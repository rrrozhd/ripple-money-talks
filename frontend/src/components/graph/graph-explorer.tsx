"use client";

import { ArrowRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGraph } from "@/lib/api";
import { RELATIONS, type Edge, type Graph, type Relation, type Sector, type Ticker } from "@/lib/types";
import { FilingLink, Quote, RELATION_COLOR, RelationBadge, SECTOR_COLOR, SECTOR_LABEL, SECTOR_SHORT, Ticker as TickerChip, fmtUsd } from "../ui";
import { GraphCanvas, type Selection } from "./graph-canvas";
import { layout } from "./layout";

const SECTORS: Sector[] = ["semis", "equipment", "hardware", "external"];

/** Display label for a node id (outside companies use ids like "x:tsmc"). */
const labelOf = (graph: Graph, t: Ticker) => {
  const c = graph.companies.find((x) => x.ticker === t);
  return c?.label ?? c?.ticker ?? t;
};

function EdgeEvidence({ edge, graph, perspective }: { edge: Edge; graph: Graph; perspective?: Ticker }) {
  const name = (t: Ticker) => graph.companies.find((c) => c.ticker === t)?.name ?? t;
  const other = perspective === edge.to ? edge.from : edge.to;
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <TickerChip>{labelOf(graph, edge.from)}</TickerChip>
        <span className="text-faint">names</span>
        <TickerChip>{labelOf(graph, edge.to)}</TickerChip>
        <span className="text-faint">as</span>
        <RelationBadge relation={edge.relation} />
        {perspective && perspective === edge.to && <span className="ml-auto text-[11px] text-faint">from {name(other)}&apos;s filing</span>}
      </div>
      <Quote text={edge.quote} terms={[edge.mention, ...(edge.quote.match(/\d+(\.\d+)?%/g) ?? [])]} className="mt-2.5 text-[14px]" />
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <FilingLink filing={edge.filing} />
        {edge.revenueShare !== undefined && (
          <span className="font-mono text-[11px] text-muted">{Math.round(edge.revenueShare * 100)}% of revenue</span>
        )}
      </div>
    </div>
  );
}

