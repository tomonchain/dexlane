"use client";

import { ChevronDown, CircleHelp, Ellipsis, FolderPlus, MapPin, PackageSearch, Pencil, Plus, ReceiptText, Trash2, X } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Code, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { useStored } from "@/lib/storage";
import type { AcquisitionLot, Location } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/skeletons";
import { useCachedState } from "@/lib/cache";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ
const LOCATION_ERRORS: Record<string, string> = {
  INVALID_LOCATION_CODE: "Code invalide : lettres, chiffres et tirets, jusqu'à 5 niveaux séparés par « / » (ex. BOX-03/ROW-12/SLOT-04).",
  LOCATION_HAS_CHILDREN: "Cet emplacement contient des sous-emplacements : supprimez-les d'abord.",
  LOCATION_IN_USE: "Cet emplacement a déjà contenu des cartes : il reste dans l'historique et ne peut pas être supprimé.",
};
const locationMessage = (e: unknown) => (e instanceof ApiError ? (LOCATION_ERRORS[e.code] ? t(LOCATION_ERRORS[e.code]!) : e.message) : (e as Error).message);

/** Emplacement enrichi de sa place dans l'arbre et des totaux de sa descendance. */
interface Node extends Location {
  depth: number;
  name: string;
  hasChildren: boolean;
  totalCards: number;
  totalPositions: number;
}

function buildTree(locations: Location[]): Node[] {
  return locations.map((l) => {
    const below = locations.filter((o) => o.code.startsWith(`${l.code}/`));
    return {
      ...l,
      depth: l.code.split("/").length - 1,
      name: l.code.split("/").at(-1)!,
      hasChildren: below.length > 0,
      totalCards: l.cards + below.reduce((n, o) => n + o.cards, 0),
      totalPositions: l.positions + below.reduce((n, o) => n + o.positions, 0),
    };
  });
}

type ModalState = { kind: "location"; parent?: string } | { kind: "describe"; location: Location } | { kind: "lot" } | null;

