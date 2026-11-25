import { Errors, PilotError } from "../errors.js";
import type { PhoneHub } from "./hub.js";
import { AdbShell, ShizukuShell, type Shell } from "./shell.js";
import { SHELL_IMPL } from "./shellimpl.js";
import { enrich, findNode, type Selector, type UiNode } from "./uitree.js";

/**
 * Routeur : pour chaque méthode, choisit le meilleur chemin disponible.
 *   1. app compagnon (native)     — fonctionne sans câble, en 4G
 *   2. shell via Shizuku (app)    — niveau ADB sans câble, à relancer après redémarrage
 *   3. shell via ADB (Mac)        — câble USB ou `adb tcpip`
 */
export class Device {
  lastTree: UiNode[] = [];
  lastTreeAt = 0;

  constructor(
    public hub: PhoneHub,
    public adb: AdbShell,
  ) {}

  async shell(): Promise<Shell> {
    if (this.hub.connected && this.hub.shizuku && this.hub.has("shell.exec")) return new ShizukuShell(this.hub);
    if (await this.adb.available()) return this.adb;
    if (this.hub.connected) throw Errors.shizukuInactive();
    throw Errors.notConnected();
  }

  async hasShell(): Promise<boolean> {
    return (this.hub.connected && this.hub.shizuku) || (await this.adb.available());
  }

  /** Disponibilité d'une méthode (sans l'exécuter). */
  async can(method: string): Promise<boolean> {
    if (this.hub.has(method)) return true;
    return !!SHELL_IMPL[method] && (await this.hasShell());
  }

  async call<T = any>(method: string, params: any = {}, timeoutMs = 30000): Promise<T> {
    if (this.hub.has(method)) return this.hub.request<T>(method, params, timeoutMs);
    const impl = SHELL_IMPL[method];
    if (impl) return impl(await this.shell(), params);
    if (!this.hub.connected && !(await this.adb.available())) throw Errors.notConnected();
    if (!this.hub.connected) {
      throw new PilotError(
        "COMPANION_REQUIRED",
        `« ${method} » nécessite l'app compagnon PhonePilot (ADB seul ne suffit pas).`,
        "Ouvre l'app PhonePilot sur le téléphone et vérifie qu'elle est connectée.",
      );
    }
    throw Errors.unsupported(method);
  }

  async tree(): Promise<UiNode[]> {
    const raw = await this.call("ui.dump", {}, 25000);
    this.lastTree = enrich(raw);
    this.lastTreeAt = Date.now();
    return this.lastTree;
  }

  /** Résout un sélecteur. Un id se cherche d'abord dans le dernier arbre, puis dans un arbre frais. */
  async resolve(sel: Selector): Promise<UiNode> {
    if (sel.id && Date.now() - this.lastTreeAt < 60000) {
      const n = findNode(this.lastTree, sel);
      if (n) return n;
    }
    const n = findNode(await this.tree(), sel);
    if (!n) {
      throw new PilotError(
        "ELEMENT_NOT_FOUND",
        `Élément introuvable : ${JSON.stringify(sel)}`,
        "Relis l'écran avec ui_tree ; l'élément est peut-être hors écran (scroll_until).",
      );
    }
    return n;
  }

  /** Action sur un nœud : native (accessibilité) si possible, sinon coordonnées. */
  async act(action: "click" | "long_click" | "double_click" | "set_text" | "clear", node: UiNode, extra: any = {}) {
    if (this.hub.has("ui.action")) {
      return this.call("ui.action", { action, path: node.path, bounds: node.bounds, ...extra });
    }
    const xy = { x: node.cx, y: node.cy };
    switch (action) {
      case "click":
        return this.call("input.tap", xy);
      case "long_click":
        return this.call("input.long_press", xy);
      case "double_click":
        return this.call("input.double_tap", xy);
      case "clear":
        await this.call("input.tap", xy);
        return this.call("input.clear");
      case "set_text":
        await this.call("input.tap", xy);
        if (extra.replace) await this.call("input.clear");
        return this.call("input.text", { text: extra.text });
    }
  }
}
