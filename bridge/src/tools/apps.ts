import { z } from "zod";
import { PilotError } from "../errors.js";
import { findNode } from "../phone/uitree.js";
import { tool, type Ctx, type ToolDef } from "./types.js";
import { writeBytes } from "./transfer.js";

/** Résout « WhatsApp » → com.whatsapp via la liste des applis (libellés fournis par l'app compagnon). */
export async function resolvePackage(ctx: Ctx, nameOrPkg: string): Promise<string> {
  if (/^[\w]+(\.[\w]+)+$/.test(nameOrPkg)) return nameOrPkg;
  const apps: { package: string; label?: string }[] = await ctx.device.call("apps.list", { all: true });
  const t = nameOrPkg.toLowerCase();
  const hit =
    apps.find((a) => a.label?.toLowerCase() === t) ??
    apps.find((a) => a.label?.toLowerCase().includes(t)) ??
    apps.find((a) => a.package.toLowerCase().includes(t.replace(/\s+/g, "")));
  if (!hit) throw new PilotError("APP_NOT_FOUND", `Aucune appli ne correspond à « ${nameOrPkg} ».`, "Utilise apps_list pour voir les noms exacts.");
  return hit.package;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ouvre « Infos sur l'appli » et touche un bouton (repli sans shell : forcer l'arrêt…). */
async function settingsButton(ctx: Ctx, pkg: string, labels: string[], confirmLabels: string[]) {
  await ctx.device.call("intent.start", { action: "android.settings.APPLICATION_DETAILS_SETTINGS", data: `package:${pkg}` });
  await sleep(1500);
  const nodes = await ctx.device.tree();
  const btn = labels.map((l) => findNode(nodes, { text: l })).find(Boolean);
  if (!btn) throw new PilotError("UI_CHANGED", `Bouton « ${labels[0]} » introuvable.`);
  await ctx.device.act("click", btn);
  await sleep(900);
  const after = await ctx.device.tree();
  const conf = confirmLabels.map((l) => findNode(after, { text: l, exact: true })).find(Boolean);
  if (conf) await ctx.device.act("click", conf);
  await ctx.device.call("global.action", { action: "home" });
}

export const KNOWN_APPS: Record<string, string> = {
  whatsapp: "com.whatsapp",
  telegram: "org.telegram.messenger",
  gmail: "com.google.android.gm",
  drive: "com.google.android.apps.docs",
  chrome: "com.android.chrome",
  reglages: "com.android.settings",
  settings: "com.android.settings",
};

