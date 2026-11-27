import { expect, test } from "@playwright/test";

/*
 * Parcours du site public de l'édition hébergée : landing, tarifs, pages légales, docs, séries et cotes publiques,
 * guides. Ceux de l'application sont dans scanner.spec.ts.
 */

test("page d'accueil publique : landing statique sans session, référencée, puis « Se connecter » dans le menu", async ({ page }) => {
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
  await expect(page.locator('img[src*="%2Fcards%2F"]').first()).toBeAttached();
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
  // La licence du code mène au fichier LICENSE du dépôt ; pas de témoignages.
  await expect(page.getByRole("link", { name: "Licence AGPL-3.0" })).toHaveAttribute("href", /\/blob\/main\/LICENSE$/);
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
  // Le bouton d'un forfait mène à l'inscription, forfait retenu.
  await expect(page.getByTestId("plan-solo").getByRole("link", { name: "Choisir Solo" })).toHaveAttribute("href", "/signup?plan=solo");
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


test("séries et cotes publiques : index, série, carte, adresse canonique, plan du site, sans donnée de compte", async ({ page }) => {
  // Visiteur sans session : l'index des séries, rangées par bloc.
  await page.goto("/series");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Séries et cotes des cartes Pokémon");
  await expect(page.getByRole("heading", { level: 2, name: "Épée et Bouclier" })).toBeVisible();
  await page.getByRole("link", { name: /Ténèbres Embrasées/ }).click();
  await page.waitForURL(/\/series\/swsh3-tenebres-embrasees$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ténèbres Embrasées");
  await expect(page.getByTestId("set-facts")).toContainText("Épée et Bouclier");
  await expect(page.getByTestId("set-cards")).toContainText("Fouinar");
  await expect(page.getByTestId("set-cards")).toContainText("136/189");

  // La carte : sa cote par variante, datée, avec la source.
  await page.getByTestId("set-cards").getByRole("link", { name: /Fouinar/ }).click();
  await page.waitForURL(/\/series\/swsh3-tenebres-embrasees\/136-fouinar$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fouinar");
  await expect(page.getByTestId("card-summary")).toContainText("est cotée");
  const prices = page.getByTestId("card-prices");
  await expect(prices.getByRole("row", { name: /Reverse/ })).toBeVisible();
  await expect(prices).toContainText("€");
  await expect(page.getByText(/Cote tendance Cardmarket, via TCGdex/)).toBeVisible();
  // Détails repris de TCGdex, variation sur 30 jours, liens vers les places de marché.
  await expect(page.getByTestId("card-facts")).toContainText("tetsuya koizumi");
  await expect(page.getByTestId("card-facts")).toContainText("110");
  await expect(prices.getByRole("columnheader", { name: "30 jours" })).toBeVisible();
  // La variation dépend des relevés faits par les parcours précédents : un pourcentage, ou « stable ».
  await expect(prices.getByRole("row", { name: /Reverse/ })).toContainText(/[+−]\d+ %|stable/);
  await expect(page.getByTestId("card-external").getByRole("link", { name: /Cardmarket/ })).toHaveAttribute("href", /cardmarket\.com\/fr\/Pokemon\/Products\/Search\?searchString=Fouinar/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /assets\.tcgdex\.net\/.*\/136\/high\.webp$/);
  // L'en-tête : « Cotes » est la section active, au téléphone comme sur grand écran, sans rien qui déborde.
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Cotes" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  const phone = page.viewportSize()!;
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole("navigation", { name: "Navigation du site" }).getByRole("link", { name: "Cotes" })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  }
  await page.setViewportSize(phone);
  await expect(page.getByRole("link", { name: "Ténèbres Embrasées", exact: true }).first()).toHaveAttribute("href", "/series/swsh3-tenebres-embrasees");
  // Aucune donnée d'un compte : ni stock, ni ventes, ni navigation de l'application.
  await expect(page.getByText(/en stock|exemplaire/i)).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

  // Une seule adresse par page : un autre nom ou une autre casse mènent à l'adresse canonique.
  await page.goto("/series/SWSH3-ancien-nom/136");
  await page.waitForURL(/\/series\/swsh3-tenebres-embrasees\/136-fouinar$/);
  expect((await page.goto("/series/swsh3-tenebres-embrasees/999-absente"))?.status()).toBe(404);
  expect((await page.goto("/series/xy99-inconnue"))?.status()).toBe(404);

  // Plan du site : séries et cartes cotées ; robots.txt le signale.
  const sitemap = await (await page.request.get("/series/sitemap.xml")).text();
  expect(sitemap).toContain("/series/swsh3-tenebres-embrasees</loc>");
  expect(sitemap).toContain("/series/swsh3-tenebres-embrasees/136-fouinar</loc>");
  expect(await (await page.request.get("/robots.txt")).text()).toContain("/series/sitemap.xml");
  expect(await (await page.request.get("/llms.txt")).text()).toContain("/series");
});


test("guides : index, article rendu depuis le Markdown, sommaire, brouillon signalé hors production, flux RSS", async ({ page }) => {
  await page.goto("/guides");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guides");
  const list = page.getByTestId("guides-list");
  const first = list.getByRole("link").first();
  const title = (await first.locator("span.text-xl").textContent())!;
  await first.click();
  await page.waitForURL(/\/guides\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  // Le Markdown est rendu en titres de section ; le modèle (_modele.md) n'est jamais publié.
  await expect(page.getByTestId("guide-body").locator("h2").first()).toBeVisible();
  // La bannière, quand le guide en a une : affichée, chargée, et reprise comme image de partage.
  const banner = page.getByTestId("guide-banner").locator("img");
  if (await banner.count()) {
    await expect(banner).toHaveAttribute("alt", /.+/);
    expect(await banner.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/guides\/[^/]+\.(webp|jpe?g|png)$/);
  }
  await expect(page.locator('script[type="application/ld+json"]').nth(1)).toBeAttached();
  // Hors production, un brouillon se relit avec son bandeau ; il reste hors des moteurs.
  if (await page.getByTestId("guide-draft").count()) {
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  expect((await page.goto("/guides/_modele"))?.status()).toBe(404);
  expect((await page.goto("/guides/inconnu"))?.status()).toBe(404);
  const rss = await page.request.get("/guides/rss.xml");
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  expect(await rss.text()).toContain("<title>Guides Dexlane</title>");
});
