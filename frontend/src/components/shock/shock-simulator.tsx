"use client";

import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { getShockBuyers, runShock } from "@/lib/api";
import type { ShockBuyer, ShockResult, ShockSupplier } from "@/lib/types";
import { FilingLink, Quote, SECTOR_COLOR, SECTOR_SHORT, Ticker, fmtUsd } from "../ui";

const label = (id: string, name: string) => (id.startsWith("x:") ? name : id);

function Share({ s }: { s: ShockSupplier }) {
  if (s.revenue_share === null) return <span className="text-muted">Not disclosed</span>;
  const pct = `${Math.round(s.revenue_share * 100)}%`;
  return (
    <>
      <span className="font-mono font-semibold text-ink">{s.share_kind === "lower_bound" ? `≥ ${pct}` : pct}</span>
      <p className="mt-0.5 text-[11px] text-faint">{s.share_kind === "lower_bound" ? "filing says “10% or more”" : "exact, from filing"}</p>
    </>
  );
}

function Row({ s, max, open, onToggle }: { s: ShockSupplier; max: number; open: boolean; onToggle: () => void }) {
  const w = s.revenue_at_risk_usd && max ? Math.max(4, (s.revenue_at_risk_usd / max) * 100) : 0;
  return (
    <>
      <tr className="cursor-pointer align-top hover:bg-surface-2/50" onClick={onToggle}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform ${open ? "" : "-rotate-90"}`} />
            <Ticker sector={s.sector ?? "external"}>{label(s.supplier, s.name)}</Ticker>
            {!s.supplier.startsWith("x:") && <span className="text-sm text-ink">{s.name}</span>}
          </div>
          <p className="mt-1 pl-5.5 text-[11px] text-faint">stated in {s.stated_by}&apos;s 10-K</p>
        </td>
        <td className="px-4 py-3 text-sm">
          <Share s={s} />
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm text-muted">{s.supplier_revenue_usd ? fmtUsd(s.supplier_revenue_usd) : "—"}</td>
        <td className="px-4 py-3">
          {s.revenue_at_risk_usd === null ? (
            <span className="text-sm text-muted">Not quantified</span>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-2 w-28 rounded-full bg-surface-2">
                <div className="h-2 rounded-full" style={{ width: `${w}%`, background: "var(--rel-competitor)" }} />
              </div>
              <span className="font-mono text-[13px] font-semibold text-ink">{fmtUsd(s.revenue_at_risk_usd)}</span>
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-sm">
          {s.beta === null ? (
            <span className="text-muted">No price data</span>
          ) : (
            <span className="font-mono text-[12px] text-muted">
              β {s.beta} · ρ {s.corr}
              {s.sector && (
                <span className="ml-1.5 inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: SECTOR_COLOR[s.sector] }} />
                  {SECTOR_SHORT[s.sector]}
                </span>
              )}
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-surface-2/40 px-4 pt-1 pb-4">
            <Quote text={s.quote} terms={[s.revenue_share !== null ? `${Math.round(s.revenue_share * 100)}%` : undefined]} className="border-l-2 border-line-strong pl-3 text-[14px]" />
            <div className="mt-2">
              <FilingLink filing={{ filer: "", form: "10-K", url: s.source_link }} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ShockSimulator() {
  const [buyers, setBuyers] = useState<ShockBuyer[]>([]);
  const [company, setCompany] = useState("x:tsmc");
  const [drop, setDrop] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShockResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    getShockBuyers().then(setBuyers, (e: Error) => setError(e.message));
  }, []);

  // Recompute whenever the company or the cut changes; the API is fast, so a short debounce is enough.
  useEffect(() => {
    const id = setTimeout(async () => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      try {
        setResult(await runShock(company, drop, c.signal));
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (ctrl.current === c) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [company, drop]);

  const max = Math.max(0, ...(result?.suppliers ?? []).map((s) => s.revenue_at_risk_usd ?? 0));

  return (
    <div className="mx-auto grid w-full max-w-[1600px] flex-1 gap-8 px-4 py-10 sm:px-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:px-12 xl:px-16">
      <aside className="space-y-5">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Demand shock</p>
          <h1 className="mt-2 font-serif text-4xl leading-tight tracking-tight text-ink">Who feels it upstream?</h1>
          <p className="mt-3 text-[15px] leading-6 text-muted">
            Cut a company&apos;s purchases and see which suppliers lose revenue. Dollars are computed only where a supplier&apos;s own 10-K
            discloses how much of its revenue comes from this customer.
          </p>
        </div>

        <div className="space-y-5 rounded-2xl border border-line bg-surface/50 p-5 backdrop-blur-md">
          <div>
            <p className="text-xs font-semibold tracking-wider text-muted uppercase">Buyer</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {buyers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setCompany(b.id)}
                  title={`${b.name}: ${b.suppliers} supplier${b.suppliers === 1 ? "" : "s"} in the graph`}
                  className={`rounded-md border px-2 py-1 text-xs font-medium ${
                    company === b.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {b.name}
                  <span className="ml-1 font-mono text-[10px] text-faint">{b.suppliers}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="drop" className="text-xs font-semibold tracking-wider text-muted uppercase">
                Purchase cut
              </label>
              <span className="font-serif text-2xl text-ink">−{drop}%</span>
            </div>
            <input
              id="drop"
              type="range"
              min={5}
              max={60}
              step={5}
              value={drop}
              onChange={(e) => setDrop(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between font-mono text-[10px] text-faint">
              <span>−5%</span>
              <span>−60%</span>
            </div>
          </div>
        </div>

        <p className="text-xs leading-5 text-faint">
          Revenue at risk = supplier revenue (SEC XBRL) × disclosed share from this customer × cut. “≥ 10%” shares are lower bounds,
          so those dollars are too. β / ρ are each supplier&apos;s link to its own sector from a year of daily prices. Illustrative, not a forecast.
        </p>
      </aside>

      <section className="min-w-0 space-y-5">
        {error && (
          <div className="flex gap-2 rounded-xl border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [fmtUsd(result.total_at_risk_usd), `quantified revenue at risk if ${result.name} cuts ${result.drop_pct}%`],
                [String(result.suppliers.length), "suppliers in the verified graph"],
                [`${result.quantified}/${result.suppliers.length}`, "with a disclosed revenue share"],
              ].map(([v, l]) => (
                <div key={l} className="rounded-xl border border-line bg-surface/50 p-4 backdrop-blur-sm">
                  <p className="flex items-center gap-2 font-serif text-3xl leading-none text-ink">
                    {v}
                    {loading && <Loader2 className="h-4 w-4 animate-spin text-faint" />}
                  </p>
                  <p className="mt-2 text-xs font-medium text-muted">{l}</p>
                </div>
              ))}
            </div>

            {result.suppliers.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface/50 p-5 text-sm text-muted backdrop-blur-sm">
                No suppliers of <strong className="text-ink">{result.name}</strong> in the verified graph.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface/70 backdrop-blur-md">
                <table className="w-full min-w-[820px]">
                  <thead className="border-b border-line text-left text-[11px] tracking-wider text-muted uppercase">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Supplier</th>
                      <th className="px-4 py-2.5 font-semibold">Share from {label(result.company, result.name)}</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Supplier revenue</th>
                      <th className="px-4 py-2.5 font-semibold">Revenue at risk</th>
                      <th className="px-4 py-2.5 font-semibold">Stock vs sector</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.suppliers.map((s) => (
                      <Fragment key={s.supplier}>
                        <Row s={s} max={max} open={open === s.supplier} onToggle={() => setOpen(open === s.supplier ? null : s.supplier)} />
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-4 py-2.5 text-[11px] text-faint">Click a row to read the filing sentence behind it.</p>
              </div>
            )}
          </div>
        )}

        {!result && !error && (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/40 text-sm text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
      </section>
    </div>
  );
}
