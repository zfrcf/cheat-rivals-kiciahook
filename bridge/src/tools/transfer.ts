import { createReadStream, mkdirSync, openSync, closeSync, writeSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { PilotError } from "../errors.js";
import type { Ctx } from "./types.js";

const CHUNK = 512 * 1024;

/** Téléphone → Mac. ADB si dispo (rapide), sinon par morceaux via l'app (fonctionne en 4G). */
export async function pullFile(ctx: Ctx, remote: string, localDir = ctx.cfg.inboxDir): Promise<{ local: string; bytes: number; via: string }> {
  mkdirSync(localDir, { recursive: true });
  const local = uniquePath(join(localDir, basename(remote)));
  if (await ctx.device.adb.available()) {
    await ctx.device.adb.pull(remote, local);
    return { local, bytes: statSync(local).size, via: "adb" };
  }
  if (!ctx.device.hub.has("file.read_chunk")) throw new PilotError("NO_TRANSFER_PATH", "Aucun canal de transfert (ni ADB ni app).");
  const st = await ctx.device.call("file.stat", { path: remote });
  if (st.dir) throw new PilotError("IS_DIR", `${remote} est un dossier : utilise archive_zip puis file_pull.`);
  const fd = openSync(local, "w");
  try {
    for (let off = 0; off < st.size; off += CHUNK) {
      const r = await ctx.device.call("file.read_chunk", { path: remote, offset: off, length: CHUNK }, 60000);
      writeSync(fd, Buffer.from(r.data, "base64"));
    }
  } finally {
    closeSync(fd);
  }
  return { local, bytes: st.size, via: "app" };
}

/** Mac → téléphone. */
export async function pushFile(ctx: Ctx, local: string, remoteDir = "/sdcard/Download/PhonePilot"): Promise<{ remote: string; bytes: number; via: string }> {
  const size = statSync(local).size;
  const remote = `${remoteDir.replace(/\/$/, "")}/${basename(local)}`;
  if (await ctx.device.adb.available()) {
    await ctx.device.adb.exec(`mkdir -p '${remoteDir}'`);
    await ctx.device.adb.push(local, remote);
    return { remote, bytes: size, via: "adb" };
  }
  if (!ctx.device.hub.has("file.write_chunk")) throw new PilotError("NO_TRANSFER_PATH", "Aucun canal de transfert (ni ADB ni app).");
  let off = 0;
  for await (const buf of createReadStream(local, { highWaterMark: CHUNK })) {
    await ctx.device.call("file.write_chunk", { path: remote, offset: off, append: off > 0, data: (buf as Buffer).toString("base64") }, 60000);
    off += (buf as Buffer).length;
  }
  if (size === 0) await ctx.device.call("file.write_chunk", { path: remote, offset: 0, append: false, data: "" });
  return { remote, bytes: size, via: "app" };
}

function uniquePath(p: string): string {
  try {
    statSync(p);
  } catch {
    return p;
  }
  const dot = p.lastIndexOf(".");
  const stamp = `_${Date.now()}`;
  return dot > p.lastIndexOf("/") ? p.slice(0, dot) + stamp + p.slice(dot) : p + stamp;
}
