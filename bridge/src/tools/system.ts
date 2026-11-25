import { z } from "zod";
import { PilotError } from "../errors.js";
import { checkShellCommand } from "../security/guard.js";
import { findNode } from "../phone/uitree.js";
import { tool, type Ctx, type ToolDef } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Repli universel : basculer une tuile des réglages rapides EMUI. */
async function quickTile(ctx: Ctx, labels: string[], on?: boolean) {
  await ctx.device.call("global.action", { action: "quick_settings" });
  await sleep(900);
  let nodes = await ctx.device.tree();
  let tile = labels.map((l) => findNode(nodes, { text: l })).find(Boolean);
  if (!tile) {
    // EMUI : 2e page de tuiles
    await ctx.device.call(ctx.device.hub.has("gesture.swipe") ? "gesture.swipe" : "input.swipe", { x1: 900, y1: 700, x2: 150, y2: 700, ms: 300 });
    await sleep(700);
    nodes = await ctx.device.tree();
    tile = labels.map((l) => findNode(nodes, { text: l })).find(Boolean);
  }
  if (!tile) {
    await ctx.device.call("global.action", { action: "collapse" });
    throw new PilotError("TILE_NOT_FOUND", `Tuile « ${labels[0]} » absente des réglages rapides.`, "Ajoute-la via le crayon des réglages rapides EMUI.");
  }
  const state = `${tile.desc ?? ""} ${tile.text ?? ""}`;
  const isOn = /activ[ée]|on\b|checked/i.test(state) && !/d[ée]sactiv/i.test(state) ? true : tile.checked;
  if (on === undefined || isOn !== on) await ctx.device.act("click", tile);
  await sleep(500);
  await ctx.device.call("global.action", { action: "collapse" });
  return { ok: true, via: "réglages rapides", previous: isOn };
}

async function viaShellOrTile(ctx: Ctx, method: string, labels: string[], on: boolean) {
  if (await ctx.device.can(method)) return ctx.device.call(method, { on });
  return quickTile(ctx, labels, on);
}

