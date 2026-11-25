import { EventEmitter } from "node:events";
import { Errors } from "../errors.js";

/** Commandes shell strictement interdites (réinitialisation, désactivation du verrouillage, etc.). */
const FORBIDDEN_SHELL = [
  /\bwipe\b|--wipe|factory[_ ]?reset|master[_ ]?clear|FACTORY_RESET|MASTER_CLEAR/i,
  /\brecovery\b/i,
  /\blocksettings\b\s+(clear|set-disabled|set-pin|set-password|set-pattern)/i,
  /\bpm\s+(disable|disable-user|hide|suspend)\b.*(systemui|settings|keyguard|phonepilot)/i,
  /\bpm\s+uninstall\b.*\b(com\.android\.systemui|com\.android\.settings|com\.phonepilot)/i,
  /settings\s+put\s+\w+\s+(lockscreen\.disabled|lock_screen_lock_after_timeout)/i,
  /\brm\s+-rf?\s+\/(sdcard|storage|data)\/?(\s|$)/i,
  /\bdd\s+if=/i,
  /\bsetprop\b/i,
];

export function checkShellCommand(cmd: string): string | null {
  for (const r of FORBIDDEN_SHELL) if (r.test(cmd)) return `commande interdite (${r.source.slice(0, 30)}…)`;
  return null;
}

/** Mots qui, sur un élément touché ou un texte tapé, imposent une confirmation. */
const SENSITIVE_UI: [RegExp, string][] = [
  [/\b(payer|paiement|pay(er)?\s+maintenant|pay|checkout|régler)\b/i, "paiement"],
  [/\b(acheter|achat|buy|purchase|commander|valider (la|ma) commande|passer commande|s'abonner|subscribe)\b/i, "achat"],
  [/\b(virement|transf[ée]rer de l'argent|envoyer de l'argent|wire|transfer money|b[ée]n[ée]ficiaire)\b/i, "virement"],
  [/\b(publier|publish|post(er)?|partager publiquement|tweet(er)?|mettre en ligne)\b/i, "publication_publique"],
  [/\b(supprimer d[ée]finitivement|delete permanently|vider la corbeille|effacer tout)\b/i, "suppression_definitive"],
  [/\b(mot de passe|password|code pin|code secret|biom[ée]trie|empreinte|d[ée]sactiver le verrouillage|r[ée]initialis|factory reset)\b/i, "securite"],
];

export function sensitiveUiCategory(...texts: (string | undefined)[]): string | null {
  const t = texts.filter(Boolean).join(" ");
  for (const [r, cat] of SENSITIVE_UI) if (r.test(t)) return cat;
  return null;
}

/**
 * Garde-fou global : arrêt d'urgence + confirmations.
 * L'arrêt peut être déclenché par Claude (emergency_stop) ou par le bouton STOP de l'app,
 * mais SEULE l'app (Antoine) peut reprendre.
 */
export class Guard extends EventEmitter {
  stopped = false;
  stoppedReason = "";

  stop(reason: string) {
    this.stopped = true;
    this.stoppedReason = reason;
    this.emit("stop", reason);
  }

  resumeFromPhone() {
    this.stopped = false;
    this.stoppedReason = "";
    this.emit("resume");
  }

  assertRunning() {
    if (this.stopped) throw Errors.stopped();
  }
}
