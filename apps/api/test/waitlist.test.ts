import { describe, expect, it } from "vitest";
import { testDatabaseUrl, useTestDb } from "@dexlane/db/testing";
import { createApp } from "../src/app";
import type { Mail } from "../src/mailer";

const sql = useTestDb("api");
const TOKEN = "test-token-0123456789abcdef";
const BASE = "https://dexlane.test";
const mails: Mail[] = [];
const app = createApp({
  sql, token: TOKEN, recognizer: () => { throw new Error("no scan here"); }, signup: "waitlist",
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

describe("closed sign-ups and waitlist (#103)", () => {
  it("refuses new accounts while sign-ups are closed, and says so", async () => {
    expect((await req("GET", "/api/public/signup")).json).toEqual({ mode: "waitlist" });
    const refused = await signUp("vendeur@example.com");
    expect(refused).toMatchObject({ status: 403, json: { error: { code: "SIGNUP_CLOSED" } } });
    expect(mails).toHaveLength(0);
    expect((await sql`select 1 from auth_users`).length).toBe(0);
  });

  it("still lets an address invited into a team sign up", async () => {
    await sql`insert into account_invitations (email, token_hash, invited_by, expires_at) values ('equipe@example.com', 'h', 'proprio', now() + interval '1 day')`;
    expect((await signUp("Equipe@Example.com")).status).toBe(200);
  });

  it("keeps each address once on the waitlist, with what it told us, readable by the server only", async () => {
    expect((await req("POST", "/api/public/waitlist", { email: "Vendeur@Example.com", plan: "solo", code: "FLYER" })).status).toBe(201);
    expect((await req("POST", "/api/public/waitlist", { email: "vendeur@example.com", volume: "50-200" })).status).toBe(201);
    expect((await req("POST", "/api/public/waitlist", { email: "pas-une-adresse" })).status).toBe(400);
    const list = await req("GET", "/api/admin/waitlist");
    expect(list.json.entries).toHaveLength(1);
    expect(list.json.entries[0]).toMatchObject({ email: "vendeur@example.com", plan: "solo", signupCode: "FLYER", volume: "50-200" });
  });
});
