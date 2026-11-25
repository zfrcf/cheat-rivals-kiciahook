import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PilotError } from "../errors.js";
import type { AdbLike } from "./shell.js";

const pexec = promisify(execFile);

/** ADB depuis le Mac (mode local uniquement). */
export class AdbShell implements AdbLike {
  kind = "adb" as const;
  private lastCheck = 0;
  private lastOk = false;

  constructor(
    private adbPath: string,
    private serial?: string,
  ) {}

  private args(...rest: string[]) {
    return this.serial ? ["-s", this.serial, ...rest] : rest;
  }

  async available(): Promise<boolean> {
    if (Date.now() - this.lastCheck < 3000) return this.lastOk;
    this.lastCheck = Date.now();
    try {
      const { stdout } = await pexec(this.adbPath, this.args("get-state"), { timeout: 3000 });
      this.lastOk = stdout.trim() === "device";
    } catch {
      this.lastOk = false;
    }
    return this.lastOk;
  }

  async exec(cmd: string, timeoutMs = 30000): Promise<string> {
    try {
      const { stdout } = await pexec(this.adbPath, this.args("shell", cmd), {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout;
    } catch (e: any) {
      throw new PilotError("SHELL_FAILED", `adb shell a échoué : ${(e.stderr || e.message || "").toString().trim()}`);
    }
  }

  async execBinary(cmd: string, timeoutMs = 30000): Promise<Buffer> {
    const { stdout } = await pexec(this.adbPath, this.args("exec-out", cmd), {
      timeout: timeoutMs,
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
    });
    return stdout as unknown as Buffer;
  }

  async pull(remote: string, local: string): Promise<void> {
    await pexec(this.adbPath, this.args("pull", remote, local), { timeout: 600000 });
  }

  async push(local: string, remote: string): Promise<void> {
    await pexec(this.adbPath, this.args("push", local, remote), { timeout: 600000 });
  }

  async install(apk: string): Promise<string> {
    const { stdout } = await pexec(this.adbPath, this.args("install", "-r", apk), { timeout: 300000 });
    return stdout.trim();
  }

  /** Bascule ADB en Wi-Fi (Phase 1) : renvoie l'adresse ip:5555 à utiliser avec `adb connect`. */
  async enableTcpip(): Promise<string> {
    const ipOut = await this.exec("ip -f inet addr show wlan0");
    const ip = ipOut.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1];
    await pexec(this.adbPath, this.args("tcpip", "5555"), { timeout: 10000 });
    if (!ip) throw new PilotError("NO_WIFI_IP", "Impossible de lire l'IP Wi-Fi du téléphone.");
    return `${ip}:5555`;
  }
}

