"use client";

import { Images, Layers, Plus, ScanLine, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type IntakeMode = "SCANNER" | "CAMERA" | "FILES";
/** Le lot se présente selon le matériel choisi dans l'assistant de démarrage. */
const LOT: Record<IntakeMode, { label: string; hint: string }> = {
  SCANNER: { label: "Un lot scanné", hint: "Images du scanner à défilement" },
  CAMERA: { label: "Un lot photographié", hint: "Au téléphone, recto puis verso" },
  FILES: { label: "Un lot d'images", hint: "Photos déjà prises, déposées ensemble" },
};
const ADD: { href: string; label: string; hint: string; icon: LucideIcon }[] = [
  { href: "/scanner/lot", label: "Un lot d'images", hint: "Fichiers du scanner à défilement", icon: Images },
  { href: "/ajouter", label: "Une carte", hint: "Photo ou recherche dans le catalogue", icon: ScanLine },
  { href: "/vrac", label: "Du vrac", hint: "Un lot compté, sans détail", icon: Layers },
];

/** Bouton d'ajout : une seule entrée pour faire entrer des cartes, trois façons de le faire. */
export function AddMenu({ className }: { className?: string }) {
  const [intake, setIntake] = useState<IntakeMode | null>(null);
  useEffect(() => {
    api.appSettings().then((s) => setIntake(s.intakeMode)).catch(() => undefined);
  }, []);
  const items = ADD.map((item) => (item.href === "/scanner/lot" && intake ? { ...item, ...LOT[intake] } : item));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium whitespace-nowrap text-primary-foreground shadow-xs transition-colors outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/30",
          className,
        )}
        data-testid="add-cards"
      >
        <Plus className="size-4" aria-hidden /> Ajouter des cartes
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {items.map((item) => (
            <DropdownMenu.Item key={item.href} asChild>
              <Link href={item.href} className="flex items-center gap-3 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-accent">
                <item.icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="grid">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
