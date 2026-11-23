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
  // L'assistant de démarrage a son propre parcours : ailleurs, il est considéré comme terminé.
  expect((await page.request.put("/api/app-settings", { data: { onboardingDone: true } })).ok()).toBe(true);
}

/** Choisit l'emplacement dans la feuille, en le créant s'il n'existe pas encore. */
async function chooseLocation(page: Page, code: string) {
  const field = page.getByRole("button", { name: "Emplacement", exact: true });
  await field.click();
  await page.getByLabel("Filtrer les emplacements").fill(code.toLowerCase());
  await page.getByRole("button", { name: /Créer l'emplacement/ }).or(page.getByRole("radio", { name: code, exact: true })).first().click();
  await expect(field).toContainText(code);
}

/** Ouvre la fiche d'une carte du stock (sur téléphone, dans une feuille) à partir de sa référence d'offre. */
async function openStockCard(page: Page, offerSku: string) {
  await page.goto("/stock");
  await page.getByLabel("Rechercher dans le stock").fill(offerSku);
  await page.getByTestId(`stock-${offerSku}`).click();
  const panel = page.getByTestId("stock-inspector");
  await expect(panel).toBeVisible();
  return panel;
}

const confirm = (page: Page) => page.getByTestId("confirm");
const onHand = (page: Page) => page.getByTestId("on-hand");
/** Bandeau d'erreur de l'application (Next ajoute son propre role="alert" pour l'annonce des pages). */
const errorBanner = (page: Page) => page.locator('[data-slot="alert"][data-variant="destructive"]');

test("première utilisation : l'assistant crée le compte, règle le scan, importe une série, crée les emplacements, la stratégie de prix et un canal", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/inventaire");
  await page.waitForURL(/\/bienvenue$/);
  await expect(page.getByRole("heading", { name: "Créez votre compte" })).toBeVisible();

  // 1. Compte : un mauvais jeton est refusé, le bon crée le compte.
  await page.getByLabel("Jeton d'installation").fill("pas-le-bon-jeton-pas-le-bon-jeton");
  await page.getByLabel(/^Mot de passe/).fill(E2E_PASSWORD);
  await page.getByLabel("Confirmer le mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(errorBanner(page)).toHaveText("Jeton d'installation refusé.");
  await page.getByLabel("Jeton d'installation").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  // 2. Mode de scan.
  await expect(page.getByRole("heading", { name: "Comment scannez-vous vos cartes ?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  await page.getByRole("radio", { name: /Appareil photo du téléphone/ }).click();
  await page.getByRole("button", { name: "Continuer" }).click();

  // 3. Séries : les séries déjà présentes sont cochées d'office, « 151 » s'importe avec une barre d'avancement.
  await expect(page.getByRole("heading", { name: "Quelles séries avez-vous ?" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Ténèbres Embrasées/ })).toBeDisabled();
  // Les cartes anglaises ont leur propre catalogue : rien n'y est encore importé.
  await page.getByLabel("Langue des cartes").selectOption("en");
  await expect(page.getByRole("checkbox", { name: /Ténèbres Embrasées/ })).toBeEnabled();
  await page.getByLabel("Rechercher une série").fill("151");
  await page.getByRole("checkbox", { name: /^151/ }).check();
  await page.getByRole("button", { name: "Importer 1 série" }).click();
  await expect(page.getByTestId("import-progress")).toContainText("Import terminé");
  await expect(page.getByTestId("import-progress")).toContainText("1 / 1");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "Continuer" }).click();

  // 4. Emplacements : deux boîtes et un classeur, nommés d'office.
  await page.getByLabel("Nombre de boîtes").fill("2");
  await page.getByLabel("Nombre de classeurs").fill("1");
  await expect(page.getByTestId("location-preview")).toHaveText("BOITE-01  BOITE-02  CLASSEUR-01");
  await page.getByRole("button", { name: "Créer 3 emplacements" }).click();

  // 5. Prix : la stratégie choisie est enregistrée.
  await expect(page.getByRole("heading", { name: "Comment fixer vos prix ?" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Équilibré/ })).toBeChecked();
  await page.getByRole("radio", { name: /Vendre vite/ }).click();
  await page.getByRole("button", { name: "Continuer" }).click();

  // 6. Canaux : étape passée, puis fin de l'assistant.
  await expect(page.getByRole("heading", { name: "Où vendez-vous ?" })).toBeVisible();
  await page.getByTestId("channel-card-ebay").getByRole("radio", { name: "Simulation" }).click();
  await expect(page.getByText("eBay : simulation")).toBeVisible();
  await page.getByRole("button", { name: "Terminer" }).click();
  await expect(page.getByRole("heading", { name: "Tout est prêt" })).toBeVisible();
  await page.getByRole("button", { name: "Aller au stock" }).click();
  await page.waitForURL(/\/stock$/);
  await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();

  // Tout a été enregistré, et l'assistant ne se rouvre plus.
  const json = async (path: string) => (await page.request.get(path)).json();
  expect(await json("/api/app-settings")).toMatchObject({ onboardingDone: true, intakeMode: "CAMERA" });
  expect((await json("/api/pricing/settings")).strategy).toBe("FAST");
  expect(((await json("/api/locations")).locations as { code: string }[]).map((l) => l.code)).toEqual(expect.arrayContaining(["BOITE-01", "BOITE-02", "CLASSEUR-01"]));
  expect(((await json("/api/channels")).channels as { id: string; mode: string }[]).find((c) => c.id === "ebay")!.mode).toBe("SIMULATION");
  await page.request.put("/api/channels/ebay", { data: { mode: "OFF" } });
  await page.request.put("/api/pricing/settings", { data: { ...(await json("/api/pricing/settings")), strategy: "BALANCED" } });
  await page.goto("/inventaire");
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
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();

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
  // Achetée 1,50 € alors que le marché est plus bas : le coût s'affiche, et le prix est tenu à ce coût.
  await expect(page.getByText("1,50 €").first()).toBeVisible();
  await expect(page.getByTestId("offer-pricing")).toContainText("prix tenu au coût");
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
  // Le Fouinar reverse se vend 0,43 € sur la semaine et 0,29 € sur le mois : l'estimation part de ces ventes réussies,
  // sans s'écarter de plus de 20 % du mois, et signale que le prix bouge.
  const basis = estimate.getByTestId("sales-basis");
  await expect(basis).toContainText("Ventes réussies 0,35 €");
  await expect(basis).toContainText("prix en mouvement");
  await expect(basis).toContainText("7 j 0,43 € · 30 j 0,29 € · veille 0,29 €");
  await expect(basis).toContainText("Cardmarket, relevées hier");
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

  // Frais d'envoi réglés une fois : affranchissement habituel de la lettre suivie, sleeve, top-loader, enveloppe.
  await page.goto("/reglages");
  await page.getByRole("link", { name: /Frais d'envoi/ }).click();
  await page.getByLabel("Lettre suivie (€)").fill("1,29");
  await page.getByLabel("Sleeve (€)").fill("0,02");
  await page.getByLabel("Top-loader (€)").fill("0,08");
  await page.getByLabel("Enveloppe (€)").fill("0,25");
  await expect(page.getByTestId("supplies-per-card")).toContainText("0,10 €");
  await page.getByRole("button", { name: "Enregistrer les frais" }).click();
  await expect(page.getByText("Frais d'envoi enregistrés")).toBeVisible();

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

  // Avant la remise, la marge est estimée avec ces frais : 5,00 − 2 × 0,20 de cartes − 1,29 − (2 × 0,10 + 0,25).
  await expect(page.getByTestId("order-stage")).toHaveText("À préparer");
  await expect(page.getByTestId("order-supplies")).toHaveText("− 0,45 €");
  await expect(page.getByTestId("order-margin")).toHaveText("2,86 €");
  await expect(page.getByText("Marge estimée")).toBeVisible();

  // Préparation : l'emplacement est indiqué, un mauvais code est refusé, le bon valide le prélèvement.
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
  // L'affranchissement habituel est prérempli ; celui réellement payé le remplace.
  await expect(page.getByLabel("Affranchissement payé (€)")).toHaveValue("1,29");
  await page.getByLabel("Affranchissement payé (€)").fill("1,49");
  await page.getByRole("button", { name: "Confirmer le dépôt" }).last().click();
  await expect(page.getByTestId("order-stage")).toHaveText("Remise");
  await expect(page.getByTestId("order-margin")).toHaveText("2,66 €"); // 5,00 − 0,40 − 1,49 − 0,45
  await expect(page.getByText("Marge estimée")).toHaveCount(0);
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
  await rows.nth(1).getByRole("button", { name: "Choisir la carte 2" }).click();
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

test("annonces : modèle de titre, fond des photos, composition du visuel à partir du scan, depuis la fiche du stock", async ({ page }) => {
  await login(page);
  // Une carte scannée puis entrée en stock par l'API : l'offre a son scan.
  const scanned = (await (await page.request.post("/api/scans?language=fr", { data: png(CLEAR), headers: { "Content-Type": "image/png" } })).json()) as {
    suggestedVariantId: string; photo: { id: string };
  };
  await page.request.post("/api/locations", { data: { code: "BOX-AN" } });
  const received = (await (await page.request.post("/api/inventory/receive", {
    data: { variantId: scanned.suggestedVariantId, condition: "MT", quantity: 1, locationCode: "BOX-AN", unitCostCents: 0, photoIds: [scanned.photo.id] },
    headers: { "Idempotency-Key": `e2e-annonce-${Date.now()}` },
  })).json()) as { offer: { id: string } };
  const listingPhotos = async () => {
    const { photos } = (await (await page.request.get(`/api/stock/${received.offer.id}`)).json()) as { photos: { id: string; kind: string; url: string }[] };
    return photos.filter((p) => p.kind === "LISTING");
  };

  // L'ancienne page Annonces mène au stock : tout se fait depuis la fiche d'une carte.
  await page.goto("/annonces");
  await page.waitForURL(/\/stock\?statut=READY$/);
  let panel = await openStockCard(page, "OF-SWSH3-136-FR-R-MT");
  await expect(panel.getByTestId("stock-listing-title")).toHaveText("Fouinar 136/189 Ténèbres Embrasées Reverse FR MT Carte Pokémon");
  await expect(panel.getByRole("button", { name: "Composer les photos d'annonce" })).toBeVisible();

  // Modèle : l'aperçu suit la saisie, une variable s'insère d'un clic, le titre des offres change après enregistrement.
  await page.goto("/reglages/annonces");
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

  // Fiche : le nouveau titre s'applique, le visuel est composé à partir du scan au format carré choisi.
  panel = await openStockCard(page, "OF-SWSH3-136-FR-R-MT");
  await expect(panel.getByTestId("stock-listing-title")).toHaveText("Pokémon Fouinar 136/189 - Mint");
  await panel.getByRole("button", { name: "Composer les photos d'annonce" }).click();
  await expect(page.getByText("1 photo d'annonce composée")).toBeVisible();
  await expect.poll(async () => (await listingPhotos()).length).toBe(1);
  const size = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, (await listingPhotos())[0]!.url);
  expect(size).toEqual([1600, 1600]);

  // Recomposer remplace le visuel au lieu d'en ajouter un ; le style peut aussi s'appliquer à tout le stock d'un coup.
  const [before] = (await listingPhotos()).map((p) => p.id);
  await panel.getByRole("button", { name: "Recomposer les photos d'annonce" }).click();
  await expect.poll(async () => (await listingPhotos()).map((p) => p.id)).not.toContain(before);
  expect(await listingPhotos()).toHaveLength(1);
  await page.goto("/reglages/annonces");
  await page.getByRole("tab", { name: "Photos" }).click();
  const [second] = (await listingPhotos()).map((p) => p.id);
  await page.getByRole("button", { name: "Tout recomposer" }).click();
  await expect(page.getByText(/photos? d'annonce recomposées?/)).toBeVisible();
  await expect.poll(async () => (await listingPhotos()).map((p) => p.id)).not.toContain(second);
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

  // Aucun canal actif : la fiche n'en propose aucun.
  let panel = await openStockCard(page, "OF-SWSH3-136-FR-R-LP");
  await expect(panel.getByTestId("stock-channel-ebay")).toHaveCount(0);

  // Canaux : le mode réel est indisponible sans connecteur, la simulation s'active d'un clic.
  await page.goto("/reglages/canaux");
  const ebay = page.getByTestId("channel-card-ebay");
  await expect(ebay.getByRole("radio", { name: "Réel" })).toBeDisabled();
  await expect(ebay.getByText("Passer en réel : obtenir l'accès")).toBeVisible();
  await ebay.getByRole("radio", { name: "Simulation" }).click();
  await expect(page.getByText("eBay : simulation")).toBeVisible();

  panel = await openStockCard(page, "OF-SWSH3-136-FR-R-LP");
  const channel = panel.getByTestId("stock-channel-ebay");
  await channel.getByRole("button", { name: "Publier" }).click();
  await expect(channel).toContainText("en ligne · 2 ×");

  // Un acheteur fictif commande : la commande arrive dans Ventes, la quantité annoncée baisse.
  await channel.getByRole("button", { name: "Simuler un achat" }).click();
  await expect(page.getByText(/Commande SIM-\d{6} reçue/)).toBeVisible();
  await expect(channel).toContainText("en ligne · 1 ×");

  await page.goto("/ventes");
  const order = page.getByRole("link", { name: /SIM-\d{6}/ });
  await expect(order).toContainText("eBay");
  await expect(order).toContainText("Acheteur de test");
  await order.click();
  await expect(page.getByTestId("order-stage")).toHaveText("À préparer");

  // Retrait de l'annonce.
  panel = await openStockCard(page, "OF-SWSH3-136-FR-R-LP");
  await panel.getByTestId("stock-channel-ebay").getByRole("button", { name: "Retirer l'annonce eBay" }).click();
  await expect(panel.getByTestId("stock-channel-ebay").getByRole("button", { name: "Publier" })).toBeVisible();
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

  await page.goto("/stock");
  await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();
  await expect(page.getByTestId("stock-totals")).toContainText("carte");
  await page.getByLabel("Rechercher dans le stock").fill("BOX"); // ne correspond à aucune carte : la recherche porte sur les cartes
  await expect(page.getByText("Aucune carte ne correspond.")).toBeVisible();
  await page.getByLabel("Rechercher dans le stock").fill("");

  // Filtres : la boîte réduit la liste à son contenu ; les compteurs suivent ; un clic efface tout.
  const filters = page.getByTestId("stock-filters");
  await filters.getByLabel("Boîte").selectOption("BOX-SK");
  await expect(page.getByTestId("stock-OF-SWSH3-136-FR-N-PO")).toBeVisible();
  await expect(page.getByTestId("stock-OF-SWSH3-136-FR-R-PO")).toBeVisible();
  await expect(page.locator('tbody tr[data-testid^="stock-"]')).toHaveCount(2);
  await filters.getByLabel("État").selectOption("PO");
  await filters.getByLabel("Prix").selectOption("gte200");
  await expect(page.getByText("Aucune carte ne correspond.")).toBeVisible();
  await filters.getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(filters.getByLabel("Boîte")).toHaveValue("");

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

  // Évolution du prix : les ventes réussies et l'annonce la moins chère, relevé après relevé (le plus ancien, dix jours plus tôt, valait moitié moins).
  const chart = panel.getByTestId("price-history");
  const legend = chart.getByTestId("price-history-legend");
  await expect(legend).toContainText("Ventes 7 j0,43 €");
  await expect(legend).toContainText("Ventes 30 j0,29 €");
  await expect(legend).toContainText("Annonce la moins chère0,08 €");
  await expect(legend).not.toContainText("Tendance"); // des ventes existent : la tendance des annonces n'est pas tracée
  await expect(chart).toContainText(/\d relevés Cardmarket/);
  // Au clavier comme au survol : chaque relevé donne toutes les séries. Les flèches s'arrêtent aux extrémités.
  await chart.getByRole("img").focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  const tip = chart.getByTestId("price-history-tooltip");
  await expect(tip).toContainText("0,21 €Ventes 7 j");
  await expect(tip).toContainText("0,04 €Annonce la moins chère");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(tip).toContainText("0,43 €Ventes 7 j");
  // Les mêmes valeurs en tableau, et la période se choisit.
  await chart.getByText("Tableau des valeurs").click();
  await expect(chart.getByRole("table")).toContainText("0,21 €");
  await chart.getByRole("radio", { name: "30 j" }).click();
  await expect(chart.getByRole("radio", { name: "30 j" })).toBeChecked();
  await expect(chart).toContainText(/\d relevés Cardmarket/);

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
  await page.goto("/reglages/annonces");
  await page.getByRole("tab", { name: "Photos" }).click();
  await page.getByTestId("promo-input").setInputFiles({ name: "rachat.png", mimeType: "image/png", buffer: png(40, 40) });
  await expect(page.getByText("Image de fin d'annonce enregistrée")).toBeVisible();
  await expect(page.getByTestId("promo").getByRole("img", { name: "Image de fin d'annonce" })).toBeVisible();

  // Stock : deux cartes sélectionnées, une par jour à partir d'aujourd'hui.
  await page.goto("/stock");
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

test("sans scanner : le téléphone photographie recto puis verso, les cartes entrent dans le lot dans l'ordre des prises de vue", async ({ page }) => {
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-09" } });
  const batch = (await (await page.request.post("/api/scan-batches", { data: { locationCode: "BOITE-09", defaultCondition: "NM" } })).json()) as { id: string };
  await page.goto(`/scanner/lot/${batch.id}`);
  const shoot = (width: number) => page.getByTestId("capture-input").setInputFiles({ name: "image.png", mimeType: "image/png", buffer: png(width) });
  const capture = page.getByTestId("capture");
  const rows = page.getByTestId("batch-row");

  // Carte 1 : recto, puis verso. Rien n'est envoyé tant que le verso n'est pas pris.
  await expect(capture).toHaveText("Recto · carte 1");
  await shoot(CLEAR);
  await expect(capture).toHaveText("Verso · carte 1");
  await expect(page.getByText("Carte 1 : retournez-la et photographiez le verso.")).toBeVisible();
  await expect(rows).toHaveCount(0);
  await shoot(30);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Fouinar");
  await expect(rows.nth(0).getByRole("img", { name: /Recto|Verso/ })).toHaveCount(2);

  // Carte 2 : verso inutile, le recto part seul. La numérotation suit les prises de vue.
  await expect(capture).toHaveText("Recto · carte 2");
  await shoot(PARTIAL_NAME);
  await page.getByRole("button", { name: "Sans verso" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Carte à choisir");
  await expect(rows.nth(1).getByRole("img", { name: /Recto|Verso/ })).toHaveCount(1);
  await expect(capture).toHaveText("Recto · carte 3");

  // Une carte photographiée depuis un autre appareil apparaît d'elle-même.
  await page.request.post(`/api/scan-batches/${batch.id}/items?position=3&fileName=autre.png`, { data: png(CLEAR), headers: { "Content-Type": "image/png" } });
  await expect(rows).toHaveCount(3, { timeout: 15_000 });
  await expect(capture).toHaveText("Recto · carte 4");
});

test("annonce bloquée faute de photo : la photo s'ajoute après coup depuis la fiche du stock et débloque la publication", async ({ page }) => {
  await login(page);
  await page.request.put("/api/channels/ebay", { data: { mode: "SIMULATION" } });
  await page.request.post("/api/locations", { data: { code: "BOX-PH" } });
  // Carte entrée par recherche manuelle, donc sans aucune photo.
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string; finish: string }[] }[] };
  await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants.find((v) => v.finish === "normal")!.id, condition: "MT", quantity: 1, locationCode: "BOX-PH", unitCostCents: 1 },
    headers: { "Idempotency-Key": `e2e-photo-${Date.now()}` },
  });

  const panel = await openStockCard(page, "OF-SWSH3-136-FR-N-MT");
  const publish = panel.getByTestId("stock-channel-ebay").getByRole("button", { name: "Publier" });
  await expect(panel).toContainText("il manque une photo");
  await expect(publish).toBeDisabled();

  // La photo est ajoutée sur place : l'annonce devient publiable.
  await panel.getByTestId("offer-photo-input").setInputFiles({ name: "recto.png", mimeType: "image/png", buffer: png(40, 56) });
  await expect(page.getByText("Photo ajoutée")).toBeVisible();
  await expect(panel.getByTestId("offer-photos").getByRole("img", { name: "Recto" })).toBeVisible();
  await expect(panel).not.toContainText("il manque une photo");
  await expect(panel.getByRole("button", { name: "Ajouter le verso" })).toBeVisible();
  await publish.click();
  await expect(panel.getByTestId("stock-channel-ebay")).toContainText("en ligne");

  // Une photo ratée se retire, et se remplace.
  await panel.getByRole("button", { name: "Retirer la photo du recto" }).click();
  await expect(page.getByText("Photo retirée")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Ajouter une photo" })).toBeVisible();
});

test("lot sans temps mort : variante appliquée en masse, corrections enchaînées, photos d'annonce prêtes, planification directe", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.request.put("/api/channels/ebay", { data: { mode: "SIMULATION" } });
  await page.request.post("/api/locations", { data: { code: "BOITE-10" } });
  const batch = (await (await page.request.post("/api/scan-batches", { data: { locationCode: "BOITE-10", defaultCondition: "NM", paired: false } })).json()) as { id: string };
  await page.goto(`/scanner/lot/${batch.id}`);
  const FINISH_UNKNOWN = 14;
  const file = (name: string, width: number) => ({ name, mimeType: "image/png", buffer: png(width) });
  await page.getByTestId("batch-input").setInputFiles([
    file("c1.png", FINISH_UNKNOWN), file("c2.png", FINISH_UNKNOWN), file("c3.png", PARTIAL_NAME), file("c4.png", PARTIAL_NAME),
  ]);
  const rows = page.getByTestId("batch-row");
  await expect(rows).toHaveCount(4);

  // Deux cartes reconnues dont le scan n'a pas vu la finition : un clic règle les deux.
  const bulk = page.getByTestId("bulk-variant");
  await expect(bulk).toContainText("Variante non lue sur 2 cartes");
  await bulk.getByRole("button", { name: "Reverse (2)" }).click();
  await expect(page.getByText("Variante appliquée à 2 cartes")).toBeVisible();
  await expect(rows.nth(0)).toHaveAttribute("data-status", "ready");
  await expect(rows.nth(1)).toHaveAttribute("data-status", "ready");
  await expect(bulk).toHaveCount(0);

  // Deux cartes à choisir : la correction de la première ouvre directement la seconde.
  await rows.nth(2).getByRole("button", { name: "Choisir la carte 3" }).click();
  const third = page.getByRole("dialog", { name: "Carte n° 3" });
  await third.getByRole("radio", { name: /Fouinar/ }).click();
  await third.getByRole("radio", { name: "Normale" }).click();
  await third.getByRole("button", { name: "Utiliser et passer à la suivante" }).click();
  const fourth = page.getByRole("dialog", { name: "Carte n° 4" });
  await fourth.getByRole("radio", { name: /Fouinar/ }).click();
  await fourth.getByRole("radio", { name: "Reverse" }).click();
  await expect(fourth.getByRole("button", { name: "Utiliser et passer à la suivante" })).toHaveCount(0);
  await fourth.getByRole("button", { name: "Utiliser cette carte" }).click();
  await expect(fourth).toHaveCount(0);

  // Entrée en stock : les visuels d'annonce se composent d'eux-mêmes, puis la mise en ligne se planifie d'ici.
  await page.getByTestId("batch-save").click();
  const done = page.getByTestId("batch-done");
  await expect(done).toContainText("4 cartes en stock");
  await done.getByRole("button", { name: "Planifier la mise en ligne" }).click();
  const dialog = page.getByRole("dialog", { name: "Planifier la mise en ligne" });
  await expect(dialog).toContainText("Les cartes de ce lot (2 annonces)");
  await dialog.getByRole("button", { name: "Planifier", exact: true }).click();
  await expect(page.getByText(/2 cartes planifiées sur 1 jour/)).toBeVisible();

  const { items } = (await (await page.request.get(`/api/scan-batches/${batch.id}`)).json()) as { items: { offerId: string }[] };
  const detail = (await (await page.request.get(`/api/stock/${items[0]!.offerId}`)).json()) as { photos: { kind: string }[]; planned: unknown };
  expect(detail.photos.filter((p) => p.kind === "LISTING").length).toBeGreaterThanOrEqual(1);
  expect(detail.planned).toMatchObject({ channel: "ebay" });
  await page.request.post("/api/publications/cancel", { data: {} });
});

test("page d'accueil : vitrine publique sans session, puis « Aujourd'hui » avec ce qui attend une fois connecté", async ({ page }) => {
  // Visiteur : la présentation du produit, sans navigation d'application ni donnée du stock.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Du carton de cartes à l'annonce en ligne." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Quatre gestes, dans l'ordre." })).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir Dexlane" }).click();
  await page.waitForURL(/\/login$/);

  // Propriétaire : un lot en cours apparaît dans « À faire » et mène droit au lot.
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-11" } });
  const batch = (await (await page.request.post("/api/scan-batches", { data: { name: "Lot d'accueil", locationCode: "BOITE-11", paired: false } })).json()) as { id: string };
  await page.request.post(`/api/scan-batches/${batch.id}/items?position=1&fileName=a.png`, { data: png(CLEAR), headers: { "Content-Type": "image/png" } });
  // Une carte mise en ligne puis vendue : l'activité récente doit le montrer.
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string; finish: string }[] }[] };
  const stocked = (await (await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants.find((v) => v.finish === "normal")!.id, condition: "GD", quantity: 3, locationCode: "BOITE-11", unitCostCents: 5 },
    headers: { "Idempotency-Key": `e2e-accueil-${Date.now()}` },
  })).json()) as { offer: { id: string } };
  await page.request.put("/api/channels/ebay", { data: { mode: "SIMULATION" } });
  await page.request.post(`/api/stock/${stocked.offer.id}/photos`, { data: png(CLEAR), headers: { "Content-Type": "image/png" } });
  await page.request.post(`/api/listings/offers/${stocked.offer.id}/publish`, { data: { channel: "ebay" } });
  const sale = (await (await page.request.post("/api/orders", {
    data: { lines: [{ offerId: stocked.offer.id, qty: 1, unitPriceCents: 250 }], shippingMode: "HAND_DELIVERY", buyerName: "Accueil Test" },
    headers: { "Idempotency-Key": `e2e-accueil-vente-${Date.now()}` },
  })).json()) as { externalId: string };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).first()).toBeVisible();
  await expect(page.getByTestId("home-value")).toContainText("€");

  // Activité sur 30 jours : chiffre d'affaires et nombre de ventes en bâtons, un graphique par mesure.
  const activity = page.getByTestId("home-activity");
  await expect(activity).toContainText("Chiffre d'affaires");
  await expect(page.getByTestId("home-revenue")).toContainText("€");
  await expect(page.getByTestId("home-orders")).not.toHaveText("0");
  await expect(activity.getByTestId("day-column")).toHaveCount(60); // 30 jours × 2 graphiques
  // Au clavier, la flèche gauche ouvre le dernier jour : la vente du jour y figure.
  await activity.getByRole("img").first().focus();
  await page.keyboard.press("ArrowLeft");
  const dayTip = activity.getByTestId("day-tooltip");
  await expect(dayTip).toContainText("chiffre d'affaires");
  await expect(dayTip).toContainText(/\d+vente/);
  await page.keyboard.press("Escape");
  await expect(dayTip).toHaveCount(0);
  // Dernières ventes et dernières mises en ligne, la plus récente d'abord, avec un lien vers le détail.
  const lastSale = page.getByTestId("home-sale").first();
  await expect(lastSale).toContainText(sale.externalId);
  await expect(lastSale).toContainText("Accueil Test");
  await expect(lastSale).toContainText("2,50 €");
  await expect(lastSale).toHaveAttribute("href", /\/ventes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("home-listing").first()).toContainText("Fouinar");
  await expect(page.getByTestId("home-listing").first()).toContainText("eBay");
  const task = page.getByTestId("home-task").filter({ hasText: "Lot d'accueil" });
  await expect(task).toContainText("carte à corriger");
  await task.click();
  await page.waitForURL(new RegExp(`/scanner/lot/${batch.id}$`));
  await expect(page.getByRole("heading", { name: "Lot d'accueil" })).toBeVisible();
});

