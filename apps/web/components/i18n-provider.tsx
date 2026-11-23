"use client";

import { useEffect, type ReactNode } from "react";
import { LOCALE_COOKIE, setCurrentLocale, type Locale } from "@/lib/i18n";

/** Pose la langue de l'interface avant le rendu des composants qui traduisent (serveur comme navigateur). */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  setCurrentLocale(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return children;
}

/** Change la langue : enregistrée pour un an sur cet appareil, puis la page se recharge dans la nouvelle langue. */
export function switchLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  window.location.reload();
}
