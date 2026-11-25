import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Config } from "../config.js";
import { phonepilotHome } from "../config.js";
import { PilotError } from "../errors.js";
import { PhoneHub } from "../phone/hub.js";
import { AdbShell } from "../phone/adb.js";
import { AuditLog } from "../security/audit.js";
import { AutomationStore } from "../automation/store.js";
import { Runtime } from "../runtime.js";
import { readBytes } from "../tools/transfer.js";
import type { Ctx, Delivered, Platform } from "../tools/types.js";

/** Mode « Mac » (local) : fichiers copiés dans ~/PhonePilot, ADB disponible. Conservé pour les tests et l'usage câblé. */
export function createNodeRuntime(cfg: Config) {
  const hub = new PhoneHub(cfg.pairingToken);
  const adb = new AdbShell(cfg.adbPath, cfg.adbSerial);
  const autoFile = join(phonepilotHome(), "automation.json");
  const automation = new AutomationStore(existsSync(autoFile) ? JSON.parse(readFileSync(autoFile, "utf8")) : undefined, (d) =>
    writeFileSync(autoFile, JSON.stringify(d, null, 2), { mode: 0o600 }),
  );
  let rt: Runtime;
  const platform: Platform = {
    kind: "mac",
    async deliver(ctx: Ctx, remote: string, dir = cfg.inboxDir): Promise<Delivered> {
      mkdirSync(dir, { recursive: true });
      const local = unique(join(dir, basename(remote)));
      if (await adb.available()) await adb.pull(remote, local);
      else writeFileSync(local, await readBytes(ctx, remote, 2 * 1024 ** 3));
      return { path: remote, local, bytes: statSync(local).size };
    },
    async source(src: string) {
      if (/^https:\/\//.test(src)) {
        const r = await fetch(src);
        if (!r.ok) throw new PilotError("DOWNLOAD_FAILED", `Téléchargement impossible (${r.status}) : ${src}`);
        return { name: basename(new URL(src).pathname) || "fichier", data: new Uint8Array(await r.arrayBuffer()) };
      }
      if (!existsSync(src)) throw new PilotError("FILE_NOT_FOUND", `Introuvable sur le Mac : ${src}`);
      return { name: basename(src), data: readFileSync(src) };
    },
    async pdfToText(data: Uint8Array) {
      try {
        const f = join(mkdtempSync(join(tmpdir(), "pp-")), "doc.pdf");
        writeFileSync(f, data);
        return execFileSync("pdftotext", ["-layout", f, "-"], { maxBuffer: 50 * 1024 * 1024 }).toString();
      } catch {
        return undefined;
      }
    },
    async readBytes(_ctx: Ctx, remote: string) {
      if (!(await adb.available())) throw new PilotError("PHONE_OFFLINE", "Ni app ni ADB pour lire ce fichier.");
      const f = join(mkdtempSync(join(tmpdir(), "pp-")), basename(remote));
      await adb.pull(remote, f);
      return readFileSync(f);
    },
    oneShot(at, tool, args) {
      automation.addOneShot(at, tool, args);
      rt?.startAutomation();
    },
  };
  rt = new Runtime(cfg, { link: hub, adb, audit: new AuditLog(join(phonepilotHome(), "audit")), platform, automation });
  return { rt, hub };
}

function unique(p: string): string {
  if (!existsSync(p)) return p;
  const dot = p.lastIndexOf(".");
  const stamp = `_${Date.now()}`;
  return dot > p.lastIndexOf("/") ? p.slice(0, dot) + stamp + p.slice(dot) : p + stamp;
}

