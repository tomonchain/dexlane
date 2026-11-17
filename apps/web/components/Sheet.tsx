"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Feuille modale (bas d'écran sur mobile) : focus piégé et fermeture par Échap fournis par <dialog>. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">×</button>
      </div>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