test("pilote automatique : la pile scannée entre en stock, reçoit son prix et part en ligne sans revue ; la carte douteuse suit une fois corrigée", async ({ page }) => {
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-AP" } });
  await page.request.put("/api/channels/ebay", { data: { mode: "SIMULATION" } });
  // Un état dans lequel le Fouinar reverse n'est pas encore en ligne : la mise en ligne observée viendra bien de ce lot.
  type Row = { offerId: string; condition: string; finish: string; listings: { channel: string; status: string }[] };
  const stock = async () => ((await (await page.request.get("/api/stock?q=fouinar&status=ALL")).json()) as { items: Row[] }).items;
  const before = await stock();
  const state = ["NM", "EX", "GD", "LP", "PL", "PO", "MT"].find((code) => !before.some((r) => r.finish === "reverse" && r.condition === code && r.listings.length > 0));
  expect(state, "un état encore libre pour le Fouinar reverse").toBeTruthy();
  const label = { MT: "Mint", NM: "Near Mint", EX: "Excellent", GD: "Good", LP: "Light Played", PL: "Played", PO: "Poor" }[state!]!;

  await page.goto("/scanner/lot");
  await page.getByRole("button", { name: "Boîte de destination", exact: true }).click();
  await page.getByLabel("Filtrer les emplacements").fill("boite-ap");
  await page.getByRole("radio", { name: "BOITE-AP", exact: true }).click();
  await page.getByRole("switch", { name: "Recto et verso" }).click(); // recto seul : rien à attendre avant l'entrée en stock
  await page.getByRole("switch", { name: "Pilote automatique" }).click();
  await expect(page.getByTestId("autopilot-publish").getByRole("radio", { name: "Tout de suite" })).toBeChecked();
  await page.getByRole("radiogroup", { name: "État des cartes du lot" }).getByRole("radio", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Créer le lot" }).click();
  const bar = page.getByTestId("autopilot");
  await expect(bar).toContainText("Pilote automatique · mise en ligne immédiate");

  // La pile passe : aucune autre action. Les deux cartes lues sans doute sont en stock et en ligne ; la douteuse attend.
  const file = (name: string, width: number) => ({ name, mimeType: "image/png", buffer: png(width) });
  await page.getByTestId("batch-input").setInputFiles([file("scan_001.png", CLEAR), file("scan_002.png", PARTIAL_NAME), file("scan_003.png", CLEAR)]);
  const rows = page.getByTestId("batch-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-status", "received");
  await expect(rows.nth(2)).toHaveAttribute("data-status", "received");
  await expect(rows.nth(1)).toHaveAttribute("data-status", "pending");
  await expect(bar).toContainText("2 en stock · 1 en ligne · 1 à vérifier");
  const listed = (await stock()).find((r) => r.finish === "reverse" && r.condition === state)!;
  expect(listed.listings).toMatchObject([{ channel: "ebay", status: "ACTIVE" }]);
  // Le visuel d'annonce a été composé avant la mise en ligne, sans rien demander.
  const detail = (await (await page.request.get(`/api/stock/${listed.offerId}`)).json()) as { targetPriceCents: number | null; photos: { kind: string }[] };
  expect(detail.targetPriceCents).toBeGreaterThan(0);
  expect(detail.photos.filter((p) => p.kind === "LISTING").length).toBeGreaterThan(0);

  // La carte douteuse est corrigée : elle suit toute seule, sans bouton d'entrée en stock.
  await rows.nth(1).getByRole("button", { name: "Choisir la carte 2" }).click();
  const dialog = page.getByRole("dialog", { name: "Carte n° 2" });
  await dialog.getByRole("radio", { name: /Fouinar/ }).click();
  await dialog.getByRole("radio", { name: "Normale" }).click();
  await dialog.getByRole("button", { name: "Utiliser cette carte" }).click();
  await expect(rows.nth(1)).toHaveAttribute("data-status", "received");
  await expect(bar).toContainText("3 en stock");
  await expect(bar).not.toContainText("à vérifier");

  // Le lot se termine quand la pile est passée ; couper le pilote automatique reste possible avant.
  await expect(page.getByTestId("batch-save")).toHaveText("Terminer le lot");
  await page.getByTestId("batch-save").click();
  await expect(page.getByTestId("batch-done")).toContainText("3 cartes en stock");
});

test("préparation des envois : liste de prélèvement, bon de livraison et reçu prêts à imprimer, puis marqués comme imprimés", async ({ page }) => {
  await login(page);
  // Une carte en stock, vendue par courrier avec une adresse de livraison.
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string; finish: string }[] }[] };
  await page.request.post("/api/locations", { data: { code: "BOITE-EX" } });
  const received = (await (await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants.find((v) => v.finish === "normal")!.id, condition: "MT", quantity: 2, locationCode: "BOITE-EX", unitCostCents: 5 },
    headers: { "Idempotency-Key": `e2e-envoi-${Date.now()}` },
  })).json()) as { offer: { id: string }; stockItem: { unitSku: string } };
  const order = (await (await page.request.post("/api/orders", {
    data: {
      lines: [{ offerId: received.offer.id, qty: 2, unitPriceCents: 150 }], shippingMode: "LETTER_UNTRACKED", shippingChargedCents: 200,
      buyerName: "Noa Lambert", addressLines: ["7 impasse des Tilleuls", "44000 Nantes"],
    },
    headers: { "Idempotency-Key": `e2e-envoi-vente-${Date.now()}` },
  })).json()) as { id: string; externalId: string };
  await page.request.put("/api/app-settings", { data: { slipPaper: "ROLL_80", seller: { name: "Cartes de test", address: "1 rue du Port\n44000 Nantes", legal: "SIRET 000 000 000 00000" } } });

  await page.goto("/ventes");
  await page.getByRole("link", { name: "Préparer les envois" }).click();
  await expect(page.getByRole("heading", { name: "Préparer les envois" })).toBeVisible();
  await expect(page.getByTestId("run-summary")).toContainText("à préparer");
  const doc = page.getByTestId("run-document");

  // Prélèvement : où aller chercher la carte, et pour quelle commande.
  const picking = doc.getByTestId("sheet-picking");
  await expect(picking).toContainText("BOITE-EX");
  await expect(picking).toContainText(received.stockItem.unitSku);
  await expect(picking).toContainText(`2 × Fouinar`);
  await expect(picking).toContainText(order.externalId);
  // Bon de livraison : en-tête du vendeur, destinataire et adresse, sans prix.
  const slip = doc.getByTestId("sheet-slip").filter({ hasText: order.externalId });
  await expect(slip).toContainText("Cartes de test");
  await expect(slip).toContainText("Noa Lambert");
  await expect(slip).toContainText("7 impasse des Tilleuls");
  await expect(slip).toContainText("Lettre non suivie");
  await expect(slip).not.toContainText("€");
  // Reçu : lignes, frais de port, total et mention légale.
  const receipt = doc.getByTestId("sheet-receipt").filter({ hasText: order.externalId });
  await expect(receipt).toContainText("3,00 €");
  await expect(receipt).toContainText("Frais de port");
  await expect(receipt).toContainText("Total payé5,00 €");
  await expect(receipt).toContainText("SIRET 000 000 000 00000");

  // Le papier se choisit et se retient ; une partie du document peut être retirée.
  await page.getByLabel("Papier").selectOption("LABEL_100X150");
  await expect(doc).toHaveCSS("width", /^3(4|5)\d/); // 92 mm
  await page.getByRole("switch", { name: "Reçus" }).click();
  await expect(doc.getByTestId("sheet-receipt")).toHaveCount(0);
  await page.getByRole("switch", { name: "Reçus" }).click();

  // À l'impression, il ne reste que le document : ni menu, ni réglages.
  await page.emulateMedia({ media: "print" });
  await expect(doc).toBeVisible();
  await expect(page.getByTestId("print-run")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).first()).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // Après l'impression, les commandes sont marquées : elles ne reviennent pas dans l'impression du lendemain.
  await page.evaluate(() => { window.print = () => window.dispatchEvent(new Event("afterprint")); });
  await page.getByTestId("print-run").click();
  await page.getByTestId("mark-printed").click();
  await expect(page.getByTestId("run-summary")).toContainText("dont 0 pas encore imprimée");
  const run = (await (await page.request.get("/api/orders/preparation")).json()) as { orders: { id: string; slipPrintedAt: string | null }[] };
  expect(run.orders.find((o) => o.id === order.id)!.slipPrintedAt).not.toBeNull();
  // Tout reste réimprimable tant que la commande n'est pas emballée.
  await expect(doc.getByTestId("sheet-slip").filter({ hasText: order.externalId })).toBeVisible();
});
