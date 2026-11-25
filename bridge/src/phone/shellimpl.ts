import { PilotError } from "../errors.js";
import { parseUiautomatorXml } from "./uitree.js";
import { q, type Shell } from "./shell.js";

/**
 * Implémentations « niveau shell » des méthodes du protocole.
 * Elles tournent indifféremment via ADB (Mac) ou via Shizuku (app) : même code, deux transports.
 * L'app compagnon peut fournir une version native d'une méthode ; elle est alors prioritaire.
 */
type Impl = (sh: Shell, p: any) => Promise<any>;

const KEYS: Record<string, number> = {
  back: 4,
  home: 3,
  recents: 187,
  enter: 66,
  delete: 67,
  tab: 61,
  escape: 111,
  power: 26,
  sleep: 223,
  wakeup: 224,
  volume_up: 24,
  volume_down: 25,
  volume_mute: 164,
  camera: 27,
  search: 84,
  menu: 82,
  play_pause: 85,
  next: 87,
  previous: 88,
  stop: 86,
  dpad_up: 19,
  dpad_down: 20,
  dpad_left: 21,
  dpad_right: 22,
};

const STREAMS: Record<string, number> = { voice: 0, system: 1, ring: 2, media: 3, alarm: 4, notification: 5 };

/** `input text` ne gère ni espaces ni caractères non-ASCII : on découpe. */
function inputTextCommands(text: string): string[] {
  if (/[^\x20-\x7e]/.test(text)) {
    throw new PilotError(
      "NON_ASCII_TEXT",
      "La saisie de caractères accentués/emoji via le shell n'est pas possible sur Android 10.",
      "Utilise l'app compagnon (accessibilité : saisie native) — ou remplace les accents.",
    );
  }
  const escaped = text.replace(/([\\"'`$&|;<>()*?!#~{}\[\]])/g, "\\$1").replace(/ /g, "%s");
  return [`input text ${escaped}`];
}

export const SHELL_IMPL: Record<string, Impl> = {
  "ui.dump": async (sh) => {
    const out = await sh.exec("uiautomator dump /sdcard/.pp_ui.xml >/dev/null 2>&1; cat /sdcard/.pp_ui.xml", 20000);
    if (!out.includes("<hierarchy")) throw new PilotError("UI_DUMP_FAILED", "uiautomator n'a pas pu lire l'écran (animation en cours ?). Réessaie.");
    return parseUiautomatorXml(out);
  },

  "screen.capture": async (sh) => {
    const png = await sh.execBinary("screencap -p");
    return { mime: "image/png", data: png.toString("base64") };
  },

  "input.tap": async (sh, p) => sh.exec(`input tap ${p.x | 0} ${p.y | 0}`).then(() => ({ ok: true })),
  "input.long_press": async (sh, p) =>
    sh.exec(`input swipe ${p.x | 0} ${p.y | 0} ${p.x | 0} ${p.y | 0} ${p.ms ?? 800}`).then(() => ({ ok: true })),
  "input.double_tap": async (sh, p) =>
    sh.exec(`input tap ${p.x | 0} ${p.y | 0}; input tap ${p.x | 0} ${p.y | 0}`).then(() => ({ ok: true })),
  "input.swipe": async (sh, p) =>
    sh.exec(`input swipe ${p.x1 | 0} ${p.y1 | 0} ${p.x2 | 0} ${p.y2 | 0} ${p.ms ?? 300}`).then(() => ({ ok: true })),
  "input.text": async (sh, p) => {
    for (const c of inputTextCommands(p.text)) await sh.exec(c);
    return { ok: true };
  },
  "input.key": async (sh, p) => {
    const code = typeof p.key === "number" ? p.key : KEYS[p.key];
    if (code === undefined) throw new PilotError("BAD_KEY", `Touche inconnue : ${p.key}. Connues : ${Object.keys(KEYS).join(", ")}`);
    await sh.exec(`input keyevent ${code}`);
    return { ok: true };
  },
  "input.clear": async (sh) => {
    // Sélectionne tout (Ctrl+A) puis supprime.
    await sh.exec("input keyevent --longpress 113 29 >/dev/null 2>&1; input keycombination 113 29 >/dev/null 2>&1; input keyevent 67");
    return { ok: true };
  },

  "global.action": async (sh, p) => {
    const map: Record<string, string> = {
      back: "input keyevent 4",
      home: "input keyevent 3",
      recents: "input keyevent 187",
      notifications: "cmd statusbar expand-notifications",
      quick_settings: "cmd statusbar expand-settings",
      collapse: "cmd statusbar collapse",
      lock_screen: "input keyevent 223",
    };
    const cmd = map[p.action];
    if (!cmd) throw new PilotError("BAD_ACTION", `Action globale inconnue : ${p.action}`);
    await sh.exec(cmd);
    return { ok: true };
  },

  "device.state": async (sh) => {
    const out = await sh.exec(
      "dumpsys power | grep -E 'mWakefulness=|Display Power'; " +
        "dumpsys window | grep -E 'mDreamingLockscreen|isStatusBarKeyguard|mShowingLockscreen|mCurrentFocus'; " +
        "dumpsys battery | grep -E 'level|status|temperature|AC powered|USB powered'",
    );
    const screenOn = /mWakefulness=Awake/.test(out);
    const locked = /(mDreamingLockscreen|isStatusBarKeyguard|mShowingLockscreen)=true/.test(out);
    const focus = out.match(/mCurrentFocus=Window\{\S+ \S+ ([^\/\s}]+)/)?.[1];
    const level = Number(out.match(/level: (\d+)/)?.[1]);
    const temp = Number(out.match(/temperature: (\d+)/)?.[1]) / 10;
    const charging = /(AC|USB) powered: true/.test(out);
    return { screenOn, locked, foreground: focus, battery: { level, temperatureC: temp, charging } };
  },

  "battery.info": async (sh) => {
    const out = await sh.exec("dumpsys battery");
    const g = (k: string) => out.match(new RegExp(`${k}: (.+)`))?.[1]?.trim();
    return {
      level: Number(g("level")),
      temperatureC: Number(g("temperature")) / 10,
      voltageMv: Number(g("voltage")),
      health: { "2": "bonne", "3": "surchauffe", "4": "morte", "5": "surtension", "7": "froide" }[g("health") ?? ""] ?? g("health"),
      status: { "2": "en charge", "3": "décharge", "4": "pas en charge", "5": "pleine" }[g("status") ?? ""] ?? g("status"),
      charging: g("AC powered") === "true" || g("USB powered") === "true",
    };
  },

  "apps.list": async (sh, p) => {
    const out = await sh.exec(`pm list packages ${p.all ? "" : "-3"}`);
    return out
      .split("\n")
      .map((l) => l.replace("package:", "").trim())
      .filter(Boolean)
      .sort()
      .map((pkg) => ({ package: pkg }));
  },
  "app.open": async (sh, p) => {
    const out = await sh.exec(`monkey -p ${q(p.package)} -c android.intent.category.LAUNCHER 1 2>&1`);
    if (/No activities found/.test(out)) throw new PilotError("APP_NOT_FOUND", `Aucune activité lançable pour ${p.package}`);
    return { ok: true };
  },
  "app.close": async (sh, p) => sh.exec(`am force-stop ${q(p.package)}`).then(() => ({ ok: true })),
  "app.uninstall": async (sh, p) => ({ output: (await sh.exec(`pm uninstall ${q(p.package)}`)).trim() }),
  "app.foreground": async (sh) => {
    const out = await sh.exec("dumpsys activity activities | grep -E 'mResumedActivity|ResumedActivity'");
    const m = out.match(/u0 ([\w.]+)\/([\w.$]+)/);
    return { package: m?.[1], activity: m?.[2] };
  },
  "app.permissions": async (sh, p) => {
    const out = await sh.exec(`dumpsys package ${q(p.package)} | grep -E 'permission.*granted='`);
    return out
      .split("\n")
      .map((l) => l.trim().match(/^([\w.]+): granted=(\w+)/))
      .filter(Boolean)
      .map((m) => ({ permission: m![1], granted: m![2] === "true" }));
  },
  "app.install_remote": async (sh, p) => ({ output: (await sh.exec(`pm install -r ${q(p.path)}`, 300000)).trim() }),
  "url.open": async (sh, p) =>
    sh.exec(`am start -a android.intent.action.VIEW -d ${q(p.url)}`).then(() => ({ ok: true })),

  "settings.wifi": async (sh, p) => sh.exec(`svc wifi ${p.on ? "enable" : "disable"}`).then(() => ({ ok: true })),
  "settings.data": async (sh, p) => sh.exec(`svc data ${p.on ? "enable" : "disable"}`).then(() => ({ ok: true })),
  "settings.bluetooth": async (sh, p) => sh.exec(`svc bluetooth ${p.on ? "enable" : "disable"}`).then(() => ({ ok: true })),
  "settings.brightness": async (sh, p) =>
    sh
      .exec(`settings put system screen_brightness_mode 0; settings put system screen_brightness ${Math.round((p.percent / 100) * 255)}`)
      .then(() => ({ ok: true })),
  "settings.dark_mode": async (sh, p) => sh.exec(`cmd uimode night ${p.on ? "yes" : "no"}`).then(() => ({ ok: true })),
  "settings.screen_timeout": async (sh, p) =>
    sh.exec(`settings put system screen_off_timeout ${Math.round(p.seconds * 1000)}`).then(() => ({ ok: true })),
  "settings.rotation": async (sh, p) => {
    if (p.mode === "auto") await sh.exec("settings put system accelerometer_rotation 1");
    else {
      const r = { portrait: 0, landscape: 1, reverse_portrait: 2, reverse_landscape: 3 }[p.mode as string] ?? 0;
      await sh.exec(`settings put system accelerometer_rotation 0; settings put system user_rotation ${r}`);
    }
    return { ok: true };
  },
  "settings.dnd": async (sh, p) => sh.exec(`cmd notification set_dnd ${p.on ? "priority" : "off"}`).then(() => ({ ok: true })),
  "settings.get": async (sh, p) => ({ value: (await sh.exec(`settings get ${q(p.namespace)} ${q(p.key)}`)).trim() }),
  "settings.put": async (sh, p) => sh.exec(`settings put ${q(p.namespace)} ${q(p.key)} ${q(p.value)}`).then(() => ({ ok: true })),

  "media.key": async (sh, p) => SHELL_IMPL["input.key"](sh, { key: p.action }),
  "volume.set": async (sh, p) => {
    const s = STREAMS[p.stream] ?? 3;
    await sh.exec(`media volume --stream ${s} --set ${p.level | 0}`);
    return { ok: true };
  },
  "volume.get": async (sh, p) => {
    const s = STREAMS[p.stream ?? "media"] ?? 3;
    return { output: (await sh.exec(`media volume --stream ${s} --get`)).trim() };
  },

  "screen.record": async (sh, p) => {
    const path = `/sdcard/Movies/PhonePilot/ecran_${Date.now()}.mp4`;
    await sh.exec(`mkdir -p /sdcard/Movies/PhonePilot; screenrecord --time-limit ${Math.min(p.seconds ?? 10, 180)} ${q(path)}`, (p.seconds ?? 10) * 1000 + 15000);
    return { path };
  },

  "files.list": async (sh, p) => {
    const out = await sh.exec(`ls -la ${q(p.path ?? "/sdcard")}`);
    return out
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((c) => c.length >= 8)
      .map((c) => ({ name: c.slice(7).join(" "), dir: c[0].startsWith("d"), size: Number(c[4]), modified: `${c[5]} ${c[6]}` }))
      .filter((f) => f.name !== "." && f.name !== "..");
  },
  "storage.info": async (sh) => ({ df: (await sh.exec("df -h /data /sdcard 2>/dev/null")).trim() }),
  "file.mkdir": async (sh, p) => sh.exec(`mkdir -p ${q(p.path)}`).then(() => ({ ok: true })),

  "power.reboot": async (sh) => {
    // Réponse avant la coupure.
    setTimeout(() => sh.exec("svc power reboot").catch(() => undefined), 500);
    return { ok: true, note: "Redémarrage lancé — Shizuku devra être relancé depuis le Mac." };
  },
  "camera.shutter": async (sh) => sh.exec("input keyevent 27").then(() => ({ ok: true })),
  "intent.start": async (sh, p) => {
    const extras = Object.entries(p.extras ?? {})
      .map(([k, v]) => (typeof v === "number" ? `--ei ${q(k)} ${v}` : typeof v === "boolean" ? `--ez ${q(k)} ${v}` : `--es ${q(k)} ${q(String(v))}`))
      .join(" ");
    await sh.exec(`am start ${p.action ? `-a ${q(p.action)}` : ""} ${p.data ? `-d ${q(p.data)}` : ""} ${p.component ? `-n ${q(p.component)}` : ""} ${extras}`);
    return { ok: true };
  },
};

export const SHELL_METHODS = new Set(Object.keys(SHELL_IMPL));
