import { deflateSync, crc32 } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { E2E_API_PORT, E2E_EMAIL, E2E_PASSWORD, E2E_TOKEN } from "./constants";

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
  // Le propriétaire de l'installation : créé avec le jeton d'installation s'il n'existe pas encore, puis connecté.
  const { passwordSet } = (await (await page.request.get("/auth")).json()) as { passwordSet: boolean };
  if (!passwordSet) expect((await page.request.post("/auth", { data: { setupToken: E2E_TOKEN, email: E2E_EMAIL, newPassword: E2E_PASSWORD } })).ok()).toBe(true);
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email: E2E_EMAIL, password: E2E_PASSWORD } })).ok()).toBe(true);
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

test("première utilisation : l'assistant crée le compte, la boutique, règle le scan, importe une série, crée les emplacements, les envois et la stratégie de prix", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/inventory");
  await page.waitForURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: "Crée ton compte" })).toBeVisible();

  // 1. Compte : un mauvais jeton est refusé, le bon crée le compte.
  await page.getByLabel("Jeton d'installation").fill("pas-le-bon-jeton-pas-le-bon-jeton");
  await page.getByLabel("Adresse e-mail").fill(E2E_EMAIL);
  await page.getByLabel(/^Mot de passe/).fill(E2E_PASSWORD);
  await page.getByLabel("Confirmer le mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(errorBanner(page)).toHaveText("Jeton d'installation refusé.");
  await page.getByLabel("Jeton d'installation").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  // 2. Boutique : le nom et l'adresse imprimés sur les bons et les reçus.
  await expect(page.getByRole("heading", { name: "Ta boutique" })).toBeVisible();
  await page.getByLabel("Nom de la boutique").fill("Cartes du Lac");
  await page.getByLabel("Adresse").fill("3 rue du Lac\n74000 Annecy");
  await page.getByRole("button", { name: "Continuer" }).click();

  // 3. Mode de scan.
  await expect(page.getByRole("heading", { name: "Comment scannes-tu tes cartes ?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  await page.getByRole("radio", { name: /Appareil photo du téléphone/ }).click();
  await page.getByRole("button", { name: "Continuer" }).click();

  // 4. Séries (propriétaire de l'installation) : les séries déjà présentes sont cochées d'office, « 151 » s'importe avec une barre d'avancement.
  await expect(page.getByRole("heading", { name: "Quelles séries as-tu ?" })).toBeVisible();
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

  // 5. Emplacements : deux boîtes et un classeur, nommés d'office.
  await page.getByLabel("Nombre de boîtes").fill("2");
  await page.getByLabel("Nombre de classeurs").fill("1");
  await expect(page.getByTestId("location-preview")).toHaveText("BOITE-01  BOITE-02  CLASSEUR-01");
  await page.getByRole("button", { name: "Créer 3 emplacements" }).click();

  // 6. Envois et prix : l'affranchissement et la stratégie choisie sont enregistrés ; un montant illisible est refusé.
  await expect(page.getByRole("heading", { name: "Tes envois et tes prix" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Équilibré/ })).toBeChecked();
  await page.getByRole("radio", { name: /Vendre vite/ }).click();
  await page.getByLabel("Lettre suivie").fill("abc");
  await page.getByRole("button", { name: "Terminer" }).click();
  await expect(page.getByText("Lettre suivie : montant invalide.")).toBeVisible();
  await page.getByLabel("Lettre suivie").fill("2,90");
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
  expect((await json("/api/app-settings")).seller).toMatchObject({ name: "Cartes du Lac", address: "3 rue du Lac\n74000 Annecy" });
  expect((await json("/api/shipping-costs")).postage).toEqual({ LETTER_UNTRACKED: null, LETTER_TRACKED: 290, PARCEL_TRACKED: null });
  await page.request.put("/api/shipping-costs", { data: { postage: { LETTER_UNTRACKED: null, LETTER_TRACKED: null, PARCEL_TRACKED: null }, supplies: (await json("/api/shipping-costs")).supplies } });
  await page.request.put("/api/app-settings", { data: { seller: { name: "", address: "", legal: "" } } });
  await page.request.put("/api/pricing/settings", { data: { ...(await json("/api/pricing/settings")), strategy: "BALANCED" } });
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventaire" })).toBeVisible();

  // Déconnexion depuis le compte, puis retour par l'adresse e-mail et le mot de passe.
  await page.getByTestId("more-button").click();
  await page.getByTestId("more-sheet").getByRole("link", { name: "Réglages" }).click();
  await page.getByRole("link", { name: /^Compte/ }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.getByLabel("Jeton d'installation")).toHaveCount(0);

  await page.getByLabel("Adresse e-mail").fill(E2E_EMAIL);
  await page.getByLabel("Mot de passe", { exact: true }).fill("ce-n-est-pas-ca");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(errorBanner(page)).toHaveText("Adresse e-mail ou mot de passe incorrect.");
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();

  // Sans session, l'API relayée reste fermée.
  await page.context().clearCookies();
  expect((await page.request.get("/api/inventory")).status()).toBe(401);
});

test("photo lisible : la carte entre en stock et se retrouve dans l'inventaire", async ({ page }) => {
  await login(page);
  await page.goto("/add");
  await chooseLocation(page, "BOX-A/ROW-01");

  await takePhoto(page, CLEAR);
  await expect(page.getByText("Identification sûre.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Fouinar/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Reverse" })).toBeChecked();
  await expect(confirm(page)).toHaveText("Reste : l'état");
  // Valider avec une étape manquante y mène : l'étape « État » défile à l'écran et se signale, rien n'est enregistré.
  await confirm(page).click();
  const conditionStep = page.locator("#etape-etat");
  await expect(conditionStep).toHaveAttribute("data-attention", "true");
  await expect(conditionStep).toBeInViewport();
  await expect(onHand(page)).toHaveCount(0);

  await page.getByRole("radio", { name: "Near Mint" }).click();
  await page.getByRole("button", { name: "Quantité : plus" }).click();
  await page.getByLabel("Coût unitaire (€)").fill("1,50");
  // Enregistrement en arrière-plan : même lent, il ne bloque pas la carte suivante.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/inventory/receive", async (route) => { await held; await route.continue(); });
  await confirm(page).dblclick(); // un double appui ne doit créer qu'une position
  await expect(page.getByTestId("entry-saving")).toContainText("Fouinar");
  await expect(page.getByRole("button", { name: "Photographier la suivante" })).toBeEnabled();
  await expect(page.getByTestId("session-entry-pending")).toHaveCount(1);
  release();

  await expect(page.getByText("Entrée en stock enregistrée.")).toBeVisible();
  await expect(page.getByTestId("session-entry-pending")).toHaveCount(0);
  const sku = await page.getByTestId("unit-sku").innerText();
  expect(sku).toMatch(/^SI-\d{6}$/);
  await expect(page.getByText("OF-SWSH3-136-FR-R-NM")).toBeVisible();

  await page.goto("/inventory?location=BOX-A");
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
  await page.goto("/add");
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
  await page.goto("/add");
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
  await page.goto("/bulk");
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
  await page.goto("/catalog");
  // Catalogue français complet : la liste des séries n'a pas encore été lue, il n'est donc pas « complet ».
  await expect(page.getByTestId("catalog-import")).toContainText(/Catalogue français : \d+ séries sur \d+/);
  await expect(page.getByTestId("catalog-import").getByRole("button", { name: "Tout importer maintenant" })).toBeVisible();
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
  await page.goto("/add");
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
  await page.goto("/locations");
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
  await page.goto("/add");
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
  await page.goto("/pricing");
  await page.getByRole("tab", { name: /^Toutes/ }).click();
  const offer = page.getByTestId("offer-OF-SWSH3-136-FR-R-GD");
  await offer.getByRole("button", { name: /Fixer le prix/ }).click();
  await page.getByLabel("Prix cible (€)").fill("2,50");
  await page.getByLabel("Catégorie de vente").selectOption("LOT");
  await page.getByRole("button", { name: "Enregistrer le prix" }).click();
  await expect(offer).toContainText("2,50 €");
  await expect(offer).toContainText("Lot");

  await page.goto("/inventory?location=BOX-P");
  await page.getByRole("link", { name: /Fouinar/ }).click();
  const pricing = page.getByTestId("offer-pricing");
  await expect(pricing).toContainText("2,50 €");
  await expect(pricing).toContainText("2,00 €"); // plancher automatique : 80 % du prix cible
  await expect(pricing).toContainText("Lot");

  // Règles : un seuil incohérent est refusé, un seuil valide recalcule les offres.
  await page.goto("/pricing");
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
  await page.goto("/settings");
  await page.getByRole("link", { name: /Frais d'envoi/ }).click();
  await page.getByLabel("Lettre suivie (€)").fill("1,29");
  await page.getByLabel("Sleeve (€)").fill("0,02");
  await page.getByLabel("Top-loader (€)").fill("0,08");
  await page.getByLabel("Enveloppe (€)").fill("0,25");
  await expect(page.getByTestId("supplies-per-card")).toContainText("0,10 €");
  await page.getByRole("button", { name: "Enregistrer les frais" }).click();
  await expect(page.getByText("Frais d'envoi enregistrés")).toBeVisible();

  await page.goto("/sales");
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
  // L'action de l'étape reste en bas de l'écran, avec ce qui manque pour la lancer.
  const bar = page.getByTestId("action-bar");
  await expect(bar).toContainText("Prélevez 1 carte pour pouvoir emballer.");
  await expect(bar.getByRole("button", { name: "Marquer comme emballée" })).toBeDisabled();
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
  await page.goto("/inventory?location=BOX-V");
  await page.getByRole("link", { name: /Fouinar/ }).click();
  await expect(onHand(page)).toHaveText("1");
  await page.goto("/sales");
  await page.getByRole("tab", { name: /^Remises/ }).click();
  await expect(page.getByRole("link", { name: /Camille/ })).toContainText("5,00 €");
});

test("lot scanné : cartes reçues dans l'ordre du scanner, revue conservée après rechargement, entrée en stock d'un bloc", async ({ page }) => {
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-07" } });
  await page.goto("/scanner/batch");
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

  // L'ancienne page Annonces mène au planning des mises en ligne ; l'annonce se règle depuis la fiche d'une carte.
  await page.goto("/listings");
  await page.waitForURL(/\/listings$/);
  let panel = await openStockCard(page, "OF-SWSH3-136-FR-R-MT");
  await expect(panel.getByTestId("stock-listing-title")).toHaveText("Fouinar 136/189 Ténèbres Embrasées Reverse FR MT Carte Pokémon");
  await expect(panel.getByRole("button", { name: "Composer les photos d'annonce" })).toBeVisible();

  // Modèle : l'aperçu suit la saisie, une variable s'insère d'un clic, le titre des offres change après enregistrement.
  await page.goto("/settings/listing");
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
  await page.goto("/settings/listing");
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
  await page.goto("/settings/channels");
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

  await page.goto("/sales");
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
  const received = (await (await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants.find((v) => v.finish === "reverse")!.id, condition: "NM", quantity: 2, locationCode: "BOX-ST", unitCostCents: 5 },
    headers: { "Idempotency-Key": `e2e-stats-${Date.now()}` },
  })).json()) as { offer: { id: string } };
  // Une vente, pour que l'onglet des ventes ait de quoi montrer même si ce parcours est lancé seul.
  await page.request.post("/api/orders", {
    data: { lines: [{ offerId: received.offer.id, qty: 1, unitPriceCents: 150 }], shippingMode: "HAND_DELIVERY" },
    headers: { "Idempotency-Key": `e2e-stats-sale-${Date.now()}` },
  });

  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Statistiques", level: 1 })).toBeVisible();
  // Par défaut : ce qui se vend. Les parcours précédents ont enregistré des ventes.
  await expect(page.getByTestId("sales-insights")).toBeVisible();
  await expect(page.getByTestId("sales-cards")).not.toHaveText("0");
  await expect(page.getByTestId("sales-by-set")).toContainText("Ténèbres Embrasées");
  await expect(page.getByTestId("sales-top-cards")).toContainText("Fouinar");
  // Mises en vente et ventes : les deux comptes, leur rapport et un verdict.
  const balance = page.getByTestId("sales-balance");
  await expect(balance.getByTestId("balance-listed")).not.toHaveText("0");
  await expect(balance.getByTestId("balance-ratio")).toContainText("%");
  await expect(balance.getByTestId("balance-verdict")).toHaveText(/Équilibré|Le stock s'accumule|Le stock se vide/);
  await page.getByRole("tab", { name: "Stock et cotes" }).click();
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

  // Filtres, regroupés derrière un bouton : la boîte réduit la liste à son contenu ; les filtres posés restent visibles
  // en puces sous la recherche, et un clic les efface tous.
  const filtersButton = page.getByTestId("stock-filters-button");
  await filtersButton.click();
  const filters = page.getByRole("dialog", { name: "Filtres du stock" });
  await filters.getByLabel("Boîte").selectOption("BOX-SK");
  await expect(page.getByTestId("stock-OF-SWSH3-136-FR-N-PO")).toBeVisible();
  await expect(page.getByTestId("stock-OF-SWSH3-136-FR-R-PO")).toBeVisible();
  await expect(page.locator('tbody tr[data-testid^="stock-"]')).toHaveCount(2);
  await filters.getByLabel("État").selectOption("PO");
  await filters.getByLabel("Prix").selectOption("gte200");
  await expect(page.getByText("Aucune carte ne correspond.")).toBeVisible();
  await filters.getByRole("button", { name: "Voir les cartes" }).click();
  await expect(filters).toHaveCount(0);
  const chips = page.getByTestId("stock-filters");
  await expect(chips).toContainText("Boîte : BOX-SK");
  await expect(chips).toContainText("Prix : 200 € et plus");
  await expect(filtersButton).toHaveAccessibleName("Filtres, 3 actifs");
  await chips.getByRole("button", { name: "Tout effacer" }).click();
  await expect(chips).toHaveCount(0);

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
  // La photo de l'exemplaire s'agrandit dans une visionneuse.
  await panel.getByTestId("photo-stack").click();
  const viewer = page.getByTestId("photo-viewer");
  await expect(viewer.getByRole("img", { name: /Recto/ })).toBeVisible();
  await viewer.getByRole("button", { name: "Fermer" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(panel).toBeVisible();

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
  await page.goto("/add");
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
  await page.goto(`/scanner/batch/${batch.id}`);
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
  await page.goto("/settings/listing");
  await page.getByRole("tab", { name: "Photos" }).click();
  await page.getByTestId("promo-input").setInputFiles({ name: "rachat.png", mimeType: "image/png", buffer: png(40, 40) });
  await expect(page.getByText("Image de fin d'annonce enregistrée")).toBeVisible();
  await expect(page.getByTestId("promo").getByRole("img", { name: "Image de fin d'annonce" })).toBeVisible();

  // Logo de la boutique sur les visuels, avec la mention « powered by Dexlane » (active par défaut), en haut à droite.
  const brand = page.getByTestId("brand");
  await brand.getByTestId("logo-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png(60, 20) });
  await expect(brand.getByRole("img", { name: "Logo de la boutique" })).toBeVisible();
  await brand.getByLabel("Emplacement sur le visuel").selectOption("top-right");
  await page.getByRole("button", { name: "Enregistrer le style" }).click();
  await expect(page.getByText("Style des photos enregistré")).toBeVisible();
  const style = ((await (await page.request.get("/api/listings/settings")).json()) as { photo: { logoPhotoId: string | null; brandPosition: string; poweredBy: boolean } }).photo;
  expect(style).toMatchObject({ brandPosition: "top-right", poweredBy: true });
  expect(style.logoPhotoId).toMatch(/^[0-9a-f-]{36}$/);

  // Stock : deux cartes sélectionnées, une par jour à partir d'aujourd'hui.
  await page.goto("/stock");
  await page.getByLabel("Rechercher dans le stock").fill("OF-SWSH3-136-FR-N-");
  await page.getByTestId("stock-OF-SWSH3-136-FR-N-LP").getByRole("checkbox").check();
  await page.getByTestId("stock-OF-SWSH3-136-FR-N-PL").getByRole("checkbox").check();
  // La sélection fait apparaître sa barre d'actions ; sur téléphone, elles sont regroupées dans un menu.
  await expect(page.getByTestId("action-bar")).toContainText("2 cartes sélectionnées");
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Mettre en ligne" }).click();
  const dialog = page.getByRole("dialog", { name: "Planifier la mise en ligne" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  await dialog.getByLabel("À partir du").fill(today);
  await dialog.getByLabel("Cartes par jour").fill("1");
  await expect(dialog.getByTestId("plan-summary")).toContainText("2 cartes sur 2 jours");
  await dialog.getByRole("button", { name: "Planifier", exact: true }).click();
  await expect(page.getByText("2 cartes planifiées sur 2 jours")).toBeVisible();
  await expect(page.getByTestId("action-bar")).toHaveCount(0);

  // Le planning a sa page, ouverte depuis l'en-tête du stock.
  await page.getByRole("main").getByRole("link", { name: /^Mises en ligne/ }).click();
  await page.waitForURL(/\/listings$/);

  // Le calendrier, affiché d'abord : une carte aujourd'hui, une demain ; celle de demain passe au surlendemain.
  const shift = (n: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const calendar = page.getByTestId("publication-calendar");
  await expect(calendar.getByTestId(`calendar-day-${today}`)).toHaveAttribute("aria-label", /\d+ prévues?/);
  await expect(calendar.getByTestId(`calendar-day-${shift(1)}`)).toHaveAttribute("aria-label", /\d+ prévues?/);
  const [pl] = ((await (await page.request.get("/api/stock?q=OF-SWSH3-136-FR-N-PL")).json()) as { items: { offerId: string }[] }).items;
  await calendar.getByTestId(`calendar-day-${shift(1)}`).click();
  const day = page.getByTestId("calendar-day");
  const entry = day.getByTestId("calendar-entry").filter({ has: page.locator(`a[href="/stock?offer=${pl!.offerId}"]`) });
  await expect(entry).toContainText("Prévue");
  await entry.getByRole("button", { name: "Déplacer" }).click();
  await entry.getByLabel("Nouvelle date").fill(shift(2));
  await entry.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Mise en ligne déplacée")).toBeVisible();
  await expect(entry).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(calendar.getByTestId(`calendar-day-${shift(2)}`)).toHaveAttribute("aria-label", /\d+ prévues?/);
  await calendar.getByTestId(`calendar-day-${shift(2)}`).click();
  await expect(day.getByTestId("calendar-entry").filter({ has: page.locator(`a[href="/stock?offer=${pl!.offerId}"]`) })).toContainText("Prévue");
  await page.keyboard.press("Escape");

  // La vue en liste, jour par jour.
  await page.getByRole("tab", { name: /^Liste/ }).click();
  const schedule = page.getByTestId("schedule");
  await expect(schedule).toContainText("2 mises en ligne planifiées sur 2 jours");

  // La carte du jour part tout de suite ; l'image promo est la dernière photo envoyée au canal.
  await schedule.getByRole("button", { name: "Publier maintenant les 1 du jour" }).click();
  await expect(page.getByText("1 annonce publiée")).toBeVisible();
  await expect(schedule).toContainText("1 mise en ligne planifiée sur 1 jour");
  const stock = (await (await page.request.get("/api/stock?q=OF-SWSH3-136-FR-N-")).json()) as { items: { offerSku: string; status: string; planned: unknown }[] };
  expect(stock.items.find((r) => r.offerSku.endsWith("N-LP"))).toMatchObject({ status: "LISTED", planned: null });
  expect(stock.items.find((r) => r.offerSku.endsWith("N-PL"))).toMatchObject({ status: "READY", planned: { channel: "ebay" } });

  // Le reste du planning s'annule d'un clic.
  await schedule.getByRole("button", { name: /^Annuler les mises en ligne du/ }).click();
  await expect(page.getByText("1 mise en ligne annulée")).toBeVisible();
  await expect(schedule).toHaveCount(0);

  // Au calendrier, la carte publiée aujourd'hui apparaît comme publiée.
  await page.getByRole("tab", { name: "Calendrier" }).click();
  await expect(calendar.getByTestId(`calendar-day-${today}`)).toHaveAttribute("aria-label", /\d+ publiées?/);
  await calendar.getByTestId(`calendar-day-${today}`).click();
  await expect(day.getByTestId("calendar-entry").filter({ hasText: "Publiée" }).first()).toBeVisible();
});

test("sans scanner : le téléphone photographie recto puis verso, les cartes entrent dans le lot dans l'ordre des prises de vue", async ({ page }) => {
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-09" } });
  const batch = (await (await page.request.post("/api/scan-batches", { data: { locationCode: "BOITE-09", defaultCondition: "NM" } })).json()) as { id: string };
  await page.goto(`/scanner/batch/${batch.id}`);
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
  const choose = async (button: string, name: string) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), panel.getByRole("button", { name: button }).click()]);
    await chooser.setFiles({ name, mimeType: "image/png", buffer: png(40, 56) });
  };
  await choose("Ajouter le recto", "recto.png");
  await expect(page.getByText("Recto ajouté")).toBeVisible();
  await expect(panel.getByTestId("offer-photos").getByRole("img", { name: "Recto" })).toBeVisible();
  await expect(panel).not.toContainText("il manque une photo");
  await publish.click();
  await expect(panel.getByTestId("stock-channel-ebay")).toContainText("en ligne");

  // Le verso s'ajoute dans son propre emplacement ; une photo se remplace ou se retire.
  await choose("Ajouter le verso", "verso.png");
  await expect(page.getByText("Verso ajouté")).toBeVisible();
  await expect(panel.getByTestId("offer-photos").getByRole("img", { name: "Verso" })).toBeVisible();
  await choose("Remplacer le recto", "recto-2.png");
  await expect(page.getByText("Recto remplacé")).toBeVisible();
  await expect(panel.getByTestId("offer-photos").getByRole("img")).toHaveCount(2);
  await panel.getByRole("button", { name: "Retirer la photo du recto" }).click();
  await expect(page.getByText("Photo retirée")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Ajouter le recto" })).toBeVisible();
  await expect(panel.getByTestId("offer-photos").getByRole("img", { name: "Verso" })).toBeVisible();
});

test("lot sans temps mort : variante appliquée en masse, corrections enchaînées, photos d'annonce prêtes, planification directe", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.request.put("/api/channels/ebay", { data: { mode: "SIMULATION" } });
  await page.request.post("/api/locations", { data: { code: "BOITE-10" } });
  const batch = (await (await page.request.post("/api/scan-batches", { data: { locationCode: "BOITE-10", defaultCondition: "NM", paired: false } })).json()) as { id: string };
  await page.goto(`/scanner/batch/${batch.id}`);
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

/** Le dernier e-mail envoyé à cette adresse, et le chemin du lien qu'il contient. */
async function lastMail(page: Page, to: string) {
  const mails = (await (await page.request.get(`http://127.0.0.1:${E2E_API_PORT}/__test/mails`)).json()) as { to: string; subject: string; text: string }[];
  const mail = mails.filter((m) => m.to === to).at(-1)!;
  const url = new URL(mail.text.match(/https?:\/\/\S+/)![0]);
  return { subject: mail.subject, path: url.pathname + url.search };
}

test("inscription : compte créé depuis /signup, adresse vérifiée par le lien reçu, stock à soi, connexion par e-mail et mot de passe oublié", async ({ page }) => {
  // Le compte d'installation a déjà du stock : le nouveau compte ne doit pas le voir.
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOITE-INS" } });
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string }[] }[] };
  await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants[0]!.id, condition: "NM", quantity: 1, locationCode: "BOITE-INS", unitCostCents: 5 },
    headers: { "Idempotency-Key": `e2e-inscription-${Date.now()}` },
  });
  expect(((await (await page.request.get("/api/stock")).json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
  await page.request.post("/api/auth/sign-out", { data: {} });

  const email = `vendeur-${Date.now()}@example.com`;
  const password = "mot-de-passe-vendeur";
  // Le bouton d'un forfait mène à l'inscription, forfait retenu.
  await page.goto("/tarifs");
  await page.getByTestId("plan-solo").getByRole("link", { name: "Choisir Solo" }).click();
  await page.waitForURL(/\/signup\?plan=solo$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Crée ton compte");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel(/^Mot de passe/).fill("court");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByTestId("signup-sent")).toHaveCount(0);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByTestId("signup-sent")).toContainText(email);

  // Tant que l'adresse n'est pas vérifiée, la connexion est refusée.
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(errorBanner(page)).toContainText("n'a pas encore été vérifiée");

  // Le lien reçu vérifie l'adresse et ouvre le compte : l'assistant de démarrage, sans compte à créer, et un stock vide.
  const verification = await lastMail(page, email);
  expect(verification.subject).toBe("Confirme ton adresse e-mail");
  expect(verification.path).toContain("/api/auth/verify-email?token=");
  await page.goto(verification.path);
  await page.waitForURL(/\/welcome$/);
  await expect(page.getByLabel("Jeton d'installation")).toHaveCount(0);
  // Le forfait choisi sur le site est retenu ; le compte démarre en Découverte.
  expect((await (await page.request.get("/api/account")).json()) as { email: string; requestedPlan: string }).toMatchObject({ email, requestedPlan: "solo", role: "user", plan: { id: "decouverte" } });
  expect(((await (await page.request.get("/api/stock")).json()) as { items: unknown[] }).items).toEqual([]);

  // L'onboarding du nouvel inscrit : boutique, scan, rangement, envois et prix — sans compte à créer ni séries à importer.
  await expect(page.getByRole("list", { name: "Étapes de démarrage" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Ta boutique" })).toBeVisible();
  await page.getByLabel("Nom de la boutique").fill("Chez le vendeur");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Comment scannes-tu tes cartes ?" })).toBeVisible();
  await page.getByRole("radio", { name: /Appareil photo du téléphone/ }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Où ranges-tu tes cartes ?" })).toBeVisible();
  await page.getByLabel("Nombre de boîtes").fill("1");
  await page.getByLabel("Nombre de classeurs").fill("0");
  await page.getByRole("button", { name: "Créer 1 emplacement" }).click();
  await expect(page.getByRole("heading", { name: "Tes envois et tes prix" })).toBeVisible();
  await page.getByLabel("Lettre simple").fill("1,39");
  await page.getByRole("button", { name: "Terminer" }).click();
  await expect(page.getByRole("heading", { name: "Tout est prêt" })).toBeVisible();
  await page.getByRole("button", { name: "Aller au stock" }).click();
  await page.waitForURL(/\/stock$/);
  // Ses réglages sont les siens : la boutique du propriétaire de l'installation n'a pas bougé.
  const mine = (await (await page.request.get("/api/app-settings")).json()) as { onboardingDone: boolean; seller: { name: string } };
  expect(mine).toMatchObject({ onboardingDone: true, seller: { name: "Chez le vendeur" } });
  expect(((await (await page.request.get("/api/locations")).json()) as { locations: { code: string }[] }).locations.map((l) => l.code)).toEqual(["BOITE-01"]);
  expect(((await (await page.request.get("/api/shipping-costs")).json()) as { postage: Record<string, number | null> }).postage.LETTER_UNTRACKED).toBe(139);
  // Une fois l'adresse vérifiée, le lien n'ouvre plus de session.
  await page.request.post("/api/auth/sign-out", { data: {} });
  await page.goto(verification.path);
  await page.goto("/stock");
  await page.waitForURL(/\/login/);

  // Connexion par adresse e-mail et mot de passe.
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  await page.request.post("/api/auth/sign-out", { data: {} });

  // Mot de passe oublié : lien par e-mail, nouveau mot de passe, session ouverte.
  await page.goto("/login");
  await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
  await page.waitForURL(/\/forgot-password$/);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByTestId("forgot-sent")).toBeVisible();
  const reset = await lastMail(page, email);
  expect(reset.subject).toBe("Réinitialise ton mot de passe");
  await page.goto(reset.path);
  await page.waitForURL(/\/reset-password\?token=/);
  await page.getByLabel(/^Nouveau mot de passe/).fill("nouveau-mot-de-passe-vendeur");
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  // Le nouveau mot de passe ferme les sessions : on se connecte avec lui, et on retrouve son stock, toujours vide.
  await page.waitForURL(/\/login$/);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill("nouveau-mot-de-passe-vendeur");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  expect(((await (await page.request.get("/api/stock")).json()) as { items: unknown[] }).items).toEqual([]);
});

test("site marketing : en-tête et menu mobile, tarifs, pages légales, contact, colis, docs, 404, sitemap et robots", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  // En-tête : opaque, bordure basse une fois qu'on a défilé.
  await expect(header).toHaveClass(/border-transparent/);
  await page.mouse.wheel(0, 600);
  await expect(header).toHaveClass(/border-border/);

  // Menu mobile : aria-expanded, fermeture avec Échap, puis à la navigation ; lien actif.
  const menuButton = page.getByRole("button", { name: "Menu" });
  const menu = page.getByRole("navigation", { name: "Menu" });
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await menuButton.click();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("link", { name: "GitHub" })).toHaveAttribute("target", "_blank");
  await page.keyboard.press("Escape");
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await menuButton.click();
  await menu.getByRole("link", { name: "Tarifs" }).click();
  await page.waitForURL(/\/tarifs$/);
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await menuButton.click();
  await expect(menu.getByRole("link", { name: "Tarifs" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");

  // /tarifs : grille complète lue dans la configuration, trois lignes, encart, FAQ du prix.
  await expect(page).toHaveTitle("Tarifs — Dexlane");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu paies selon ce que tu publies. Rien sur ce que tu vends.");
  await expect(page.locator("[data-testid^=plan-]")).toHaveCount(4);
  await expect(page.getByTestId("plan-pro")).toContainText("Recommandé");
  await expect(page.getByTestId("plan-pro")).toContainText(/29\s€ \/ mois/);
  await expect(page.getByTestId("plan-boutique")).toContainText("Support prioritaire");
  await expect(page.getByText("Un lot compte pour une seule carte.")).toBeVisible();
  await expect(page.getByText(/10\s€ les 500 cartes supplémentaires/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu préfères l'héberger toi-même ?" })).toBeVisible();
  await expect(page.locator("details")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

  // Pages légales : un seul titre, un sommaire, des champs à compléter.
  for (const [path, title] of [["/mentions-legales", "Mentions légales"], ["/cgu", "CGU"], ["/confidentialite", "Confidentialité"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByRole("navigation", { name: "Sommaire" })).toBeVisible();
    await expect(page.getByText("[À COMPLÉTER]").first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Suppression du compte et des données eBay associées" })).toBeVisible();

  // Pied de page : trois groupes.
  for (const group of ["Produit", "Projet", "Légal"]) await expect(page.getByRole("navigation", { name: group })).toBeVisible();

  await page.goto("/contact");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contact");
  await expect(page.getByText("Une question, un bug, une idée ? Écris-nous, c'est le fondateur qui répond.")).toBeVisible();
  await expect(page.getByRole("link", { name: "[À COMPLÉTER]" })).toHaveAttribute("href", "mailto:[À COMPLÉTER]");
  await expect(page.getByRole("link", { name: "github.com/tomonchain/dexlane/issues" })).toBeVisible();

  await page.goto("/colis");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu viens de recevoir une carte vendue avec Dexlane.");
  await expect(page.getByRole("main").getByRole("link", { name: "Essayer gratuitement" })).toHaveAttribute("href", /^\/signup\?code=/);
  await expect(page.getByRole("heading", { name: "Connecte ton compte eBay" })).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\.png$/);
  const og = await page.request.get("/og.png");
  expect(og.headers()["content-type"]).toBe("image/png");

  // Docs : un sommaire repliable sur téléphone, des pages statiques, page suivante ; une page inconnue est une 404.
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documentation");
  await page.getByRole("main").getByRole("link", { name: /Installer la version Community/ }).first().click();
  await page.waitForURL(/\/docs\/community$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Installer la version Community");
  await expect(page.getByText("EBAY_RU_NAME").first()).toBeVisible();
  await page.getByText("Sommaire de la documentation").click();
  await page.getByRole("navigation", { name: "Sommaire de la documentation" }).getByRole("link", { name: "Forfaits et quotas" }).click();
  await page.waitForURL(/\/docs\/forfaits$/);
  await expect(page.getByRole("heading", { level: 2, name: "Ce qui compte comme une carte publiée" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sommaire de la documentation" })).toBeHidden();
  await page.getByRole("link", { name: /Suivant/ }).click();
  await page.waitForURL(/\/docs\/community$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  expect((await page.goto("/docs/inconnue"))?.status()).toBe(404);

  const missing = await page.goto("/cette-page-n-existe-pas");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cette page n'existe pas.");
  await page.getByRole("main").getByRole("link", { name: "Accueil" }).click();
  await page.waitForURL(/\/$/);

  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/tarifs</loc>");
  expect(sitemap).not.toContain("/colis");
  const robots = await (await page.request.get("/robots.txt")).text();
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  expect(robots).toContain("Disallow: /api/");
});

test("page d'accueil : landing publique sans session, puis « Aujourd'hui » avec ce qui attend une fois connecté", async ({ page }) => {
  // Visiteur : la landing statique, sans navigation d'application ni donnée du stock, référencée.
  await page.goto("/");
  await expect(page).toHaveTitle("Dexlane — Publie tes cartes Pokémon sur eBay en quelques secondes");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Tes cartes en vente sur eBay. Sans y passer tes soirées.");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\.png$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  // Le titre porte le logo eBay à la place du mot : son nom accessible reste la phrase du brief.
  const hero = page.getByRole("heading", { level: 1, name: "Tes cartes en vente sur eBay en quelques secondes. Pas en quelques soirées." });
  await expect(hero).toBeVisible();
  await expect(hero.getByRole("img", { name: "eBay" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);
  // La démonstration du produit (HTML) et les illustrations montrent de vraies cartes.
  await expect(page.locator('img[src*="landing%2Fcards"]').first()).toBeAttached();
  // Mobile d'abord : le CTA principal est visible sans défiler.
  const cta = page.getByRole("link", { name: "Essayer gratuitement" }).first();
  await expect(cta).toBeInViewport();
  await expect(cta).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "Voir le code sur GitHub" })).toHaveAttribute("href", "https://github.com/tomonchain/dexlane");
  for (const title of ["Vendre des cartes, c'est 10 % de passion et 90 % de saisie.", "Trois étapes. La troisième est un clic.", "Tout ce qui te prend du temps, Dexlane s'en charge.", "Que tu vendes 30 cartes ou 3 000.", "Tu paies selon ce que tu publies. Rien sur ce que tu vends.", "Le code est ouvert. Vérifie par toi-même.", "Fait par un vendeur, pour des vendeurs.", "Les questions qu'on nous pose", "Tes cartes ne se vendront pas depuis un classeur."]) {
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  // Ancres des sections ; huit fonctionnalités, dont les deux sur le stock ; grille de tarifs courte.
  for (const id of ["probleme", "comment-ca-marche", "fonctionnalites", "pour-qui", "tarifs", "open-source", "fondateur", "faq", "essayer"]) {
    await expect(page.locator(`section#${id}`)).toHaveCount(1);
  }
  await expect(page.locator("#fonctionnalites h3")).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "Retrouve chaque carte en dix secondes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Achats, ventes, marge" })).toBeVisible();
  await expect(page.getByTestId("plan-pro")).toContainText("Recommandé");
  // Chaque forfait dit ce qu'il ajoute au précédent, et le rythme que permet son quota.
  await expect(page.getByTestId("plan-pro")).toContainText("Tout Solo, plus :");
  await expect(page.getByTestId("plan-pro")).toContainText("Suggestions de titre et de prix");
  await expect(page.getByTestId("plan-pro")).not.toContainText("Publication en masse");
  await expect(page.getByTestId("plan-solo")).toContainText("≈ 35 cartes par semaine");
  await expect(page.locator("#tarifs").getByText("Un lot compte pour une seule carte.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir le détail des tarifs →" })).toHaveAttribute("href", "/tarifs");
  // Les éléments « à confirmer » sont affichés tels que rédigés ; pas de témoignages.
  await expect(page.getByText("Licence [À CONFIRMER]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ce qu'en disent les vendeurs" })).toHaveCount(0);
  // FAQ : une question s'ouvre sur sa réponse.
  await page.getByText("Est-ce que Dexlane prend une commission sur mes ventes ?").click();
  await expect(page.getByText("Non, aucune. Tu paies ton forfait, c'est tout.", { exact: false })).toBeVisible();
  await expect(page.getByText("Dexlane est un outil indépendant.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  // Sur téléphone, « Se connecter » est dans le menu.
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Se connecter" }).click();
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
  await expect(lastSale).toHaveAttribute("href", /\/sales\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("home-listing").first()).toContainText("Fouinar");
  await expect(page.getByTestId("home-listing").first()).toContainText("eBay");
  // Barre d'onglets flottante : réduite (icônes seules) quand on descend, en grand dès qu'on remonte, toujours là.
  const tabs = page.getByTestId("mobile-nav");
  const stocks = tabs.getByRole("link", { name: "Stock" });
  await expect(tabs).not.toHaveAttribute("data-compact");
  await expect(tabs.getByText("Stock")).toBeVisible();
  await page.mouse.wheel(0, 600);
  await expect(tabs).toHaveAttribute("data-compact", "true");
  await expect(tabs).toBeInViewport();
  await expect(stocks).toBeVisible(); // le libellé est replié, l'onglet reste nommé et cliquable
  await expect.poll(async () => (await tabs.boundingBox())?.height).toBeLessThan(50);
  await page.mouse.wheel(0, -200);
  await expect(tabs).not.toHaveAttribute("data-compact");
  await page.evaluate(() => window.scrollTo(0, 0));
  // Onglet « Plus » : une feuille avec les écrans moins fréquents ; un lien y mène et la referme.
  await tabs.getByRole("button", { name: "Plus" }).click();
  const more = page.getByTestId("more-sheet");
  await expect(more).toContainText("Ventes et chiffre d'affaires");
  await more.getByRole("link", { name: "Achats" }).click();
  await page.waitForURL(/\/buying$/);
  await expect(more).toHaveCount(0);
  await expect(tabs.getByRole("button", { name: "Plus" })).toHaveAttribute("aria-current", "page");
  await page.goto("/");
  const task = page.getByTestId("home-task").filter({ hasText: "Lot d'accueil" });
  await expect(task).toContainText("carte à corriger");
  await task.click();
  await page.waitForURL(new RegExp(`/scanner/batch/${batch.id}$`));
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

  await page.goto("/scanner/batch");
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

  await page.goto("/sales");
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

test("achats : suivre une carte avec un prix cible, ses prix sur Cardmarket et TCGplayer, alertes, et bonnes affaires sur les grosses cartes", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await page.getByTestId("more-button").click();
  await page.getByTestId("more-sheet").getByRole("link", { name: "Achats" }).click();
  await expect(page.getByRole("heading", { name: "Achats" })).toBeVisible();

  // Suivre le Dracaufeu du Set de Base (impression illimitée) avec un prix cible de 100 €.
  const rows = page.getByTestId("watched-card");
  const draco = rows.filter({ hasText: "Dracaufeu" });
  if (await draco.count()) await draco.getByRole("button", { name: "Ne plus suivre Dracaufeu" }).click(); // rejouable
  await page.getByRole("button", { name: "Suivre une carte" }).click();
  const dialog = page.getByRole("dialog", { name: "Suivre une carte" });
  // Sans saisie : les cartes les plus demandées (vendues la veille, prix de vente en hausse), prêtes à suivre d'un clic.
  const top = dialog.getByTestId("top-cards");
  await expect(top.getByTestId("pick-card").first()).toContainText("Dracaufeu");
  await expect(top.getByTestId("pick-card").first()).toContainText("432,22 €");
  await expect(top.getByTestId("pick-card").first()).toContainText("+11 % cette semaine");
  // Une seule saisie : nom et numéro ensemble ; une ligne par variante existant en français (illimitée, 1re édition) —
  // les impressions purement anglaises (« sans ombre », « Copyright 1999-2000 ») n'y figurent pas.
  await dialog.getByLabel("Rechercher une carte").fill("dracaufeu 4/102");
  const results = dialog.getByTestId("search-results").getByTestId("pick-card");
  await expect(results).toHaveCount(2);
  await expect(dialog.getByTestId("search-results")).not.toContainText("sans ombre");
  const unlimited = results.filter({ hasText: "illimité" });
  await expect(unlimited).toContainText("432,22 €");
  await unlimited.getByRole("button", { name: "Suivre Dracaufeu 4" }).click();
  await expect(unlimited).toContainText("Suivie");
  await dialog.getByRole("button", { name: "Terminé" }).click();
  await expect(page.getByText("Dracaufeu suivie")).toBeVisible();
  await draco.getByLabel("Prix cible pour Dracaufeu").fill("100");
  await draco.getByLabel("Prix cible pour Dracaufeu").press("Enter");
  await expect(page.getByText("Prix cible : 100,00 €")).toBeVisible();

  // Ses prix sur chaque plateforme : ventes réussies 432 €, annonce dès 90 €, TCGplayer 987 $.
  await expect(draco).toContainText("432,22 €");
  await expect(draco).toContainText("90,00 €");
  await expect(draco).toContainText("987,13");
  // L'annonce la moins chère (90 €) est sous le prix cible : la carte remonte en tête, signalée.
  await expect(draco).toContainText("Sous votre prix cible");
  await expect(page.getByText(/demande votre attention|demandent votre attention/)).toBeVisible();
  await expect(draco.getByRole("link", { name: "Chercher Dracaufeu sur Cardmarket" })).toHaveAttribute("href", /cardmarket\.com.*Dracaufeu/);
  await draco.getByRole("button", { name: "Évolution du prix de Dracaufeu" }).click();
  await expect(draco.getByTestId("price-history")).toBeVisible();

  // L'accueil le signale aussi.
  await page.goto("/");
  await expect(page.getByTestId("home-task").filter({ hasText: "carte suivie à regarder" })).toBeVisible();

  // Le prix cible se modifie sur place : sous l'annonce la moins chère, l'alerte de cible disparaît.
  await page.goto("/buying");
  await draco.getByLabel("Prix cible pour Dracaufeu").fill("80");
  await draco.getByLabel("Prix cible pour Dracaufeu").press("Enter");
  await expect(page.getByText("Prix cible : 80,00 €")).toBeVisible();
  await expect(draco).not.toContainText("Sous votre prix cible");

  // Bonnes affaires : les cartes de plus de 10 € annoncées nettement sous leurs ventes, la plus grosse affaire d'abord.
  await page.goto("/buying");
  await page.getByRole("tab", { name: "Bonnes affaires" }).click();
  const deal = page.getByTestId("deal").filter({ hasText: "Dracaufeu" }).first();
  await expect(deal).toContainText("−79 %");
  await expect(deal).toContainText("Suivie");
  await expect(page.getByTestId("deals-scope")).toContainText("vérifiez l'annonce avant d'acheter");
  await expect(page.getByTestId("deal").filter({ hasText: "Fouinar" })).toHaveCount(0); // une commune à quelques centimes n'est pas une affaire
  await page.getByLabel("Valeur minimale").selectOption("10000");
  await expect(page.getByTestId("deal").filter({ hasText: "Dracaufeu" })).toHaveCount(1); // 432 € > 100 €

  // Ne plus suivre.
  await page.getByRole("tab", { name: /Cartes suivies/ }).click();
  await draco.getByRole("button", { name: "Ne plus suivre Dracaufeu" }).click();
  await expect(page.getByText("Dracaufeu n'est plus suivie")).toBeVisible();
});

test("fiche d'une carte : variantes et prix, tous les exemplaires regroupés quels que soient l'état et la boîte, ventes", async ({ page }) => {
  await login(page);
  // Trois exemplaires du même Fouinar : deux normaux « Mint » dans une boîte, un reverse « Excellent » dans une autre ; un vendu.
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as {
    candidates: { catalogCardId: string; variants: { id: string; finish: string }[] }[];
  };
  const fouinar = candidates[0]!;
  for (const code of ["BOITE-F1", "BOITE-F2"]) await page.request.post("/api/locations", { data: { code } });
  const receive = async (finish: string, condition: string, quantity: number, locationCode: string) =>
    (await (await page.request.post("/api/inventory/receive", {
      data: { variantId: fouinar.variants.find((v) => v.finish === finish)!.id, condition, quantity, locationCode, unitCostCents: 3 },
      headers: { "Idempotency-Key": `e2e-fiche-${finish}-${Date.now()}` },
    })).json()) as { offer: { id: string; offerSku: string }; stockItem: { unitSku: string } };
  const normal = await receive("normal", "MT", 2, "BOITE-F1");
  const reverse = await receive("reverse", "EX", 1, "BOITE-F2");
  const sale = (await (await page.request.post("/api/orders", {
    data: { lines: [{ offerId: normal.offer.id, qty: 1, unitPriceCents: 90 }], shippingMode: "HAND_DELIVERY" },
    headers: { "Idempotency-Key": `e2e-fiche-vente-${Date.now()}` },
  })).json()) as { externalId: string };

  // Depuis le stock : le nom de la carte mène à sa fiche.
  const panel = await openStockCard(page, normal.offer.offerSku);
  await panel.getByRole("link", { name: "Fouinar" }).click();
  await page.waitForURL(new RegExp(`/card/${fouinar.catalogCardId}$`));
  await expect(page.getByTestId("card-name")).toHaveText("Fouinar");

  // Les variantes, chacune avec ses prix sur chaque plateforme.
  const variants = page.getByTestId("card-variant");
  await expect(variants).toHaveCount(2);
  await expect(variants.filter({ hasText: "Reverse" })).toContainText("0,35 €");
  await expect(page.getByTestId("price-history")).toBeVisible();

  // Tous les exemplaires regroupés par offre (variante × état), avec leur boîte.
  const copies = page.getByTestId("card-copies");
  await expect(copies.getByTestId(`card-offer-${normal.offer.offerSku}`)).toContainText("BOITE-F1");
  await expect(copies.getByTestId(`card-offer-${normal.offer.offerSku}`)).toContainText("1 réservée");
  await expect(copies.getByTestId(`card-offer-${reverse.offer.offerSku}`)).toContainText("BOITE-F2");
  await expect(copies.getByTestId(`card-offer-${reverse.offer.offerSku}`)).toContainText(reverse.stockItem.unitSku);
  await expect(page.getByTestId("card-sales")).toContainText(sale.externalId);

  // Suivre une variante depuis la fiche ; ouvrir une offre dans le stock.
  const reverseRow = variants.filter({ hasText: "Reverse" });
  if (await reverseRow.getByRole("button", { name: /^Suivre/ }).count()) {
    await reverseRow.getByRole("button", { name: /^Suivre/ }).click();
    await expect(reverseRow.getByRole("link", { name: "Suivie" })).toBeVisible();
  }
  await copies.getByTestId(`card-offer-${reverse.offer.offerSku}`).getByRole("link", { name: "Ouvrir dans le stock" }).click();
  await expect(page.getByTestId("stock-inspector")).toContainText("Fouinar");
});

test("langue : l'interface passe en anglais depuis le compte, montants et dates suivent, puis revient en français", async ({ page }) => {
  await login(page);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Compte", level: 1 })).toBeVisible();
  await page.getByTestId("locale-switch").getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const tabs = page.getByTestId("mobile-nav");
  for (const name of ["Home", "Stock", "Listings", "Sales"]) await expect(tabs.getByRole("link", { name })).toBeVisible();
  // « Plus » range les écrans moins fréquents : achats, statistiques, réglages…
  await tabs.getByRole("button", { name: "More" }).click();
  const more = page.getByTestId("more-sheet");
  for (const name of ["Buying", "Statistics", "Settings", "Account"]) await expect(more.getByRole("link", { name })).toBeVisible();
  await more.getByRole("button", { name: "Close" }).click();
  await expect(more).toHaveCount(0);

  await tabs.getByRole("link", { name: "Stock" }).click();
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^To price/ })).toBeVisible();
  // Montants au format anglais : le symbole avant le nombre, le point décimal.
  await expect(page.getByTestId("stock-totals")).toContainText(/€\d[\d,]*\.\d\d/);

  await page.goto("/account");
  await page.getByTestId("locale-switch").getByRole("radio", { name: "Français" }).click();
  await expect(page.getByRole("heading", { name: "Compte", level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("cache : en revenant sur un écran, ses dernières données s'affichent tout de suite, sans squelette", async ({ page }) => {
  await login(page);
  await page.request.post("/api/locations", { data: { code: "BOX-CA" } });
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string }[] }[] };
  await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants[0]!.id, condition: "NM", quantity: 1, locationCode: "BOX-CA", unitCostCents: 5 },
    headers: { "Idempotency-Key": `e2e-cache-${Date.now()}` },
  });
  await page.goto("/stock");
  const rows = page.locator('tbody tr[data-testid^="stock-"]');
  await expect(rows.first()).toBeVisible();
  const tabs = page.getByTestId("mobile-nav");
  await tabs.getByRole("link", { name: "Accueil" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();

  // Le serveur ne répond plus au stock : seules les données gardées en mémoire peuvent s'afficher.
  await page.route("**/api/stock?**", () => undefined);
  await tabs.getByRole("link", { name: "Stock" }).click();
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId("skeleton")).toHaveCount(0);

  // Les données restent sur l'appareil : en rouvrant l'application, toujours sans réponse du serveur, le stock revient.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dexlane-cache-v2")?.length ?? 0)).toBeGreaterThan(0);
  await page.reload();
  await expect(rows.first()).toBeVisible();

  // La déconnexion efface ce qui était gardé.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.goto("/account");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem("dexlane-cache-v2"))).toBeNull();
});

test("notifications : réglage par appareil et choix de ce qui est signalé", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Notifications/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await expect(page.getByTestId("push-device")).toContainText(/appareils? abonnés? en tout/);
  const watched = page.getByRole("switch", { name: "Cartes suivies" });
  await expect(watched).toBeChecked();
  await watched.click();
  await expect(watched).not.toBeChecked();
  await expect.poll(async () => ((await (await page.request.get("/api/notifications")).json()) as { preferences: { watched: boolean } }).preferences.watched).toBe(false);
  await watched.click();
  await expect.poll(async () => ((await (await page.request.get("/api/notifications")).json()) as { preferences: { watched: boolean } }).preferences.watched).toBe(true);
});

/** Photo de téléphone factice : une carte (bord jaune, intérieur clair) posée sur une table sombre. */
function cardPhoto(): Buffer {
  const width = 600, height = 800;
  const card = { x: 150, y: 120, w: 300, h: 419 };
  const row = width * 3 + 1;
  const px = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    px[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const inCard = x >= card.x && x < card.x + card.w && y >= card.y && y < card.y + card.h;
      const inner = inCard && x >= card.x + 15 && x < card.x + card.w - 15 && y >= card.y + 15 && y < card.y + card.h - 15;
      const [r, g, b] = inner ? [245, 240, 215] : inCard ? [250, 205, 30] : [40 + ((x * 7 + y * 3) % 9), 40, 46];
      px.set([r, g, b], y * row + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(px)), chunk("IEND", Buffer.alloc(0))]);
}

test("photo au téléphone : la carte est repérée, redressée et recadrée au format carte avant la lecture", async ({ page }) => {
  await login(page);
  await page.request.put("/api/app-settings", { data: { intakeMode: "CAMERA" } });
  await page.goto("/add");
  await page.getByTestId("photo-input").setInputFiles({ name: "carte.png", mimeType: "image/png", buffer: cardPhoto() });
  const badge = page.getByTestId("photo-cropped");
  await expect(badge).toBeVisible({ timeout: 30_000 });
  const ratio = await page.getByRole("img", { name: "Photo prise" }).first().evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(ratio).toBeCloseTo(63 / 88, 2);
});

test("stock › fournitures : ajout depuis une suggestion, alerte « à commander », commande, entrée, et journal des mouvements", async ({ page }) => {
  await login(page);
  await page.request.post("/api/locations", { data: { code: "ETAGERE-E2E" } });
  await page.goto("/fournitures"); // l'ancienne adresse mène au stock
  await expect(page).toHaveURL(/\/stock\?section=supplies/);
  await expect(page.getByTestId("stock-tabs").getByRole("link", { name: "Fournitures" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Sleeves" }).click();
  const form = page.getByTestId("supply-form");
  await expect(form.getByLabel("Nom")).toHaveValue("Sleeves");
  await form.getByLabel("Référence").fill("SLV-E2E");
  await form.getByLabel("En stock").fill("30");
  await form.getByLabel("Prix d'achat unitaire (€)").fill("0,05");
  await form.getByRole("button", { name: "Ajouter" }).click();

  // 30 sleeves pour un seuil de 100 : à commander, signalé en haut, sur l'onglet et sur l'accueil.
  const row = page.getByTestId("supply-Sleeves");
  await expect(row.getByTestId("supply-on-hand")).toHaveText("30");
  await expect(page.getByTestId("supplies-to-reorder")).toContainText("1 fourniture à commander");
  await expect(page.getByTestId("supplies-totals")).toContainText("1,50");
  const inspector = page.getByTestId("supply-inspector");
  await expect(inspector).toContainText("SLV-E2E");
  await page.goto("/");
  await expect(page.getByTestId("home-task").filter({ hasText: "fourniture à commander" })).toContainText("Sleeves");

  await page.goto("/stock?section=supplies");
  await row.click();
  await inspector.getByTestId("supply-ordered").click();
  await expect(inspector).toContainText("Commandé");
  await expect(page.getByTestId("supplies-to-reorder")).toHaveCount(0);
  await inspector.getByRole("button", { name: "Entrée" }).click();
  await expect(page.getByTestId("supply-quantity")).toHaveValue("500"); // la quantité habituellement commandée
  await page.getByLabel("Note (facultative)").fill("commande 42");
  await page.getByRole("button", { name: "Ajouter au stock" }).click();
  await expect(row.getByTestId("supply-on-hand")).toHaveText("530");
  await expect(inspector.getByTestId("recent-movements")).toContainText("commande 42");

  // Rangée sur une étagère, puis inventaire.
  await inspector.getByRole("button", { name: "Modifier Sleeves" }).click();
  await page.getByRole("button", { name: "Emplacement" }).click();
  await page.getByLabel("Filtrer les emplacements").fill("etagere-e2e");
  await page.getByRole("radio", { name: "ETAGERE-E2E", exact: true }).click();
  await page.getByTestId("supply-form").getByRole("button", { name: "Enregistrer" }).click();
  await expect(inspector).toContainText("ETAGERE-E2E");
  await inspector.getByRole("button", { name: "Inventaire" }).click();
  await page.getByTestId("supply-quantity").fill("528");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(row.getByTestId("supply-on-hand")).toHaveText("528");

  // Le journal : entrée, inventaire, cartes et fournitures ensemble (la fiche, en tiroir sur téléphone, se ferme d'abord).
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await page.getByTestId("stock-tabs").getByRole("link", { name: "Mouvements" }).click();
  const journal = page.getByTestId("stock-journal");
  await journal.getByRole("tab", { name: "Fournitures" }).click();
  await expect(journal.getByTestId("stock-movement").first()).toContainText("Sleeves");
  await expect(journal.getByTestId("stock-movement").first()).toContainText("−2");
  await expect(journal).toContainText("commande 42");
  await expect(journal.getByTestId("journal-summary")).toContainText("+530"); // stock initial (30) et entrée (500)

  // Son prix d'achat fixe désormais le coût des fournitures dans la marge : les frais d'envoi l'affichent.
  await page.goto("/settings/shipping");
  await expect(page.getByTestId("supplies-from-stock")).toContainText("Sleeves");
  await expect(page.getByTestId("supplies-per-card")).toContainText("0,05 €");
  await expect(page.getByLabel("Sleeve (€)")).toHaveCount(0);

  // Retirée pour ne pas peser sur les autres parcours.
  await page.goto("/stock?section=supplies");
  await row.click();
  await inspector.getByRole("button", { name: "Modifier Sleeves" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("supply-form").getByRole("button", { name: "Retirer" }).click();
  await expect(row).toHaveCount(0);
});

test("stock › cartes : les derniers mouvements d'une carte dans sa fiche, et le journal des cartes", async ({ page }) => {
  await login(page);
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string }[] }[] };
  await page.request.post("/api/locations", { data: { code: "BOX-MV" } });
  const received = (await (await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants[0]!.id, condition: "PL", quantity: 4, locationCode: "BOX-MV", unitCostCents: 5 },
    headers: { "Idempotency-Key": `e2e-mv-${Date.now()}` },
  })).json()) as { offer: { id: string; offerSku: string }; stockItem: { id: string } };
  await page.request.post(`/api/inventory/${received.stockItem.id}/adjust`, { data: { countedOnHand: 3, reason: "abîmée" }, headers: { "Idempotency-Key": `e2e-mv-adj-${Date.now()}` } });

  await openStockCard(page, received.offer.offerSku);
  const recent = page.getByTestId("recent-movements");
  // La correction en premier, puis l'entrée (d'autres parcours ont pu faire bouger la même carte avant).
  await expect(recent.getByTestId("stock-movement").first()).toContainText("abîmée");
  await expect(recent.getByTestId("stock-movement").nth(1)).toContainText("Entrée");
  await page.getByRole("link", { name: "Tout le journal" }).click();
  await page.getByTestId("stock-journal").getByRole("tab", { name: "Cartes" }).click();
  await expect(page.getByTestId("stock-movement").filter({ hasText: "abîmée" })).toContainText("Fouinar");
});

test("agents : jeton créé dans les réglages, serveur MCP joignable avec ce jeton, puis révoqué", async ({ page }) => {
  await login(page);
  await page.goto("/settings/agents");
  await expect(page.getByTestId("mcp-endpoint")).toHaveValue(/\/mcp$/);
  await page.getByTestId("agent-name").fill("Agent e2e");
  await page.getByRole("button", { name: "Créer un jeton" }).click();
  const token = await page.getByTestId("agent-token-value").inputValue();
  expect(token).toMatch(/^dxl_/);
  await expect(page.getByTestId("agent-tokens")).toContainText("Agent e2e");

  const mcp = (body: unknown, bearer = token) => page.request.post("/mcp", {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    data: body,
  });
  const listed = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  expect(listed.status()).toBe(200);
  const tools = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  expect(tools).toContain("get_business_overview");
  const overview = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_business_overview", arguments: {} } });
  const result = ((await overview.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
  expect(result.isError).toBeFalsy();
  expect(JSON.parse(result.content[0]!.text)).toHaveProperty("stock");
  // Le jeton du serveur web ou une session ne remplacent pas un jeton d'agent sur /mcp.
  expect((await mcp({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, "pas-un-jeton")).status()).toBe(401);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Révoquer Agent e2e" }).click();
  await expect(page.getByText("Accès révoqué")).toBeVisible();
  expect((await mcp({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} })).status()).toBe(401);
});

test("ventes : suivi du colis, livraison notée et demande d'avis ; extension dans le stock ; anciennes adresses", async ({ page }) => {
  await login(page);
  const { candidates } = (await (await page.request.get("/api/catalog/cards?name=fouinar")).json()) as { candidates: { variants: { id: string }[] }[] };
  await page.request.post("/api/locations", { data: { code: "BOX-TR" } });
  const received = (await (await page.request.post("/api/inventory/receive", {
    data: { variantId: candidates[0]!.variants[0]!.id, condition: "EX", quantity: 2, locationCode: "BOX-TR", unitCostCents: 10 },
    headers: { "Idempotency-Key": `e2e-tr-${Date.now()}` },
  })).json()) as { offer: { id: string; offerSku: string } };
  const order = (await (await page.request.post("/api/orders", {
    data: { lines: [{ offerId: received.offer.id, qty: 1, unitPriceCents: 300 }], shippingMode: "LETTER_TRACKED", buyerName: "Camille Suivi" },
    headers: { "Idempotency-Key": `e2e-tr-sale-${Date.now()}` },
  })).json()) as { id: string; externalId: string; lines: { allocations: { id: string; unitSku: string }[] }[] };
  const allocation = order.lines[0]!.allocations[0]!;
  await page.request.post(`/api/orders/${order.id}/pick`, { data: { allocationId: allocation.id, unitSku: allocation.unitSku } });
  await page.request.post(`/api/orders/${order.id}/pack`);
  await page.request.post(`/api/orders/${order.id}/handover`, { data: { tracking: "6A 1234 5678 901" } });

  // L'ancienne adresse des ventes mène à la nouvelle ; la vente remise montre son suivi dans la liste.
  await page.goto("/ventes");
  await expect(page).toHaveURL(/\/sales$/);
  await page.getByRole("tab", { name: /^Remises/ }).click();
  await expect(page.getByTestId(`order-${order.externalId}`).getByTestId("order-delivery")).toContainText("6A12345678901");

  await page.goto(`/sales/${order.id}`);
  const card = page.getByTestId("delivery-card");
  await expect(card.getByTestId("delivery-status")).toHaveText("Déposée");
  await expect(card.getByTestId("delivery-tracking")).toHaveText("6A12345678901");
  await expect(card).toContainText("La Poste / Colissimo");
  await expect(card.getByRole("link", { name: "Suivre le colis" })).toHaveAttribute("href", "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901");
  await card.getByTestId("mark-delivered").click();
  await expect(card.getByTestId("delivery-status")).toHaveText("Livrée");
  const review = card.getByTestId("review-panel");
  await expect(review).toContainText("24 h après la livraison");
  await expect(review.getByTestId("review-message")).toHaveValue(/^Bonjour Camille Suivi,/);
  await review.getByTestId("review-requested").click();
  await expect(review).toContainText("Demandé le");

  // Le code d'extension en colonne du stock ; l'ancien filtre « statut » mène au nouveau paramètre.
  await page.goto("/stock?statut=READY");
  await expect(page).toHaveURL(/\/stock\?.*\bstatus=READY/);
  await page.goto("/stock");
  await page.getByLabel("Rechercher dans le stock").fill(received.offer.offerSku);
  await expect(page.getByTestId(`stock-${received.offer.offerSku}`)).toContainText("EB03");
  await page.goto("/reglages/envois");
  await expect(page).toHaveURL(/\/settings\/shipping$/);
  await expect(page.getByTestId("tracking-carriers")).toContainText("Non relié");
});

test("mémoire de l'appareil : des données gardées par une version précédente ne font pas planter l'écran", async ({ page }) => {
  await login(page);
  // Format du premier écran Fournitures : ni totaux, ni prix, ni emplacement.
  const old = { supplies: [{ id: "00000000-0000-4000-8000-000000000001", name: "Sleeves", usage: "PER_CARD", perUse: 1, modes: ["HAND_DELIVERY"], onHand: 3, reorderPoint: 10, reorderQuantity: null, supplierUrl: null, orderedAt: null, createdAt: new Date().toISOString(), used30Days: 0, daysLeft: null, status: "LOW" }], toReorder: 1 };
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("seeded")) {
      // Sous l'ancienne clé (ignorée et effacée) et sous la clé courante (l'écran doit tenir quand même).
      localStorage.setItem("dexlane-cache-v1", JSON.stringify({ supplies: { at: Date.now(), value } }));
      localStorage.setItem("dexlane-cache-v2", JSON.stringify({ supplies: { at: Date.now(), value } }));
      sessionStorage.setItem("seeded", "1");
    }
  }, old);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/stock?section=supplies");
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();
  await expect(page.getByTestId("stock-tabs")).toBeVisible();
  await expect(page.getByTestId("supply-Sleeves").or(page.getByText("Aucune fourniture suivie"))).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("dexlane-cache-v1"))).toBeNull();
});

test("forfait, gradation, suggestions et lots : le compte d'installation sans limite, une carte gradée, deux cartes vendues en un lot", async ({ page }) => {
  await login(page);
  // Le compte d'installation n'a pas de forfait : tout est ouvert, sans quota.
  await page.goto("/settings/plan");
  await expect(page.getByTestId("plan-current")).toContainText("Forfait Community");
  await expect(page.getByTestId("quota-meter")).toContainText("sans limite");
  await expect(page.getByText("Installation sans limite")).toBeVisible();

  const variant = async (name: string) => ((await (await page.request.get(`/api/catalog/cards?name=${name}`)).json()) as { candidates: { variants: { id: string }[] }[] }).candidates[0]!.variants[0]!.id;
  await page.request.post("/api/locations", { data: { code: "BOX-LOT" } });
  const receive = async (variantId: string, condition: string, unique: boolean) => (await (await page.request.post("/api/inventory/receive", {
    data: { variantId, condition, quantity: 1, locationCode: "BOX-LOT", unitCostCents: 20, unique },
    headers: { "Idempotency-Key": `e2e-lot-${condition}-${Date.now()}-${Math.random()}` },
  })).json()) as { offer: { id: string; offerSku: string } };
  const graded = await receive(await variant("dracaufeu"), "NM", true);
  const [first, second] = [await receive(await variant("fouinar"), "GD", true), await receive(await variant("fouinar"), "EX", true)];
  for (const o of [graded, first, second]) await page.request.post(`/api/pricing/offers/${o.offer.id}/price`, { data: { targetPriceCents: 400 } });

  // Une carte gradée : la note remplace l'état dans le titre de l'annonce.
  const panel = await openStockCard(page, graded.offer.offerSku);
  await panel.getByRole("button", { name: "Noter une gradation" }).click();
  await panel.getByTestId("grading-grader").selectOption("PSA");
  await panel.getByTestId("grading-grade").selectOption("10");
  await panel.getByLabel("Numéro de certificat").fill("87654321");
  await panel.getByRole("button", { name: "Enregistrer", exact: true }).last().click();
  await expect(panel.getByTestId("stock-grading")).toContainText("PSA 10");
  await expect(panel.getByTestId("stock-listing-title")).toContainText("PSA 10");
  // Suggestions : un titre pour la recherche, appliqué d'un clic, puis retour au modèle.
  const suggestions = panel.getByTestId("stock-suggestions");
  await expect(suggestions).toContainText("Dracaufeu 4/102");
  await suggestions.getByRole("button", { name: "Utiliser ce titre" }).click();
  await expect(page.getByText("Titre appliqué")).toBeVisible();
  await suggestions.getByRole("button", { name: "Revenir au modèle" }).click();
  await expect(page.getByText("Retour au modèle de titre")).toBeVisible();

  // Deux cartes cochées deviennent un lot : elles quittent le stock à l'unité.
  await page.goto("/stock");
  await page.getByLabel("Rechercher dans le stock").fill("fouinar");
  await page.getByTestId(`stock-${first.offer.offerSku}`).getByRole("checkbox").check();
  await page.getByTestId(`stock-${second.offer.offerSku}`).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Créer un lot" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un lot" });
  await dialog.getByTestId("lot-title").fill("Lot Fouinar x2");
  await dialog.getByTestId("lot-price").fill("6");
  await dialog.getByTestId("lot-create").click();
  await expect(page.getByText("Lot créé : Lot Fouinar x2")).toBeVisible();
  await expect(page.getByTestId(`stock-${first.offer.offerSku}`)).toHaveCount(0);

  await page.goto("/lots");
  const lot = page.getByTestId("sale-lots").locator("li").filter({ hasText: "Lot Fouinar x2" }).first();
  await expect(lot).toContainText("2 cartes");
  await expect(lot).toContainText("À vendre");
  page.once("dialog", (d) => void d.accept());
  await lot.getByRole("button", { name: "Défaire" }).click();
  await expect(page.getByText("Lot défait : les cartes sont de retour dans le stock")).toBeVisible();
  await expect(lot).toContainText("Défait");
});
