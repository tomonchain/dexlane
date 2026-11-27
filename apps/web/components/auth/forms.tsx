"use client";

import { ArrowRight, MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { EDITION } from "@/config/edition";
import { clearCache } from "@/lib/cache";
import { AUTH } from "./content";
import { AuthLayout } from "./layout";

/*
 * Formulaires d'inscription et de mot de passe. Ils parlent aux routes /auth/* du serveur web, qui
 * relaient à l'API ; les pages qui les portent restent statiques (le lien reçu par e-mail est lu dans l'adresse, côté
 * navigateur).
 */

class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Appelle une route de BetterAuth, relayée sous /api/auth. */
async function post(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return;
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string; error?: { code?: string; message?: string } } | null;
  const code = data?.code ?? data?.error?.code ?? (res.status === 429 ? "TOO_MANY_ATTEMPTS" : "ERROR");
  throw new AuthError(code, data?.message ?? data?.error?.message ?? `HTTP ${res.status}`);
}

const message = (e: unknown): string => {
  const code = e instanceof AuthError ? e.code : "";
  return AUTH.errors[code as keyof typeof AUTH.errors] ?? AUTH.errors.DEFAULT;
};

/** Entre dans le compte : les données gardées sur l'appareil pour un autre compte sont oubliées. */
function enter() {
  clearCache();
  window.location.assign("/");
}

const param = (name: string) => new URLSearchParams(window.location.search).get(name) ?? "";

/** Un écran de compte : la moitié droite d'AuthLayout, avec son titre et son chapeau. */
function Card({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <AuthLayout tagline={EDITION.tagline}>
      <div className="grid gap-7">
        <header className="grid gap-2.5">
          <h1 className="text-[2rem] leading-[1.06] font-[450] tracking-[-0.035em] text-balance sm:text-[2.25rem]">{title}</h1>
          {lead && <p className="text-[15px] leading-relaxed text-muted-foreground">{lead}</p>}
        </header>
        {children}
      </div>
    </AuthLayout>
  );
}

const FORM = "grid gap-5";
/** Encadré des confirmations (e-mail envoyé). */
const NOTICE = "grid justify-items-start gap-4 rounded-2xl bg-muted p-5 ring-1 ring-border/60";
const LINK = "font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:no-underline";

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" size="lg" disabled={busy}>
      {busy ? <Spinner className="text-primary-foreground" /> : null} {children} {!busy && <ArrowRight />}
    </Button>
  );
}

/** Inscription : adresse et mot de passe, puis « vérifie ta boîte mail ». */
export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Le forfait choisi sur /tarifs et le code du flyer (/colis) accompagnent l'inscription.
      const [plan, signupCode] = [param("plan"), param("code")];
      await post("sign-up/email", {
        name: email.trim().split("@")[0], email: email.trim(), password, callbackURL: "/signup/verify",
        ...(plan ? { plan } : {}), ...(signupCode ? { signupCode } : {}),
      });
      setSent(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card title={AUTH.signup.sentTitle}>
        <div className={NOTICE} data-testid="signup-sent">
          <MailCheck className="size-8" aria-hidden />
          <p className="text-[15px] leading-relaxed">{AUTH.signup.sentText.replace("{email}", email.trim())}</p>
          {resent
            ? <p className="text-sm text-muted-foreground" role="status">{AUTH.signup.resent}</p>
            : (
              <Button
                variant="outline"
                onClick={() => void post("send-verification-email", { email: email.trim(), callbackURL: "/signup/verify" }).catch(() => undefined).finally(() => setResent(true))}
              >
                {AUTH.signup.resend}
              </Button>
            )}
        </div>
      </Card>
    );
  }

  return (
    <Card title={AUTH.signup.title} lead={AUTH.signup.lead}>
      <form onSubmit={submit} className={FORM}>
        <Field label={AUTH.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required autoFocus />
        </Field>
        <Field label={AUTH.password} hint={AUTH.passwordHint}>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Submit busy={busy}>{AUTH.signup.submit}</Submit>
        {EDITION.legal && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {AUTH.signup.terms[0]} <Link href={EDITION.legal.terms} className={LINK}>{AUTH.signup.terms[1]}</Link> {AUTH.signup.terms[2]}{" "}
            <Link href={EDITION.legal.privacy} className={LINK}>{AUTH.signup.terms[3]}</Link>.
          </p>
        )}
      </form>
      <p className="text-sm text-muted-foreground">{AUTH.signup.haveAccount} <Link href="/login" className={LINK}>{AUTH.login}</Link></p>
    </Card>
  );
}

