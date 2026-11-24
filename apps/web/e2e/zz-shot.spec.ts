// @ts-nocheck
import { test } from "@playwright/test";
import { E2E_PASSWORD, E2E_TOKEN } from "./constants";
test("shot", async ({ page }) => {
  const { passwordSet } = await (await page.request.get("/auth")).json();
  await page.request.post("/auth", { data: passwordSet ? { password: E2E_PASSWORD } : { setupToken: E2E_TOKEN, newPassword: E2E_PASSWORD } });
  await page.request.put("/api/app-settings", { data: { onboardingDone: true } });
  await page.request.post("/api/locations", { data: { code: "BOX-A" } });
  const { candidates } = await (await page.request.get("/api/catalog/cards?name=fouinar")).json();
  const r = await (await page.request.post("/api/inventory/receive", { data: { variantId: candidates[0].variants[0].id, condition: "NM", quantity: 3, locationCode: "BOX-A", unitCostCents: 10 }, headers: { "Idempotency-Key": "a" + Date.now() } })).json();
  const o = await (await page.request.post("/api/orders", { data: { lines: [{ offerId: r.offer.id, qty: 1, unitPriceCents: 350 }], shippingMode: "LETTER_TRACKED", buyerName: "Camille" }, headers: { "Idempotency-Key": "o" + Date.now() } })).json();
  const a = o.lines[0].allocations[0];
  await page.request.post(`/api/orders/${o.id}/pick`, { data: { allocationId: a.id, unitSku: a.unitSku } });
  for (const [w, h, tag] of [[412, 915, "mobile"], [1400, 900, "desktop"]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/sales/${o.id}`);
    await page.getByTestId("action-bar").waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/act-sale-${tag}.png` });
    await page.goto("/stock");
    await page.locator("tbody tr input[type=checkbox]").first().check();
    await page.getByTestId("action-bar").waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/act-stock-${tag}.png` });
    await page.goto("/settings/shop");
    await page.getByLabel("Nom de la boutique").fill("Ma boutique " + tag);
    await page.getByTestId("action-bar").waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/act-settings-${tag}.png` });
  }
});
