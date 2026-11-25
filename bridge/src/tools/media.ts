import { z } from "zod";
import { tool, type ToolDef } from "./types.js";
import { readBytes } from "./transfer.js";
import type { Ctx } from "./types.js";

const give = (ctx: Ctx, path: string) => ctx.platform.deliver(ctx, path);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mediaTools: ToolDef[] = [
  tool({
    name: "photos_list",
    kind: "observe",
    description: "List latest photos/videos from the gallery (MediaStore) with date, size, GPS location if present.",
    schema: {
      limit: z.number().default(20),
      after: z.string().optional().describe("ISO date"),
      before: z.string().optional(),
      kind: z.enum(["photo", "video", "all"]).default("photo"),
      near: z.object({ lat: z.number(), lon: z.number(), radius_km: z.number().default(2) }).optional(),
    },
    run: async (a, ctx) => ({ json: await ctx.device.call("photos.list", a, 60000) }),
  }),
  tool({
    name: "photos_pull",
    kind: "act",
    description: "Get photos selected by date range and/or location: zipped on the phone and returned as one download link (or copied to the Mac in Mac mode).",
    schema: {
      after: z.string().optional(),
      before: z.string().optional(),
      near: z.object({ lat: z.number(), lon: z.number(), radius_km: z.number().default(2) }).optional(),
      limit: z.number().default(50),
      local_dir: z.string().optional(),
    },
    run: async (a, ctx) => {
      const list: { path: string }[] = await ctx.device.call("photos.list", { ...a, kind: "all" }, 60000);
      if (!list.length) return { json: { count: 0 } };
      if (ctx.platform.kind === "mac") {
        const out = [];
        for (const p of list) out.push(await ctx.platform.deliver(ctx, p.path, a.local_dir));
        return { json: { count: out.length, files: out.map((f) => f.local) } };
      }
      const zip = `/sdcard/Download/PhonePilot/photos_${Date.now()}.zip`;
      await ctx.device.call("archive.zip", { paths: list.map((p) => p.path), dest: zip }, 300000);
      return { json: { count: list.length, ...(await give(ctx, zip)) } };
    },
  }),
  tool({
    name: "camera_capture",
    kind: "act",
    description: "Take a photo with the back or front camera (opens the camera app and presses the shutter), then return a download link.",
    schema: { camera: z.enum(["back", "front"]).default("back"), pull: z.boolean().default(true).describe("Return a download link / Mac copy") },
    run: async (a, ctx) => {
      const before = Date.now();
      await ctx.device.call("camera.open", { mode: "photo", front: a.camera === "front" });
      await sleep(2500);
      await ctx.device.call("camera.shutter");
      await sleep(2500);
      const [last] = await ctx.device.call("photos.list", { limit: 1, kind: "photo", after: new Date(before - 5000).toISOString() });
      if (!last) return { json: { ok: false, note: "Photo non détectée : vérifier l'écran (ui_tree) — le déclencheur a peut-être un autre libellé." } };
      if (!a.pull) return { json: last };
      const data = await readBytes(ctx, last.path).catch(() => undefined);
      return { image: data && { data: Buffer.from(data).toString("base64"), mime: "image/jpeg" }, json: await give(ctx, last.path) };
    },
  }),
  tool({
    name: "video_capture",
    kind: "act",
    description: "Record a short video (seconds) with the camera app, then optionally pull it to the Mac.",
    schema: { seconds: z.number().max(120).default(10), camera: z.enum(["back", "front"]).default("back"), pull: z.boolean().default(true).describe("Return a download link / Mac copy") },
    run: async (a, ctx) => {
      const before = Date.now();
      await ctx.device.call("camera.open", { mode: "video", front: a.camera === "front" });
      await sleep(2500);
      await ctx.device.call("camera.shutter");
      await sleep(a.seconds * 1000);
      await ctx.device.call("camera.shutter");
      await sleep(3000);
      const [last] = await ctx.device.call("photos.list", { limit: 1, kind: "video", after: new Date(before - 5000).toISOString() });
      if (!last) return { json: { ok: false, note: "Vidéo non détectée : vérifier l'écran." } };
      return { json: a.pull ? await give(ctx, last.path) : last };
    },
  }),
  tool({
    name: "audio_record",
    kind: "act",
    description: "Record a voice memo with the microphone (companion app foreground service), saved to /sdcard/Recordings/PhonePilot.",
    schema: { seconds: z.number().max(3600).default(30), pull: z.boolean().default(true).describe("Return a download link / Mac copy") },
    run: async (a, ctx) => {
      const r = await ctx.device.call("audio.record", { seconds: a.seconds }, a.seconds * 1000 + 20000);
      return { json: a.pull ? await give(ctx, r.path) : r };
    },
  }),
  tool({
    name: "media_control",
    kind: "act",
    description: "Control music/media playback: play_pause, next, previous, stop.",
    schema: { action: z.enum(["play_pause", "next", "previous", "stop"]) },
    run: async (a, ctx) => ({ json: await ctx.device.call("media.key", { action: a.action }) }),
  }),
  tool({
    name: "volume_set",
    kind: "act",
    description: "Set volume for a stream: media, ring, alarm, notification, voice, system. level is 0-15 (media) or 0-7 typical for others; use percent instead for convenience.",
    schema: { stream: z.enum(["media", "ring", "alarm", "notification", "voice", "system"]), level: z.number().optional(), percent: z.number().min(0).max(100).optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("volume.set", a) }),
  }),
  tool({
    name: "tts_say",
    kind: "act",
    description: "Make the phone speak a text aloud (French voice by default).",
    schema: { text: z.string(), lang: z.string().default("fr-FR") },
    run: async (a, ctx) => ({ json: await ctx.device.call("tts.say", a, 60000) }),
  }),
];
