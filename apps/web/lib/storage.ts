import { useCallback, useEffect, useState } from "react";

/** État conservé sur l'appareil (réglages de session du scanner). Rendu initial neutre, puis lecture au montage. */
export function useStored<T>(key: string, initial: T): [T, (value: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // stockage indisponible (navigation privée) : on garde la valeur initiale
    }
    setReady(true);
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // idem
      }
    },
    [key],
  );
  return [value, set, ready];
}
