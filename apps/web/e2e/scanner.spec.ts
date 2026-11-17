import { deflateSync, crc32 } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { E2E_TOKEN } from "./constants";

/** PNG valide de la largeur voulue : la largeur choisit le scénario du lecteur factice (e2e/harness.ts). */
function png(width: number, height = 14): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits par canal
  header[9] = 2; // RVB
  const rowLength = width * 3 + 1;
  const pixels = Buffer.alloc(rowLength * height, 0x80);
  for (let y = 0; y < height; y++) pixels[y * rowLength] = 0; // filtre « aucun »
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CLEAR = 10;
const PARTIAL_NAME = 11;
const OUTAGE = 12;

const takePhoto = (page: Page, scenario: number) =>
  page.getByTestId("photo-input").setInputFiles({ name: "carte.png", mimeType: "image/png", buffer: png(scenario) });

async function login(page: Page) {
  expect((await page.request.post("/auth", { data: { token: E2E_TOKEN } })).ok()).toBe(true);
}

/** Choisit l'emplacement dans la feuille, en le créant s'il n'existe pas encore. */
async function chooseLocation(page: Page, code: string) {
  const field = page.getByRole("button", { name: "Emplacement", exact: true });
  await field.click();
  await page.getByLabel("Filtrer les emplacements").fill(code.toLowerCase());
  await page.getByRole("button", { name: /Créer l'emplacement/ }).or(page.getByRole("radio", { name: code, exact: true })).first().click();
  await expect(field).toContainText(code);
}

const confirm = (page: Page) => page.locator(".actionbar .primary");
const onHand = (page: Page) => page.getByTestId("on-hand");
/** Bandeau d'erreur de l'application (Next ajoute son propre role="alert" pour l'annonce des pages). */
const errorBanner = (page: Page) => page.locator(".banner.error");

test("demande le jeton et refuse un jeton invalide", async ({ page }) => {
  await page.goto("/inventaire");
  await page.waitForURL(/\/login\?next=%2Finventaire/);

  await page.getByLabel("Jeton").fill("pas-le-bon-jeton");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(errorBanner(page)).toHaveText("Jeton refusé.");

  await page.getByLabel("Jeton").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/inventaire$/);
  await expect(page.getByRole("heading", { name: "Inventaire" })).toBeVisible();
});

test("photo lisible : la carte entre en stock et se retrouve dans l'inventaire", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await chooseLocation(page, "BOX-A/ROW-01");

  await takePhoto(page, CLEAR);
  await expect(page.getByText("Identification sûre.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Fouinar/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Reverse" })).toBeChecked();
  await expect(confirm(page)).toBeDisabled();
  await expect(confirm(page)).toHaveText("Reste : l'état");

  await page.getByRole("radio", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: "Quantité : plus" }).click();
  await page.getByLabel("Coût unitaire (€)").fill("1,50");
  await confirm(page).dblclick(); // un double appui ne doit créer qu'une position

  await expect(page.getByText("Entrée en stock enregistrée.")).toBeVisible();
  const sku = await page.getByTestId("unit-sku").innerText();
  expect(sku).toMatch(/^SI-\d{6}$/);
  await expect(page.getByText("OF-SWSH3-136-FR-R-NM")).toBeVisible();

  await page.goto("/inventaire?emplacement=BOX-A");
  await expect(page.getByRole("status").filter({ hasText: "position" })).toHaveText("1 position");
  await page.getByRole("link", { name: /Fouinar/ }).click();
  await expect(onHand(page)).toHaveText("2");
  await expect(page.getByText("1,50 €")).toBeVisible();
  await expect(page.getByText(sku)).toBeVisible();
});

test("lecture incertaine : rien n'est présélectionné, le brouillon se valide depuis la fiche", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await chooseLocation(page, "BOX-B");

  await takePhoto(page, PARTIAL_NAME);
  await expect(page.getByText("À vérifier : choisissez la bonne carte.")).toBeVisible();
  await expect(page.getByText("nom partiellement lisible")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Fouinar/ })).not.toBeChecked();
  await expect(confirm(page)).toHaveText("Reste : la carte, l'état");

  await page.getByRole("radio", { name: /Fouinar/ }).click();
  await expect(confirm(page)).toHaveText("Reste : la variante, l'état"); // finition non lue : pas de variante suggérée
  await page.getByRole("radio", { name: "Normale" }).click();
  await page.getByRole("radio", { name: "Excellent" }).click();
  await page.getByLabel("Brouillon").check();
  await confirm(page).click();

  await expect(page.getByText("Brouillon : non vendable")).toBeVisible();
  await page.getByRole("link", { name: "Voir la fiche" }).click();
  await expect(page.getByText("Disponible à la vente").locator("xpath=following-sibling::dd")).toHaveText("0");
  await page.getByRole("button", { name: "Valider (rendre vendable)" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Disponible à la vente").locator("xpath=following-sibling::dd")).toHaveText("1");
});

