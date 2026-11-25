"use client";

import { ArrowRight, MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { AUTH } from "@/components/landing/content";
import { clearCache } from "@/lib/cache";

/*
 * Formulaires d'inscription et de mot de passe du site marketing. Ils parlent aux routes /auth/* du serveur web, qui
 * relaient à l'API ; les pages qui les portent restent statiques (le lien reçu par e-mail est lu dans l'adresse, côté
 * navigateur).
 */

class AuthError extends Error {
  constructor(public code: string, message: string, public retryAfterS?: number) {
    super(message);
  }
}

async function post(action: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return;
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: { retryAfterS?: number } } } | null;
  throw new AuthError(data?.error?.code ?? "ERROR", data?.error?.message ?? `HTTP ${res.status}`, data?.error?.details?.retryAfterS);
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

function Card({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-md gap-6 px-4 pt-12 pb-20 sm:pt-20 sm:pb-28">
      <header className="grid gap-3">
        <h1 className="text-[2rem] leading-[1.06] font-[450] tracking-[-0.035em] text-balance sm:text-[2.5rem]">{title}</h1>
        {lead && <p className="text-base leading-relaxed text-muted-foreground">{lead}</p>}
      </header>
      {children}
    </div>
  );
}

const FORM = "grid gap-5 rounded-2xl bg-card p-6 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_16px_32px_-16px_rgb(0_0_0/0.18)]";
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
      await post("signup", { email, password, plan: param("plan"), code: param("code") });
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
        <div className={FORM} data-testid="signup-sent">
          <MailCheck className="size-8" aria-hidden />
          <p className="text-[15px] leading-relaxed">{AUTH.signup.sentText.replace("{email}", email.trim())}</p>
          {resent
            ? <p className="text-sm text-muted-foreground" role="status">{AUTH.signup.resent}</p>
            : (
              <Button
                variant="outline"
                onClick={() => void post("resend", { email }).catch(() => undefined).finally(() => setResent(true))}
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
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {AUTH.signup.terms[0]} <Link href="/cgu" className={LINK}>{AUTH.signup.terms[1]}</Link> {AUTH.signup.terms[2]}{" "}
          <Link href="/confidentialite" className={LINK}>{AUTH.signup.terms[3]}</Link>.
        </p>
      </form>
      <p className="text-sm text-muted-foreground">{AUTH.signup.haveAccount} <Link href="/login" className={LINK}>{AUTH.login}</Link></p>
    </Card>
  );
}

/** Lien de vérification suivi : l'adresse est confirmée, la session s'ouvre. */
export function VerifyEmail() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = param("token");
    if (!token) return setError(AUTH.errors.LINK_EXPIRED);
    post("verify", { token }).then(enter, (e) => setError(message(e)));
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
      await post("forgot", { email });
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
        <div className={FORM} data-testid="forgot-sent">
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
      await post("reset", { token: param("token"), newPassword: password });
      enter();
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
