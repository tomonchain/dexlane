import { describe, expect, it } from "vitest";
import { testDatabaseUrl, useTestDb } from "@dexlane/db/testing";
import { createApp } from "../src/app";
import type { Mail } from "../src/mailer";

const sql = useTestDb("api");
const TOKEN = "test-token-0123456789abcdef";
const BASE = "https://dexlane.test";
const mails: Mail[] = [];
const app = createApp({
  sql, token: TOKEN, recognizer: () => { throw new Error("no scan here"); }, signup: "invite",
  databaseUrl: testDatabaseUrl("api"), baseUrl: BASE, mailer: { send: async (m) => void mails.push(m) }, onError: () => undefined,
});

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, Origin: BASE, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const signUp = (email: string) =>
  req("POST", "/api/auth/sign-up/email", { name: "x", email, password: "un-bon-mot-de-passe", callbackURL: "/signup/verify" });

describe("sign-ups by invitation only (#116)", () => {
  it("refuses new accounts unless invited, and says so", async () => {
    expect((await req("GET", "/api/public/signup")).json).toEqual({ mode: "invite" });
    const refused = await signUp("vendeur@example.com");
    expect(refused).toMatchObject({ status: 403, json: { error: { code: "SIGNUP_CLOSED" } } });
    expect(mails).toHaveLength(0);
    expect((await sql`select 1 from auth_users`).length).toBe(0);
  });

  it("lets an address invited into the team sign up", async () => {
    await sql`insert into account_invitations (email, token_hash, invited_by, expires_at) values ('equipe@example.com', 'h', 'proprio', now() + interval '1 day')`;
    expect((await signUp("Equipe@Example.com")).status).toBe(200);
  });
});