export const appTools: ToolDef[] = [
  tool({
    name: "apps_list",
    kind: "observe",
    description: "List installed apps (label + package). all=true includes system apps.",
    schema: { all: z.boolean().default(false) },
    run: async (a, ctx) => ({ json: await ctx.device.call("apps.list", { all: a.all }) }),
  }),
  tool({
    name: "app_open",
    kind: "act",
    description: "Open an app by name (e.g. 'WhatsApp', 'Réglages') or package name. Also used to switch between apps.",
    schema: { app: z.string() },
    run: async (a, ctx) => {
      const pkg = KNOWN_APPS[a.app.toLowerCase()] ?? (await resolvePackage(ctx, a.app));
      await ctx.device.call("app.open", { package: pkg });
      return { json: { ok: true, package: pkg } };
    },
  }),
  tool({
    name: "app_close",
    kind: "act",
    description: "Force-stop an app.",
    schema: { app: z.string() },
    run: async (a, ctx) => {
      const pkg = await resolvePackage(ctx, a.app);
      if (await ctx.device.can("app.close")) await ctx.device.call("app.close", { package: pkg });
      else await settingsButton(ctx, pkg, ["Forcer l'arrêt", "Arrêter", "Force stop"], ["OK", "Forcer l'arrêt"]);
      return { json: { ok: true, package: pkg } };
    },
  }),
  tool({
    name: "app_foreground",
    kind: "observe",
    description: "Return the app currently in the foreground.",
    schema: {},
    run: async (_a, ctx) => ({ json: await ctx.device.call("app.foreground") }),
  }),
  tool({
    name: "app_install",
    kind: "act",
    description: "Install an APK from an https URL (or a Mac path in Mac mode). The Android installer opens on the phone; Antoine taps Install (no silent install without Shizuku/ADB).",
    schema: { source: z.string().describe("https URL of the .apk, or Mac path") },
    run: async (a, ctx) => {
      const src = await ctx.platform.source(a.source);
      const remote = `/sdcard/Download/PhonePilot/${src.name.endsWith(".apk") ? src.name : "app.apk"}`;
      await writeBytes(ctx, remote, src.data);
      if (await ctx.device.hasShell()) return { json: await ctx.device.call("app.install_remote", { path: remote }) };
      return { json: { ...(await ctx.device.call("app.install_prompt", { path: remote })), note: "Installeur ouvert : Antoine doit valider sur le téléphone." } };
    },
  }),
  tool({
    name: "app_uninstall",
    kind: "act",
    description: "Uninstall an app (always asks for confirmation on the phone).",
    schema: { app: z.string() },
    confirm: (a) => ({ category: "desinstallation", summary: `Désinstaller ${a.app}` }),
    run: async (a, ctx) => {
      const pkg = await resolvePackage(ctx, a.app);
      if (/phonepilot|systemui|android\.settings/.test(pkg)) throw new PilotError("FORBIDDEN", "Désinstallation interdite pour cette appli.");
      if (await ctx.device.can("app.uninstall")) return { json: await ctx.device.call("app.uninstall", { package: pkg }) };
      await ctx.device.call("intent.start", { action: "android.intent.action.DELETE", data: `package:${pkg}` });
      await sleep(1500);
      const ok = findNode(await ctx.device.tree(), { text: "Désinstaller" }) ?? findNode(ctx.device.lastTree, { text: "OK", exact: true });
      if (!ok) throw new PilotError("UI_CHANGED", "Boîte de désinstallation introuvable — vérifier l'écran.");
      await ctx.device.act("click", ok);
      return { json: { ok: true, package: pkg } };
    },
  }),
  tool({
    name: "app_clear_cache",
    kind: "act",
    description: "Clear an app's cache (opens its App info › Storage screen and taps 'Clear cache' / 'Vider le cache').",
    schema: { app: z.string() },
    run: async (a, ctx) => {
      const pkg = await resolvePackage(ctx, a.app);
      await ctx.device.call("intent.start", { action: "android.settings.APPLICATION_DETAILS_SETTINGS", data: `package:${pkg}` });
      await new Promise((r) => setTimeout(r, 1500));
      const storage = findNode(await ctx.device.tree(), { text: "Stockage" }) ?? findNode(ctx.device.lastTree, { text: "Storage" });
      if (!storage) throw new PilotError("UI_CHANGED", "Entrée « Stockage » introuvable dans les infos de l'appli.");
      await ctx.device.act("click", storage);
      await new Promise((r) => setTimeout(r, 1200));
      const btn = findNode(await ctx.device.tree(), { text: "Vider le cache" }) ?? findNode(ctx.device.lastTree, { text: "Clear cache" });
      if (!btn) throw new PilotError("UI_CHANGED", "Bouton « Vider le cache » introuvable.");
      await ctx.device.act("click", btn);
      return { json: { ok: true, package: pkg } };
    },
  }),
  tool({
    name: "app_usage",
    kind: "observe",
    description: "Screen time per app for 'day' or 'week' (UsageStats; requires 'Usage access' permission for PhonePilot).",
    schema: { period: z.enum(["day", "week"]).default("day"), top: z.number().default(15) },
    run: async (a, ctx) => ({ json: await ctx.device.call("usage.stats", { period: a.period, top: a.top }) }),
  }),
  tool({
    name: "app_permissions",
    kind: "observe",
    description: "List an app's permissions and whether they are granted.",
    schema: { app: z.string() },
    run: async (a, ctx) => ({ json: await ctx.device.call("app.permissions", { package: await resolvePackage(ctx, a.app) }) }),
  }),
  tool({
    name: "url_open",
    kind: "act",
    description: "Open a URL or deep link (https://, tel:, geo:, whatsapp://, intent URIs...).",
    schema: { url: z.string() },
    run: async (a, ctx) => {
      if (/^(javascript|file):/i.test(a.url)) throw new PilotError("FORBIDDEN", "Schéma d'URL interdit.");
      return { json: await ctx.device.call("url.open", { url: a.url }) };
    },
  }),
  tool({
    name: "share_to_app",
    kind: "act",
    description:
      "Share text and/or a phone file to an app via the Android share sheet (e.g. app='WhatsApp'). Returns after the target app opens; finish the flow with ui_tree/tap (choose recipient, press send).",
    schema: { app: z.string().optional(), text: z.string().optional(), file_path: z.string().optional().describe("Path on the phone"), mime: z.string().optional() },
    run: async (a, ctx) => {
      const pkg = a.app ? KNOWN_APPS[a.app.toLowerCase()] ?? (await resolvePackage(ctx, a.app)) : undefined;
      return { json: await ctx.device.call("share", { package: pkg, text: a.text, path: a.file_path, mime: a.mime }) };
    },
  }),
];
