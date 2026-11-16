export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/dexlane_test";
  const name = new URL(url).pathname.slice(1);
  // Garde-fou : les tests vident la base. Refuser toute base qui n'est pas explicitement une base de test.
  if (!name.endsWith("_test")) throw new Error(`refusing to run tests against non-test database "${name}"`);
  return url;
}
