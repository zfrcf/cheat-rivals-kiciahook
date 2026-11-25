import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import { PilotError } from "../errors.js";
import { findNode } from "../phone/uitree.js";
import { fieldNear } from "../phone/uitree.js";
import type { AutomationStore, Step } from "../automation/store.js";
import { TZ } from "../automation/store.js";
import { tool, type Ctx, type ToolDef } from "./types.js";
import { pullFile } from "./transfer.js";

const stepSchema = z.object({ tool: z.string(), args: z.record(z.any()).optional() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const store = (ctx: Ctx) => ctx.state.get("automation") as AutomationStore;

function validCron(expr: string) {
  try {
    new Cron(expr, { timezone: TZ, paused: true }).stop();
  } catch (e: any) {
    throw new PilotError("BAD_CRON", `Expression cron invalide : ${e.message}`, "Format : 'min heure jour mois jourSemaine', ex '0 8 * * *' = chaque jour à 8 h.");
  }
}

export async function runSteps(ctx: Ctx, who: string, steps: Step[]) {
  const results = [];
  for (const s of steps) {
    if (["macro_play", "schedule_task", "trigger_create"].includes(s.tool)) throw new PilotError("FORBIDDEN", "Récursion d'automatisation interdite.");
    results.push({ tool: s.tool, result: await ctx.run(s.tool, s.args ?? {}, who) });
    await sleep(400);
  }
  return results;
}

/** Lit la valeur affichée à côté d'un libellé (pour la surveillance). */
export async function readValue(ctx: Ctx, app: string, label: string): Promise<string | undefined> {
  await ctx.run("app_open", { app }, ctx.who);
  await sleep(2500);
  const nodes = await ctx.device.tree();
  const l = findNode(nodes, { text: label });
  if (!l) return undefined;
  const idx = nodes.indexOf(l);
  const next = nodes.slice(idx + 1).find((n) => n.text && n.text !== l.text);
  return next?.text;
}

export const automationTools: ToolDef[] = [
  tool({
    name: "macro_record",
    kind: "meta",
    description: "Start or stop recording a macro: every action tool you call between start and stop is saved under that name.",
    schema: { name: z.string(), action: z.enum(["start", "stop", "cancel"]) },
    run: async (a, ctx) => {
      const st = store(ctx);
      if (a.action === "start") {
        st.recording = { name: a.name, steps: [] };
        return { json: { ok: true, note: `Enregistrement de « ${a.name} » démarré.` } };
      }
      if (!st.recording) throw new PilotError("NOT_RECORDING", "Aucun enregistrement en cours.");
      const rec = st.recording;
      st.recording = undefined;
      if (a.action === "cancel") return { json: { ok: true, note: "Annulé." } };
      st.data.macros[rec.name] = rec.steps;
      st.save();
      return { json: { ok: true, name: rec.name, steps: rec.steps } };
    },
  }),
  tool({
    name: "macro_play",
    kind: "act",
    description: "Replay a recorded macro (or list macros if name omitted). All safety checks apply to each step.",
    schema: { name: z.string().optional() },
    run: async (a, ctx) => {
      const st = store(ctx);
      if (!a.name) return { json: st.data.macros };
      const steps = st.data.macros[a.name];
      if (!steps) throw new PilotError("NO_MACRO", `Macro inconnue : ${a.name}`);
      return { json: await runSteps(ctx, `macro:${a.name}`, steps) };
    },
  }),
  tool({
    name: "schedule_task",
    kind: "act",
    description:
      "Create/replace a scheduled task (Europe/Paris time) that runs a fixed list of tool steps, e.g. every morning at 8:00 → cron '0 8 * * *', steps [{tool:'daily_report'}]. Steps run without an LLM and keep all confirmations.",
    schema: { name: z.string(), cron: z.string(), steps: z.array(stepSchema).min(1) },
    run: async (a, ctx) => {
      validCron(a.cron);
      const st = store(ctx);
      st.data.schedules = st.data.schedules.filter((s) => s.name !== a.name).concat({ name: a.name, cron: a.cron, steps: a.steps, created: new Date().toISOString() });
      st.save();
      ctx.state.get("restartAutomation")?.();
      return { json: { ok: true, next: st.nextRuns()[`s:${a.name}`] } };
    },
  }),
  tool({
    name: "trigger_create",
    kind: "act",
    description:
      "Create an event trigger: event ∈ notification, missed_call, sms; match {app?, from?, contains?}; steps may use {{event.from}}, {{event.name}}, {{event.number}}, {{event.app}} (never the message body). Each firing asks confirmation on the phone unless confirm=false.",
    schema: {
      name: z.string(),
      event: z.enum(["notification", "missed_call", "sms"]),
      match: z.object({ app: z.string().optional(), from: z.string().optional(), contains: z.string().optional() }).default({}),
      steps: z.array(stepSchema).min(1),
      confirm: z.boolean().default(true),
    },
    run: async (a, ctx) => {
      const st = store(ctx);
      st.data.triggers = st.data.triggers.filter((t) => t.name !== a.name).concat({ ...a, created: new Date().toISOString() });
      st.save();
      return { json: { ok: true } };
    },
  }),
  tool({
    name: "watch_create",
    kind: "act",
    description: "Monitor a value shown in an app (the text next to a label) on a cron schedule and alert on change (phone notification + audit).",
    schema: { name: z.string(), app: z.string(), label: z.string(), cron: z.string().default("0 * * * *") },
    run: async (a, ctx) => {
      validCron(a.cron);
      const st = store(ctx);
      const first = await readValue(ctx, a.app, a.label);
      st.data.watches = st.data.watches.filter((w) => w.name !== a.name).concat({ ...a, last: first, lastAt: new Date().toISOString() });
      st.save();
      ctx.state.get("restartAutomation")?.();
      return { json: { ok: true, valeur_actuelle: first } };
    },
  }),
  tool({
    name: "automation_list",
    kind: "observe",
    description: "List macros, scheduled tasks (with next run), triggers and watches.",
    schema: {},
    run: async (_a, ctx) => {
      const st = store(ctx);
      return { json: { macros: Object.keys(st.data.macros), planifications: st.data.schedules, prochaines: st.nextRuns(), declencheurs: st.data.triggers, surveillances: st.data.watches } };
    },
  }),
  tool({
    name: "automation_delete",
    kind: "act",
    description: "Delete a macro, scheduled task, trigger or watch by name.",
    schema: { kind: z.enum(["macro", "schedule", "trigger", "watch"]), name: z.string() },
    run: async (a, ctx) => {
      const st = store(ctx);
      if (a.kind === "macro") delete st.data.macros[a.name];
      if (a.kind === "schedule") st.data.schedules = st.data.schedules.filter((s) => s.name !== a.name);
      if (a.kind === "trigger") st.data.triggers = st.data.triggers.filter((s) => s.name !== a.name);
      if (a.kind === "watch") st.data.watches = st.data.watches.filter((s) => s.name !== a.name);
      st.save();
      ctx.state.get("restartAutomation")?.();
      return { json: { ok: true } };
    },
  }),
  tool({
    name: "form_fill",
    kind: "act",
    description: "Fill a form in the current app: for each {label, value}, finds the input nearest to the label and types the value. Does NOT submit.",
    schema: { fields: z.array(z.object({ label: z.string(), value: z.string() })) },
    run: async (a, ctx) => {
      const report = [];
      for (const f of a.fields) {
        const field = fieldNear(await ctx.device.tree(), f.label);
        if (!field) {
          report.push({ label: f.label, ok: false });
          continue;
        }
        if (field.password) {
          report.push({ label: f.label, ok: false, note: "champ mot de passe : laissé à Antoine" });
          continue;
        }
        await ctx.device.act("set_text", field, { text: f.value, replace: true });
        report.push({ label: f.label, ok: true });
        await sleep(300);
      }
      return { json: report };
    },
  }),
  tool({
    name: "notify_user",
    kind: "act",
    description: "Show a notification on Antoine's phone (title + text). Use for alerts and reports.",
    schema: { title: z.string(), text: z.string() },
    run: async (a, ctx) => ({ json: await ctx.device.call("notify", a) }),
  }),
  tool({
    name: "backup_run",
    kind: "act",
    description: "Back up new photos (DCIM, Pictures) and documents (Documents, Download) modified since the last backup to the Mac (~/PhonePilot/Sauvegardes/AAAA-MM-JJ).",
    schema: { since: z.string().optional().describe("ISO date; default = last backup or 24h") },
    run: async (a, ctx) => {
      const st = store(ctx);
      const since = a.since ?? st.data.lastBackup ?? new Date(Date.now() - 864e5).toISOString();
      const dest = join(ctx.cfg.backupDir, new Date().toISOString().slice(0, 10));
      let count = 0;
      let bytes = 0;
      for (const root of ["/sdcard/DCIM", "/sdcard/Pictures", "/sdcard/Documents", "/sdcard/Download"]) {
        const files: { path: string }[] = await ctx.device.call("files.search", { root, after: since, limit: 2000, sort: "date" }, 120000).catch(() => []);
        for (const f of files) {
          const sub = join(dest, root.split("/").pop()!);
          const r = await pullFile(ctx, f.path, sub);
          count++;
          bytes += r.bytes;
        }
      }
      st.data.lastBackup = new Date().toISOString();
      st.save();
      return { json: { ok: true, fichiers: count, octets: bytes, dossier: dest } };
    },
  }),
  tool({
    name: "cleanup",
    kind: "act",
    description:
      "Cleanup: old downloads, old screenshots, app caches. dry_run=true (default) only lists candidates; with dry_run=false files go to the PhonePilot trash (restorable).",
    schema: { dry_run: z.boolean().default(true), downloads_older_days: z.number().default(90), screenshots_older_days: z.number().default(180), caches: z.boolean().default(true) },
    run: async (a, ctx) => {
      const before = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
      const dl: any[] = await ctx.device.call("files.search", { root: "/sdcard/Download", before: before(a.downloads_older_days), limit: 500 }, 120000);
      const sc: any[] = await ctx.device.call("files.search", { root: "/sdcard/Pictures/Screenshots", before: before(a.screenshots_older_days), limit: 1000 }, 120000);
      const all = [...dl, ...sc];
      const total = all.reduce((s, f) => s + (f.size ?? 0), 0);
      if (a.dry_run) return { json: { candidats: all.length, octets: total, exemples: all.slice(0, 20).map((f) => f.path) } };
      if (all.length) await ctx.run("file_delete", { paths: all.map((f) => f.path), permanent: false }, ctx.who);
      let caches = "non";
      if (a.caches && (await ctx.device.hasShell())) {
        await (await ctx.device.shell()).exec("pm trim-caches 999G", 120000);
        caches = "vidés";
      }
      return { json: { ok: true, deplaces_corbeille: all.length, octets: total, caches } };
    },
  }),
  tool({
    name: "daily_report",
    kind: "observe",
    description: "Daily report: battery, storage, missed calls (24h), notification summary by app. Saved to ~/PhonePilot/Rapports on the Mac; notify=true also sends a phone notification.",
    schema: { notify: z.boolean().default(false) },
    run: async (a, ctx) => {
      const safe = async (p: Promise<any>) => p.catch((e: Error) => ({ erreur: e.message }));
      const since = new Date(Date.now() - 864e5).toISOString();
      const [battery, storage, missed, notifs] = await Promise.all([
        safe(ctx.device.call("battery.info")),
        safe(ctx.device.call("storage.info", {}, 60000)),
        safe(ctx.device.call("call.log", { type: "missed", after: since, limit: 50 })),
        safe(ctx.device.call("notifications.history", { hours: 24 })),
      ]);
      const byApp: Record<string, number> = {};
      if (Array.isArray(notifs)) for (const n of notifs) byApp[n.appLabel ?? n.app] = (byApp[n.appLabel ?? n.app] ?? 0) + 1;
      const md = [
        `# Rapport PhonePilot — ${new Date().toLocaleDateString("fr-FR", { timeZone: TZ })}`,
        `- Batterie : ${battery.level ?? "?"} % (${battery.temperatureC ?? "?"} °C, ${battery.health ?? ""})`,
        `- Stockage : ${storage.freeHuman ?? storage.df ?? JSON.stringify(storage)}`,
        `- Appels manqués (24 h) : ${Array.isArray(missed) ? missed.length : "?"}${Array.isArray(missed) ? missed.slice(0, 10).map((c: any) => `\n  - ${c.name ?? c.number} à ${c.date}`).join("") : ""}`,
        `- Notifications (24 h) : ${Object.entries(byApp)
          .sort((x, y) => y[1] - x[1])
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}`,
      ].join("\n");
      const dir = join(ctx.cfg.inboxDir, "..", "Rapports");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${new Date().toISOString().slice(0, 10)}.md`);
      writeFileSync(path, md + "\n");
      if (a.notify) await ctx.device.call("notify", { title: "Rapport du jour", text: md.split("\n").slice(1).join(" · ").slice(0, 500) }).catch(() => undefined);
      return { text: md + `\n\n(Enregistré : ${path})`, untrusted: "rapport" };
    },
  }),
];
