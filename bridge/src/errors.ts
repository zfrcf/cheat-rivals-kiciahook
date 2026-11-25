/** Erreur « exploitable » : un code stable + un message qui dit quoi faire. */
export class PilotError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
  toText(): string {
    return `[${this.code}] ${this.message}${this.hint ? `\n→ ${this.hint}` : ""}`;
  }
}

export const Errors = {
  notConnected: () =>
    new PilotError(
      "PHONE_OFFLINE",
      "Téléphone injoignable : ni l'app PhonePilot ni ADB ne répondent.",
      "Vérifie que l'app PhonePilot affiche « Connecté », ou branche le câble USB au Mac.",
    ),
  shizukuInactive: () =>
    new PilotError(
      "SHIZUKU_INACTIVE",
      "Shizuku inactif — branche le téléphone au Mac.",
      "Lance scripts/mac/relancer-shizuku.sh (ou attends que le démon Mac le fasse automatiquement).",
    ),
  unsupported: (method: string) =>
    new PilotError(
      "UNSUPPORTED",
      `Action « ${method} » indisponible avec les connexions actuelles.`,
      "Active l'app compagnon (accessibilité) ou Shizuku, selon l'action.",
    ),
  stopped: () =>
    new PilotError(
      "EMERGENCY_STOP",
      "Arrêt d'urgence actif : toutes les actions sont bloquées.",
      "Seul Antoine peut reprendre, avec le bouton « Reprendre » de l'app PhonePilot.",
    ),
  denied: (why: string) => new PilotError("USER_DENIED", `Action refusée sur le téléphone : ${why}`),
  forbidden: (why: string) => new PilotError("FORBIDDEN", `Action interdite par la politique de sécurité : ${why}`),
  locked: () =>
    new PilotError(
      "SCREEN_LOCKED",
      "L'écran est verrouillé.",
      "Préviens Antoine et demande-lui de déverrouiller. Ne jamais tenter de deviner le code.",
    ),
};
