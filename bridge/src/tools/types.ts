import type { z } from "zod";
import type { Config } from "../config.js";
import type { Device } from "../phone/device.js";
import type { AuditEntry } from "../security/audit.js";
import type { Guard } from "../security/guard.js";

export interface Out {
  json?: unknown;
  text?: string;
  image?: { data: string; mime: string };
  /** Si défini, le texte vient de l'appareil : il sera encadré comme donnée non fiable. */
  untrusted?: string;
}

/** Où vit le bridge : sur le Mac (fichiers locaux, ADB) ou dans le cloud (liens de téléchargement). */
export interface Delivered {
  path: string;
  bytes?: number;
  local?: string;
  link?: string;
  expires?: string;
}

export interface Platform {
  kind: "mac" | "cloud";
  /** Met un fichier du téléphone à disposition d'Antoine : copie sur le Mac, ou lien HTTPS temporaire. */
  deliver(ctx: Ctx, remotePath: string, dir?: string): Promise<Delivered>;
  /** Récupère un fichier source (URL https, ou chemin local sur le Mac). */
  source(src: string): Promise<{ name: string; data: Uint8Array }>;
  pdfToText?(data: Uint8Array): Promise<string | undefined>;
  readBytes?(ctx: Ctx, remote: string, max: number): Promise<Uint8Array>;
  /** Programme une action unique (ex. fin du Ne pas déranger). */
  oneShot(at: Date, tool: string, args: any): void;
}

export interface AuditSink {
  write(e: Omit<AuditEntry, "ts">): void;
  tail(n?: number, filter?: string): Promise<AuditEntry[]> | AuditEntry[];
  saveImage(name: string, base64: string): Promise<string | undefined> | string | undefined;
}

export interface Ctx {
  device: Device;
  cfg: Config;
  audit: AuditSink;
  platform: Platform;
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
