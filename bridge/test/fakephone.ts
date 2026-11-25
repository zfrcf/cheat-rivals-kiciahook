import WebSocket from "ws";

/** Téléphone simulé : se connecte au bridge comme le ferait l'app PhonePilot. */
export class FakePhone {
  ws!: WebSocket;
  calls: { method: string; params: any }[] = [];
  approve = true;
  handlers: Record<string, (p: any) => any> = {};

  constructor(
    private url: string,
    private token: string,
    private methods: string[],
    private shizuku = false,
  ) {}

  connect(): Promise<"welcome" | number> {
    return new Promise((resolve) => {
      this.ws = new WebSocket(this.url);
      this.ws.on("open", () =>
        this.ws.send(JSON.stringify({ type: "hello", token: this.token, device: { model: "ELE-L29", android: "10", app: "test" }, methods: this.methods, shizuku: this.shizuku })),
      );
      this.ws.on("close", (code) => resolve(code));
      this.ws.on("message", async (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "welcome") return resolve("welcome");
        if (msg.type !== "req") return;
        this.calls.push({ method: msg.method, params: msg.params });
        try {
          const h = this.handlers[msg.method];
          const result = msg.method === "confirm.request" ? { approved: this.approve } : h ? await h(msg.params) : { ok: true };
          this.ws.send(JSON.stringify({ type: "res", id: msg.id, ok: true, result }));
        } catch (e: any) {
          this.ws.send(JSON.stringify({ type: "res", id: msg.id, ok: false, error: { code: "FAKE", message: e.message } }));
        }
      });
    });
  }

  event(name: string, data: any = {}) {
    this.ws.send(JSON.stringify({ type: "event", name, data }));
  }

  called(method: string) {
    return this.calls.filter((c) => c.method === method);
  }

  close() {
    this.ws?.close();
  }
}
