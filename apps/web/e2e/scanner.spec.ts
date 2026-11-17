import { deflateSync, crc32 } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_TOKEN } from "./constants";

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

/** Ouvre une session ; définit le mot de passe au passage si le parcours est lancé seul sur une base neuve. */
async function login(page: Page) {
  const { passwordSet } = (await (await page.request.get("/auth")).json()) as { passwordSet: boolean };
  const data = passwordSet ? { password: E2E_PASSWORD } : { setupToken: E2E_TOKEN, newPassword: E2E_PASSWORD };
  expect((await page.request.post("/auth", { data })).ok()).toBe(true);
}

/** Choisit l'emplacement dans la feuille, en le créant s'il n'existe pas encore. */
async function chooseLocation(page: Page, code: string) {
  const field = page.getByRole("button", { name: "Emplacement", exact: true });
  await field.click();
  await page.getByLabel("Filtrer les emplacements").fill(code.toLowerCase());
  await page.getByRole("button", { name: /Créer l'emplacement/ }).or(page.getByRole("radio", { name: code, exact: true })).first().click();
  await expect(field).toContainText(code);
}

const confirm = (page: Page) => page.getByTestId("confirm");
const onHand = (page: Page) => page.getByTestId("on-hand");
/** Bandeau d'erreur de l'application (Next ajoute son propre role="alert" pour l'annonce des pages). */
const errorBanner = (page: Page) => page.locator('[data-slot="alert"][data-variant="destructive"]');

test("première connexion : le jeton d'installation permet de choisir le mot de passe, qui sert ensuite seul", async ({ page }) => {
  await page.goto("/inventaire");
  await page.waitForURL(/\/login\?next=%2Finventaire/);
  await expect(page.getByRole("heading", { name: "Première connexion" })).toBeVisible();

  await page.getByLabel("Jeton d'installation").fill("pas-le-bon-jeton-pas-le-bon-jeton");
  await page.getByLabel("Nouveau mot de passe").fill(E2E_PASSWORD);
  await page.getByLabel("Confirmer le mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Créer le mot de passe" }).click();
  await expect(errorBanner(page)).toHaveText("Jeton d'installation refusé.");

  await page.getByLabel("Jeton d'installation").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Créer le mot de passe" }).click();
  await page.waitForURL(/\/inventaire$/);
  await expect(page.getByRole("heading", { name: "Inventaire" })).toBeVisible();

  // Déconnexion depuis le compte, puis retour par le seul mot de passe.
  await page.getByRole("link", { name: "Compte et réglages" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.getByLabel("Jeton d'installation")).toHaveCount(0);

  await page.getByLabel("Mot de passe", { exact: true }).fill("ce-n-est-pas-ca");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(errorBanner(page)).toHaveText("Mot de passe incorrect.");
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Scanner" })).toBeVisible();

  // Sans session, l'API relayée reste fermée.
  await page.context().clearCookies();
  expect((await page.request.get("/api/inventory")).status()).toBe(401);
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
  await page.getByRole("switch", { name: "Brouillon" }).click();
  await confirm(page).click();

  await expect(page.getByText("Brouillon : non vendable")).toBeVisible();
  await page.getByRole("link", { name: "Voir la fiche" }).click();
  await expect(page.getByTestId("sellable")).toHaveText("0");
  await page.getByRole("button", { name: "Valider (rendre vendable)" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sellable")).toHaveText("1");
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
  await page.getByRole("switch", { name: "Exemplaire unique" }).click();
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
  await expect(page.getByRole("listitem").filter({ hasText: "Correction" })).toContainText("recomptage");

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

test("catalogue : onglets, import d'une série, détail, puis recherche par autocomplétion de série", async ({ page }) => {
  await login(page);
  await page.goto("/catalogue");
  await expect(page.getByRole("tab", { name: /^Importées/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /^Importées/ })).toContainText("2");
  await page.getByRole("button", { name: "Actualiser la liste" }).click();

  // Les séries se regroupent par bloc, et le bloc sert de filtre.
  await expect(page.getByRole("heading", { name: "Épée et Bouclier" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wizards" })).toBeVisible();
  await page.getByLabel("Bloc").selectOption({ label: "Wizards (1)" });
  await expect(page.getByTestId("set-base1")).toBeVisible();
  await expect(page.getByTestId("set-swsh3")).toHaveCount(0);
  await page.getByLabel("Bloc").selectOption("");

  const pending = page.getByRole("tab", { name: /^Non importées/ });
  await expect(pending).toContainText("1");
  await pending.click();
  const set = page.getByTestId("set-sv03.5");
  await expect(set).toContainText("207 cartes");
  await expect(page.getByTestId("set-swsh3")).toHaveCount(0);
  await set.getByRole("button", { name: "Importer" }).click();

  // La série passe dans l'onglet « Importées », que l'écran suit.
  await expect(page.getByRole("tab", { name: /^Importées/ })).toHaveAttribute("aria-selected", "true");
  await expect(set).toContainText("1 carte importée");
  await expect(pending).toContainText("0");

  await set.getByRole("link", { name: "Voir la série 151" }).click();
  await expect(page.getByRole("heading", { name: "151" })).toBeVisible();
  const mew = page.getByTestId("card-151");
  await expect(mew).toContainText("Mew-ex");
  await expect(mew).toContainText("€");
  await page.getByLabel("Filtrer les cartes").fill("pikachu");
  await expect(page.getByText("Aucune carte ne correspond")).toBeVisible();

  // Dans le scanner, la série se choisit par son nom et suffit à retrouver ses cartes.
  await page.getByRole("link", { name: "Scanner" }).click();
  await page.getByRole("button", { name: "Rechercher sans photo" }).click();
  const serie = page.getByRole("combobox", { name: "Série" });
  await serie.fill("15");
  await page.getByRole("option", { name: /151/ }).click();
  await expect(serie).toHaveValue("151 · sv03.5");
  await page.getByRole("button", { name: "Rechercher dans le catalogue" }).click();
  await expect(page.getByRole("radio", { name: /Mew-ex/ })).toBeVisible();
});

test("emplacements : création en série, description, suppression d'un emplacement inutilisé", async ({ page }) => {
  await login(page);
  await page.goto("/rangement");
  await expect(page.getByRole("heading", { name: "Bien organiser ses emplacements" })).toBeVisible();

  await page.getByRole("button", { name: "Nouvel emplacement" }).click();
  await page.getByRole("tab", { name: "Créer une série" }).click();
  await page.getByLabel("Dans (facultatif)").fill("box-z");
  await page.getByLabel("Préfixe").fill("row");
  await page.getByLabel("À", { exact: true }).fill("3");
  await expect(page.getByText("3 à créer")).toBeVisible();
  await page.getByRole("button", { name: "Créer 3 emplacements" }).click();

  const row3 = page.getByTestId("location-BOX-Z/ROW-03");
  await expect(row3).toBeVisible();
  await expect(page.getByTestId("location-BOX-Z")).toBeVisible();

  await page.getByRole("button", { name: "Actions pour BOX-Z", exact: true }).click();
  await page.getByRole("menuitem", { name: "Modifier la description" }).click();
  await page.getByLabel("Description").fill("Boîte de test");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("location-BOX-Z")).toContainText("Boîte de test");

  // Une boîte qui contient des rangées ne se supprime pas ; une rangée vide, si.
  await page.getByRole("button", { name: "Actions pour BOX-Z", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Supprimer" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Actions pour BOX-Z/ROW-03" }).click();
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  await expect(row3).toHaveCount(0);
  await expect(page.getByTestId("location-BOX-Z/ROW-02")).toBeVisible();
});

test("prix : estimation à la saisie, prix posé à l'entrée, décision manuelle et règles", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await chooseLocation(page, "BOX-P");
  await takePhoto(page, CLEAR);
  const estimate = page.getByTestId("price-estimate");
  await expect(estimate).toContainText("Choisissez la variante et l'état");
  await page.getByRole("radio", { name: "Good", exact: true }).click();
  await expect(estimate).toContainText("Prix estimé pour cet état");
  await expect(estimate).toContainText("Cardmarket");
  await expect(estimate).toContainText("relevée hier");
  await confirm(page).click();
  await expect(page.getByTestId("entry-pricing")).toContainText("Prix cible");

  // Décision manuelle : le prix et la catégorie choisis s'affichent partout, et l'offre sort de la revue.
  await page.getByRole("link", { name: "Prix", exact: true }).click();
  await page.getByRole("tab", { name: /^Toutes/ }).click();
  const offer = page.getByTestId("offer-OF-SWSH3-136-FR-R-GD");
  await offer.getByRole("button", { name: /Fixer le prix/ }).click();
  await page.getByLabel("Prix cible (€)").fill("2,50");
  await page.getByLabel("Catégorie de vente").selectOption("LOT");
  await page.getByRole("button", { name: "Enregistrer le prix" }).click();
  await expect(offer).toContainText("2,50 €");
  await expect(offer).toContainText("Lot");

  await page.goto("/inventaire?emplacement=BOX-P");
  await page.getByRole("link", { name: /Fouinar/ }).click();
  const pricing = page.getByTestId("offer-pricing");
  await expect(pricing).toContainText("2,50 €");
  await expect(pricing).toContainText("2,00 €"); // plancher automatique : 80 % du prix cible
  await expect(pricing).toContainText("Lot");

  // Règles : un seuil incohérent est refusé, un seuil valide recalcule les offres.
  await page.goto("/prix");
  await page.getByRole("tab", { name: "Règles" }).click();
  await page.getByLabel("Lot en dessous de (€)").fill("0,10");
  await page.getByRole("button", { name: "Enregistrer les règles" }).click();
  await expect(errorBanner(page)).toContainText("seuils doivent être croissants");
  await page.getByLabel("Lot en dessous de (€)").fill("4,00");
  await page.getByRole("button", { name: "Enregistrer les règles" }).click();
  await expect(page.getByText(/Règles enregistrées/)).toBeVisible();
  await page.getByRole("tab", { name: /^Toutes/ }).click();
  await expect(page.getByTestId("offer-OF-SWSH3-136-FR-R-GD")).toContainText("2,50 €"); // la décision manuelle tient
});

test("ventes : vente directe réservée, prélevée par code, emballée, déposée avec suivi, marge calculée", async ({ page }) => {
  await login(page);
  // Stock de départ posé par l'API : 3 Fouinar reverse « Played » à 0,20 € pièce.
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string; finish: string }[] }[] };
  const variantId = candidates[0]!.variants.find((v) => v.finish === "reverse")!.id;
  await page.request.post("/api/locations", { data: { code: "BOX-V" } });
  const received = (await (await page.request.post("/api/inventory/receive", {
    data: { variantId, condition: "PL", quantity: 3, locationCode: "BOX-V", unitCostCents: 20 },
    headers: { "Idempotency-Key": `e2e-vente-${Date.now()}` },
  })).json()) as { stockItem: { unitSku: string } };
  const sku = received.stockItem.unitSku;

  await page.goto("/ventes");
  await page.getByRole("link", { name: "Nouvelle vente" }).click();
  await page.getByLabel("Rechercher une carte en stock").fill("OF-SWSH3-136-FR-R-PL");
  await page.getByRole("button", { name: "Ajouter Fouinar PL" }).click();
  const line = page.getByTestId("line-OF-SWSH3-136-FR-R-PL");
  await line.getByRole("button", { name: /plus$/ }).click();
  await line.getByLabel("Prix unitaire (€)").fill("1,50");
  await page.getByRole("radio", { name: "Lettre suivie" }).click();
  await page.getByLabel("Frais de port facturés (€)").fill("2,00");
  await page.getByLabel("Acheteur (facultatif)").fill("Camille");
  await expect(page.getByTestId("sale-total")).toHaveText("5,00 €");
  await page.getByRole("button", { name: "Enregistrer la vente" }).click();

  // Préparation : l'emplacement est indiqué, un mauvais code est refusé, le bon valide le prélèvement.
  await expect(page.getByTestId("order-stage")).toHaveText("À préparer");
  const pick = page.getByTestId(`pick-${sku}`);
  await expect(pick).toContainText("BOX-V");
  await expect(page.getByRole("button", { name: /Prélevez toutes les cartes/ })).toBeDisabled();
  await pick.getByLabel("Code lu sur la pochette").fill("999999");
  await pick.getByRole("button", { name: `Prélever ${sku}` }).click();
  await expect(errorBanner(page)).toHaveText("Aucune position ne porte ce code.");
  await pick.getByLabel("Code lu sur la pochette").fill(String(Number(sku.slice(3))));
  await pick.getByRole("button", { name: `Prélever ${sku}` }).click();
  await expect(pick).toContainText("Prélevée");

  await page.getByRole("button", { name: "Marquer comme emballée" }).click();
  await expect(page.getByTestId("order-stage")).toHaveText("Emballée");
  await page.getByRole("button", { name: "Confirmer le dépôt" }).click();
  await page.getByLabel("Numéro de suivi").fill("1A23456789");
  await page.getByLabel("Affranchissement payé (€)").fill("1,29");
  await page.getByRole("button", { name: "Confirmer le dépôt" }).last().click();
  await expect(page.getByTestId("order-stage")).toHaveText("Remise");
  await expect(page.getByTestId("order-margin")).toHaveText("3,31 €"); // 5,00 − 2 × 0,20 − 1,29
  await expect(page.getByRole("button", { name: "Annuler la vente" })).toHaveCount(0);

  // Le stock physique a baissé, la vente figure dans les ventes remises.
  await page.goto("/inventaire?emplacement=BOX-V");
  await page.getByRole("link", { name: /Fouinar/ }).click();
  await expect(onHand(page)).toHaveText("1");
  await page.goto("/ventes");
  await page.getByRole("tab", { name: /^Remises/ }).click();
  await expect(page.getByRole("link", { name: /Camille/ })).toContainText("5,00 €");
});

test("scan en lot : images recto verso d'un scanner, vérification ligne à ligne, entrée en série avec photos", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Importer un lot d'images/ }).click();
  await expect(page.getByRole("heading", { name: "Scan en lot" })).toBeVisible();

  const file = (name: string, width: number) => ({ name, mimeType: "image/png", buffer: png(width) });
  const input = page.getByTestId("batch-input");
  const save = page.getByTestId("batch-save");
  const rows = page.getByTestId("batch-row");

  // Recto et verso : un nombre impair d'images trahit une image manquante.
  await page.getByRole("switch", { name: "Recto et verso" }).click();
  await input.setInputFiles([file("scan_001.png", CLEAR), file("scan_002.png", 30), file("scan_003.png", PARTIAL_NAME)]);
  await expect(errorBanner(page)).toContainText("3 images ont été déposées");
  await expect(rows).toHaveCount(0);

  // Déposées dans le désordre, les images sont remises dans l'ordre du scanner (nom de fichier).
  await input.setInputFiles([
    file("scan_010.png", 30), file("scan_003.png", PARTIAL_NAME), file("scan_001.png", CLEAR),
    file("scan_002.png", 30), file("scan_009.png", OUTAGE), file("scan_004.png", 30),
  ]);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-status", "ready");
  await expect(rows.nth(0)).toContainText("Fouinar");
  await expect(rows.nth(1)).toContainText("Carte à choisir");
  await expect(rows.nth(2)).toContainText("Lecture impossible");
  await expect(rows.nth(0).getByRole("img")).toHaveCount(2); // recto et verso

  await chooseLocation(page, "BOX-LOT");
  await expect(save).toHaveText("Reste : l'état des cartes");
  await page.getByRole("radio", { name: "Near Mint" }).click();
  await expect(save).toHaveText("Entrer 1 carte en stock");

  // Lecture incertaine : l'opérateur choisit la carte et la variante, puis un état propre à cette carte.
  await rows.nth(1).getByRole("button", { name: "Choisir" }).click();
  const dialog = page.getByRole("dialog", { name: "Choisir la carte" });
  await dialog.getByRole("radio", { name: /Fouinar/ }).click();
  await dialog.getByRole("radio", { name: "Normale" }).click();
  await dialog.getByRole("button", { name: "Utiliser cette carte" }).click();
  await page.getByLabel("État de la carte 2").selectOption("EX");
  // Lecture en panne : la ligne est retirée du lot.
  await page.getByRole("button", { name: "Retirer la carte 3" }).click();
  await expect(rows).toHaveCount(2);

  await expect(save).toHaveText("Entrer 2 cartes en stock");
  await save.click();
  const skus = page.getByTestId("batch-sku");
  await expect(skus).toHaveCount(2);
  const [first, second] = await skus.allInnerTexts();
  expect(Number(second!.slice(3))).toBe(Number(first!.slice(3)) + 1); // les codes suivent l'ordre de la pile
  await expect(page.getByTestId("batch-counts")).toContainText("2 en stock");
  await expect(rows.nth(1)).toContainText("EX");

  // La fiche de la position porte les deux photos du scan.
  await skus.first().click();
  await expect(page.getByRole("heading", { name: "Fouinar" })).toBeVisible();
  await expect(page.getByTestId("position-photos").getByRole("img")).toHaveCount(2);
  await expect(page.getByTestId("position-photos")).toContainText("Recto");
  await expect(page.getByTestId("position-photos")).toContainText("Verso");
  await expect(page.getByText("OF-SWSH3-136-FR-R-NM")).toBeVisible();
});

test("annonces : modèle de titre, fond des photos, composition du visuel à partir du scan", async ({ page }) => {
  await login(page);
  // Une carte scannée puis entrée en stock par l'API : l'offre a son scan.
  const scanned = (await (await page.request.post("/api/scans?language=fr", { data: png(CLEAR), headers: { "Content-Type": "image/png" } })).json()) as {
    suggestedVariantId: string; photo: { id: string };
  };
  await page.request.post("/api/locations", { data: { code: "BOX-AN" } });
  await page.request.post("/api/inventory/receive", {
    data: { variantId: scanned.suggestedVariantId, condition: "MT", quantity: 1, locationCode: "BOX-AN", unitCostCents: 0, photoIds: [scanned.photo.id] },
    headers: { "Idempotency-Key": `e2e-annonce-${Date.now()}` },
  });

  await page.goto("/annonces");
  const listing = page.getByTestId("listing-OF-SWSH3-136-FR-R-MT");
  await expect(listing.getByTestId("listing-title")).toHaveText("Fouinar 136/189 Ténèbres Embrasées Reverse FR MT Carte Pokémon");
  await expect(listing).toContainText("Photos à composer");

  // Modèle : l'aperçu suit la saisie, une variable s'insère d'un clic, le titre des offres change après enregistrement.
  await page.getByRole("tab", { name: "Modèle" }).click();
  const title = page.getByLabel("Modèle de titre");
  await title.fill("Pokémon {nom} {numero} - ");
  await page.getByRole("button", { name: "{etat_nom}" }).click();
  await expect(title).toHaveValue("Pokémon {nom} {numero} - {etat_nom}");
  await expect(page.getByTestId("template-preview-title")).toHaveText("Pokémon Dracaufeu 4/102 - Near Mint");
  await page.getByRole("button", { name: "Enregistrer le modèle" }).click();
  await expect(page.getByText("Modèle enregistré")).toBeVisible();

  // Photos : un fond prédéfini, un texte, puis enregistrement.
  await page.getByRole("tab", { name: "Photos" }).click();
  await page.getByRole("radio", { name: "Sable" }).click();
  await page.getByLabel("Texte en bas de l'image").fill("dexlane-cards");
  await page.getByRole("button", { name: "Enregistrer le style" }).click();
  await expect(page.getByText("Style des photos enregistré")).toBeVisible();

  // Offres : le nouveau titre s'applique, le visuel est composé à partir du scan au format carré choisi.
  await page.getByRole("tab", { name: "Offres" }).click();
  await expect(listing.getByTestId("listing-title")).toHaveText("Pokémon Fouinar 136/189 - Mint");
  await page.getByRole("button", { name: /Composer les photos manquantes/ }).click();
  await expect(listing).toContainText("1 photo d'annonce");
  const composed = listing.getByRole("img", { name: "Photo d'annonce" });
  await expect(composed).toHaveJSProperty("naturalWidth", 1600);
  await expect(composed).toHaveJSProperty("naturalHeight", 1600);
  // Recomposer remplace le visuel au lieu d'en ajouter un.
  const listingPhotoIds = async () => {
    const { items } = (await (await page.request.get("/api/listings/offers?q=OF-SWSH3-136-FR-R-MT")).json()) as { items: { photos: { id: string; kind: string }[] }[] };
    return items[0]!.photos.filter((p) => p.kind === "LISTING").map((p) => p.id);
  };
  const [before] = await listingPhotoIds();
  await listing.getByRole("button", { name: /Recomposer les photos/ }).click();
  await expect.poll(listingPhotoIds).not.toContain(before);
  expect(await listingPhotoIds()).toHaveLength(1);
  await expect(listing.getByRole("img", { name: "Photo d'annonce" })).toHaveCount(1);
});

test("canaux : simulation eBay — publication, achat simulé qui arrive dans les ventes, quantité annoncée à jour, retrait", async ({ page }) => {
  await login(page);
  // Offre prête : 2 exemplaires scannés (photo), prix posé automatiquement.
  const scanned = (await (await page.request.post("/api/scans?language=fr", { data: png(CLEAR), headers: { "Content-Type": "image/png" } })).json()) as {
    suggestedVariantId: string; photo: { id: string };
  };
  await page.request.post("/api/locations", { data: { code: "BOX-EB" } });
  await page.request.post("/api/inventory/receive", {
    data: { variantId: scanned.suggestedVariantId, condition: "LP", quantity: 2, locationCode: "BOX-EB", unitCostCents: 0, photoIds: [scanned.photo.id] },
    headers: { "Idempotency-Key": `e2e-canal-${Date.now()}` },
  });

  await page.goto("/annonces");
  const listing = page.getByTestId("listing-OF-SWSH3-136-FR-R-LP");
  await expect(listing).toBeVisible();
  await expect(listing.getByTestId("channel-ebay")).toHaveCount(0);

  // Canaux : le mode réel est indisponible sans connecteur, la simulation s'active d'un clic.
  await page.getByRole("tab", { name: "Canaux" }).click();
  const ebay = page.getByTestId("channel-card-ebay");
  await expect(ebay.getByRole("radio", { name: "Réel" })).toBeDisabled();
  await expect(ebay.getByText("Passer en réel : obtenir l'accès")).toBeVisible();
  await ebay.getByRole("radio", { name: "Simulation" }).click();
  await expect(page.getByText("eBay : simulation")).toBeVisible();

  await page.getByRole("tab", { name: "Offres" }).click();
  const channel = listing.getByTestId("channel-ebay");
  await channel.getByRole("button", { name: "Publier sur eBay" }).click();
  await expect(channel).toContainText("En ligne");
  await expect(channel).toContainText("2 annoncées");

  // Un acheteur fictif commande : la commande arrive dans Ventes, la quantité annoncée baisse.
  await channel.getByRole("button", { name: "Simuler un achat" }).click();
  await expect(page.getByText(/Commande SIM-\d{6} reçue/)).toBeVisible();
  await expect(channel).toContainText("1 annoncée");

  await page.goto("/ventes");
  const order = page.getByRole("link", { name: /SIM-\d{6}/ });
  await expect(order).toContainText("eBay");
  await expect(order).toContainText("Acheteur de test");
  await order.click();
  await expect(page.getByTestId("order-stage")).toHaveText("À préparer");

  // Retrait de l'annonce.
  await page.goto("/annonces");
  await channel.getByRole("button", { name: "Retirer" }).click();
  await expect(channel.getByRole("button", { name: "Publier sur eBay" })).toBeVisible();
});
