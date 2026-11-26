import { Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DocBlock } from "./content";

/** Texte en ligne : `**gras**`, `` `code` `` et `[lien](adresse)` ; une adresse qui commence par http s'ouvre à part. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-medium text-foreground">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="rounded-[5px] bg-muted box-decoration-clone px-1.5 py-0.5 font-mono text-[0.86em] text-foreground ring-1 ring-border/70">{part.slice(1, -1)}</code>;
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link) {
          const [, label, href] = link;
          const classes = "font-medium text-foreground underline decoration-foreground/30 underline-offset-4 outline-none hover:decoration-foreground focus-visible:decoration-foreground";
          return href!.startsWith("http")
            ? <a key={i} href={href} target="_blank" rel="noreferrer" className={classes}>{label}</a>
            : <Link key={i} href={href!} className={classes}>{label}</Link>;
        }
        return part;
      })}
    </>
  );
}

const TEXT = "text-[15px] leading-[1.75] text-muted-foreground";

function Block({ block }: { block: DocBlock }): ReactNode {
  if ("p" in block) return <p className={TEXT}><Inline text={block.p} /></p>;
  if ("list" in block) {
    return (
      <ul className={cn(TEXT, "grid gap-2")}>
        {block.list.map((item) => (
          <li key={item} className="relative pl-5">
            <span aria-hidden className="absolute top-[0.7em] left-0.5 size-1.5 rounded-full bg-foreground/25" />
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if ("steps" in block) {
    return (
      <ol className={cn(TEXT, "grid gap-3")}>
        {block.steps.map((step, i) => (
          <li key={step} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
            <span className="tabular mt-0.5 flex size-6 items-center justify-center rounded-full bg-card font-mono text-[11px] text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.08)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.12)]">{i + 1}</span>
            <span><Inline text={step} /></span>
          </li>
        ))}
      </ol>
    );
  }
  if ("code" in block) {
    return (
      <figure className="overflow-hidden rounded-xl bg-[oklch(0.2_0.008_60)] text-[oklch(0.94_0.004_85)] ring-1 ring-black/5 dark:ring-white/10">
        {block.label && <figcaption className="border-b border-white/10 px-4 py-2 font-mono text-[11px] text-white/55">{block.label}</figcaption>}
        <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-relaxed"><code>{block.code}</code></pre>
      </figure>
    );
  }
  if ("note" in block) {
    const Icon = block.tone === "warning" ? TriangleAlert : Info;
    return (
      <aside className="flex gap-3 rounded-xl bg-muted px-4 py-3.5 text-[14px] leading-relaxed text-muted-foreground ring-1 ring-border/60">
        <Icon className="mt-0.5 size-4 shrink-0 text-foreground/70" aria-hidden />
        <p><Inline text={block.note} /></p>
      </aside>
    );
  }
  if ("table" in block) {
    return (
      <div className="overflow-x-auto rounded-xl ring-1 ring-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-[13px] text-muted-foreground">
            <tr>{block.table.head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {block.table.rows.map((row) => (
              <tr key={row.join("|")} className="border-t align-top">
                {/* Seule la dernière colonne (la plus longue) revient à la ligne. */}
                {row.map((cell, i) => (
                  <td key={i} className={cn("px-4 py-2.5", i === 0 ? "font-medium" : "text-muted-foreground", i < row.length - 1 && row.length > 2 && "whitespace-nowrap")}>
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="grid border-t">
      {block.faq.map((item) => (
        <details key={item.q} className="group border-b [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-[16px] font-medium tracking-[-0.01em] outline-none focus-visible:underline">
            {item.q}
            <span aria-hidden className="relative size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45">
              <span className="absolute top-1/2 left-0 h-px w-3.5 -translate-y-1/2 bg-current" />
              <span className="absolute top-0 left-1/2 h-3.5 w-px -translate-x-1/2 bg-current" />
            </span>
          </summary>
          <p className={cn(TEXT, "pb-5")}><Inline text={item.a} /></p>
        </details>
      ))}
    </div>
  );
}

export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return <div className="grid gap-5">{blocks.map((block, i) => <Block key={i} block={block} />)}</div>;
}
