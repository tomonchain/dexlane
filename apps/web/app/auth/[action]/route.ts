import type { NextRequest } from "next/server";
import { authApi, publicBaseUrl, withSession, type Granted } from "@/lib/auth-server";
import { isSameOrigin, jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Inscription et liens reçus par e-mail :
 * - `signup` `{ email, password, plan?, code? }` : crée le compte, envoie le lien de vérification ;
 * - `resend` `{ email }` : renvoie ce lien ;
 * - `verify` `{ token }` : confirme l'adresse et ouvre la session ;
 * - `forgot` `{ email }` : envoie un lien de réinitialisation du mot de passe ;
 * - `reset` `{ token, newPassword }` : enregistre le nouveau mot de passe et ouvre la session.
 * Les réponses de `signup`, `resend` et `forgot` ne disent jamais si une adresse est déjà inscrite.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const { action } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : "");
  const optional = (key: string) => (text(key).trim() ? { [key]: text(key).trim() } : {});
  const baseUrl = publicBaseUrl(req);
  const post = <T>(path: string, payload: unknown) => authApi<T>(path, { method: "POST", body: JSON.stringify(payload) });

  switch (action) {
    case "signup": {
      const res = await post<{ ok: true }>("/api/auth/signup", { email: text("email"), password: text("password"), baseUrl, ...optional("plan"), ...optional("code") });
      return res.ok ? Response.json({ ok: true }) : res.response;
    }
    case "resend": {
      const res = await post<{ ok: true }>("/api/auth/email/resend", { email: text("email"), baseUrl });
      return res.ok ? Response.json({ ok: true }) : res.response;
    }
    case "forgot": {
      const res = await post<{ ok: true }>("/api/auth/password/forgot", { email: text("email"), baseUrl });
      return res.ok ? Response.json({ ok: true }) : res.response;
    }
    case "verify": {
      const res = await post<Granted>("/api/auth/email/verify", { token: text("token") });
      return res.ok ? withSession(req, res.data) : res.response;
    }
    case "reset": {
      const res = await post<Granted>("/api/auth/password/reset-with-token", { token: text("token"), newPassword: text("newPassword") });
      return res.ok ? withSession(req, res.data) : res.response;
    }
    default:
      return jsonError(404, "NOT_FOUND", "no such route");
  }
}
