"use client";

import { BadgeCheck } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Claim, Memo } from "@/lib/types";
import { FilingLink, Quote, RelationBadge, Ticker, fmtUsd } from "../ui";

type CiteProps = { n: number; id: string; active: boolean; onHover: (id: string | null) => void };

function Cite({ n, id, active, onHover }: CiteProps) {
  return (
    <a
      href={`#claim-${id}`}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(id)}
      onBlur={() => onHover(null)}
      className={`mx-px inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded px-1 align-middle font-mono text-[10px] font-medium no-underline transition-colors ${
        active ? "bg-accent text-bg" : "bg-accent-soft text-accent hover:bg-accent hover:text-bg"
      }`}
    >
      {n}
    </a>
  );
}

/** Renders **bold** and [c1] citation markers. */
function Prose({ text, number, active, onHover }: { text: string; number: Map<string, number>; active: string | null; onHover: (id: string | null) => void }) {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(c\d+)\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} className="font-semibold">{m[1]}</strong>);
    else if (m[2] && number.has(m[2]))
      out.push(<Cite key={m.index} n={number.get(m[2])!} id={m[2]} active={active === m[2]} onHover={onHover} />);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function ClaimCard({ claim, n, active }: { claim: Claim; n: number; active: boolean }) {
  return (
    <li
      id={`claim-${claim.id}`}
      className={`scroll-mt-24 rounded-lg border bg-surface p-4 transition-colors ${active ? "border-accent ring-2 ring-accent/20" : "border-line"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-5 min-w-5 items-center justify-center rounded bg-accent-soft px-1 font-mono text-[11px] font-medium text-accent">{n}</span>
        <Ticker>{claim.company}</Ticker>
        {claim.relation && <RelationBadge relation={claim.relation} />}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-accent">
          <BadgeCheck className="h-3.5 w-3.5" /> Verbatim match
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{claim.text}</p>
      <Quote text={claim.quote} terms={[claim.mention, ...(claim.numbers ?? [])]} className="mt-3 border-l-2 border-line-strong pl-3" />
      <div className="mt-3">
        <FilingLink filing={claim.filing} />
      </div>
    </li>
  );
}

export function MemoView({ memo, elapsedMs }: { memo: Memo; elapsedMs?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const number = useMemo(() => new Map(memo.claims.map((c, i) => [c.id, i + 1])), [memo.claims]);
  const filers = new Set(memo.claims.map((c) => c.filing.filer)).size;

  return (
    <article className="fade-up">
      <header className="border-b border-line pb-5">
        <p className="text-[11px] font-medium tracking-wider text-faint uppercase">Research memo</p>
        <h1 className="mt-2 font-serif text-3xl leading-tight tracking-tight text-balance text-ink sm:text-[34px]">{memo.headline}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1 text-accent">
            <BadgeCheck className="h-3.5 w-3.5" />
            {memo.claims.length} of {memo.claims.length} claims backed by an exact filing quote
          </span>
          <span>{filers} filing{filers === 1 ? "" : "s"} cited</span>
          {elapsedMs !== undefined && <span>{(elapsedMs / 1000).toFixed(1)}s</span>}
        </div>
      </header>

      <div className="mt-6 space-y-7">
        {memo.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="font-serif text-xl text-ink">{s.heading}</h2>
            <div className="mt-2 space-y-3 text-[15px] leading-7 text-ink/90">
              {s.paragraphs.map((p, i) => (
                <p key={i}>
                  <Prose text={p} number={number} active={active} onHover={setActive} />
                </p>
              ))}
            </div>
          </section>
        ))}

        {memo.exposure && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-[11px] tracking-wider text-muted uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Disclosed share</th>
                  <th className="px-3 py-2 text-right font-medium">Cut</th>
                  <th className="px-3 py-2 text-right font-medium">At risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-surface font-mono text-[13px]">
                {memo.exposure.map((x) => (
                  <tr key={x.supplier}>
                    <td className="px-3 py-2.5">
                      <Ticker>{x.supplier}</Ticker>
                      <Cite n={number.get(x.claimId)!} id={x.claimId} active={active === x.claimId} onHover={setActive} />
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmtUsd(x.revenueUsd)}</td>
                    <td className="px-3 py-2.5 text-right">{Math.round(x.revenueShare * 100)}%</td>
                    <td className="px-3 py-2.5 text-right">{x.dropPct}%</td>
                    <td className="px-3 py-2.5 text-right font-medium text-ink">{fmtUsd(x.atRiskUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {memo.claims.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[11px] font-medium tracking-wider text-faint uppercase">Evidence</h2>
          <ol className="mt-3 space-y-3">
            {memo.claims.map((c) => (
              <ClaimCard key={c.id} claim={c} n={number.get(c.id)!} active={active === c.id} />
            ))}
          </ol>
        </section>
      )}

      <footer className="mt-8 border-t border-line pt-4 text-xs leading-5 text-faint">
        {memo.caveats.map((c) => (
          <p key={c}>{c}</p>
        ))}
      </footer>
    </article>
  );
}

export function MemoSkeleton() {
  return (
    <div className="animate-pulse" aria-label="Drafting memo">
      <div className="h-3 w-24 rounded bg-surface-2" />
      <div className="mt-3 h-8 w-4/5 rounded bg-surface-2" />
      <div className="mt-2 h-8 w-2/5 rounded bg-surface-2" />
      <div className="mt-8 space-y-2.5">
        {[100, 92, 96, 70].map((w, i) => (
          <div key={i} className="h-3.5 rounded bg-surface-2" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="mt-8 h-28 rounded-lg bg-surface-2" />
      <div className="mt-3 h-28 rounded-lg bg-surface-2" />
    </div>
  );
}
