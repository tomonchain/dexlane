"use client";

import { MailCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Formulaire de désinscription de l'e-mail du récap (page publique, en français comme les autres écrans de compte). */
export function UnsubscribeForm() {
  const params = useSearchParams();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const link = { a: params.get("a") ?? "", u: params.get("u") ?? "", s: params.get("s") ?? "" };
  const valid = !!(link.a && link.u && link.s);

  async function confirm() {
    setState("busy");
    const res = await fetch("/email/unsubscribe/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(link) }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  }

  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Récap mensuel</h1>
      {state === "done" ? (
        <div className="grid justify-items-start gap-3" data-testid="unsubscribed">
          <MailCheck className="size-8 text-success" aria-hidden />
          <p className="text-[15px] leading-relaxed">C'est fait : tu ne recevras plus l'e-mail du récap. Tes récaps restent dans l'application, et tu peux réactiver l'e-mail dans Compte.</p>
        </div>
      ) : (
        <>
          <p className="text-[15px] leading-relaxed text-muted-foreground">Ne plus recevoir l'e-mail qui annonce ton récap, le 1er de chaque mois ?</p>
          {!valid && <Alert variant="destructive">Ce lien est incomplet. Ouvre-le à nouveau depuis l'e-mail, ou désactive l'e-mail dans Compte.</Alert>}
          {state === "error" && <Alert variant="destructive">Ce lien n'est pas valable. Désactive l'e-mail dans Compte, une fois connecté.</Alert>}
          <Button onClick={() => void confirm()} disabled={!valid || state === "busy"} className="justify-self-start">Me désinscrire</Button>
        </>
      )}
    </div>
  );
}