function NodeDetail({ graph, id, edges }: { graph: Graph; id: Ticker; edges: Edge[] }) {
  const c = graph.companies.find((x) => x.ticker === id)!;
  const stats = graph.stats.find((s) => s.ticker === id);
  const related = edges.filter((e) => e.from === id || e.to === id);
  const byRelation = RELATIONS.map((r) => {
    // From this company's perspective: its own links plus inverse links from others' filings.
    const inv: Record<Relation, Relation> = { supplier: "customer", customer: "supplier", competitor: "competitor", partner: "partner" };
    return {
      r,
      items: related.filter((e) => (e.from === id && e.relation === r) || (e.to === id && e.relation === inv[r])),
    };
  }).filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SECTOR_COLOR[c.sector] }} />
          <span className="text-xs text-muted">{SECTOR_LABEL[c.sector]}</span>
        </div>
        <h2 className="mt-1 font-serif text-2xl text-ink">{c.name}</h2>
        <p className="font-mono text-xs text-muted">
          {c.label ?? c.ticker}
          {c.revenueUsd ? ` · revenue ${fmtUsd(c.revenueUsd)}` : ""}
        </p>
      </div>

      {stats ? (
        <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface">
          {[
            ["Beta", stats.beta.toFixed(2), `to ${SECTOR_LABEL[stats.sector].toLowerCase()}`],
            ["Correlation", stats.correlation.toFixed(2), "to own sector"],
            ...(stats.followsSector && stats.followsCorrelation !== undefined
              ? [["Follows", SECTOR_SHORT[stats.followsSector], `ρ ${stats.followsCorrelation.toFixed(2)}`]]
              : [["Sector", SECTOR_SHORT[stats.sector], "from 1y of prices"]]),
          ].map(([k, v, sub]) => (
            <div key={k} className="p-3">
              <dt className="text-[11px] text-faint">{k}</dt>
              <dd className="mt-0.5 font-mono text-[15px] leading-5 text-ink">{v}</dd>
              <dd className="text-[11px] text-muted">{sub}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong p-3 text-xs text-muted">
          Outside the 15 covered filers. Its links come only from other companies&apos; 10-Ks; no price stats.
        </p>
      )}

      {stats?.followsSector && stats.followsCorrelation !== undefined && stats.followsSector !== stats.sector && (
        <p className="text-xs leading-5 text-muted">
          Note: {c.name} trades more like <strong className="text-ink">{SECTOR_LABEL[stats.followsSector].toLowerCase()}</strong> (ρ {stats.followsCorrelation.toFixed(2)}) than its own sector (ρ {stats.correlation.toFixed(2)}).
        </p>
      )}

      {c.sector !== "external" && (
        <Link
          href={`/?q=${encodeURIComponent(`Who are ${c.name}'s suppliers and customers?`)}`}
          className="flex items-center justify-between rounded-lg bg-ink px-3 py-2.5 text-sm text-bg hover:opacity-90"
        >
          Ask Ripple about {c.name}
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      {byRelation.map(({ r, items }) => (
        <section key={r}>
          <h3 className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wider text-faint uppercase">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: RELATION_COLOR[r] }} />
            {r}s · {items.length}
          </h3>
          <div className="space-y-2">
            {items.map((e) => (
              <EdgeEvidence key={e.id} edge={e} graph={graph} perspective={id} />
            ))}
          </div>
        </section>
      ))}
      {byRelation.length === 0 && <p className="text-sm text-muted">No links under the current filters.</p>}
    </div>
  );
}

export function GraphExplorer() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relations, setRelations] = useState<Set<Relation>>(new Set(RELATIONS));
  const [showExternal, setShowExternal] = useState(true);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    getGraph().then(setGraph, (e: Error) => setError(e.message));
  }, []);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Ignore small jitters so dragged positions survive minor resizes.
      setSize((s) => (s && Math.abs(s.w - width) < 40 && Math.abs(s.h - height) < 40 ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [graph]);

  const positions = useMemo(() => (graph && size ? layout(graph.companies, graph.edges, size.w, size.h) : null), [graph, size]);

  const visibleNodes = useMemo(() => {
    if (!positions) return new Map();
    return new Map([...positions].filter(([, n]) => showExternal || n.company.sector !== "external"));
  }, [positions, showExternal]);

  const visibleEdges = useMemo(
    () => (graph?.edges ?? []).filter((e) => relations.has(e.relation) && visibleNodes.has(e.from) && visibleNodes.has(e.to)),
    [graph, relations, visibleNodes],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !graph) return [];
    return graph.companies.filter((c) => c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, graph]);

  if (error) return <p className="p-6 text-sm text-danger">Could not load graph: {error}</p>;
  if (!graph) return <div className="m-6 flex-1 animate-pulse rounded-xl bg-surface-2" />;

  const counts = Object.fromEntries(RELATIONS.map((r) => [r, graph.edges.filter((e) => e.relation === r).length])) as Record<Relation, number>;
  const selectedEdge = selection?.kind === "edge" ? graph.edges.find((e) => e.id === selection.id) : undefined;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] flex-1 gap-4 p-4 sm:p-6 lg:h-[calc(100vh-3.5rem)] lg:min-h-0 lg:flex-none lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[200px_minmax(0,1fr)_340px] xl:grid-cols-[220px_minmax(0,1fr)_380px]">
      {/* Filters */}
      <aside className="space-y-6 lg:overflow-y-auto">
        <div>
          <h1 className="font-serif text-2xl text-ink">Relationship graph</h1>
          <p className="mt-1 text-xs leading-5 text-muted">
            {graph.edges.length} links from {graph.companies.filter((c) => c.sector !== "external").length} filers&apos; latest 10-Ks. Every edge is a sentence.
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a company"
            aria-label="Find a company"
            className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-8 text-sm outline-none placeholder:text-faint focus:border-accent"
          />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
              {matches.map((c) => (
                <li key={c.ticker}>
                  <button
                    onClick={() => {
                      setSelection({ kind: "node", id: c.ticker });
                      setQuery("");
                      if (c.sector === "external") setShowExternal(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="w-16 font-mono text-xs text-muted">{c.label ?? c.ticker}</span>
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset>
          <legend className="mb-2 text-[11px] font-medium tracking-wider text-faint uppercase">Relations</legend>
          <div className="space-y-1">
            {RELATIONS.map((r) => {
              const on = relations.has(r);
              return (
                <label key={r} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = new Set(relations);
                      if (on) next.delete(r);
                      else next.add(r);
                      setRelations(next);
                    }}
                    className="sr-only"
                  />
                  <svg width="22" height="8" aria-hidden="true" opacity={on ? 1 : 0.3}>
                    <line x1="0" y1="4" x2="22" y2="4" stroke={RELATION_COLOR[r]} strokeWidth="2" strokeDasharray={r === "competitor" ? "4 3" : undefined} />
                  </svg>
                  <span className={`capitalize ${on ? "text-ink" : "text-faint line-through"}`}>{r}</span>
                  <span className="ml-auto font-mono text-xs text-faint">{counts[r]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[11px] font-medium tracking-wider text-faint uppercase">Sectors</legend>
          <ul className="space-y-1.5 px-2 text-sm">
            {SECTORS.map((s) => (
              <li key={s} className="flex items-center gap-2.5">
                <span
                  className="h-3 w-3 rounded-full border-2"
                  style={{ borderColor: SECTOR_COLOR[s], borderStyle: s === "external" ? "dashed" : "solid" }}
                />
                <span className="text-muted">{SECTOR_LABEL[s]}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2 px-2 text-sm text-muted">
            <input type="checkbox" checked={showExternal} onChange={(e) => setShowExternal(e.target.checked)} className="accent-[var(--accent)]" />
            Show non-covered companies
          </label>
        </fieldset>
        <p className="px-2 text-[11px] leading-4 text-faint">
          {graph.companies.some((c) => c.revenueUsd) ? "Node size ∝ √revenue. " : ""}
          {graph.asOf === "live" ? "Live from the Ripple graph database." : `As of ${graph.asOf}.`}
        </p>
      </aside>

      {/* Canvas */}
      <div ref={canvasRef} className="h-[520px] min-h-0 lg:h-auto">
        {positions ? (
          <GraphCanvas nodes={visibleNodes} edges={visibleEdges} selection={selection} onSelect={setSelection} />
        ) : (
          <div className="h-full animate-pulse rounded-xl bg-surface-2" />
        )}
      </div>

      {/* Detail */}
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-line bg-bg p-4 lg:pr-3">
        {selection && (
          <button
            onClick={() => setSelection(null)}
            className="float-right -mt-1 -mr-1 rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-ink"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {selection?.kind === "node" ? (
          <NodeDetail graph={graph} id={selection.id} edges={visibleEdges} />
        ) : selectedEdge ? (
          <div className="space-y-4">
            <p className="text-[11px] font-medium tracking-wider text-faint uppercase">Link</p>
            <EdgeEvidence edge={selectedEdge} graph={graph} />
            <div className="flex gap-2">
              {[selectedEdge.from, selectedEdge.to].map((t) => (
                <button key={t} onClick={() => setSelection({ kind: "node", id: t })} className="rounded-md border border-line px-2.5 py-1 font-mono text-xs hover:bg-surface-2">
                  Open {labelOf(graph, t)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm leading-6 text-muted">
            <p className="font-serif text-lg text-ink">Pick a company or a link.</p>
            <p className="mt-2">Each arrow is a relationship one company states in its own 10-K. Click it to read the exact sentence and open the filing on SEC EDGAR.</p>
            <ul className="mt-4 space-y-2">
              {["NVDA", "TSM", "x:tsmc", "AAPL", "ENTG"]
                .filter((t) => graph.companies.some((c) => c.ticker === t))
                .slice(0, 4)
                .map((t) => (
                <li key={t}>
                  <button onClick={() => setSelection({ kind: "node", id: t })} className="flex items-center gap-2 hover:text-ink">
                    <TickerChip sector={graph.companies.find((c) => c.ticker === t)?.sector}>{labelOf(graph, t)}</TickerChip>
                    {graph.companies.find((c) => c.ticker === t)?.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
