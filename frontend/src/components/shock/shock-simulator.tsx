"use client";

import { AlertTriangle, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { BACKEND_URL, demandShock } from "@/lib/api";
import type { ShockImpact, ShockResponse } from "@/lib/types";
import { Ticker } from "../ui";

const QUICK = ["NVDA", "TSM", "AMD", "INTC"];

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) < 1 ? 2 : 1)}%`;

function ImpactBar({ value, max }: { value: number; max: number }) {
  const w = max ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-surface-2">
        <div
          className="h-2 rounded-full"
          style={{ width: `${w}%`, background: value < 0 ? "var(--rel-competitor)" : "var(--accent)" }}
        />
      </div>
      <span className="font-mono text-[13px] font-semibold text-ink">{pct(value)}</span>
    </div>
  );
}

function Row({ r, max }: { r: ShockImpact; max: number }) {
  const m = r.market_cross_check;
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Ticker>{r.supplier}</Ticker>
          <ArrowRight className="h-3 w-3 text-faint" />
          <Ticker>{r.sells_to}</Ticker>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          {r.hops === 1 ? "Direct supplier" : `${r.hops} hops upstream`}
        </p>
      </td>
      <td className="px-4 py-3">
        {r.revenue_impact_pct === null ? (
          <span className="text-sm text-muted">Not disclosed</span>
        ) : (
          <ImpactBar value={r.revenue_impact_pct} max={max} />
        )}
      </td>
      <td className="px-4 py-3 text-sm">
        {r.weight_used === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="font-mono text-ink">{(r.weight_used * 100).toFixed(1)}%</span>
        )}
        <p className="mt-0.5 text-[11px] text-faint">
          {r.exposure_disclosed ? "from filing" : r.weight_assumed ? "assumed" : "no disclosure"}
        </p>
      </td>
      <td className="px-4 py-3 text-sm">
        {m?.implied_price_move_pct == null ? (
          <span className="text-muted">No price data</span>
        ) : (
          <>
            <span className="font-mono font-semibold text-ink">{pct(m.implied_price_move_pct)}</span>
            <p className="mt-0.5 font-mono text-[11px] text-faint">
              β {m.beta_on_company} · ρ {m.corr} · {m.n_obs}d{!m.reliable && " · low sample"}
            </p>
          </>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-[11px] text-muted">{r.evidence_edge_ids.join(" → ")}</td>
    </tr>
  );
}

export function ShockSimulator() {
  const [company, setCompany] = useState("NVDA");
  const [shock, setShock] = useState(-30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShockResponse | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const run = async (ticker = company) => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setCompany(t);
    setLoading(true);
    setError(null);
    try {
      setResult(await demandShock(t, shock, c.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (ctrl.current === c) setLoading(false);
    }
  };

  const impacts = result?.data.impacts ?? [];
  const max = Math.max(0, ...impacts.map((r) => Math.abs(r.revenue_impact_pct ?? 0)));
  const disclosed = impacts.filter((r) => r.revenue_impact_pct !== null).length;
  const aiFailed = result ? !result.ai_ok : false;
  const demoData = result ? result.data_sources.prices === "synthetic" || result.data_sources.edges === "fallback" : false;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] flex-1 gap-8 px-4 py-10 sm:px-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:px-12 xl:px-16">
      <aside className="space-y-5">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Demand shock · live backend</p>
          <h1 className="mt-2 font-serif text-4xl leading-tight tracking-tight text-ink">Who feels it upstream?</h1>
          <p className="mt-3 text-[15px] leading-6 text-muted">
            Cut a company&apos;s demand and trace the hit through its suppliers. Revenue impact uses only exposure disclosed in filings;
            the market column cross-checks it with price betas.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="space-y-5 rounded-2xl border border-line bg-surface/50 p-5 backdrop-blur-md"
        >
          <div>
            <label htmlFor="company" className="text-xs font-semibold tracking-wider text-muted uppercase">
              Company
            </label>
            <input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value.toUpperCase())}
              className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-sm font-semibold text-ink outline-none focus:border-accent"
              placeholder="NVDA"
              autoComplete="off"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCompany(t)}
                  className={`rounded-md border px-2 py-0.5 font-mono text-xs ${
                    company === t ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="shock" className="text-xs font-semibold tracking-wider text-muted uppercase">
                Demand change
              </label>
              <span className="font-serif text-2xl text-ink">{shock}%</span>
            </div>
            <input
              id="shock"
              type="range"
              min={-60}
              max={0}
              step={5}
              value={shock}
              onChange={(e) => setShock(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between font-mono text-[10px] text-faint">
              <span>−60%</span>
              <span>0%</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !BACKEND_URL}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2.5 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Running…" : "Run shock"}
          </button>
          {!BACKEND_URL && (
            <p className="text-xs text-danger">
              Set <code className="font-mono">NEXT_PUBLIC_RIPPLE_API_URL</code> in <code className="font-mono">web/.env.local</code> and restart the dev
              server.
            </p>
          )}
        </form>
      </aside>

      <section className="min-w-0 space-y-5">
        {error && (
          <div className="flex gap-2 rounded-xl border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {!result && !error && (
          <div className="flex h-full min-h-64 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/40 p-8 text-center text-sm text-muted backdrop-blur-sm">
            {loading ? "Running the shock and asking the agent for a summary…" : "Pick a company and a demand change, then run the shock."}
          </div>
        )}

        {result && (
          <div className={`space-y-5 transition-opacity ${loading ? "opacity-50" : ""}`}>
            {demoData && (
              <div className="flex gap-2 rounded-xl border border-dashed border-line-strong bg-highlight/60 p-3 text-sm text-ink backdrop-blur-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <span>
                  <strong className="font-semibold">Demo data.</strong>{" "}
                  {result.data_sources.prices === "synthetic" && "Prices are synthetic (no daily_prices.csv). "}
                  {result.data_sources.edges === "fallback" && "Supplier links are 3 built-in examples (no edges.json). "}
                  Market-implied moves are not real.
                </span>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [`${result.data.shock_pct}%`, `demand change at ${result.data.company}`],
                [String(impacts.length), "suppliers reached in the graph"],
                [`${disclosed}/${impacts.length}`, "with disclosed exposure"],
              ].map(([v, l]) => (
                <div key={l} className="rounded-xl border border-line bg-surface/50 p-4 backdrop-blur-sm">
                  <p className="font-serif text-3xl leading-none text-ink">{v}</p>
                  <p className="mt-2 text-xs font-medium text-muted">{l}</p>
                </div>
              ))}
            </div>

            <div
              className={`rounded-2xl border p-5 backdrop-blur-md ${
                aiFailed ? "border-dashed border-line-strong bg-surface/40" : "border-line bg-surface/60"
              }`}
            >
              <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-muted uppercase">
                <Sparkles className="h-3.5 w-3.5 text-accent" /> Agent summary
              </p>
              {aiFailed ? (
                <p className="mt-2 text-sm text-muted">
                  Summary unavailable — the model call failed. The numbers below come straight from the graph and prices.
                  <span className="mt-1 block font-mono text-[11px] text-faint">{result.ai_analysis}</span>
                </p>
              ) : (
                <p className="mt-2 text-[15px] leading-7 font-medium text-ink">{result.ai_analysis}</p>
              )}
            </div>

            {impacts.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface/50 p-5 text-sm text-muted backdrop-blur-sm">
                No supplier links for <strong className="text-ink">{result.data.company}</strong> in the backend graph yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface/70 backdrop-blur-md">
                <table className="w-full min-w-[760px]">
                  <thead className="border-b border-line text-left text-[11px] tracking-wider text-muted uppercase">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Supplier → customer</th>
                      <th className="px-4 py-2.5 font-semibold">Revenue impact</th>
                      <th className="px-4 py-2.5 font-semibold">Exposure</th>
                      <th className="px-4 py-2.5 font-semibold">Market-implied move</th>
                      <th className="px-4 py-2.5 font-semibold">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {impacts.map((r) => (
                      <Row key={r.supplier} r={r} max={max} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs leading-5 text-faint">
              Up to {result.data.assumptions.max_hops} hops, decay {result.data.assumptions.hop_decay} per hop
              {result.data.assumptions.default_weight === null ? ", no assumed weights" : `, assumed weight ${result.data.assumptions.default_weight}`}.{" "}
              {result.data.assumptions.note}.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
