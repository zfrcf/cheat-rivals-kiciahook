import { Cron } from "croner";

export interface Step {
  tool: string;
  args?: Record<string, unknown>;
}

export interface Schedule {
  name: string;
  cron: string;
  steps: Step[];
  created: string;
}

export interface Trigger {
  name: string;
  event: "notification" | "missed_call" | "sms";
  match: { app?: string; from?: string; contains?: string };
  steps: Step[];
  confirm: boolean;
  created: string;
}

export interface Watch {
  name: string;
  cron: string;
  app: string;
  label: string;
  last?: string;
  lastAt?: string;
}

export interface OneShot {
  id: string;
  at: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface Data {
  macros: Record<string, Step[]>;
  oneshots?: OneShot[];
  schedules: Schedule[];
  triggers: Trigger[];
  watches: Watch[];
  lastBackup?: string;
}

export const TZ = "Europe/Paris";

/** Persistance des macros / planifications / déclencheurs dans ~/.phonepilot/automation.json. */
export class AutomationStore {
  data: Data = { macros: {}, schedules: [], triggers: [], watches: [] };
  private jobs = new Map<string, Cron>();
  recording?: { name: string; steps: Step[] };

  constructor(
    initial: Partial<Data> | undefined,
    private persist: (d: Data) => void,
  ) {
    if (initial) this.data = { ...this.data, ...initial };
  }

  save() {
    this.persist(this.data);
  }

  addOneShot(at: Date, tool: string, args: Record<string, unknown>) {
    (this.data.oneshots ??= []).push({ id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: at.toISOString(), tool, args });
    this.save();
  }

  /** Échéances (planifs, surveillances, actions uniques) — utilisé par le mode cloud (alarmes). */
  due(now = new Date(), last: Date): { schedules: Schedule[]; watches: Watch[]; oneshots: OneShot[] } {
    const hit = (cron: string) => {
      const n = new Cron(cron, { timezone: TZ, paused: true }).nextRun(last);
      return !!n && n <= now;
    };
    return {
      schedules: this.data.schedules.filter((s) => hit(s.cron)),
      watches: this.data.watches.filter((w) => hit(w.cron)),
      oneshots: (this.data.oneshots ?? []).filter((o) => new Date(o.at) <= now),
    };
  }

  nextWake(now = new Date()): Date | undefined {
    const times: number[] = [];
    for (const c of [...this.data.schedules.map((s) => s.cron), ...this.data.watches.map((w) => w.cron)]) {
      const n = new Cron(c, { timezone: TZ, paused: true }).nextRun(now);
      if (n) times.push(n.getTime());
    }
    for (const o of this.data.oneshots ?? []) times.push(new Date(o.at).getTime());
    return times.length ? new Date(Math.min(...times)) : undefined;
  }

  /** (Re)programme toutes les tâches. runner exécute une liste d'étapes. */
  startAll(runner: (who: string, steps: Step[]) => Promise<unknown>, watchRunner: (w: Watch) => Promise<unknown>) {
    for (const j of this.jobs.values()) j.stop();
    this.jobs.clear();
    for (const o of this.data.oneshots ?? []) {
      const at = new Date(o.at) > new Date() ? new Date(o.at) : new Date(Date.now() + 1000);
      this.jobs.set(`o:${o.id}`, new Cron(at, { timezone: TZ }, async () => {
        this.data.oneshots = (this.data.oneshots ?? []).filter((x) => x.id !== o.id);
        this.save();
        await runner("action programmée", [{ tool: o.tool, args: o.args }]).catch(() => undefined);
      }));
    }
    for (const s of this.data.schedules) {
      this.jobs.set(`s:${s.name}`, new Cron(s.cron, { timezone: TZ, protect: true }, async () => { await runner(`planif:${s.name}`, s.steps).catch(() => undefined); }));
    }
    for (const w of this.data.watches) {
      this.jobs.set(`w:${w.name}`, new Cron(w.cron, { timezone: TZ, protect: true }, async () => { await watchRunner(w).catch(() => undefined); }));
    }
  }

  stopAll() {
    for (const j of this.jobs.values()) j.stop();
  }

  nextRuns(): Record<string, string | undefined> {
    const o: Record<string, string | undefined> = {};
    for (const [k, j] of this.jobs) o[k] = j.nextRun()?.toISOString();
    return o;
  }
}

/** Remplace {{event.x}} par des champs sûrs de l'événement (jamais le corps d'un message). */
const SAFE_FIELDS = new Set(["from", "name", "app", "number", "title"]);
export function applyTemplate(steps: Step[], event: Record<string, unknown>): Step[] {
  const sub = (v: unknown): unknown => {
    if (typeof v === "string")
      return v.replace(/\{\{event\.(\w+)\}\}/g, (_m, k) => (SAFE_FIELDS.has(k) ? String(event[k] ?? "") : `[champ ${k} non autorisé]`));
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
    return v;
  };
  return steps.map((s) => ({ tool: s.tool, args: sub(s.args ?? {}) as Record<string, unknown> }));
}

export function eventMatches(t: Trigger, name: string, ev: Record<string, any>): boolean {
  if (t.event !== name) return false;
  const has = (v: unknown, needle?: string) => !needle || String(v ?? "").toLowerCase().includes(needle.toLowerCase());
  return has(ev.app, t.match.app) && has(`${ev.from ?? ""} ${ev.name ?? ""} ${ev.number ?? ""}`, t.match.from) && has(`${ev.title ?? ""} ${ev.text ?? ""} ${ev.body ?? ""}`, t.match.contains);
}
