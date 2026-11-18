"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/utils";

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

/**
 * Fenêtre modale adaptative : boîte de dialogue centrée sur ordinateur, tiroir depuis le bas sur téléphone
 * (atteignable au pouce, se ferme en glissant). Focus piégé et fermeture par Échap dans les deux cas.
 */
export function Modal({ title, description, onClose, children, className }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const desktop = useIsDesktop();
  const onOpenChange = (open: boolean) => !open && onClose();
  const overlay = "fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0";

  if (desktop) {
    return (
      <Dialog.Root open onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={overlay} />
          <Dialog.Content
            {...(description ? {} : { "aria-describedby": undefined })}
            className={cn(
              "fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              className,
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div className="grid gap-1">
                <Dialog.Title className="text-base font-semibold tracking-tight">{title}</Dialog.Title>
                {description && <Dialog.Description className="text-sm text-muted-foreground">{description}</Dialog.Description>}
              </div>
              <Dialog.Close aria-label="Fermer" className="-mt-1 -mr-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5">{children}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer.Root open onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Drawer.Content {...(description ? {} : { "aria-describedby": undefined })} className={cn("fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-2xl border-t bg-popover text-popover-foreground outline-none", className)}>
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25" aria-hidden />
          <div className="grid gap-1 px-4 pt-3 pb-3">
            <Drawer.Title className="text-base font-semibold tracking-tight">{title}</Drawer.Title>
            {description && <Drawer.Description className="text-sm text-muted-foreground">{description}</Drawer.Description>}
          </div>
          <div className="grid gap-4 overflow-y-auto px-4 pt-1 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
