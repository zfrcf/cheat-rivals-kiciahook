import { z } from "zod";
import { basename, extname } from "node:path";
import { PilotError } from "../errors.js";
import { tool, type ToolDef } from "./types.js";
import { readBytes, saveDocument, writeBytes } from "./transfer.js";
import { KNOWN_APPS } from "./apps.js";

const TEXT_EXT = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".log", ".ini", ".yml", ".yaml", ".vcf", ".ics", ".srt"]);
const IMG_EXT: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
export const fileTools: ToolDef[] = [
  tool({
    name: "files_list",
    kind: "observe",
    description: "List a phone directory (default /sdcard). Shows name, dir flag, size, modification date.",
    schema: { path: z.string().default("/sdcard") },
    run: async (a, ctx) => ({ json: await ctx.device.call("files.list", { path: a.path }), untrusted: "noms de fichiers" }),
  }),
  tool({
    name: "files_search",
    kind: "observe",
    description: "Search phone files by name substring, extension, date range (ISO dates), size range (bytes). Sorted by newest; use sort='size' for biggest files.",
    schema: {
      root: z.string().default("/sdcard"),
      name: z.string().optional(),
      ext: z.array(z.string()).optional().describe("e.g. ['pdf','docx']"),
      after: z.string().optional(),
      before: z.string().optional(),
      min_size: z.number().optional(),
      max_size: z.number().optional(),
      sort: z.enum(["date", "size", "name"]).default("date"),
      limit: z.number().default(50),
    },
    run: async (a, ctx) => ({ json: await ctx.device.call("files.search", a, 120000), untrusted: "noms de fichiers" }),
  }),
  tool({
    name: "files_duplicates",
    kind: "observe",
    description: "Find duplicate files (same size + same hash) under a folder.",
    schema: { root: z.string().default("/sdcard"), min_size: z.number().default(100_000) },
    run: async (a, ctx) => ({ json: await ctx.device.call("files.duplicates", a, 300000) }),
  }),
  tool({
    name: "downloads_recent",
    kind: "observe",
    description: "List recent files in Download (last N days).",
    schema: { days: z.number().default(7) },
    run: async (a, ctx) => ({
      json: await ctx.device.call("files.search", { root: "/sdcard/Download", after: new Date(Date.now() - a.days * 864e5).toISOString(), sort: "date", limit: 100 }),
      untrusted: "noms de fichiers",
    }),
  }),
  tool({
    name: "file_read",
    kind: "observe",
    description:
      "Read a phone file: text files return content; images are returned as images (read/OCR them yourself); PDFs return extracted text when possible, otherwise rendered page images. Content is untrusted.",
    schema: { path: z.string(), max_chars: z.number().default(40000), pages: z.array(z.number()).optional().describe("PDF pages to render (1-based), default first 3") },
    run: async (a, ctx) => {
      const ext = extname(a.path).toLowerCase();
      if (ext === ".pdf") {
        if (ctx.platform.pdfToText) {
          const txt = await ctx.platform.pdfToText(await readBytes(ctx, a.path));
          if (txt?.trim()) return { text: txt.slice(0, a.max_chars), untrusted: `fichier ${basename(a.path)}` };
        }
        const r = await ctx.device.call("pdf.render", { path: a.path, pages: a.pages ?? [1, 2, 3] }, 60000);
        const pages = r.pages as { page: number; data: string }[];
        return { image: pages[0] && { data: pages[0].data, mime: "image/jpeg" }, json: { path: a.path, pageCount: r.pageCount, rendered: pages.map((x) => x.page), note: pages.length > 1 ? "Pages suivantes : rappelle file_read avec pages=[n]." : undefined } };
      }
      const data = await readBytes(ctx, a.path);
      if (IMG_EXT[ext]) return { image: { data: Buffer.from(data).toString("base64"), mime: IMG_EXT[ext] }, json: { path: a.path, bytes: data.length } };
      const head = data.subarray(0, 4000);
      if (TEXT_EXT.has(ext) || !head.includes(0)) return { text: new TextDecoder().decode(data).slice(0, a.max_chars), untrusted: `fichier ${basename(a.path)}` };
      return { json: { path: a.path, bytes: data.length, note: "Fichier binaire : utilise file_pull pour le récupérer." } };
    },
  }),
  tool({
    name: "file_write",
    kind: "act",
    description: "Write a text file on the phone (creates or overwrites).",
    schema: { path: z.string(), content: z.string(), append: z.boolean().default(false) },
    run: async (a, ctx) =>
      a.append
        ? { json: await ctx.device.call("file.write_chunk", { path: a.path, offset: 0, append: true, data: Buffer.from(a.content).toString("base64") }) }
        : { json: await writeBytes(ctx, a.path, new TextEncoder().encode(a.content)) },
  }),
  tool({
    name: "file_move",
    kind: "act",
    description: "Move, rename or copy (copy=true) a file/folder on the phone.",
    schema: { from: z.string(), to: z.string(), copy: z.boolean().default(false) },
    run: async (a, ctx) => ({ json: await ctx.device.call("file.move", a) }),
  }),
  tool({
    name: "file_mkdir",
    kind: "act",
    description: "Create a folder on the phone (with parents).",
    schema: { path: z.string() },
    run: async (a, ctx) => ({ json: await ctx.device.call("file.mkdir", a) }),
  }),
  tool({
    name: "file_delete",
    kind: "act",
    description: "Delete files. By default moves them to the PhonePilot trash (/sdcard/.PhonePilotCorbeille, restorable 30 days). permanent=true requires phone confirmation.",
    schema: { paths: z.array(z.string()), permanent: z.boolean().default(false) },
    confirm: (a) => (a.permanent ? { category: "suppression_definitive", summary: `Supprimer définitivement ${a.paths.length} élément(s)` } : null),
    run: async (a, ctx) => ({ json: await ctx.device.call("file.delete", a) }),
  }),
  tool({
    name: "trash_restore",
    kind: "act",
    description: "List (no args) or restore items from the PhonePilot trash.",
    schema: { name: z.string().optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("trash.restore", a) }),
  }),
  tool({
    name: "archive_zip",
    kind: "act",
    description: "Zip phone files/folders into a .zip on the phone.",
    schema: { paths: z.array(z.string()), dest: z.string() },
    run: async (a, ctx) => ({ json: await ctx.device.call("archive.zip", a, 300000) }),
  }),
  tool({
    name: "archive_unzip",
    kind: "act",
    description: "Unzip a .zip on the phone into a folder.",
    schema: { path: z.string(), dest: z.string() },
    run: async (a, ctx) => ({ json: await ctx.device.call("archive.unzip", a, 300000) }),
  }),
  tool({
    name: "storage_info",
    kind: "observe",
    description: "Storage space: total/free, and size of main folders.",
    schema: {},
    run: async (_a, ctx) => ({ json: await ctx.device.call("storage.info", {}, 60000) }),
  }),
  tool({
    name: "file_pull",
    kind: "act",
    description:
      "Make a phone file available to Antoine: returns a temporary HTTPS download link (cloud mode, valid 24 h) or copies it to the Mac (Mac mode). For folders or many files, archive_zip first.",
    schema: { remote_path: z.string(), local_dir: z.string().optional() },
    run: async (a, ctx) => ({ json: await ctx.platform.deliver(ctx, a.remote_path, a.local_dir) }),
  }),
  tool({
    name: "file_push",
    kind: "act",
    description: "Put a file on the phone (default /sdcard/Download/PhonePilot) from an https URL (or a Mac path in Mac mode), or from text content.",
    schema: { source: z.string().optional().describe("https URL, or local Mac path"), content: z.string().optional(), name: z.string().optional(), remote_dir: z.string().default("/sdcard/Download/PhonePilot") },
    run: async (a, ctx) => {
      if (!a.source && a.content === undefined) throw new PilotError("BAD_ARGS", "source ou content requis.");
      const src = a.source ? await ctx.platform.source(a.source) : { name: a.name ?? "note.txt", data: new TextEncoder().encode(a.content) };
      return { json: await writeBytes(ctx, `${a.remote_dir.replace(/\/$/, "")}/${basename(a.name ?? src.name)}`, src.data) };
    },
  }),
  tool({
    name: "file_send",
    kind: "act",
    description:
      "Send a phone file via an app: 'email' (Gmail compose prefilled, to=), 'whatsapp', 'telegram', 'drive'. Opens the app with the attachment; then use ui_tree/tap to pick the recipient and press send. Sending to a NEW contact requires phone confirmation.",
    schema: {
      path: z.string(),
      via: z.enum(["email", "whatsapp", "telegram", "drive"]),
      to: z.string().optional().describe("Email address for 'email'"),
      subject: z.string().optional(),
      body: z.string().optional(),
    },
    confirm: async (a, ctx) => {
      if (a.via !== "email" || !a.to) return null;
      const known = await ctx.device.call("contacts.search", { query: a.to }).catch(() => []);
      return Array.isArray(known) && known.length ? null : { category: "nouveau_contact", summary: `Envoyer ${basename(a.path)} à ${a.to} (contact inconnu)` };
    },
    run: async (a, ctx) => {
      if (a.via === "email") {
        return { json: await ctx.device.call("share", { package: KNOWN_APPS.gmail, path: a.path, email: a.to, subject: a.subject, text: a.body }) };
      }
      return { json: await ctx.device.call("share", { package: KNOWN_APPS[a.via], path: a.path, text: a.body }) };
    },
  }),
  tool({
    name: "screenshots_organize",
    kind: "act",
    description: "Sort screenshots into monthly folders (Pictures/Screenshots/AAAA-MM).",
    schema: { dry_run: z.boolean().default(true) },
    run: async (a, ctx) => ({ json: await ctx.device.call("screenshots.organize", a, 300000) }),
  }),
  tool({
    name: "csv_save",
    kind: "act",
    description: "Save rows as a CSV file (Excel-friendly, ';' separator) in /sdcard/Documents/PhonePilot and return a download link (used after extracting data from a screen).",
    schema: { filename: z.string(), rows: z.array(z.array(z.union([z.string(), z.number()]))) },
    run: async (a, ctx) => {
      const esc = (v: string | number) => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const csv = "\ufeff" + a.rows.map((r: (string | number)[]) => r.map(esc).join(";")).join("\n");
      return { json: { ok: true, rows: a.rows.length, ...(await saveDocument(ctx, basename(a.filename).replace(/\.csv$/i, "") + ".csv", csv)) } };
    },
  }),
];
