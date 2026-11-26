import { randomBytes } from "node:crypto";
import { recordEvent, withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

/**
 * Accès aux API REST d'eBay pour un compte vendeur. Deux identités :
 * - l'application (App ID et Cert ID, dans l'environnement du serveur), qui obtient les jetons ;
 * - le compte vendeur, qui autorise l'application une fois (consentement OAuth) : on garde son jeton de
 *   renouvellement (18 mois) et on en tire des jetons d'accès de deux heures, renouvelés d'office.
 */

export type EbayEnvironment = "sandbox" | "production";

export interface EbayConfig {
  environment: EbayEnvironment;
  /** App ID (Client ID) du jeu de clés. */
  clientId: string;
  /** Cert ID (Client Secret) du jeu de clés. */
  clientSecret: string;
  /** Nom de l'URL de redirection (RuName) déclarée dans « User tokens » ; c'est lui qu'eBay attend comme redirect_uri. */
  ruName: string;
}

/** Configuration d'après l'environnement ; null tant que les trois identifiants ne sont pas tous fournis. */
export function ebayConfigFromEnv(env: Record<string, string | undefined>): EbayConfig | null {
  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  const ruName = env.EBAY_RU_NAME?.trim();
  if (!clientId || !clientSecret || !ruName) return null;
  // Bac à sable par défaut : la production se demande explicitement.
  return { environment: env.EBAY_ENV?.trim().toLowerCase() === "production" ? "production" : "sandbox", clientId, clientSecret, ruName };
}

export const EBAY_HOSTS: Record<EbayEnvironment, { api: string; apiz: string; auth: string }> = {
  sandbox: { api: "https://api.sandbox.ebay.com", apiz: "https://apiz.sandbox.ebay.com", auth: "https://auth.sandbox.ebay.com" },
  production: { api: "https://api.ebay.com", apiz: "https://apiz.ebay.com", auth: "https://auth.ebay.com" },
};

/** Droits demandés au compte vendeur : annonces, règles de vente, commandes, et son pseudo. */
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

const CHANNEL = "ebay";
/** Une autorisation commencée doit revenir dans le quart d'heure (eBay donne cinq minutes au code). */
const STATE_TTL_MINUTES = 15;
/** Marge avant l'expiration d'un jeton d'accès : on le renouvelle un peu avant. */
const ACCESS_MARGIN_MS = 5 * 60_000;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/** Une erreur renvoyée par eBay, rapportée telle quelle (le message d'eBay est le plus parlant). */
export interface EbayErrorDetail {
  errorId?: number;
  message?: string;
  longMessage?: string;
  parameters?: { name: string; value: string }[];
}

export class EbayClient {
  readonly hosts: { api: string; apiz: string; auth: string };

  constructor(
    private readonly sql: Db,
    readonly config: EbayConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.hosts = EBAY_HOSTS[config.environment];
  }

  // ───────────────────────── Consentement du compte vendeur ─────────────────────────

  /** Adresse où envoyer le propriétaire pour qu'il autorise Dexlane sur son compte eBay. */
  async consentUrl(): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    await this.sql`delete from channel_oauth_states where created_at < now() - make_interval(mins => ${STATE_TTL_MINUTES})`;
    await this.sql`insert into channel_oauth_states (state, channel) values (${state}, ${CHANNEL})`;
    const url = new URL("/oauth2/authorize", this.hosts.auth);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.ruName);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", EBAY_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "login");
    return url.toString();
  }

  /** Retour du consentement : vérifie `state`, échange le code contre les jetons et les garde. */
  async completeConsent(input: { state: string; code: string }): Promise<{ username: string | null }> {
    const [pending] = await this.sql`
      delete from channel_oauth_states
       where state = ${input.state} and channel = ${CHANNEL} and created_at > now() - make_interval(mins => ${STATE_TTL_MINUTES})
       returning state`;
    if (!pending) throw new DomainError("EBAY_CONSENT_EXPIRED", "cette autorisation eBay a expiré ou a déjà servi : recommencez la connexion");
    const tokens = await this.tokenRequest({ grant_type: "authorization_code", code: input.code, redirect_uri: this.config.ruName });
    if (!tokens.refresh_token) throw new DomainError("EBAY_REJECTED", "eBay n'a pas fourni de jeton de renouvellement");
    const username = await this.fetchUsername(tokens.access_token).catch(() => null);
    const [connected] = await this.sql<{ connectedAt: Date }[]>`
      insert into channel_accounts (channel, environment, username, refresh_token, refresh_expires_at, access_token, access_expires_at)
      values (${CHANNEL}, ${this.config.environment}, ${username}, ${tokens.refresh_token},
              ${expiry(tokens.refresh_token_expires_in)}, ${tokens.access_token}, ${expiry(tokens.expires_in)})
      on conflict (account_id, channel) do update set
        environment = excluded.environment, username = excluded.username, refresh_token = excluded.refresh_token,
        refresh_expires_at = excluded.refresh_expires_at, access_token = excluded.access_token,
        access_expires_at = excluded.access_expires_at, connected_at = now()
      returning connected_at`;
    // Chaque connexion est un fait daté (une reconnexion en est une autre).
    if (connected) {
      await recordEvent(this.sql, {
        type: "ebay_connected", key: `ebay_connected:${connected.connectedAt.toISOString()}`, occurredAt: connected.connectedAt,
        payload: { environment: this.config.environment },
      });
    }
    return { username };
  }

  async disconnect(): Promise<void> {
    await this.sql`delete from channel_accounts where channel = ${CHANNEL}`;
  }

  /** Compte connecté dans l'environnement configuré ; null sinon (jamais connecté, ou connecté à l'autre environnement). */
  async account(): Promise<{ username: string | null; connectedAt: Date; refreshExpiresAt: Date | null } | null> {
    const [row] = await this.sql<{ username: string | null; connectedAt: Date; refreshExpiresAt: Date | null }[]>`
      select username, connected_at, refresh_expires_at from channel_accounts
       where channel = ${CHANNEL} and environment = ${this.config.environment}`;
    return row ?? null;
  }

  // ───────────────────────── Jetons ─────────────────────────

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetcher(`${this.hosts.api}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as (TokenResponse & { error?: string; error_description?: string }) | null;
    if (res.ok && body?.access_token) return body;
    if (res.status >= 500) throw new DomainError("EBAY_UNAVAILABLE", `eBay ne répond pas (HTTP ${res.status}) : réessayez plus tard`);
    if (body?.error === "invalid_client") {
      throw new DomainError("EBAY_BAD_CREDENTIALS", "eBay refuse les identifiants de l'application : vérifiez EBAY_CLIENT_ID, EBAY_CLIENT_SECRET et EBAY_ENV");
    }
    if (body?.error === "invalid_grant" && form.grant_type === "refresh_token") {
      throw new DomainError("EBAY_NOT_CONNECTED", "l'autorisation du compte eBay a expiré ou a été retirée : reconnectez le compte");
    }
    throw new DomainError("EBAY_REJECTED", `eBay refuse l'autorisation : ${body?.error_description ?? body?.error ?? `HTTP ${res.status}`}`);
  }

  /** Jeton d'accès valide du compte vendeur, renouvelé au besoin (et gardé pour les appels suivants). */
  async accessToken(force = false): Promise<string> {
    return withTx(this.sql, async (tx) => {
      // Verrou : deux synchronisations simultanées ne renouvellent pas le jeton chacune de leur côté.
      const [row] = await tx<{ refreshToken: string; accessToken: string | null; accessExpiresAt: Date | null }[]>`
        select refresh_token, access_token, access_expires_at from channel_accounts
         where channel = ${CHANNEL} and environment = ${this.config.environment} for update`;
      if (!row) throw new DomainError("EBAY_NOT_CONNECTED", "aucun compte eBay n'est connecté : connectez-le dans Réglages › Canaux de vente");
      if (!force && row.accessToken && row.accessExpiresAt && row.accessExpiresAt.getTime() - ACCESS_MARGIN_MS > Date.now()) return row.accessToken;
      const tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: row.refreshToken, scope: EBAY_SCOPES.join(" ") });
      await tx`
        update channel_accounts set access_token = ${tokens.access_token}, access_expires_at = ${expiry(tokens.expires_in)}
         where channel = ${CHANNEL}`;
      return tokens.access_token;
    });
  }

  private async fetchUsername(accessToken: string): Promise<string | null> {
    const res = await this.fetcher(`${this.hosts.apiz}/commerce/identity/v1/user/`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { username?: string }).username ?? null;
  }

  // ───────────────────────── Appels ─────────────────────────

  /**
   * Appel REST au nom du compte vendeur. Renvoie le corps JSON (null pour une réponse vide), ou `undefined` pour un
   * 404 quand `allowNotFound` est demandé. Un jeton refusé est renouvelé une fois.
   */
  async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; language?: string; allowNotFound?: boolean; host?: "api" | "apiz" } = {},
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken(attempt > 1)}`, Accept: "application/json" };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      // Langue du contenu envoyé (titres, descriptions) : exigée par l'API Inventory.
      if (opts.language) headers["Content-Language"] = opts.language;
      const res = await this.fetcher(`${this.hosts[opts.host ?? "api"]}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 401 && attempt === 1) continue;
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // Page d'erreur HTML d'un intermédiaire : seul le statut HTTP compte.
      }
      if (res.ok) return body as T;
      if (res.status === 404 && opts.allowNotFound) return undefined as T;
      const errors = ((body as { errors?: EbayErrorDetail[] } | null)?.errors ?? []).slice(0, 5);
      if (res.status >= 500 && errors.length === 0) throw new DomainError("EBAY_UNAVAILABLE", `eBay ne répond pas (HTTP ${res.status}) : réessayez plus tard`);
      throw new DomainError("EBAY_REJECTED", `eBay : ${describeErrors(errors) || `HTTP ${res.status}`}`, { status: res.status, errors });
    }
  }

  /** Appel à l'ancienne API Trading (XML), pour ce que les API REST n'exposent pas (liste des services d'envoi). */
  async trading(call: string, siteId: number, xmlBody: string): Promise<string> {
    const res = await this.fetcher(`${this.hosts.api}/ws/api.dll`, {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": call,
        "X-EBAY-API-SITEID": String(siteId),
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1331",
        "X-EBAY-API-IAF-TOKEN": await this.accessToken(),
        "Content-Type": "text/xml",
      },
      body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${xmlBody}</${call}Request>`,
      signal: AbortSignal.timeout(30_000),
    });
    const xml = await res.text();
    if (!res.ok || /<Ack>Failure<\/Ack>/.test(xml)) {
      const message = /<LongMessage>([^<]*)<\/LongMessage>/.exec(xml)?.[1] ?? `HTTP ${res.status}`;
      throw new DomainError("EBAY_REJECTED", `eBay : ${message}`);
    }
    return xml;
  }
}

/** Les messages d'eBay, sans doublon, du plus précis au plus court. */
export function describeErrors(errors: EbayErrorDetail[]): string {
  return [...new Set(errors.map((e) => (e.longMessage || e.message || "").trim()).filter(Boolean))].join(" ; ");
}

const expiry = (seconds: number | undefined) => (seconds ? new Date(Date.now() + seconds * 1000) : null);
