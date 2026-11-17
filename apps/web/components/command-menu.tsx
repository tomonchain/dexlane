"use client";

import { Command } from "cmdk";
import { Archive, BookOpen, Layers, Package, ScanLine, Search, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { positionSubtitle, positionTitle } from "@/lib/format";
import type { Position } from "@/lib/types";
import { Code, Spinner } from "./ui/misc";

export const PAGES = [
  { href: "/", label: "Scanner", hint: "Entrer une carte en stock", icon: ScanLine },
  { href: "/inventaire", label: "Inventaire", hint: "Rechercher et gérer les positions", icon: Package },
  { href: "/prix", label: "Prix", hint: "Estimations, prix cibles et règles", icon: Tags },
  { href: "/rangement", label: "Rangement", hint: "Emplacements et lots d'acquisition", icon: Archive },
  { href: "/vrac", label: "Vrac", hint: "Enregistrer un lot agrégé", icon: Layers },
  { href: "/catalogue", label: "Catalogue", hint: "Synchroniser les séries", icon: BookOpen },
] as const;

const item =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

/** Palette de commandes (⌘K / Ctrl+K) : aller à une page ou retrouver une position par nom ou SKU. */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Position[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let current = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api.inventory({ q, limit: 6, lifecycle: "ALL" })
        .then((r) => current && setResults(r.items))
        .catch(() => current && setResults([]))
        .finally(() => current && setSearching(false));
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const pages = PAGES.filter((p) => !q || `${p.label} ${p.hint}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[12dvh] left-1/2 z-50 w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="sr-only">Recherche</Dialog.Title>
          <Command shouldFilter={false} label="Recherche">
            <div className="flex items-center gap-2.5 border-b px-4">
              {searching ? <Spinner /> : <Search className="size-4 text-muted-foreground" aria-hidden />}
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Nom de carte, SKU, page…"
                className="h-13 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 md:text-sm"
              />
              <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">Échap</kbd>
            </div>
            <Command.List className="max-h-[55dvh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                {searching ? "Recherche…" : "Aucun résultat."}
              </Command.Empty>
              {results.length > 0 && (
                <Command.Group heading="Inventaire" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase">
                  {results.map((p) => (
                    <Command.Item key={p.id} value={p.id} onSelect={() => go(`/inventaire/${p.unitSku}`)} className={item}>
                      <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{positionTitle(p)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{positionSubtitle(p)}</span>
                      </span>
                      <span className="grid justify-items-end gap-0.5 text-xs text-muted-foreground">
                        <Code>{p.unitSku}</Code>
                        <Code>{p.locationCode}</Code>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {pages.length > 0 && (
                <Command.Group heading="Aller à" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase">
                  {pages.map((p) => (
                    <Command.Item key={p.href} value={p.href} onSelect={() => go(p.href)} className={item}>
                      <p.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{p.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{p.hint}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
