/** Envoi des e-mails transactionnels (vérification d'adresse, mot de passe oublié). */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** En-têtes en plus (désinscription en un clic : List-Unsubscribe). */
  headers?: Record<string, string>;
}
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Envoi par Resend (https://resend.com) : une clé d'API et une adresse d'expédition sur un domaine vérifié. */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(mail) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, ...(mail.headers ? { headers: mail.headers } : {}) }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    },
  };
}

/** En développement, sans Resend : l'e-mail est écrit dans la console, lien compris. */
export function consoleMailer(): Mailer {
  return {
    async send(mail) {
      console.info(`[mail] à ${mail.to} — ${mail.subject}\n${mail.text}`);
    },
  };
}

/**
 * Le service d'envoi d'après l'environnement : Resend si `RESEND_API_KEY` et `EMAIL_FROM` sont définis, la console en
 * développement, rien sinon (l'inscription répond alors qu'elle n'est pas configurée).
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) return resendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  return env.NODE_ENV === "production" ? null : consoleMailer();
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Un e-mail simple : quelques lignes et, au besoin, un bouton. */
function compose(to: string, subject: string, lines: string[], action?: { label: string; url: string }, footer?: string): Mail {
  const text = [...lines, ...(action ? [`${action.label} : ${action.url}`] : []), ...(footer ? [footer] : [])].join("\n\n");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:32px 16px;background:#fbfaf8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1a17">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e8e5e0;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:18px;font-weight:600">dexlane</p>
${lines.map((l) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">${escapeHtml(l)}</p>`).join("\n")}
${action ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1d1a17;color:#ffffff;text-decoration:none;font-weight:500;font-size:15px;padding:12px 20px;border-radius:8px">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b655e;word-break:break-all">${escapeHtml(action.url)}</p>` : ""}
${footer ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b655e">${escapeHtml(footer)}</p>` : ""}
</div></body></html>`;
  return { to, subject, text, html };
}

export const verificationMail = (to: string, url: string) =>
  compose(to, "Confirme ton adresse e-mail", ["Bienvenue sur Dexlane.", "Confirme ton adresse pour ouvrir ton compte."], { label: "Confirmer mon adresse", url },
    "Le lien est valable 24 heures. Si tu n'es pas à l'origine de cette inscription, ignore ce message.");

export const alreadyRegisteredMail = (to: string, loginUrl: string) =>
  compose(to, "Tu as déjà un compte Dexlane", ["Quelqu'un vient de s'inscrire avec cette adresse, mais elle a déjà un compte.", "Si c'est toi, connecte-toi. Si tu as oublié ton mot de passe, tu peux le réinitialiser depuis la page de connexion."],
    { label: "Se connecter", url: loginUrl }, "Si ce n'est pas toi, ignore ce message : ton compte n'a pas changé.");

export const passwordResetMail = (to: string, url: string) =>
  compose(to, "Réinitialise ton mot de passe", ["Tu as demandé à changer ton mot de passe Dexlane."], { label: "Choisir un nouveau mot de passe", url },
    "Le lien est valable 1 heure. Si tu n'as rien demandé, ignore ce message : ton mot de passe n'a pas changé.");

export const invitationMail = (to: string, inviter: string, url: string) =>
  compose(to, "Tu es invité sur Dexlane", [`${inviter} t'invite à rejoindre son compte Dexlane : son stock, ses annonces et ses ventes.`],
    { label: "Rejoindre le compte", url }, "Le lien est valable 7 jours. Si tu ne connais pas cette personne, ignore ce message.");

export const supportMail = (to: string, input: { from: string; subject: string; message: string; plan: string; priority: boolean }) =>
  compose(to, `${input.priority ? "[PRIORITAIRE] " : ""}Support Dexlane : ${input.subject}`,
    [`De : ${input.from} (forfait ${input.plan})`, ...input.message.split(/\n{2,}/)]);

/** Le récap du mois (ou de l'année) est prêt : un e-mail court, un lien vers la page, un lien de désinscription. */
export const recapMail = (to: string, input: { period: string; cardsSold: number; timeSavedMinutes: number; url: string; unsubscribe: string }) => {
  const hours = Math.floor(input.timeSavedMinutes / 60);
  const minutes = input.timeSavedMinutes % 60;
  const saved = hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")}` : `${minutes} min`;
  const sold = `${input.cardsSold} carte${input.cardsSold > 1 ? "s" : ""} vendue${input.cardsSold > 1 ? "s" : ""}`;
  return {
    ...compose(to, `Ton récap ${input.period} est prêt`, [`Ton récap ${input.period} : ${sold}, environ ${saved} gagnées.`],
      { label: "Voir mon récap", url: input.url },
      `Tu reçois cet e-mail parce que le récap mensuel est activé. Pour ne plus le recevoir : ${input.unsubscribe}`),
    headers: { "List-Unsubscribe": `<${input.unsubscribe}>` },
  };
};
