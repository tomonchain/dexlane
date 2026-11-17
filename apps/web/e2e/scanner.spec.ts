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
  await page.getByRole("link", { name: "Réglages" }).click();
  await page.getByRole("link", { name: /^Compte/ }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.getByLabel("Jeton d'installation")).toHaveCount(0);

  await page.getByLabel("Mot de passe", { exact: true }).fill("ce-n-est-pas-ca");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(errorBanner(page)).toHaveText("Mot de passe incorrect.");
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();

  // Sans session, l'API relayée reste fermée.
  await page.context().clearCookies();
  expect((await page.request.get("/api/inventory")).status()).toBe(401);
});

test("photo lisible : la carte entre en stock et se retrouve dans l'inventaire", async ({ page }) => {
  await login(page);
  await page.goto("/ajouter");
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
  await page.goto("/ajouter");
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
  await page.goto("/ajouter");
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
  await page.goto("/ajouter");
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
  await page.goto("/ajouter");
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
  await page.goto("/prix");
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

test("lot scanné : cartes reçues dans l'ordre du scanner, revue conservée après rechargement, entrée en stock d'un bloc", async ({ page }) => {
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-07" } });
  await page.goto("/scanner/lot");
  const box = page.getByRole("button", { name: "Boîte de destination", exact: true });
  await box.click();
  await page.getByLabel("Filtrer les emplacements").fill("boite-07");
  await page.getByRole("radio", { name: "BOITE-07", exact: true }).click();
  await page.getByRole("button", { name: "Créer le lot" }).click();
  await expect(page.getByRole("heading", { name: /^Lot du / })).toBeVisible();

  const file = (name: string, width: number) => ({ name, mimeType: "image/png", buffer: png(width) });
  const input = page.getByTestId("batch-input");
  const save = page.getByTestId("batch-save");
  const rows = page.getByTestId("batch-row");

  // Recto et verso : un nombre impair d'images trahit une image manquante.
  await input.setInputFiles([file("scan_001.png", CLEAR), file("scan_002.png", 30), file("scan_003.png", PARTIAL_NAME)]);
  await expect(errorBanner(page)).toContainText("3 images ont été choisies");
  await expect(rows).toHaveCount(0);

  // Déposées dans le désordre, les images retrouvent l'ordre du scanner (nom de fichier), recto puis verso.
  await input.setInputFiles([
    file("scan_010.png", 30), file("scan_003.png", PARTIAL_NAME), file("scan_001.png", CLEAR),
    file("scan_002.png", 30), file("scan_009.png", OUTAGE), file("scan_004.png", 30),
  ]);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Fouinar");
  await expect(rows.nth(1)).toContainText("Carte à choisir");
  await expect(rows.nth(2)).toContainText("Lecture impossible");
  await expect(rows.nth(0).getByRole("img", { name: /Recto|Verso/ })).toHaveCount(2);
  await expect(save).toBeDisabled();

  // L'état du lot rend prête la carte reconnue sans doute possible.
  await page.getByLabel("État du lot").selectOption("NM");
  await expect(rows.nth(0)).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("batch-counts")).toContainText("2 à corriger");

  // Lecture incertaine : la carte et la variante sont choisies à la main, avec un état à elle.
  await rows.nth(1).getByRole("button", { name: "Choisir" }).click();
  const dialog = page.getByRole("dialog", { name: "Carte n° 2" });
  await dialog.getByRole("radio", { name: /Fouinar/ }).click();
  await dialog.getByRole("radio", { name: "Normale" }).click();
  await dialog.getByLabel("État de cette carte").selectOption("EX");
  await dialog.getByRole("button", { name: "Utiliser cette carte" }).click();
  // Lecture en panne : la carte est écartée du lot.
  await page.getByRole("button", { name: "Écarter la carte 3" }).click();
  await expect(rows.nth(2)).toHaveAttribute("data-status", "skipped");

  // Tout est enregistré côté serveur : recharger la page ne perd ni les lectures ni les corrections.
  await page.reload();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveAttribute("data-status", "ready");
  await expect(save).toHaveText("Entrer 2 cartes en stock");
  await save.click();

  await expect(page.getByTestId("batch-done")).toContainText("2 cartes en stock");
  const skus = page.getByTestId("batch-sku");
  await expect(skus).toHaveCount(2);
  const [first, second] = await skus.allInnerTexts();
  expect(Number(second!.slice(3))).toBe(Number(first!.slice(3)) + 1); // les codes suivent l'ordre de la pile

  // La fiche de la position porte le recto et le verso, dans la boîte du lot.
  await skus.first().click();
  await expect(page.getByRole("heading", { name: "Fouinar" })).toBeVisible();
  await expect(page.getByTestId("position-photos").getByRole("img")).toHaveCount(2);
  await expect(page.getByText("BOITE-07").first()).toBeVisible();
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

test("statistiques : chiffres clés, variation de cote d'une carte en stock, seuil d'alerte réglable, relevé des cotes", async ({ page }) => {
  await login(page);
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string; finish: string }[] }[] };
  await page.request.post("/api/locations", { data: { code: "BOX-ST" } });
  await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants.find((v) => v.finish === "reverse")!.id, condition: "NM", quantity: 2, locationCode: "BOX-ST", unitCostCents: 5 },
    headers: { "Idempotency-Key": `e2e-stats-${Date.now()}` },
  });

  await page.goto("/statistiques");
  await expect(page.getByRole("heading", { name: "Statistiques" })).toBeVisible();
  await expect(page.getByTestId("stat-value")).toContainText("€");
  await expect(page.getByRole("heading", { name: "Valeur du stock par catégorie" })).toBeVisible();

  // La cote du Fouinar reverse a doublé en dix jours (0,14 € → 0,28 €) : visible dans « Toutes », trop faible pour une alerte par défaut.
  await page.getByRole("tab", { name: "Toutes" }).click();
  const move = page.getByTestId("move-swsh3-136-reverse");
  await expect(move).toContainText("+100 %");
  await expect(move).toContainText("0,14 €");
  await expect(move).toContainText("0,28 €");
  await expect(move).not.toContainText("Alerte");

  // Seuil minimal abaissé : la même variation devient une alerte.
  await page.getByLabel("Variation minimale (€)").fill("0,05");
  await page.getByRole("button", { name: "Enregistrer les seuils" }).click();
  await expect(page.getByText("Seuils d'alerte enregistrés")).toBeVisible();
  await page.getByRole("tab", { name: /^Alertes/ }).click();
  await expect(move).toContainText("Alerte");

  await page.getByRole("button", { name: "Relever les cotes" }).click();
  // Le catalogue de test rend ses cotations d'origine : selon l'ordre des parcours, elles sont nouvelles ou déjà connues.
  await expect(page.getByText(/nouvelles? cotes? sur \d+ cartes?|Cotes déjà à jour/)).toBeVisible();
});