export default function StoragePage() {
  const [locations, setLocations] = useCachedState<Location[]>("locations");
  const [lots, setLots] = useCachedState<AcquisitionLot[]>("lots");
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [helpHidden, setHelpHidden, helpReady] = useStored("dexlane.locations.help-hidden", false);

  const load = useCallback(() => {
    Promise.all([api.locations(), api.lots()])
      .then(([l, a]) => {
        setLocations(l.locations);
        setLots(a.lots);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const tree = useMemo(() => buildTree(locations ?? []), [locations]);
  const visible = tree.filter((n) => ![...collapsed].some((code) => n.code.startsWith(`${code}/`)));
  const toggle = (code: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(code)) next.add(code);
      return next;
    });

  async function remove(l: Location) {
    try {
      await api.deleteLocation(l.id);
      toast.success(t("Emplacement {code} supprimé", { code: l.code }));
      load();
    } catch (e) {
      toast.error(locationMessage(e));
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title={t("Rangement")}
        description={t("Où sont les cartes, et d'où elles viennent.")}
        actions={helpReady && helpHidden && <Button variant="ghost" size="sm" onClick={() => setHelpHidden(false)}><CircleHelp /> {t("Aide")}</Button>}
      />
      {error && <Alert variant="destructive">{error}</Alert>}

      {helpReady && !helpHidden && (
        <Card className="relative border-primary/20 bg-brand-soft/50">
          <button type="button" onClick={() => setHelpHidden(true)} aria-label={t("Masquer l'aide")} className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
            <X className="size-4" aria-hidden />
          </button>
          <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="grid gap-3">
              <h2 className="pr-8 text-[15px] font-semibold tracking-tight">{t("Bien organiser ses emplacements")}</h2>
              <ol className="grid gap-2.5 text-sm">
                {[
                  [t("Un code = un endroit physique."), t("Écrivez-le sur une étiquette collée sur la boîte, la rangée ou la case. C'est ce code que l'application vous donnera pour retrouver une carte.")],
                  [t("Du plus grand au plus petit, séparés par « / »."), t("Boîte, puis rangée, puis case : BOX-03/ROW-12/SLOT-04. Jusqu'à 5 niveaux ; créez seulement ceux dont vous avez besoin.")],
                  [t("Numérotez sur deux chiffres."), t("01, 02… 10 : le tri reste naturel. « Créer une série » génère d'un coup les rangées d'une boîte.")],
                  [t("Ne réutilisez pas un code."), t("Un emplacement qui a contenu des cartes reste dans l'historique : il ne se supprime pas et ne doit pas désigner un autre endroit.")],
                ].map(([title, text], i) => (
                  <li key={title} className="flex gap-3">
                    <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden>{i + 1}</span>
                    <span><strong className="font-semibold">{title}</strong> <span className="text-muted-foreground">{text}</span></span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid content-start gap-1 rounded-lg border bg-card p-3 font-mono text-[13px]" aria-label={t("Exemple d'arborescence")}>
              <span className="font-sans text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("Exemple")}</span>
              <span>BOX-01 <span className="font-sans text-muted-foreground">· {t("cartes rares")}</span></span>
              <span className="pl-4 text-muted-foreground">└ ROW-01</span>
              <span className="pl-4 text-muted-foreground">└ ROW-02</span>
              <span>BOX-02 <span className="font-sans text-muted-foreground">· {t("vrac")}</span></span>
              <span>CLASSEUR-A</span>
              <span className="pl-4 text-muted-foreground">└ PAGE-01</span>
            </div>
          </div>
        </Card>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <div className="grid gap-1">
              <CardTitle>{t("Emplacements")}</CardTitle>
              <CardDescription>{t("Les totaux incluent les sous-emplacements.")}</CardDescription>
            </div>
            <Button size="sm" onClick={() => setModal({ kind: "location" })}><Plus /> {t("Nouvel emplacement")}</Button>
          </CardHeader>
          {!locations && !error && <div className="px-5 pb-5"><ListSkeleton count={3} label={t("Chargement des emplacements")} /></div>}
          {locations?.length === 0 && (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <EmptyState icon={<MapPin />} title={t("Aucun emplacement")} action={<Button size="sm" onClick={() => setModal({ kind: "location" })}>{t("Créer le premier")}</Button>}>
                {t("Commencez par une boîte, par exemple BOX-01, puis ajoutez-lui des rangées.")}
              </EmptyState>
            </div>
          )}
          {visible.length > 0 && (
            <ul className="divide-y border-t" aria-label={t("Emplacements")}>
              {visible.map((n) => {
                const isCollapsed = collapsed.has(n.code);
                return (
                  <li key={n.id} className="flex min-h-12 items-center gap-1 pr-2 pl-2 sm:pl-3" data-testid={`location-${n.code}`}>
                    <span className="flex shrink-0 items-center" style={{ paddingLeft: `${n.depth * 1.15}rem` }}>
                      {n.hasChildren ? (
                        <button type="button" onClick={() => toggle(n.code)} aria-expanded={!isCollapsed} aria-label={isCollapsed ? t("Déplier {code}", { code: n.code }) : t("Replier {code}", { code: n.code })} className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40">
                          <ChevronDown className={cn("size-4 transition-transform", isCollapsed && "-rotate-90")} aria-hidden />
                        </button>
                      ) : (
                        <span className="flex size-8 items-center justify-center text-muted-foreground/40" aria-hidden>{n.depth > 0 ? "└" : "·"}</span>
                      )}
                    </span>
                    <Link href={`/inventory?location=${encodeURIComponent(n.code)}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 pr-1 text-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/30" title={t("Voir le contenu de {code}", { code: n.code })}>
                      <span className="min-w-0 flex-1">
                        <Code className={cn("block truncate", n.depth === 0 && "font-semibold")}>{n.depth === 0 ? n.code : n.name}</Code>
                        {n.description && <span className="block truncate text-xs text-muted-foreground">{n.description}</span>}
                      </span>
                      <span className="hidden text-xs text-muted-foreground sm:block">{tn(n.totalPositions, "{n} position", "{n} positions")}</span>
                      <span className="tabular w-12 text-right font-semibold" title={t("Cartes")}>{n.totalCards}</span>
                    </Link>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger aria-label={t("Actions pour {code}", { code: n.code })} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-accent">
                        <Ellipsis className="size-4" aria-hidden />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-xl border bg-popover p-1 text-sm text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
                          {[
                            { icon: PackageSearch, label: t("Voir le contenu"), href: `/inventory?location=${encodeURIComponent(n.code)}` },
                            { icon: FolderPlus, label: t("Ajouter des sous-emplacements"), onSelect: () => setModal({ kind: "location", parent: n.code }), disabled: n.depth >= 4 },
                            { icon: Pencil, label: t("Modifier la description"), onSelect: () => setModal({ kind: "describe", location: n }) },
                          ].map((item) => (
                            <DropdownMenu.Item key={item.label} asChild={!!item.href} disabled={item.disabled} onSelect={item.onSelect} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent">
                              {item.href ? <Link href={item.href}><item.icon className="size-4 text-muted-foreground" aria-hidden /> {item.label}</Link> : <><item.icon className="size-4 text-muted-foreground" aria-hidden /> {item.label}</>}
                            </DropdownMenu.Item>
                          ))}
                          <DropdownMenu.Separator className="my-1 h-px bg-border" />
                          <DropdownMenu.Item
                            disabled={n.hasChildren || n.positions > 0}
                            onSelect={() => void remove(n)}
                            className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-destructive outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-destructive-soft"
                          >
                            <Trash2 className="size-4" aria-hidden /> {t("Supprimer")}
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <div className="grid gap-1">
              <CardTitle>{t("Lots d'acquisition")}</CardTitle>
              <CardDescription>{t("Provenance et coût d'achat des cartes.")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setModal({ kind: "lot" })}><Plus /> {t("Nouveau lot")}</Button>
          </CardHeader>
          {!lots && !error && <div className="px-5 pb-5"><ListSkeleton count={2} label={t("Chargement des lots")} /></div>}
          {lots?.length === 0 && (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <EmptyState icon={<ReceiptText />} title={t("Aucun lot")}>{t("Un lot relie des cartes à leur provenance et à leur coût d'achat.")}</EmptyState>
            </div>
          )}
          {lots && lots.length > 0 && (
            <div className="divide-y border-t">
              {lots.map((l) => (
                <div key={l.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.sourceType}{l.sellerRef ? ` · ${l.sellerRef}` : ""}</span>
                    <span className="block text-xs text-muted-foreground">{l.purchaseDate}{l.shippingCostCents ? ` · ${t("port {amount}", { amount: formatEuros(l.shippingCostCents) })}` : ""}</span>
                  </span>
                  <span className="tabular font-semibold">{formatEuros(l.totalCostCents)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {modal?.kind === "location" && <NewLocation parent={modal.parent} existing={locations ?? []} onClose={() => setModal(null)} onCreated={load} />}
      {modal?.kind === "describe" && <DescribeLocation location={modal.location} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === "lot" && <NewLot onClose={() => setModal(null)} onCreated={load} />}
    </div>
  );
}

const normalize = (code: string) => code.trim().toUpperCase().replace(/\s*\/\s*/g, "/");

function NewLocation({ parent, existing, onClose, onCreated }: { parent?: string; existing: Location[]; onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<"single" | "series">(parent ? "series" : "single");
  const [code, setCode] = useState(parent ? `${parent}/` : "");
  const [description, setDescription] = useState("");
  const [inside, setInside] = useState(parent ?? "");
  const [prefix, setPrefix] = useState(parent ? (parent.includes("/") ? "SLOT" : "ROW") : "BOX");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = Number(from);
  const last = Number(to);
  const validRange = Number.isInteger(first) && Number.isInteger(last) && first >= 0 && last >= first && last - first < 200;
  const width = Math.max(2, String(last).length);
  const codes = validRange && prefix.trim()
    ? Array.from({ length: last - first + 1 }, (_, i) => normalize(`${inside.trim() ? `${inside.trim()}/` : ""}${prefix.trim()}-${String(first + i).padStart(width, "0")}`))
    : [];
  const known = new Set(existing.map((l) => l.code));
  const fresh = codes.filter((c) => !known.has(c));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "single") {
        const created = await api.createLocation(code, description.trim() || undefined);
        toast.success(created.created ? t("Emplacement {code} créé", { code: created.code }) : t("L'emplacement {code} existait déjà", { code: created.code }));
      } else {
        const result = await api.createLocations(codes);
        toast.success(`${tn(result.created.length, "{n} emplacement créé", "{n} emplacements créés")}${result.existing.length ? `, ${tn(result.existing.length, "{n} déjà présent", "{n} déjà présents")}` : ""}`);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(locationMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Nouvel emplacement")} description={t("Les niveaux parents manquants sont créés automatiquement.")} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <SegmentedTabs label={t("Mode de création")} value={mode} onChange={setMode} tabs={[{ value: "single", label: t("Un emplacement") }, { value: "series", label: t("Créer une série") }]} />
        {mode === "single" ? (
          <>
            <Field label={t("Code")} hint={t("Exemple : BOX-03, ou BOX-03/ROW-12 pour une rangée de cette boîte.")}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BOX-03/ROW-12" autoCapitalize="characters" autoCorrect="off" required autoFocus className="font-mono" />
            </Field>
            <Field label={t("Description (facultatif)")}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder={t("Étagère du haut, cartes rares")} />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("Dans (facultatif)")} hint={t("L'emplacement parent, par exemple la boîte dont vous créez les rangées.")}>
              <Input value={inside} onChange={(e) => setInside(e.target.value)} placeholder="BOX-03" autoCapitalize="characters" autoCorrect="off" list="known-locations" className="font-mono" />
              <datalist id="known-locations">{existing.map((l) => <option key={l.id} value={l.code} />)}</datalist>
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-3">
              <Field label={t("Préfixe")}>
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="ROW" autoCapitalize="characters" autoCorrect="off" required className="font-mono" />
              </Field>
              <Field label={t("De")}>
                <Input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} required className="tabular" />
              </Field>
              <Field label={t("À")}>
                <Input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} required className="tabular" />
              </Field>
            </div>
            {codes.length > 0 ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" role="status">
                <span className="font-medium">{t("{n} à créer", { n: fresh.length })}</span>
                {codes.length !== fresh.length && <span className="text-muted-foreground"> · {tn(codes.length - fresh.length, "{n} déjà présent", "{n} déjà présents")}</span>}
                <span className="mt-1 block truncate text-muted-foreground"><Code>{codes[0]}</Code>{codes.length > 1 && <> … <Code>{codes.at(-1)}</Code></>}</span>
              </div>
            ) : (
              <Alert variant="warning">{t("Indiquez un préfixe et une plage valide (200 emplacements au plus).")}</Alert>
            )}
          </>
        )}
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" disabled={busy || (mode === "single" ? !code.trim() : fresh.length === 0)}>
          {mode === "single" ? t("Créer l'emplacement") : tn(fresh.length, "Créer {n} emplacement", "Créer {n} emplacements")}
        </Button>
      </form>
    </Modal>
  );
}

function DescribeLocation({ location, onClose, onSaved }: { location: Location; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(location.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.describeLocation(location.id, description.trim() || null);
      toast.success(t("Description enregistrée"));
      onSaved();
      onClose();
    } catch (err) {
      setError(locationMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Décrire {code}", { code: location.code })} description={t("Le code ne change pas : seule la description est modifiable.")} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label={t("Description")}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder={t("Étagère du haut, cartes rares")} autoFocus />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" disabled={busy}>{t("Enregistrer")}</Button>
      </form>
    </Modal>
  );
}

function NewLot({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [sourceType, setSourceType] = useState("");
  const [sellerRef, setSellerRef] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [total, setTotal] = useState("");
  const [shipping, setShipping] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyring = useRef(createKeyring());

  const totalCents = parseEuros(total);
  const shippingCents = parseEuros(shipping);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (totalCents === null || shippingCents === null) return;
    setBusy(true);
    setError(null);
    const payload = {
      sourceType: sourceType.trim(),
      sellerRef: sellerRef.trim() || undefined,
      purchaseDate,
      totalCostCents: totalCents,
      shippingCostCents: shippingCents || undefined,
    };
    try {
      await api.createLot(payload, keyring.current.keyFor(payload));
      toast.success(t("Lot d'acquisition enregistré"));
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Nouveau lot d'acquisition")} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label={t("Provenance")}>
          <Input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder={t("Collection personnelle, particulier…")} required maxLength={80} autoFocus />
        </Field>
        <Field label={t("Vendeur / référence")}>
          <Input value={sellerRef} onChange={(e) => setSellerRef(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Date d'achat")}>
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
          </Field>
          <Field label={t("Coût total (€)")}>
            <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={total !== "" && totalCents === null} required className="tabular" />
          </Field>
        </div>
        <Field label={t("Frais de port (€)")}>
          <Input inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} aria-invalid={shippingCents === null} className="tabular" />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" disabled={busy || !sourceType.trim() || totalCents === null || shippingCents === null}>{t("Enregistrer le lot")}</Button>
      </form>
    </Modal>
  );
}