/**
 * Liste d'attente (#103), à la place de l'inscription tant qu'elle est fermée : une adresse, et ce qu'on sait déjà du
 * vendeur (forfait choisi sur /tarifs, code du flyer, volume). Aucun e-mail ne part.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [volume, setVolume] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [plan, code] = [param("plan"), param("code")];
      const res = await fetch("/waitlist/join", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), ...(plan ? { plan } : {}), ...(code ? { code } : {}), ...(volume ? { volume } : {}) }),
      });
      if (res.status === 400) throw new AuthError("INVALID_EMAIL", "invalid email");
      if (!res.ok) throw new AuthError(res.status === 429 ? "TOO_MANY_ATTEMPTS" : "DEFAULT", `HTTP ${res.status}`);
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? message(err) : AUTH.errors.API_UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card title={AUTH.waitlist.doneTitle}>
        <div className={NOTICE} data-testid="waitlist-done">
          <MailCheck className="size-8" aria-hidden />
          <p className="text-[15px] leading-relaxed">{AUTH.waitlist.doneText.replace("{email}", email.trim())}</p>
        </div>
        <p className="text-sm text-muted-foreground">{AUTH.waitlist.haveAccount} <Link href="/login" className={LINK}>{AUTH.login}</Link></p>
      </Card>
    );
  }

  return (
    <Card title={AUTH.waitlist.title} lead={AUTH.waitlist.lead}>
      <form onSubmit={submit} className={FORM} data-testid="waitlist-form">
        <Field label={AUTH.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required autoFocus />
        </Field>
        <Field label={AUTH.waitlist.volume}>
          <Select value={volume} onChange={(e) => setVolume(e.target.value)}>
            {AUTH.waitlist.volumes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Submit busy={busy}>{AUTH.waitlist.submit}</Submit>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {AUTH.waitlist.privacy[0]}
          {EDITION.legal && <> <Link href={EDITION.legal.privacy} className={LINK}>{AUTH.waitlist.privacy[1]}</Link>.</>}
        </p>
      </form>
      <p className="text-sm text-muted-foreground">{AUTH.waitlist.haveAccount} <Link href="/login" className={LINK}>{AUTH.login}</Link></p>
    </Card>
  );
}

/**
 * Retour du lien de vérification : BetterAuth a confirmé l'adresse et ouvert la session avant de renvoyer ici, ou il
 * signale une erreur dans l'adresse (`?error=…`) si le lien n'est plus valable.
 */
export function VerifyEmail() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (param("error")) setError(AUTH.errors.LINK_EXPIRED);
    else enter();
  }, []);

  return (
    <Card title={error ? AUTH.verify.failedTitle : AUTH.verify.title}>
      {error ? (
        <div className={FORM}>
          <Alert variant="destructive">{error}</Alert>
          <p className="text-sm text-muted-foreground">
            <Link href="/signup" className={LINK}>{AUTH.verify.again}</Link> · <Link href="/login" className={LINK}>{AUTH.login}</Link>
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-3 text-muted-foreground" role="status"><Spinner /> {AUTH.verify.pending}</p>
      )}
    </Card>
  );
}

/** Mot de passe oublié : envoie un lien, sans dire si l'adresse est connue. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("request-password-reset", { email: email.trim(), redirectTo: "/reset-password" });
      setSent(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={AUTH.forgot.title} lead={sent ? undefined : AUTH.forgot.lead}>
      {sent ? (
        <div className={NOTICE} data-testid="forgot-sent">
          <MailCheck className="size-8" aria-hidden />
          <p className="text-[15px] leading-relaxed">{AUTH.forgot.sent}</p>
        </div>
      ) : (
        <form onSubmit={submit} className={FORM}>
          <Field label={AUTH.email}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required autoFocus />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Submit busy={busy}>{AUTH.forgot.submit}</Submit>
        </form>
      )}
      <p className="text-sm text-muted-foreground"><Link href="/login" className={LINK}>{AUTH.backToLogin}</Link></p>
    </Card>
  );
}

/** Nouveau mot de passe, depuis le lien reçu par e-mail. */
export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("reset-password", { token: param("token"), newPassword: password });
      // Le nouveau mot de passe ferme toutes les sessions : on se connecte avec lui.
      clearCache();
      window.location.assign("/login");
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Card title={AUTH.reset.title} lead={AUTH.reset.lead}>
      <form onSubmit={submit} className={FORM}>
        <Field label={AUTH.reset.newPassword} hint={AUTH.passwordHint}>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required autoFocus />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Submit busy={busy}>{AUTH.reset.submit}</Submit>
      </form>
      <p className="text-sm text-muted-foreground"><Link href="/forgot-password" className={LINK}>{AUTH.reset.again}</Link></p>
    </Card>
  );
}