test("panne de lecture : recherche manuelle et exemplaire unique", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await chooseLocation(page, "BOX-C");

  await takePhoto(page, OUTAGE);
  await expect(errorBanner(page)).toContainText("lecture automatique est indisponible");

  await page.getByLabel("Nom").fill("dracaufeu");
  await page.getByRole("button", { name: "Rechercher dans le catalogue" }).click();
  await page.getByRole("radio", { name: /Dracaufeu/ }).click();
  await page.getByRole("radiogroup", { name: "Variante" }).getByRole("radio").first().click();
  await page.getByRole("radio", { name: "Mint", exact: true }).click();
  await page.getByLabel("Exemplaire unique").check();
  await expect(page.getByRole("spinbutton", { name: "Quantité" })).toHaveValue("1");
  await confirm(page).click();

  await expect(page.getByText("Entrée en stock enregistrée.")).toBeVisible();
  const sku = await page.getByTestId("unit-sku").innerText();
  await expect(page.getByText(new RegExp(`OF-BASE1-004-FR-.*-MT-U${sku.slice(3)}`))).toBeVisible();
});

test("vrac : entrée du lot, correction après comptage, extraction d'une carte", async ({ page }) => {
  await login(page);
  await page.goto("/vrac");
  await page.getByRole("radio", { name: "peu communes" }).click();
  await page.getByLabel("Nombre de cartes").fill("1000");
  await page.getByLabel("Coût total du lot (€)").fill("20");
  await chooseLocation(page, "BOX-VRAC");
  await page.getByRole("button", { name: "Enregistrer le lot" }).click();
  await expect(page.getByText("Lot enregistré.")).toBeVisible();
  await expect(page.getByText("Coût unitaire retenu : 0,02 €")).toBeVisible();

  await page.getByRole("link", { name: "Voir la fiche" }).click();
  await expect(onHand(page)).toHaveText("1000");
  await page.getByRole("button", { name: "Corriger le stock" }).click();
  await page.getByRole("button", { name: "Quantité comptée : moins" }).click();
  await page.getByLabel("Motif (obligatoire)").fill("recomptage");
  await page.getByRole("button", { name: "Enregistrer l'écart (−1)" }).click();
  await expect(onHand(page)).toHaveText("999");
  await expect(page.getByText("Correction — recomptage")).toBeVisible();

  await page.getByRole("link", { name: "Extraire une carte" }).click();
  await expect(page.getByText("Extraction du vrac")).toBeVisible();
  await expect(page.getByLabel("Coût unitaire (€)")).toHaveCount(0); // le coût vient du lot
  await chooseLocation(page, "BOX-A/ROW-02");
  await takePhoto(page, CLEAR);
  await page.getByRole("radio", { name: "Near Mint" }).click();
  await expect(confirm(page)).toHaveText("Extraire et ranger");
  await confirm(page).click();
  await expect(page.getByText("Entrée en stock enregistrée.")).toBeVisible();
  await expect(page.getByText("(998 cartes disponibles)")).toBeVisible();

  await page.getByRole("link", { name: "Retour au lot" }).click();
  await expect(onHand(page)).toHaveText("998");
  await expect(page.getByText("Extraction du vrac")).toBeVisible();
});

test("catalogue : une série absente se synchronise depuis l'appli, ses cartes deviennent trouvables", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Rechercher sans photo" }).click();
  await page.getByLabel("Nom").fill("mew");
  await page.getByRole("button", { name: "Rechercher dans le catalogue" }).click();
  await expect(page.getByText("Aucune carte trouvée.")).toBeVisible();

  await page.getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByText("2 séries synchronisées sur 2")).toBeVisible();
  await page.getByRole("button", { name: "Actualiser" }).click();
  const set = page.getByTestId("set-sv03.5");
  await expect(set).toContainText("Non synchronisée");
  await expect(set).toContainText("207 cartes");
  await set.getByRole("button", { name: "Synchroniser" }).click();
  await expect(set).toContainText("1 carte importée");
  await expect(set.getByRole("button", { name: "Mettre à jour" })).toBeVisible();

  await page.getByRole("link", { name: "Scanner" }).click();
  await page.getByRole("button", { name: "Rechercher sans photo" }).click();
  await page.getByLabel("Nom").fill("mew");
  await page.getByRole("button", { name: "Rechercher dans le catalogue" }).click();
  await expect(page.getByRole("radio", { name: /Mew-ex/ })).toBeVisible();
});
