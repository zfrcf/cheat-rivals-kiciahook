import { PilotError } from "../errors.js";
import type { Ctx } from "./types.js";

/** Transferts génériques via l'app compagnon (fonctionnent en 4G, sans Mac ni câble). */
const CHUNK = 512 * 1024;
export const MAX_READ = 15 * 1024 * 1024;

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

export async function readBytes(ctx: Ctx, remote: string, max = MAX_READ): Promise<Uint8Array> {
  if (!ctx.device.hub.has("file.read_chunk")) {
    if (ctx.platform.readBytes) return ctx.platform.readBytes(ctx, remote, max);
    throw new PilotError("COMPANION_REQUIRED", "Lecture de fichier impossible : app PhonePilot non connectée.");
  }
  const st = await ctx.device.call("file.stat", { path: remote });
  if (st.dir) throw new PilotError("IS_DIR", `${remote} est un dossier.`);
  if (st.size > max) throw new PilotError("TOO_LARGE", `${remote} fait ${(st.size / 1e6).toFixed(1)} Mo (max ${max / 1e6} Mo en lecture directe).`, "Utilise file_pull pour obtenir un lien de téléchargement.");
  const out = new Uint8Array(st.size);
  for (let off = 0; off < st.size; off += CHUNK) {
    const r = await ctx.device.call("file.read_chunk", { path: remote, offset: off, length: CHUNK }, 60000);
    out.set(Buffer.from(r.data, "base64"), off);
  }
  return out;
}

export async function writeBytes(ctx: Ctx, remote: string, data: Uint8Array): Promise<{ path: string; bytes: number }> {
  if (data.length === 0) await ctx.device.call("file.write_chunk", { path: remote, offset: 0, append: false, data: "" });
  for (let off = 0; off < data.length; off += CHUNK) {
    await ctx.device.call("file.write_chunk", { path: remote, offset: off, append: off > 0, data: b64(data.subarray(off, off + CHUNK)) }, 60000);
  }
  return { path: remote, bytes: data.length };
}

/** Écrit un document produit par Claude sur le téléphone (Documents/PhonePilot) et le rend accessible. */
export async function saveDocument(ctx: Ctx, name: string, content: string | Uint8Array) {
  const path = `/sdcard/Documents/PhonePilot/${name.replace(/[\/\\]/g, "_")}`;
  const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
  await writeBytes(ctx, path, data);
  return ctx.platform.deliver(ctx, path);
}
