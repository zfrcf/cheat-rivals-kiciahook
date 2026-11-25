import { createHash } from "node:crypto";

/** Nœud brut, format commun à uiautomator (ADB/Shizuku) et à l'AccessibilityService de l'app. */
export interface RawNode {
  path: string; // indices depuis la racine, ex "0.3.1"
  cls: string;
  pkg?: string;
  text?: string;
  desc?: string;
  resId?: string;
  bounds: [number, number, number, number];
  clickable?: boolean;
  longClickable?: boolean;
  scrollable?: boolean;
  editable?: boolean;
  checkable?: boolean;
  checked?: boolean;
  focused?: boolean;
  enabled?: boolean;
  password?: boolean;
}

export interface UiNode extends RawNode {
  id: string;
  cx: number;
  cy: number;
}

export function stableId(n: Pick<RawNode, "path" | "resId" | "cls">): string {
  return createHash("sha1")
    .update(`${n.path}|${n.resId ?? ""}|${n.cls}`)
    .digest("base64url")
    .slice(0, 5);
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");

/** Parse le XML de `uiautomator dump` sans dépendance. */
export function parseUiautomatorXml(xml: string): RawNode[] {
  const out: RawNode[] = [];
  const stack: number[] = []; // nombre d'enfants vus par niveau
  const pathStack: string[] = [];
  const re = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let m: RegExpExecArray | null;
  stack.push(0);
  while ((m = re.exec(xml))) {
    if (m[0] === "</node>") {
      stack.pop();
      pathStack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    const idx = stack[stack.length - 1]++;
    const path = [...pathStack, String(idx)].join(".");
    const b = (attrs.bounds ?? "[0,0][0,0]").match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0];
    out.push({
      path,
      cls: attrs.class ?? "",
      pkg: attrs.package,
      text: attrs.text || undefined,
      desc: attrs["content-desc"] || undefined,
      resId: attrs["resource-id"] || undefined,
      bounds: [b[0], b[1], b[2], b[3]],
      clickable: attrs.clickable === "true",
      longClickable: attrs["long-clickable"] === "true",
      scrollable: attrs.scrollable === "true",
      editable: attrs.class?.includes("EditText") ?? false,
      checkable: attrs.checkable === "true",
      checked: attrs.checked === "true",
      focused: attrs.focused === "true",
      enabled: attrs.enabled !== "false",
      password: attrs.password === "true",
    });
    if (m[2] !== "/") {
      stack.push(0);
      pathStack.push(String(idx));
    }
  }
  return out;
}

export function enrich(nodes: RawNode[]): UiNode[] {
  return nodes.map((n) => ({
    ...n,
    id: stableId(n),
    cx: Math.round((n.bounds[0] + n.bounds[2]) / 2),
    cy: Math.round((n.bounds[1] + n.bounds[3]) / 2),
  }));
}

function interesting(n: UiNode): boolean {
  const area = (n.bounds[2] - n.bounds[0]) * (n.bounds[3] - n.bounds[1]);
  if (area <= 0) return false;
  return !!(n.text || n.desc || n.clickable || n.editable || n.scrollable || n.checkable);
}

const short = (cls: string) => cls.split(".").pop() ?? cls;

/** Rendu texte compact (< ~4000 tokens) : une ligne par élément utile. */
export function renderTree(nodes: UiNode[], maxChars = 14000): string {
  const lines: string[] = [];
  let size = 0;
  let dropped = 0;
  for (const n of nodes) {
    if (!interesting(n)) continue;
    const flags = [
      n.clickable && "clic",
      n.longClickable && "appui-long",
      n.editable && "saisie",
      n.scrollable && "défile",
      n.checkable && (n.checked ? "coché" : "non-coché"),
      n.focused && "focus",
      n.enabled === false && "désactivé",
    ].filter(Boolean);
    const text = n.password ? "••••" : n.text;
    const depth = n.path.split(".").length - 1;
    const line =
      `${"  ".repeat(Math.min(depth, 6))}#${n.id} ${short(n.cls)}` +
      (text ? ` "${text.replace(/\s+/g, " ").slice(0, 80)}"` : "") +
      (n.desc && n.desc !== text ? ` (${n.desc.replace(/\s+/g, " ").slice(0, 60)})` : "") +
      (n.resId ? ` id=${n.resId.split("/").pop()}` : "") +
      (flags.length ? ` [${flags.join(",")}]` : "") +
      ` @${n.cx},${n.cy}`;
    if (size + line.length > maxChars) {
      dropped++;
      continue;
    }
    lines.push(line);
    size += line.length + 1;
  }
  if (dropped) lines.push(`… ${dropped} éléments omis (écran chargé) — utilise scroll_until ou un filtre.`);
  return lines.join("\n");
}

export interface Selector {
  id?: string;
  text?: string;
  exact?: boolean;
  resource_id?: string;
}

export function findNode(nodes: UiNode[], sel: Selector): UiNode | undefined {
  if (sel.id) return nodes.find((n) => n.id === sel.id);
  if (sel.resource_id) return nodes.find((n) => n.resId === sel.resource_id || n.resId?.endsWith(`/${sel.resource_id}`));
  if (sel.text) {
    const t = sel.text.toLowerCase();
    const match = (s?: string) => !!s && (sel.exact ? s.toLowerCase() === t : s.toLowerCase().includes(t));
    const candidates = nodes.filter((n) => match(n.text) || match(n.desc));
    // Préférer un élément cliquable, puis le plus petit (le plus précis).
    candidates.sort(
      (a, b) =>
        Number(!!b.clickable) - Number(!!a.clickable) ||
        (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) - (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]),
    );
    return candidates[0];
  }
  return undefined;
}

/** Trouve le champ de saisie le plus proche (sous ou à droite) d'un libellé — pour remplir des formulaires. */
export function fieldNear(nodes: UiNode[], label: string): UiNode | undefined {
  const l = findNode(nodes, { text: label });
  if (!l) return undefined;
  if (l.editable) return l;
  const fields = nodes.filter((n) => n.editable);
  fields.sort((a, b) => Math.hypot(a.cx - l.cx, a.cy - l.cy) - Math.hypot(b.cx - l.cx, b.cy - l.cy));
  return fields.find((f) => f.cy >= l.bounds[1] - 10) ?? fields[0];
}
