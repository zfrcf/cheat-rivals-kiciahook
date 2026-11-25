import { join } from "node:path";
import type { Config } from "./config.js";
import { phonepilotHome } from "./config.js";
import { Errors, PilotError } from "./errors.js";
import { PhoneHub } from "./phone/hub.js";
import { AdbShell } from "./phone/shell.js";
import { Device } from "./phone/device.js";
import { AuditLog } from "./security/audit.js";
import { Guard } from "./security/guard.js";
import { wrapUntrusted } from "./security/untrusted.js";
import { AutomationStore, applyTemplate, eventMatches, type Watch } from "./automation/store.js";
import type { Ctx, Out, ToolDef } from "./tools/types.js";
import { screenTools } from "./tools/screen.js";
import { appTools } from "./tools/apps.js";
import { fileTools } from "./tools/files.js";
import { mediaTools } from "./tools/media.js";
import { commTools } from "./tools/comms.js";
import { orgTools } from "./tools/org.js";
import { systemTools } from "./tools/system.js";
import { automationTools, readValue, runSteps } from "./tools/automation.js";
import { metaTools } from "./tools/meta.js";

export const ALL_TOOLS: ToolDef[] = [
  ...screenTools,
  ...appTools,
  ...fileTools,
  ...mediaTools,
  ...commTools,
  ...orgTools,
  ...systemTools,
  ...automationTools,
  ...metaTools,
];

/**
 * Cœur du bridge : exécute un outil en appliquant, dans l'ordre,
 * arrêt d'urgence → confirmation sur le téléphone → capture avant → action → capture après → audit.
 */
export class Runtime {
  readonly tools = new Map(ALL_TOOLS.map((t) => [t.name, t]));
  readonly hub: PhoneHub;
  readonly device: Device;
  readonly audit: AuditLog;
  readonly guard = new Guard();
  readonly automation: AutomationStore;
  readonly state = new Map<string, any>();

  constructor(public cfg: Config) {
    this.hub = new PhoneHub(cfg.pairingToken);
    this.device = new Device(this.hub, new AdbShell(cfg.adbPath, cfg.adbSerial));
    this.audit = new AuditLog(join(phonepilotHome(), "audit"));
    this.automation = new AutomationStore(phonepilotHome());
    this.state.set("automation", this.automation);
    this.state.set("restartAutomation", () => this.startAutomation());

    this.hub.on("event", (name: string, data: any) => this.onPhoneEvent(name, data));
    this.guard.on("stop", (reason) => this.audit.write({ who: "système", tool: "emergency_stop", args: { reason }, status: "ok", ms: 0 }));
  }

  ctx(who: string): Ctx {
    return {
      device: this.device,
      cfg: this.cfg,
      audit: this.audit,
      guard: this.guard,
      who,
      state: this.state,
      run: (tool, args, w) => this.run(tool, args, w ?? who),
    };
  }

  startAutomation() {
    this.automation.startAll(
      (who, steps) => runSteps(this.ctx(who), who, steps),
      (w) => this.checkWatch(w),
    );
  }

  private async checkWatch(w: Watch) {
    const ctx = this.ctx(`surveillance:${w.name}`);
    if (this.guard.stopped) return;
    const v = await readValue(ctx, w.app, w.label);
    if (v !== undefined && v !== w.last) {
      const prev = w.last;
      w.last = v;
      w.lastAt = new Date().toISOString();
      this.automation.save();
      await this.run("notify_user", { title: `Surveillance « ${w.name} »`, text: `${w.label} : ${prev ?? "?"} → ${v}` }, ctx.who).catch(() => undefined);
    }
  }

  private async onPhoneEvent(name: string, data: any) {
    if (name === "stop") return this.guard.stop(data?.reason ?? "bouton STOP du téléphone");
    if (name === "resume") {
      this.guard.resumeFromPhone();
      this.audit.write({ who: "Antoine (téléphone)", tool: "reprise", args: {}, status: "ok", ms: 0 });
      return;
    }
    for (const t of this.automation.data.triggers) {
      if (!eventMatches(t, name, data)) continue;
      const who = `déclencheur:${t.name}`;
      try {
        if (t.confirm) await this.askConfirmation("declencheur", `Déclencheur « ${t.name} » (${name} de ${data.name ?? data.from ?? data.number ?? data.app ?? "?"}) : exécuter ?`);
        await runSteps(this.ctx(who), who, applyTemplate(t.steps, data));
      } catch (e: any) {
        this.audit.write({ who, tool: "déclencheur", args: { event: name }, status: "erreur", ms: 0, detail: e.message });
      }
    }
  }

  async askConfirmation(category: string, summary: string): Promise<void> {
    if (!this.hub.has("confirm.request")) {
      throw new PilotError(
        "CONFIRMATION_UNAVAILABLE",
        `Action sensible (${category}) : confirmation impossible car l'app compagnon n'est pas connectée.`,
        "Demande à Antoine de la faire lui-même, ou d'ouvrir l'app PhonePilot.",
      );
    }
    const r = await this.hub.request<{ approved: boolean }>(
      "confirm.request",
      { category, summary, timeoutSec: this.cfg.confirmTimeoutSec },
      (this.cfg.confirmTimeoutSec + 10) * 1000,
    );
    if (!r.approved) throw Errors.denied(summary);
  }

  private async snapshot(label: string): Promise<string | undefined> {
    if (!this.cfg.auditScreenshots) return undefined;
    try {
      const r = await this.device.call("screen.capture", {}, 10000);
      return this.audit.saveImage(label, r.data);
    } catch {
      return undefined;
    }
  }

  async run(name: string, args: any, who = "claude"): Promise<Out> {
    const def = this.tools.get(name);
    if (!def) throw new PilotError("UNKNOWN_TOOL", `Outil inconnu : ${name}`);
    const t0 = Date.now();
    const ctx = this.ctx(who);
    let before: string | undefined;
    let confirmed = false;
    try {
      if (def.kind !== "meta") this.guard.assertRunning();
      const need = def.confirm ? await def.confirm(args, ctx) : null;
      if (need && this.cfg.confirmCategories.includes(need.category)) {
        await this.askConfirmation(need.category, need.summary);
        confirmed = true;
        before = await this.snapshot(`${name}_avant`);
      }
      const out = await def.run(args, ctx);
      const after = confirmed ? await this.snapshot(`${name}_apres`) : undefined;
      if (def.kind === "act" && this.automation.recording && who === "claude") this.automation.recording.steps.push({ tool: name, args });
      this.audit.write({ who, tool: name, args, status: "ok", ms: Date.now() - t0, before, after, detail: confirmed ? "confirmé par Antoine" : undefined });
      return out;
    } catch (e: any) {
      const status = e.code === "USER_DENIED" ? "refusé" : e.code === "EMERGENCY_STOP" || e.code === "FORBIDDEN" ? "bloqué" : "erreur";
      this.audit.write({ who, tool: name, args, status, ms: Date.now() - t0, before, detail: e.message });
      throw e;
    }
  }
}

/** Conversion d'un résultat d'outil en contenu MCP. */
export function toMcpContent(out: Out): any[] {
  const content: any[] = [];
  if (out.image) content.push({ type: "image", data: out.image.data, mimeType: out.image.mime });
  let text = out.text ?? (out.json !== undefined ? JSON.stringify(out.json, null, 1) : undefined);
  if (text !== undefined) {
    if (out.untrusted) text = wrapUntrusted(out.untrusted, text);
    content.push({ type: "text", text });
  }
  if (!content.length) content.push({ type: "text", text: "ok" });
  return content;
}
