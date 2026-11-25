import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Catégories d'actions soumises à confirmation sur le téléphone (modifiable dans config.json ou l'app). */
export const DEFAULT_CONFIRM_CATEGORIES = [
  "paiement",
  "achat",
  "virement",
  "nouveau_contact",
  "suppression_definitive",
  "publication_publique",
  "securite",
  "desinstallation",
  "redemarrage",
] as const;

export interface Config {
  /** Jeton d'appairage partagé avec l'app (secret, jamais dans Git). */
  pairingToken: string;
  /** Jeton Bearer pour le transport HTTP distant (secret). */
  httpToken: string;
  /** Adresse d'écoute du WebSocket téléphone. Mettre l'IP Tailscale du Mac (100.x.y.z). */
  wsHost: string;
  wsPort: number;
  httpHost: string;
  httpPort: number;
  /** Numéro de série ADB à cibler (optionnel si un seul appareil). */
  adbSerial?: string;
  adbPath: string;
  /** Dossier du Mac où arrivent les fichiers récupérés du téléphone. */
  inboxDir: string;
  /** Dossier de sauvegarde quotidienne. */
  backupDir: string;
  confirmCategories: string[];
  /** Délai max d'attente d'une réponse Oui/Non sur le téléphone. */
  confirmTimeoutSec: number;
  /** Captures avant/après pour les actions sensibles. */
  auditScreenshots: boolean;
}

export function phonepilotHome(): string {
  return process.env.PHONEPILOT_HOME ?? join(homedir(), ".phonepilot");
}

function defaults(): Config {
  return {
    pairingToken: randomBytes(24).toString("base64url"),
    httpToken: randomBytes(32).toString("base64url"),
    wsHost: "127.0.0.1",
    wsPort: 8765,
    httpHost: "127.0.0.1",
    httpPort: 8766,
    adbPath: process.env.ADB ?? "adb",
    inboxDir: join(homedir(), "PhonePilot", "Recus"),
    backupDir: join(homedir(), "PhonePilot", "Sauvegardes"),
    confirmCategories: [...DEFAULT_CONFIRM_CATEGORIES],
    confirmTimeoutSec: 60,
    auditScreenshots: true,
  };
}

export function configPath(): string {
  return join(phonepilotHome(), "config.json");
}

/** Charge (ou crée au premier lancement) la configuration. Le fichier est en 0600. */
export function loadConfig(): Config {
  const home = phonepilotHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = configPath();
  let cfg = defaults();
  if (existsSync(file)) {
    cfg = { ...cfg, ...JSON.parse(readFileSync(file, "utf8")) };
  } else {
    saveConfig(cfg);
  }
  // Variables d'environnement prioritaires (pratique pour launchd / tests).
  if (process.env.PHONEPILOT_WS_HOST) cfg.wsHost = process.env.PHONEPILOT_WS_HOST;
  if (process.env.PHONEPILOT_WS_PORT) cfg.wsPort = Number(process.env.PHONEPILOT_WS_PORT);
  if (process.env.PHONEPILOT_HTTP_PORT) cfg.httpPort = Number(process.env.PHONEPILOT_HTTP_PORT);
  if (process.env.PHONEPILOT_ADB_SERIAL) cfg.adbSerial = process.env.PHONEPILOT_ADB_SERIAL;
  return cfg;
}

export function saveConfig(cfg: Config): void {
  const file = configPath();
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function rotatePairingToken(cfg: Config): Config {
  const next = { ...cfg, pairingToken: randomBytes(24).toString("base64url") };
  saveConfig(next);
  return next;
}