test("stock : une ligne par carte, prix accepté d'un clic ou saisi sur place, fiche latérale, publication", async ({ page }) => {
  await login(page);
  // Deux cartes entrées par l'API : un Fouinar normal et un scan avec photo (prêt à publier).
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string; finish: string }[] }[] };
  await page.request.post("/api/locations", { data: { code: "BOX-SK" } });
  const receive = (data: Record<string, unknown>) => page.request.post("/api/inventory/receive", {
    data: { quantity: 1, locationCode: "BOX-SK", unitCostCents: 5, ...data }, headers: { "Idempotency-Key": `e2e-stock-${Math.random()}` },
  });
  await receive({ variantId: candidates[0]!.variants.find((v) => v.finish === "normal")!.id, condition: "PO", quantity: 3 });
  const scanned = (await (await page.request.post("/api/scans?language=fr", { data: png(CLEAR), headers: { "Content-Type": "image/png" } })).json()) as {
    suggestedVariantId: string; photo: { id: string };
  };
  await receive({ variantId: scanned.suggestedVariantId, condition: "PO", photoIds: [scanned.photo.id] });
  await page.request.put("/api/channels/ebay", { data: { mode: "SIMULATION" } });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();
  await expect(page.getByTestId("stock-totals")).toContainText("carte");
  await page.getByLabel("Rechercher dans le stock").fill("BOX"); // ne correspond à aucune carte : la recherche porte sur les cartes
  await expect(page.getByText("Aucune carte ne correspond.")).toBeVisible();
  await page.getByLabel("Rechercher dans le stock").fill("fouinar");

  // Prix saisi sur place : clic, saisie, Entrée.
  const normal = page.getByTestId("stock-OF-SWSH3-136-FR-N-PO");
  await expect(normal).toContainText("BOX-SK");
  await normal.getByRole("button", { name: /le prix de Fouinar/ }).click();
  await normal.getByLabel("Prix de Fouinar").fill("0,45");
  await normal.getByLabel("Prix de Fouinar").press("Enter");
  await expect(normal.getByRole("button", { name: "Modifier le prix de Fouinar" })).toHaveText("0,45 €");

  // Fiche latérale : annonce prête, prix modifiable, publication sur le canal activé.
  const reverse = page.getByTestId("stock-OF-SWSH3-136-FR-R-PO");
  await reverse.click();
  const panel = page.getByTestId("stock-inspector");
  await expect(panel.getByTestId("stock-listing-title")).toContainText("Fouinar 136/189");
  await panel.getByLabel("Prix de vente (€)").fill("1,20");
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(reverse).toContainText("1,20 €"); // la ligne du tableau suit, derrière la fiche
  await panel.getByTestId("stock-channel-ebay").getByRole("button", { name: "Publier" }).click();
  await expect(panel.getByTestId("stock-channel-ebay")).toContainText("en ligne · 1 × 1,20 €");
  await expect(reverse).toContainText("En ligne");

  // Le filtre « En ligne » ne garde que la carte publiée.
  await page.keyboard.press("Escape"); // sur téléphone, la fiche s'ouvre en tiroir
  await page.getByRole("tab", { name: /^En ligne/ }).click();
  await expect(reverse).toBeVisible();
  await expect(normal).toHaveCount(0);
});

