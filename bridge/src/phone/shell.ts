import { PilotError } from "../errors.js";
import type { PhoneLink } from "./hub.js";

/** Shell de niveau ADB : via le câble/Wi-Fi ADB du Mac, ou via Shizuku dans l'app. */
export interface Shell {
  kind: "adb" | "shizuku";
  exec(cmd: string, timeoutMs?: number): Promise<string>;
  execBinary(cmd: string, timeoutMs?: number): Promise<Buffer>;
}

/** Échappe un argument pour /system/bin/sh. */
export const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export interface AdbLike extends Shell {
  available(): Promise<boolean>;
}

/** Mode cloud : pas d'ADB. */
export class NoAdb implements AdbLike {
  kind = "adb" as const;
  async available() {
    return false;
  }
  async exec(): Promise<string> {
    throw new PilotError("NO_ADB", "ADB indisponible en mode cloud.");
  }
  async execBinary(): Promise<Buffer> {
    throw new PilotError("NO_ADB", "ADB indisponible en mode cloud.");
  }
}

export class ShizukuShell implements Shell {
  kind = "shizuku" as const;
  constructor(private hub: PhoneLink) {}

  async exec(cmd: string, timeoutMs = 30000): Promise<string> {
    const r = await this.hub.request<{ stdout: string; stderr: string; code: number }>("shell.exec", { cmd }, timeoutMs);
    if (r.code !== 0 && !r.stdout) throw new PilotError("SHELL_FAILED", `Shizuku : ${r.stderr.trim() || `code ${r.code}`}`);
    return r.stdout;
  }

  async execBinary(cmd: string, timeoutMs = 30000): Promise<Buffer> {
    const out = await this.exec(`${cmd} | base64 -w 0`, timeoutMs);
    return Buffer.from(out.replace(/\s+/g, ""), "base64");
  }
}
