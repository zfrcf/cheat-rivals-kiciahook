import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AuditEntry {
  ts: string;
  who: string; // "claude" | "planif:<nom>" | "déclencheur:<nom>" | "macro:<nom>"
  tool: string;
  args: unknown;
  status: "ok" | "erreur" | "refusé" | "bloqué";
  ms: number;
  detail?: string;
  before?: string;
  after?: string;
}

const SECRET_KEYS = /pass|token|secret|pin|code_?pin|otp/i;

/** Masque les valeurs sensibles et tronque les longs contenus. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + `…(+${v.length - 300})` : v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? "***" : k === "data_base64" ? "<binaire>" : redact(x, depth + 1);
    return o;
  }
  return v;
}

export class AuditLog {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private file(d = new Date()) {
    return join(this.dir, `${d.toISOString().slice(0, 10)}.jsonl`);
  }

  write(e: Omit<AuditEntry, "ts">): void {
    const entry: AuditEntry = { ts: new Date().toISOString(), ...e, args: redact(e.args) };
    appendFileSync(this.file(), JSON.stringify(entry) + "\n", { mode: 0o600 });
  }

  saveImage(name: string, base64: string): string {
    const dir = join(this.dir, "captures");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `${Date.now()}_${name.replace(/[^\w-]/g, "_")}.png`);
    writeFileSync(p, Buffer.from(base64, "base64"));
    return p;
  }

  tail(n = 30, filter?: string): AuditEntry[] {
    const files = existsSync(this.dir)
      ? readdirSync(this.dir)
          .filter((f) => f.endsWith(".jsonl"))
          .sort()
      : [];
    const out: AuditEntry[] = [];
    for (let i = files.length - 1; i >= 0 && out.length < n; i--) {
      const lines = readFileSync(join(this.dir, files[i]), "utf8").trim().split("\n").reverse();
      for (const l of lines) {
        if (!l) continue;
        const e = JSON.parse(l) as AuditEntry;
        if (filter && !JSON.stringify(e).toLowerCase().includes(filter.toLowerCase())) continue;
        out.push(e);
        if (out.length >= n) break;
      }
    }
    return out.reverse();
  }
}
