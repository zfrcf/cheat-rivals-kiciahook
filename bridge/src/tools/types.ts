import type { z } from "zod";
import type { Config } from "../config.js";
import type { Device } from "../phone/device.js";
import type { AuditLog } from "../security/audit.js";
import type { Guard } from "../security/guard.js";

export interface Out {
  json?: unknown;
  text?: string;
  image?: { data: string; mime: string };
  /** Si défini, le texte vient de l'appareil : il sera encadré comme donnée non fiable. */
  untrusted?: string;
}

export interface Ctx {
  device: Device;
  cfg: Config;
  audit: AuditLog;
  guard: Guard;
  who: string;
  /** Exécute un autre outil en passant par tous les garde-fous (utilisé par macros/planifs). */
  run(tool: string, args: any, who?: string): Promise<Out>;
  state: Map<string, any>;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  /** observe : lecture ; act : modifie quelque chose ; meta : toujours autorisé (même en arrêt d'urgence). */
  kind: "observe" | "act" | "meta";
  /** Renvoie la catégorie de confirmation requise (ou null). Peut inspecter l'écran. */
  confirm?: (args: any, ctx: Ctx) => Promise<{ category: string; summary: string } | null> | { category: string; summary: string } | null;
  run: (args: any, ctx: Ctx) => Promise<Out>;
}

export const tool = (d: ToolDef) => d;
