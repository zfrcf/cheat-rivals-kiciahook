import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tool, type ToolDef } from "./types.js";

export const orgTools: ToolDef[] = [
  tool({
    name: "contacts_search",
    kind: "observe",
    description: "Search contacts by name, phone or email.",
    schema: { query: z.string(), limit: z.number().default(20) },
    run: async (a, ctx) => ({ json: await ctx.device.call("contacts.search", a), untrusted: "contacts" }),
  }),
  tool({
    name: "contacts_create",
    kind: "act",
    description: "Create a contact.",
    schema: { name: z.string(), phones: z.array(z.string()).default([]), emails: z.array(z.string()).default([]), company: z.string().optional(), note: z.string().optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("contacts.create", a) }),
  }),
  tool({
    name: "contacts_update",
    kind: "act",
    description: "Update a contact (by id from contacts_search): add phones/emails, change name, company, note.",
    schema: { id: z.string(), name: z.string().optional(), add_phones: z.array(z.string()).optional(), add_emails: z.array(z.string()).optional(), company: z.string().optional(), note: z.string().optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("contacts.update", a) }),
  }),
  tool({
    name: "contacts_export",
    kind: "act",
    description: "Export all contacts as a vCard (.vcf) file on the Mac.",
    schema: {},
    run: async (_a, ctx) => {
      const r = await ctx.device.call("contacts.export_vcf", {}, 120000);
      mkdirSync(ctx.cfg.inboxDir, { recursive: true });
      const p = join(ctx.cfg.inboxDir, `contacts_${new Date().toISOString().slice(0, 10)}.vcf`);
      writeFileSync(p, r.vcf);
      return { json: { ok: true, path: p, count: r.count } };
    },
  }),
  tool({
    name: "calendar_list",
    kind: "observe",
    description: "List calendar events between two ISO dates (default: next 7 days).",
    schema: { from: z.string().optional(), to: z.string().optional(), query: z.string().optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("calendar.list", a), untrusted: "agenda" }),
  }),
  tool({
    name: "calendar_create",
    kind: "act",
    description: "Create a calendar event (ISO start/end, optional location, description, reminder minutes).",
    schema: {
      title: z.string(),
      start: z.string(),
      end: z.string().optional(),
      all_day: z.boolean().default(false),
      location: z.string().optional(),
      description: z.string().optional(),
      reminder_minutes: z.number().optional(),
      calendar: z.string().optional().describe("Calendar account/name; default = primary"),
    },
    run: async (a, ctx) => ({ json: await ctx.device.call("calendar.create", a) }),
  }),
  tool({
    name: "calendar_update",
    kind: "act",
    description: "Move or edit an event by id (from calendar_list).",
    schema: { id: z.string(), title: z.string().optional(), start: z.string().optional(), end: z.string().optional(), location: z.string().optional(), description: z.string().optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("calendar.update", a) }),
  }),
  tool({
    name: "reminder_create",
    kind: "act",
    description: "Create a reminder: a calendar event with an alert at the given ISO time.",
    schema: { text: z.string(), at: z.string() },
    run: async (a, ctx) =>
      ({ json: await ctx.device.call("calendar.create", { title: `⏰ ${a.text}`, start: a.at, end: new Date(new Date(a.at).getTime() + 15 * 60000).toISOString(), reminder_minutes: 0 }) }),
  }),
  tool({
    name: "alarm_create",
    kind: "act",
    description: "Create an alarm in the Clock app (hour 0-23, minutes, optional label and weekdays 1=Sunday..7=Saturday).",
    schema: { hour: z.number().min(0).max(23), minutes: z.number().min(0).max(59), label: z.string().optional(), days: z.array(z.number()).optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("alarm.create", a) }),
  }),
  tool({
    name: "timer_create",
    kind: "act",
    description: "Start a countdown timer in the Clock app.",
    schema: { seconds: z.number().min(1), label: z.string().optional() },
    run: async (a, ctx) => ({ json: await ctx.device.call("timer.create", a) }),
  }),
];
