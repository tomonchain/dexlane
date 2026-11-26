"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Pose `data-seen` la première fois que le bloc entre à l'écran (les animations d'entrée partent de là), et tient
 * `data-inview` à jour (les animations en boucle se mettent en pause hors de l'écran). Les styles sont dans
 * globals.css, section « Site marketing : animations » ; avec `prefers-reduced-motion`, tout reste à l'état final.
 */
export function InView({ children, className, style, threshold = 0.35 }: { children: ReactNode; className?: string; style?: CSSProperties; threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.dataset.seen = "true";
      el.dataset.inview = "true";
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      el.dataset.inview = String(entry.isIntersecting);
      if (entry.isIntersecting) el.dataset.seen = "true";
    }, { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return <div ref={ref} data-motion="" data-inview="false" className={className} style={style}>{children}</div>;
}
