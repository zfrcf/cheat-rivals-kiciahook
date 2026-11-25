import { DurableObject } from "cloudflare:workers";
import { EventEmitter } from "node:events";
import { buildServer, WebStandardStreamableHTTPServerTransport } from "../../bridge/src/server.js";
import { Runtime } from "../../bridge/src/runtime.js";
import { PilotError } from "../../bridge/src/errors.js";
import { NoAdb } from "../../bridge/src/phone/shell.js";
import type { DeviceInfo, PhoneLink } from "../../bridge/src/phone/hub.js";
import { AutomationStore, type Data } from "../../bridge/src/automation/store.js";
import { runSteps } from "../../bridge/src/tools/automation.js";
import { redact, type AuditEntry } from "../../bridge/src/security/audit.js";
import type { AuditSink, Platform } from "../../bridge/src/tools/types.js";
import type { Config } from "../../bridge/src/config.js";
import { OAuth, cors, metadata, protectedResource, rand, sha256b64url, unauthorized, type KV } from "./oauth.js";
import { authorizePage, errorPage, statusPage } from "./pages.js";

interface Env {
  PHONE: DurableObjectNamespace<PhoneHubDO>;
  /** Optionnel : code exigé pour (ré)appairer un téléphone. Sans lui, le premier téléphone qui se connecte est adopté. */
  PAIRING_CODE?: string;
}

/** Point d'entrée : tout passe par l'unique Durable Object (un seul téléphone). */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return env.PHONE.get(env.PHONE.idFromName("telephone")).fetch(req);
  },
};

const CONFIG: Config = {
  pairingToken: "",
  httpToken: "",
  wsHost: "",
  wsPort: 0,
  httpHost: "",
  httpPort: 0,
  adbPath: "",
  inboxDir: "",
  backupDir: "",
  confirmCategories: ["paiement", "achat", "virement", "nouveau_contact", "suppression_definitive", "publication_publique", "securite", "desinstallation", "redemarrage"],
  confirmTimeoutSec: 60,
  auditScreenshots: true,
};

/** Liaison téléphone au-dessus d'un WebSocket hiberné du Durable Object. */
class CloudLink extends EventEmitter implements PhoneLink {
  ws?: WebSocket;
  methods = new Set<string>();
  shizuku = false;
  device: DeviceInfo = {};
  connectedAt?: Date;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;

  get connected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
  has(m: string) {
    return this.connected && this.methods.has(m);
  }
  attach(ws: WebSocket, att: any) {
    this.ws = ws;
    this.methods = new Set(att.methods ?? []);
    this.shizuku = !!att.shizuku;
    this.device = att.device ?? {};
    this.connectedAt = att.connectedAt ? new Date(att.connectedAt) : new Date();
  }
  detach(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = undefined;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new PilotError("PHONE_DISCONNECTED", "Le téléphone s'est déconnecté pendant l'action."));
      this.pending.delete(id);
    }
  }
  onResponse(msg: any) {
    const p = this.pending.get(String(msg.id));
    if (!p) return;
    this.pending.delete(String(msg.id));
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new PilotError(msg.error?.code ?? "PHONE_ERROR", msg.error?.message ?? "Erreur téléphone"));
  }
  request<T = any>(method: string, params: unknown = {}, timeoutMs = 30000): Promise<T> {
    if (!this.connected) return Promise.reject(new PilotError("PHONE_OFFLINE", "Téléphone hors ligne : l'app PhonePilot n'est pas connectée (réseau, batterie, EMUI ?)."));
    const id = String(++this.seq);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PilotError("TIMEOUT", `Pas de réponse du téléphone pour « ${method} » (${timeoutMs / 1000}s).`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }
}