test("scan sûr à 100 % : malgré une remarque de lecture, la fiche arrive remplie avec l'état par défaut et se valide d'une touche", async ({ page }) => {
  await login(page);
  await page.goto("/ajouter");
  await chooseLocation(page, "BOX-AUTO");
  await page.getByLabel("État par défaut").selectOption("EX");

  // Carte sous pochette : le modèle le signale, mais nom, numéro et série concordent à 100 %.
  await page.getByTestId("photo-input").setInputFiles({ name: "carte.png", mimeType: "image/png", buffer: png(13) });
  await expect(page.getByText("Identification sûre.")).toBeVisible();
  await expect(page.getByText(/Remarque de lecture : card is inside a sleeve/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Fouinar/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Reverse" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Excellent" })).toBeChecked();
  await expect(confirm(page)).toHaveText("Entrer en stock");
  await expect(confirm(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Entrée en stock enregistrée.")).toBeVisible();
  await expect(page.getByText("OF-SWSH3-136-FR-R-EX")).toBeVisible();
});

test("dossier du scanner relié : chaque carte scannée arrive seule, les anciens fichiers sont ignorés, rien n'est relu après rechargement", async ({ page }) => {
  test.setTimeout(90_000);
  // Dossier de scanner simulé : le navigateur de test n'a pas de vrai sélecteur de dossier.
  await page.addInitScript(() => {
    const files: File[] = [];
    const w = window as unknown as { __scanner: { add(name: string, bytes: number[]): void }; showDirectoryPicker: () => Promise<unknown> };
    w.__scanner = { add: (name, bytes) => void files.push(new File([new Uint8Array(bytes)], name, { type: "image/png" })) };
    w.showDirectoryPicker = async () => ({
      name: "Scans",
      async *values() {
        for (const f of files) yield { kind: "file", name: f.name, getFile: async () => f };
      },
    });
  });
  const scanned = (name: string, width: number) =>
    page.evaluate(([n, bytes]) => (window as unknown as { __scanner: { add(name: string, bytes: number[]): void } }).__scanner.add(n as string, bytes as number[]), [name, [...png(width)]]);

  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-08" } });
  const batch = (await (await page.request.post("/api/scan-batches", { data: { locationCode: "BOITE-08", defaultCondition: "NM" } })).json()) as { id: string };
  await page.goto(`/scanner/lot/${batch.id}`);
  const rows = page.getByTestId("batch-row");

  // Deux images d'un lot précédent traînent dans le dossier : elles ne doivent pas entrer dans celui-ci.
  await scanned("ancien_1.png", OUTAGE);
  await scanned("ancien_2.png", OUTAGE);
  await page.getByRole("button", { name: "Relier le dossier du scanner" }).click();
  await expect(page.getByText(/2 images déjà dans le dossier/)).toBeVisible();
  await expect(page.getByText(/Dossier Scans relié/)).toBeVisible();

  // Un recto seul attend son verso ; la carte apparaît d'elle-même quand la paire est complète.
  await scanned("scan_001.png", CLEAR);
  await page.waitForTimeout(5000);
  await expect(rows).toHaveCount(0);
  await scanned("scan_002.png", 30);
  await expect(rows).toHaveCount(1, { timeout: 15_000 });
  await expect(rows.nth(0)).toContainText("Fouinar");
  await expect(rows.nth(0)).toHaveAttribute("data-status", "ready");
  await scanned("scan_003.png", CLEAR);
  await scanned("scan_004.png", 30);
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  await expect(rows.nth(1).getByRole("img", { name: /Recto|Verso/ })).toHaveCount(2, { timeout: 15_000 });

  // Après rechargement, relier le même dossier ne relit rien et n'ajoute rien.
  const before = (await (await page.request.get(`/api/scan-batches/${batch.id}`)).json()) as { items: { id: string }[] };
  await page.reload();
  for (const [name, width] of [["ancien_1.png", OUTAGE], ["ancien_2.png", OUTAGE], ["scan_001.png", CLEAR], ["scan_002.png", 30], ["scan_003.png", CLEAR], ["scan_004.png", 30]] as const) await scanned(name, width);
  await page.getByRole("button", { name: "Relier le dossier du scanner" }).click();
  await page.waitForTimeout(6000);
  const after = (await (await page.request.get(`/api/scan-batches/${batch.id}`)).json()) as { items: { id: string }[] };
  expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
  await expect(page.getByTestId("batch-save")).toHaveText("Entrer 2 cartes en stock");
});

test("mise en ligne planifiée : image de fin d'annonce, sélection de cartes, répartition par jour, publication du jour, annulation", async ({ page }) => {
  await login(page);
  await page.request.put("/api/channels/ebay", { data: { mode: "SIMULATION" } });
  await page.request.post("/api/locations", { data: { code: "BOX-PL" } });
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string; finish: string }[] }[] };
  const normal = candidates[0]!.variants.find((v) => v.finish === "normal")!.id;
  for (const condition of ["LP", "PL"]) {
    const scanned = (await (await page.request.post("/api/scans?language=fr", { data: png(CLEAR), headers: { "Content-Type": "image/png" } })).json()) as { photo: { id: string } };
    await page.request.post("/api/inventory/receive", {
      data: { variantId: normal, condition, quantity: 1, locationCode: "BOX-PL", unitCostCents: 1, photoIds: [scanned.photo.id] },
      headers: { "Idempotency-Key": `e2e-plan-${condition}-${Date.now()}` },
    });
  }

  // Image de fin d'annonce, réglée une fois.
  await page.goto("/annonces");
  await page.getByRole("tab", { name: "Photos" }).click();
  await page.getByTestId("promo-input").setInputFiles({ name: "rachat.png", mimeType: "image/png", buffer: png(40, 40) });
  await expect(page.getByText("Image de fin d'annonce enregistrée")).toBeVisible();
  await expect(page.getByTestId("promo").getByRole("img", { name: "Image de fin d'annonce" })).toBeVisible();

  // Stock : deux cartes sélectionnées, une par jour à partir d'aujourd'hui.
  await page.goto("/");
  await page.getByLabel("Rechercher dans le stock").fill("OF-SWSH3-136-FR-N-");
  await page.getByTestId("stock-OF-SWSH3-136-FR-N-LP").getByRole("checkbox").check();
  await page.getByTestId("stock-OF-SWSH3-136-FR-N-PL").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Planifier la mise en ligne (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Planifier la mise en ligne" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  await dialog.getByLabel("À partir du").fill(today);
  await dialog.getByLabel("Cartes par jour").fill("1");
  await expect(dialog.getByTestId("plan-summary")).toContainText("2 cartes sur 2 jours");
  await dialog.getByRole("button", { name: "Planifier", exact: true }).click();
  await expect(page.getByText("2 cartes planifiées sur 2 jours")).toBeVisible();

  const schedule = page.getByTestId("schedule");
  await expect(schedule).toContainText("2 mises en ligne planifiées sur 2 jours");
  const lp = page.getByTestId("stock-OF-SWSH3-136-FR-N-LP");
  const pl = page.getByTestId("stock-OF-SWSH3-136-FR-N-PL");

  // La carte du jour part tout de suite ; l'image promo est la dernière photo envoyée au canal.
  await schedule.getByRole("button", { name: "Publier maintenant les 1 du jour" }).click();
  await expect(page.getByText("1 annonce publiée")).toBeVisible();
  await expect(schedule).toContainText("1 mise en ligne planifiée sur 1 jour");
  const stock = (await (await page.request.get("/api/stock?q=OF-SWSH3-136-FR-N-")).json()) as { items: { offerSku: string; status: string; planned: unknown }[] };
  expect(stock.items.find((r) => r.offerSku.endsWith("N-LP"))).toMatchObject({ status: "LISTED", planned: null });
  expect(stock.items.find((r) => r.offerSku.endsWith("N-PL"))).toMatchObject({ status: "READY", planned: { channel: "ebay" } });
  await expect(lp).toBeVisible();
  await expect(pl).toBeVisible();

  // Le reste du planning s'annule d'un clic.
  await schedule.getByRole("button", { name: /^Annuler les mises en ligne du/ }).click();
  await expect(page.getByText("1 mise en ligne annulée")).toBeVisible();
  await expect(schedule).toHaveCount(0);
});
