import { NextResponse, type NextRequest } from "next/server";
import { authApi as api, withSession, type Granted } from "@/lib/auth-server";
import { SESSION_COOKIE, ServerConfigError, isSameOrigin, jsonError, readSession, secretEquals, serverToken, type Session } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * État de l'écran de connexion : le compte d'installation a-t-il déjà un mot de passe ? Avec une session ouverte (un
 * compte inscrit), la question ne se pose pas : l'assistant de démarrage n'a pas de compte à créer.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    if (readSession(req)) return Response.json({ passwordSet: true });
  } catch {
    // serveur sans jeton configuré : l'appel à l'API ci-dessous le signalera
  }
  const status = await api<{ passwordSet: boolean }>("/api/auth/status");
  return status.ok ? Response.json({ passwordSet: status.data.passwordSet }) : status.response;
}

/**
 * Connexion : `{ email, password }`, ou `{ password }` seul pour le compte d'installation.
 * Première connexion ou mot de passe oublié : `{ setupToken, newPassword }`, où le jeton d'installation est
 * `DEXLANE_API_TOKEN` — la preuve qu'on administre le serveur.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : "");

  if (text("setupToken") || text("newPassword")) {
    try {
      if (!secretEquals(text("setupToken").trim(), serverToken())) return jsonError(401, "INVALID_SETUP_TOKEN", "invalid setup token");
    } catch (e) {
      if (e instanceof ServerConfigError) return jsonError(500, "SERVER_MISCONFIGURED", e.message);
      throw e;
    }
    const reset = await api<Granted>("/api/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ newPassword: text("newPassword") }),
    });
    return reset.ok ? withSession(req, reset.data) : reset.response;
  }

  if (!text("password")) return jsonError(400, "PASSWORD_REQUIRED", "password is required");
  const email = text("email").trim();
  const verified = await api<Granted>("/api/auth/password/verify", {
    method: "POST",
    body: JSON.stringify({ password: text("password"), ...(email ? { email } : {}) }),
  });
  return verified.ok ? withSession(req, verified.data) : verified.response;
}

/** Changement de mot de passe depuis une session ouverte ; la session courante est renouvelée, les autres tombent. */
export async function PUT(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  let session: Session | null;
  try {
    session = readSession(req);
    if (!session) return jsonError(401, "UNAUTHORIZED", "session expired");
  } catch (e) {
    if (e instanceof ServerConfigError) return jsonError(500, "SERVER_MISCONFIGURED", e.message);
    throw e;
  }
  const body = (await req.json().catch(() => null)) as { currentPassword?: unknown; newPassword?: unknown } | null;
  if (typeof body?.currentPassword !== "string" || typeof body.newPassword !== "string") {
    return jsonError(400, "PASSWORD_REQUIRED", "currentPassword and newPassword are required");
  }
  const changed = await api<Granted>("/api/auth/password/change", {
    method: "POST",
    accountId: session.accountId,
    body: JSON.stringify({ currentPassword: body.currentPassword, newPassword: body.newPassword }),
  });
  return changed.ok ? withSession(req, changed.data) : changed.response;
}

export async function DELETE(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