export class PhoneHubDO extends DurableObject<Env> {
  private link = new CloudLink();
  private rt!: Runtime;
  private kv: KV;
  private oauth: OAuth;
  private origin = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const st = ctx.storage;
    this.kv = {
      get: (k) => st.get(k),
      put: (k, v) => st.put(k, v),
      delete: (k) => st.delete(k),
      list: (o) => st.list(o),
    };
    this.oauth = new OAuth(this.kv);
    ctx.blockConcurrencyWhile(async () => {
      this.origin = (await st.get<string>("origin")) ?? "";
      const automation = new AutomationStore(await st.get<Data>("automation"), (d) => void st.put("automation", d));
      this.rt = new Runtime(CONFIG, {
        link: this.link,
        adb: new NoAdb(),
        audit: this.audit(),
        platform: this.platform(automation),
        automation,
        reschedule: () => void this.reschedule(),
      });
      // Reprise après hibernation : le téléphone est peut-être toujours connecté.
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att?.authed) this.link.attach(ws, att);
      }
      this.rt.guard.stopped = (await st.get<boolean>("stopped")) ?? false;
      this.rt.guard.on("stop", () => void st.put("stopped", true));
      this.rt.guard.on("resume", () => void st.put("stopped", false));
    });
  }

  // ---------------- HTTP ----------------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.origin !== this.origin && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      this.origin = url.origin;
      await this.ctx.storage.put("origin", this.origin);
    }
    if (!this.origin) this.origin = url.origin;
    const path = url.pathname;
    if (req.method === "OPTIONS") return cors();

    if (path === "/phone") return this.acceptPhone(req);
    if (path.startsWith("/.well-known/oauth-authorization-server")) return Response.json(metadata(url.origin));
    if (path.startsWith("/.well-known/oauth-protected-resource")) return Response.json(protectedResource(url.origin));
    if (path === "/register" && req.method === "POST") return this.oauth.register(req);
    if (path === "/token" && req.method === "POST") return this.oauth.token(req);
    if (path === "/revoke" && req.method === "POST") return this.oauth.revoke(req);
    if (path === "/authorize" && req.method === "GET") {
      const r = await this.oauth.check(url.searchParams);
      if ("error" in r) return errorPage(r.error);
      return authorizePage(r.client.client_name ?? "Client MCP", new URL(url.searchParams.get("redirect_uri")!).host, this.link.connected);
    }
    if (path === "/authorize/approve" && req.method === "POST") return this.approve(url.searchParams);
    if (path === "/mcp") {
      if (!(await this.oauth.verify(req))) return unauthorized(url.origin);
      return this.mcp(req);
    }
    if (path.startsWith("/dl/")) return this.download(path.slice(4));
    if (path === "/" || path === "") {
      return statusPage({ connected: this.link.connected, device: this.link.device, paired: !!(await this.ctx.storage.get("phoneTokenHash")), origin: url.origin, stopped: this.rt.guard.stopped });
    }
    return new Response("Introuvable", { status: 404 });
  }

  private async approve(p: URLSearchParams): Promise<Response> {
    const r = await this.oauth.check(p);
    if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
    if (!this.link.has("confirm.request")) return Response.json({ error: "Téléphone hors ligne : ouvre l'app PhonePilot puis réessaie." }, { status: 503 });
    const host = new URL(p.get("redirect_uri")!).host;
    const res = await this.link
      .request<{ approved: boolean }>("confirm.request", { category: "connexion_claude", summary: `Autoriser « ${r.client.client_name} » (${host}) à piloter ton téléphone ?`, timeoutSec: 120 }, 130000)
      .catch((e: Error) => ({ approved: false, error: e.message }));
    this.rt.audit.write({ who: "OAuth", tool: "autorisation_connecteur", args: { client: r.client.client_name, host }, status: res.approved ? "ok" : "refusé", ms: 0 });
    if (!res.approved) return Response.json({ error: "Refusé sur le téléphone." }, { status: 403 });
    return Response.json({ redirect: await this.oauth.issueCode(p) });
  }

  private async mcp(req: Request): Promise<Response> {
    const server = buildServer(this.rt);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  }

  /** Lien de téléchargement temporaire : le fichier est lu en direct sur le téléphone, rien n'est stocké. */
  private async download(id: string): Promise<Response> {
    const d = await this.ctx.storage.get<{ path: string; name: string; size: number; exp: number }>(`dl:${id}`);
    if (!d || d.exp < Date.now()) return new Response("Lien expiré ou inconnu.", { status: 404 });
    if (!this.link.has("file.read_chunk")) return new Response("Téléphone hors ligne : réessaie quand l'app PhonePilot est connectée.", { status: 503 });
    const link = this.link;
    let off = 0;
    const CHUNK = 512 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (off >= d.size) return ctrl.close();
        const r = await link.request("file.read_chunk", { path: d.path, offset: off, length: CHUNK }, 60000);
        const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
        off += bytes.length || CHUNK;
        ctrl.enqueue(bytes);
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/octet-stream", "content-length": String(d.size), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}` },
    });
  }

  // ---------------- WebSocket téléphone ----------------

  private acceptPhone(req: Request): Response {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket attendu", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ authed: false });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: any;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() ?? {};
    if (!att.authed) {
      if (msg.type !== "hello" || typeof msg.token !== "string" || msg.token.length < 24) return ws.close(4401, "hello invalide");
      const stored = await this.ctx.storage.get<string>("phoneTokenHash");
      const h = await sha256b64url(msg.token);
      const codeOk = !this.env.PAIRING_CODE || msg.code === this.env.PAIRING_CODE;
      if (stored && stored !== h && !(this.env.PAIRING_CODE && codeOk)) return ws.close(4401, "jeton invalide");
      if (!stored && !codeOk) return ws.close(4401, "code d'appairage requis");
      if (stored !== h) {
        await this.ctx.storage.put("phoneTokenHash", h); // premier appairage (ou réappairage avec code)
        this.rt.audit.write({ who: "système", tool: "appairage", args: { device: msg.device }, status: "ok", ms: 0 });
      }
      for (const old of this.ctx.getWebSockets()) if (old !== ws && old.deserializeAttachment()?.authed) old.close(4409, "remplacé");
      const a = { authed: true, methods: msg.methods ?? [], shizuku: !!msg.shizuku, device: msg.device ?? {}, connectedAt: new Date().toISOString() };
      ws.serializeAttachment(a);
      this.link.attach(ws, a);
      ws.send(JSON.stringify({ type: "welcome" }));
      return;
    }
    if (!this.link.ws) this.link.attach(ws, att);
    if (msg.type === "res") return this.link.onResponse(msg);
    if (msg.type === "event") {
      if (msg.name === "shizuku") this.link.shizuku = !!msg.data?.active;
      if (msg.name === "methods" && Array.isArray(msg.data)) this.link.methods = new Set(msg.data);
      if (msg.name === "shizuku" || msg.name === "methods") ws.serializeAttachment({ ...att, methods: [...this.link.methods], shizuku: this.link.shizuku });
      if (msg.name === "revoke_tokens") {
        const n = await this.oauth.revokeAll();
        this.rt.audit.write({ who: "Antoine (téléphone)", tool: "révocation_accès", args: { n }, status: "ok", ms: 0 });
        return;
      }
      await this.rt.onPhoneEvent(msg.name, msg.data ?? {});
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.link.detach(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.link.detach(ws);
  }

  // ---------------- Plateforme cloud ----------------

  private platform(automation: AutomationStore): Platform {
    return {
      kind: "cloud",
      deliver: async (ctx, remote) => {
        const st = await ctx.device.call("file.stat", { path: remote });
        if (st.dir) throw new PilotError("IS_DIR", `${remote} est un dossier : utilise archive_zip d'abord.`);
        const id = rand(24);
        const exp = Date.now() + 24 * 3600e3;
        await this.ctx.storage.put(`dl:${id}`, { path: remote, name: st.name, size: st.size, exp });
        return { path: remote, bytes: st.size, link: `${this.origin}/dl/${id}`, expires: new Date(exp).toISOString() };
      },
      source: async (src) => {
        if (!/^https:\/\//.test(src)) throw new PilotError("URL_REQUIRED", "En mode cloud, la source doit être une URL https.");
        const r = await fetch(src);
        if (!r.ok) throw new PilotError("DOWNLOAD_FAILED", `Téléchargement impossible (${r.status}).`);
        const data = new Uint8Array(await r.arrayBuffer());
        if (data.length > 80 * 1024 * 1024) throw new PilotError("TOO_LARGE", "Fichier source > 80 Mo.");
        return { name: decodeURIComponent(new URL(src).pathname.split("/").pop() || "fichier"), data };
      },
      oneShot: (at, tool, args) => {
        automation.addOneShot(at, tool, args);
        void this.reschedule();
      },
    };
  }

  private audit(): AuditSink {
    const st = this.ctx.storage;
    return {
      write: (e) => {
        const entry: AuditEntry = { ts: new Date().toISOString(), ...e, args: redact(e.args) };
        void st.put(`audit:${entry.ts}:${rand(4)}`, entry);
      },
      tail: async (n = 30, filter) => {
        const m = await st.list<AuditEntry>({ prefix: "audit:", reverse: true, limit: filter ? 2000 : n });
        let all = [...m.values()];
        if (filter) all = all.filter((x) => JSON.stringify(x).toLowerCase().includes(filter.toLowerCase()));
        return all.slice(0, n).reverse();
      },
      saveImage: async (name, b64) => {
        if (b64.length > 1_500_000) return undefined;
        const key = `img:${new Date().toISOString()}:${name}`;
        await st.put(key, b64);
        return key;
      },
    };
  }

  // ---------------- Planification (alarmes) ----------------

  private async reschedule() {
    const next = this.rt.automation.nextWake();
    const daily = Date.now() + 24 * 3600e3; // ménage quotidien
    await this.ctx.storage.setAlarm(Math.min(next?.getTime() ?? daily, daily));
  }

  async alarm() {
    const now = new Date();
    const last = new Date((await this.ctx.storage.get<number>("lastAlarm")) ?? now.getTime() - 60e3);
    await this.ctx.storage.put("lastAlarm", now.getTime());
    const a = this.rt.automation;
    const due = a.due(now, last);
    if (due.oneshots.length) {
      a.data.oneshots = (a.data.oneshots ?? []).filter((o) => !due.oneshots.includes(o));
      a.save();
    }
    const jobs: Promise<unknown>[] = [];
    for (const s of due.schedules) jobs.push(runSteps(this.rt.ctx(`planif:${s.name}`), `planif:${s.name}`, s.steps));
    for (const w of due.watches) jobs.push(this.rt.checkWatch(w));
    for (const o of due.oneshots) jobs.push(this.rt.run(o.tool, o.args, "action programmée"));
    const res = await Promise.allSettled(jobs);
    for (const r of res) if (r.status === "rejected") this.rt.audit.write({ who: "planification", tool: "alarme", args: {}, status: "erreur", ms: 0, detail: String(r.reason?.message ?? r.reason) });
    await this.prune();
    await this.reschedule();
  }

  private async prune() {
    const st = this.ctx.storage;
    const cut = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
    for (const [prefix, days] of [["audit:", 30], ["img:", 7]] as const) {
      const old = await st.list({ prefix, end: `${prefix}${cut(days)}`, limit: 500 });
      if (old.size) await st.delete([...old.keys()]);
    }
    const dls = await st.list<{ exp: number }>({ prefix: "dl:" });
    const expired = [...dls].filter(([, v]) => v.exp < Date.now()).map(([k]) => k);
    if (expired.length) await st.delete(expired);
  }
}
