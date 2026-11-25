"use client";

import { Bot, Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { BackLink, Code, Loading, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { AgentToken } from "@/lib/types";

/** Ce que les agents peuvent faire, en clair (le détail est servi par le serveur MCP lui-même). */
const CAPABILITIES = [
  "Lire le stock, les ventes, les statistiques, les variations de cote, le planning des mises en ligne et les fournitures",
  "Fixer un prix, planifier des mises en ligne, enregistrer une vente directe, suivre une carte à acheter",
  "Noter une commande de fournitures, sa réception, un inventaire, et régler les seuils",
  "Rien n'est supprimé ni annulé par un agent : ces gestes restent dans l'application",
];

function CopyField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] leading-none font-medium text-foreground/80">{label}</span>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-[13px]" onFocus={(e) => e.target.select()} data-testid={testId} />
        <Button type="button" variant="outline" size="icon" aria-label={t("Copier")} onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
      </div>
    </div>
  );
}

/** Réglages › Agents : jetons d'accès au serveur MCP, pour laisser des agents gérer la boutique. */
export default function AgentsPage() {
  const [tokens, setTokens] = useState<AgentToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [origin, setOrigin] = useState("");

  const load = () => api.agentTokens().then((r) => setTokens(r.tokens)).catch((e: Error) => setError(e.message));
  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, []);
  const endpoint = `${origin}/mcp`;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    try {
      const created = await api.createAgentToken(name.trim());
      setFresh({ name: created.name, token: created.token });
      setName("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(token: AgentToken) {
    if (!window.confirm(t("Révoquer l'accès de « {name} » ? L'agent ne pourra plus rien lire ni faire.", { name: token.name }))) return;
    setBusy(token.id);
    try {
      await api.revokeAgentToken(token.id);
      toast.success(t("Accès révoqué"));
      if (fresh && token.prefix === fresh.token.slice(0, 10)) setFresh(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const config = fresh && JSON.stringify({ mcpServers: { dexlane: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${fresh.token}` } } } }, null, 2);

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/settings">Réglages</BackLink>}
        title={t("Agents")}
        description={t("Branchez vos agents sur Dexlane par le serveur MCP : ils lisent la boutique et agissent avec les mêmes règles que l'application, chaque action étant enregistrée à leur nom.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        <CardContent className="grid gap-3">
          <CardTitle>{t("Serveur MCP")}</CardTitle>
          <CardDescription>{t("À donner à votre outil d'agents (transport HTTP, « Streamable HTTP »), avec un jeton en en-tête Authorization.")}</CardDescription>
          {origin && <CopyField label={t("Adresse")} value={endpoint} testId="mcp-endpoint" />}
          <ul className="grid gap-1.5 text-sm text-muted-foreground">
            {CAPABILITIES.map((c) => <li key={c} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{t(c)}</li>)}
          </ul>
        </CardContent>
      </Card>

      {fresh && (
        <Card className="border-brand/40 bg-brand-soft/30" data-testid="agent-token-created">
          <CardContent className="grid gap-3">
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-brand" aria-hidden /> {t("Jeton de « {name} »", { name: fresh.name })}</CardTitle>
            <Alert variant="warning">{t("Copiez-le maintenant : il ne sera plus affiché. En cas de perte, révoquez-le et créez-en un autre.")}</Alert>
            <CopyField label={t("Jeton")} value={fresh.token} testId="agent-token-value" />
            <div className="grid gap-1.5">
              <span className="text-[13px] leading-none font-medium text-foreground/80">{t("Configuration type")}</span>
              <pre className="rounded-lg border bg-card p-3 text-[12px] leading-relaxed break-all whitespace-pre-wrap"><code>{config}</code></pre>
            </div>
            <Button variant="ghost" className="justify-self-start" onClick={() => setFresh(null)}><Check /> {t("C'est noté")}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-4">
          <CardTitle>{t("Jetons d'accès")}</CardTitle>
          <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
            <Field label={t("Nom de l'agent")} className="min-w-48 flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("Ex. Agent de réassort")} data-testid="agent-name" />
            </Field>
            <Button type="submit" disabled={!name.trim() || busy === "create"}>{busy === "create" ? <Spinner /> : <Plus />} {t("Créer un jeton")}</Button>
          </form>
          {!tokens ? !error && <Loading /> : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Aucun agent n'a accès pour l'instant.")}</p>
          ) : (
            <ul className="divide-y rounded-lg border" data-testid="agent-tokens">
              {tokens.map((token) => (
                <li key={token.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-medium">{token.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      <Code>{token.prefix}…</Code> · {token.lastUsedAt ? t("utilisé le {date}", { date: formatDateTime(token.lastUsedAt) }) : t("jamais utilisé")}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" disabled={busy === token.id} onClick={() => revoke(token)} aria-label={t("Révoquer {name}", { name: token.name })}>
                    {busy === token.id ? <Spinner /> : <Trash2 />} <span className="max-sm:sr-only">{t("Révoquer")}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
