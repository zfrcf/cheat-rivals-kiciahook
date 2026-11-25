import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { PilotError } from "../errors.js";

/**
 * Protocole bridge ⇄ app (JSON sur WebSocket, la connexion est TOUJOURS initiée par le téléphone) :
 *  tél → bridge : {type:"hello", token, device:{model,android,app}, methods:[...], shizuku:boolean}
 *  bridge → tél : {type:"welcome"} | fermeture 4401 si jeton invalide
 *  bridge → tél : {type:"req", id, method, params}
 *  tél → bridge : {type:"res", id, ok:true, result} | {type:"res", id, ok:false, error:{code,message}}
 *  tél → bridge : {type:"event", name, data}   (stop, resume, notification, missed_call, sms, shizuku)
 */
export interface DeviceInfo {
  model?: string;
  android?: string;
  app?: string;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class PhoneHub extends EventEmitter {
  private wss?: WebSocketServer;
  private socket?: WebSocket;
  private pending = new Map<string, Pending>();
  private seq = 0;
  methods = new Set<string>();
  shizuku = false;
  device: DeviceInfo = {};
  connectedAt?: Date;

  constructor(private token: string) {
    super();
  }

  setToken(token: string) {
    this.token = token;
  }

  listen(host: string, port: number): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ host, port, maxPayload: 64 * 1024 * 1024 });
      this.wss.on("connection", (ws) => this.onConnection(ws));
      this.wss.on("listening", () => resolve());
    });
  }

  get port(): number | undefined {
    const a = this.wss?.address();
    return typeof a === "object" && a ? a.port : undefined;
  }

  get connected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  has(method: string): boolean {
    return this.connected && this.methods.has(method);
  }

  private checkToken(given: unknown): boolean {
    if (typeof given !== "string") return false;
    const a = Buffer.from(given);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private onConnection(ws: WebSocket) {
    let authed = false;
    const authTimer = setTimeout(() => !authed && ws.close(4408, "hello attendu"), 5000);
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 20000);
    ws.on("pong", () => (alive = true));

    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!authed) {
        if (msg.type !== "hello" || !this.checkToken(msg.token)) {
          this.emit("auth_failed");
          ws.close(4401, "jeton invalide");
          return;
        }
        authed = true;
        clearTimeout(authTimer);
        // Une seule session active : la plus récente remplace l'ancienne.
        if (this.socket && this.socket !== ws) this.socket.close(4409, "remplacé");
        this.socket = ws;
        this.methods = new Set(Array.isArray(msg.methods) ? msg.methods : []);
        this.shizuku = !!msg.shizuku;
        this.device = msg.device ?? {};
        this.connectedAt = new Date();
        ws.send(JSON.stringify({ type: "welcome" }));
        this.emit("connected", this.device);
        return;
      }
      if (msg.type === "res") {
        const p = this.pending.get(String(msg.id));
        if (!p) return;
        this.pending.delete(String(msg.id));
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new PilotError(msg.error?.code ?? "PHONE_ERROR", msg.error?.message ?? "Erreur téléphone"));
      } else if (msg.type === "event") {
        if (msg.name === "shizuku") this.shizuku = !!msg.data?.active;
        if (msg.name === "methods" && Array.isArray(msg.data)) this.methods = new Set(msg.data);
        this.emit("event", msg.name, msg.data ?? {});
      }
    });

    ws.on("close", () => {
      clearInterval(ping);
      clearTimeout(authTimer);
      if (this.socket === ws) {
        this.socket = undefined;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new PilotError("PHONE_DISCONNECTED", "Le téléphone s'est déconnecté pendant l'action."));
          this.pending.delete(id);
        }
        this.emit("disconnected");
      }
    });
  }

  request<T = any>(method: string, params: unknown = {}, timeoutMs = 30000): Promise<T> {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new PilotError("PHONE_OFFLINE", "App PhonePilot non connectée."));
    }
    const id = String(++this.seq);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PilotError("TIMEOUT", `Pas de réponse du téléphone pour « ${method} » (${timeoutMs / 1000}s).`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  close() {
    this.socket?.close();
    this.wss?.close();
  }
}
