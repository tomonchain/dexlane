"use client";

import { useState } from "react";
import { cardImage } from "./format";

const LOCALIZED = /(assets\.tcgdex\.net\/)(?!en\/)[a-z-]+\//;

/**
 * Image d'une carte du catalogue, avec repli : TCGdex n'a pas l'image de chaque carte dans chaque langue. Si l'image
 * française (ou d'une autre langue) ne se charge pas, l'image anglaise de la même carte prend le relais ; si elle manque
 * aussi, `src` devient null et l'appelant affiche son emplacement vide.
 */
export function useCardImage(imageUrl: string | null, quality: "low" | "high" = "low"): { src: string | null; onError: () => void } {
  const [failed, setFailed] = useState<{ url: string | null; step: number }>({ url: imageUrl, step: 0 });
  const step = failed.url === imageUrl ? failed.step : 0;
  const english = imageUrl && LOCALIZED.test(imageUrl) ? imageUrl.replace(LOCALIZED, "$1en/") : null;
  const src = step === 0 ? cardImage(imageUrl, quality) : step === 1 && english ? cardImage(english, quality) : null;
  return { src, onError: () => setFailed({ url: imageUrl, step: step === 0 && english ? 1 : 2 }) };
}