export const systemTools: ToolDef[] = [
  tool({
    name: "settings_set",
    kind: "act",
    description:
      "Change a system setting. setting ∈ wifi, bluetooth, mobile_data, airplane, hotspot, dnd (optional until=ISO end time), brightness (0-100), dark_mode, screen_timeout (seconds), auto_rotate. Uses Shizuku/ADB when available, otherwise toggles the EMUI quick settings tile.",
    schema: {
      setting: z.enum(["wifi", "bluetooth", "mobile_data", "airplane", "hotspot", "dnd", "brightness", "dark_mode", "screen_timeout", "auto_rotate"]),
      on: z.boolean().optional(),
      value: z.number().optional(),
      until: z.string().optional(),
    },
    run: async (a, ctx) => {
      const on = a.on ?? true;
      switch (a.setting) {
        case "wifi":
          return { json: await viaShellOrTile(ctx, "settings.wifi", ["Wi-Fi", "WLAN"], on) };
        case "bluetooth":
          return { json: await viaShellOrTile(ctx, "settings.bluetooth", ["Bluetooth"], on) };
        case "mobile_data":
          return { json: await viaShellOrTile(ctx, "settings.data", ["Données mobiles", "Données", "Mobile data"], on) };
        case "airplane":
          // Android 10 : le shell ne peut pas diffuser AIRPLANE_MODE → tuile.
          return { json: await quickTile(ctx, ["Mode avion", "Airplane mode"], on) };
        case "hotspot":
          return { json: await quickTile(ctx, ["Point d'accès", "Partage de connexion", "Hotspot"], on) };
        case "dnd": {
          const r = (await ctx.device.can("settings.dnd")) ? await ctx.device.call("settings.dnd", { on }) : await quickTile(ctx, ["Ne pas déranger", "Do not disturb"], on);
          if (on && a.until) {
            const at = new Date(a.until);
            if (at.getTime() > Date.now()) ctx.platform.oneShot(at, "settings_set", { setting: "dnd", on: false });
          }
          return { json: { ...r, until: a.until } };
        }
        case "brightness":
          return { json: await ctx.device.call("settings.brightness", { percent: a.value ?? 50 }) };
        case "dark_mode":
          return { json: (await ctx.device.can("settings.dark_mode")) ? await ctx.device.call("settings.dark_mode", { on }) : await quickTile(ctx, ["Mode sombre", "Thème sombre", "Dark mode"], on) };
        case "screen_timeout":
          return { json: await ctx.device.call("settings.screen_timeout", { seconds: a.value ?? 60 }) };
        case "auto_rotate":
          return { json: await ctx.device.call("settings.rotation", { mode: on ? "auto" : "portrait" }) };
      }
      throw new PilotError("BAD_SETTING", `Réglage inconnu : ${a.setting}`);
    },
  }),
  tool({
    name: "torch",
    kind: "act",
    description: "Turn the flashlight on or off.",
    schema: { on: z.boolean() },
    run: async (a, ctx) => ({ json: (await ctx.device.can("torch.set")) ? await ctx.device.call("torch.set", a) : await quickTile(ctx, ["Lampe torche", "Lampe", "Torche"], a.on) }),
  }),
  tool({
    name: "battery_info",
    kind: "observe",
    description: "Battery level, temperature, health, charging state.",
    schema: {},
    run: async (_a, ctx) => ({ json: await ctx.device.call("battery.info") }),
  }),
  tool({
    name: "location_get",
    kind: "observe",
    description: "Current GPS location (lat, lon, accuracy, time) plus a Google Maps link.",
    schema: { fresh: z.boolean().default(true).describe("Request a fresh fix (slower) instead of last known") },
    run: async (a, ctx) => {
      const r = await ctx.device.call("location.get", a, 45000);
      return { json: { ...r, carte: r.lat ? `https://maps.google.com/?q=${r.lat},${r.lon}` : undefined } };
    },
  }),
  tool({
    name: "wifi_scan",
    kind: "observe",
    description: "Scan nearby Wi-Fi networks (SSID, signal, security).",
    schema: {},
    run: async (_a, ctx) => ({ json: await ctx.device.call("wifi.scan", {}, 30000), untrusted: "réseaux Wi-Fi" }),
  }),
  tool({
    name: "bluetooth_list",
    kind: "observe",
    description: "List paired Bluetooth devices.",
    schema: {},
    run: async (_a, ctx) => ({ json: await ctx.device.call("bluetooth.list") }),
  }),
  tool({
    name: "lock_screen",
    kind: "act",
    description: "Lock the phone screen.",
    schema: {},
    run: async (_a, ctx) => ({ json: await ctx.device.call("global.action", { action: "lock_screen" }) }),
  }),
  tool({
    name: "reboot",
    kind: "act",
    description: "Reboot the phone (always confirmed on the phone). Uses the power menu when no shell is available. The companion app restarts by itself after boot (remote control resumes in ~1-2 min, phone must be unlocked once if it has a PIN).",
    schema: {},
    confirm: () => ({ category: "redemarrage", summary: "Redémarrer le téléphone" }),
    run: async (_a, ctx) => {
      if (await ctx.device.hasShell()) return { json: await ctx.device.call("power.reboot") };
      await ctx.device.call("global.action", { action: "power_dialog" });
      await sleep(1200);
      const btn = findNode(await ctx.device.tree(), { text: "Redémarrer" }) ?? findNode(ctx.device.lastTree, { text: "Restart" });
      if (!btn) throw new PilotError("UI_CHANGED", "Bouton « Redémarrer » introuvable dans le menu d'alimentation.");
      await ctx.device.act("click", btn);
      await sleep(1000);
      const again = findNode(await ctx.device.tree().catch(() => []), { text: "Redémarrer" });
      if (again) await ctx.device.act("click", again); // EMUI demande une 2e pression
      return { json: { ok: true, note: "Redémarrage lancé. L'app se reconnectera seule après le démarrage." } };
    },
  }),
  tool({
    name: "shell",
    kind: "act",
    description:
      "Run an ADB-level shell command on the phone (via Shizuku or ADB). Dangerous commands (factory reset, lock removal, wipes) are blocked. Prefer dedicated tools when they exist.",
    schema: { command: z.string(), timeout_s: z.number().default(30) },
    run: async (a, ctx) => {
      const bad = checkShellCommand(a.command);
      if (bad) throw new PilotError("FORBIDDEN", `Commande refusée : ${bad}`);
      const sh = await ctx.device.shell();
      return { text: (await sh.exec(a.command, a.timeout_s * 1000)).slice(0, 30000), untrusted: "sortie shell" };
    },
  }),
  tool({
    name: "find_my_phone",
    kind: "act",
    description: "Find my phone: ring at max volume (even in silent mode) for N seconds and return the GPS location.",
    schema: { seconds: z.number().default(30) },
    run: async (a, ctx) => {
      const ring = await ctx.device.call("ring.start", { seconds: a.seconds }).catch((e: Error) => ({ error: e.message }));
      const loc = await ctx.device.call("location.get", { fresh: true }, 45000).catch((e: Error) => ({ error: e.message }));
      return { json: { sonnerie: ring, position: loc, carte: (loc as any).lat ? `https://maps.google.com/?q=${(loc as any).lat},${(loc as any).lon}` : undefined } };
    },
  }),
];
