"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getEval, usingMock } from "@/lib/api";
import type { EvalMetric, EvalReport, EvalRun } from "@/lib/types";

const BASE = "var(--faint)";
const RIPPLE = "var(--accent)";

function fmt(m: EvalMetric, v: number) {
  switch (m.unit) {
    case "pct":
      return `${Math.round(v * 100)}%`;
    case "score":
      return v.toFixed(2);
    case "seconds":
      return `${v}s`;
    case "count":
      return m.outOf ? `${v}/${m.outOf}` : String(v);
  }
}

function delta(m: EvalMetric) {
  const d = m.ripple - m.baseline;
  if (m.unit === "pct") return `${d > 0 ? "+" : ""}${Math.round(d * 100)} pts`;
  if (m.unit === "score") return `${d > 0 ? "+" : ""}${d.toFixed(2)}`;
  if (m.lowerIsBetter) return `−${Math.round((1 - m.ripple / m.baseline) * 100)}%`;
  return `${d > 0 ? "+" : ""}${d}`;
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: BASE }} /> Plain RAG
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: RIPPLE }} /> Ripple v1
      </span>
    </div>
  );
}

function MetricCard({ m }: { m: EvalMetric }) {
  const max = m.unit === "pct" || m.unit === "score" ? 1 : m.outOf ?? Math.max(m.baseline, m.ripple) * 1.1;
  const rows = [
    { label: "Plain RAG", v: m.baseline, color: BASE },
    { label: "Ripple v1", v: m.ripple, color: RIPPLE },
  ];
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm leading-5 text-muted">
          {m.label}
          {m.footnote && <sup className="ml-0.5 text-faint">*</sup>}
        </h3>
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-medium text-accent">{delta(m)}</span>
      </div>
      <p className="mt-2 font-serif text-3xl text-ink">{fmt(m, m.ripple)}</p>
      <div className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="group flex items-center gap-2" title={`${r.label}: ${fmt(m, r.v)}`}>
            <span className="w-16 shrink-0 text-[11px] text-faint">{r.label}</span>
            <div className="h-2 flex-1 rounded-full bg-surface-2">
              <div className="h-2 rounded-full transition-[width] group-hover:opacity-80" style={{ width: `${(r.v / max) * 100}%`, background: r.color }} />
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ink">{fmt(m, r.v)}</span>
          </div>
        ))}
      </div>
      {m.lowerIsBetter && <p className="mt-2 text-[11px] text-faint">Lower is better</p>}
    </div>
  );
}

function Dots({ backed, total, label }: { backed: number; total: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${backed} of ${total} claims backed`} aria-label={`${backed} of ${total} claims backed`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-2.5 w-2.5 rounded-full"
          style={i < backed ? { background: label === "Ripple" ? RIPPLE : "var(--muted)" } : { boxShadow: "inset 0 0 0 1.5px var(--danger)" }}
        />
      ))}
    </span>
  );
}

function RunsTable({ runs, total }: { runs: EvalRun[]; total: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-line text-left text-[11px] tracking-wider text-faint uppercase">
          <tr>
            <th className="px-4 py-2.5 font-medium">Question</th>
            <th className="px-4 py-2.5 font-medium">Plain RAG</th>
            <th className="px-4 py-2.5 font-medium">Ripple v1</th>
            <th className="px-4 py-2.5 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2/50">
              <td className="px-4 py-3">
                <Link href={`/?q=${encodeURIComponent(r.question)}`} className="text-ink hover:text-accent">
                  {r.question}
                </Link>
                <span className="ml-2 font-mono text-[10px] text-faint uppercase">{r.category}</span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Dots backed={r.baseline.backed} total={r.baseline.total} label="Plain RAG" />
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Dots backed={r.ripple.backed} total={r.ripple.total} label="Ripple" />
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap text-muted">
                {r.baseline.seconds}s → <span className="text-ink">{r.ripple.seconds}s</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2.5 text-[11px] text-faint">
        Showing {runs.length} of {total} questions{usingMock ? " (mock rows until the PRISM export is wired in)" : ""}. Filled dot = claim backed by a verbatim filing quote naming the company; red ring = unbacked.
      </p>
    </div>
  );
}

export function EvalReportView() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEval().then(setReport, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="p-6 text-sm text-danger">Could not load evaluation: {error}</p>;
  if (!report) return <div className="m-6 h-96 animate-pulse rounded-xl bg-surface-2" />;

  const backed = report.metrics.find((m) => m.key === "backed")!;
  const rest = report.metrics.filter((m) => m.key !== "backed");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-[11px] font-medium tracking-wider text-faint uppercase">Evaluation · traced in PRISM</p>
      <h1 className="mt-2 font-serif text-4xl tracking-tight text-ink">Plain RAG vs Ripple v1</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted">
        The same {report.questions} questions, run through a plain RAG baseline and through Ripple. The main check needs no answer key:
        is every company a memo names backed by a sentence that appears word for word in a filing?
      </p>

      {/* Headline */}
      <section className="mt-8 grid gap-6 rounded-2xl border border-line bg-surface p-6 md:grid-cols-[auto_1fr] md:items-center md:gap-10">
        <div>
          <p className="font-serif text-7xl leading-none text-accent">{fmt(backed, backed.ripple)}</p>
          <p className="mt-2 text-sm text-muted">of claims backed by an exact filing quote</p>
          <p className="mt-1 font-mono text-xs text-faint">vs {fmt(backed, backed.baseline)} for plain RAG</p>
        </div>
        <div>
          <Legend />
          {/* 100 squares per series: one square = 1% of claims */}
          <div className="mt-3 space-y-3">
            {[
              { label: "Plain RAG", v: backed.baseline, color: BASE },
              { label: "Ripple v1", v: backed.ripple, color: RIPPLE },
            ].map((s) => (
              <div key={s.label} title={`${s.label}: ${fmt(backed, s.v)} backed`}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted">{s.label}</span>
                  <span className="font-mono text-ink">{fmt(backed, s.v)}</span>
                </div>
                <div className="grid grid-cols-[repeat(50,minmax(0,1fr))] gap-[2px]">
                  {Array.from({ length: 100 }, (_, i) => (
                    <span
                      key={i}
                      className="aspect-square rounded-[2px]"
                      style={{ background: i < Math.round(s.v * 100) ? s.color : "var(--surface-2)" }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-xl text-ink">All metrics</h2>
          <Legend />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((m) => (
            <MetricCard key={m.key} m={m} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-serif text-xl text-ink">Per question</h2>
        <RunsTable runs={report.runs} total={report.questions} />
      </section>

      <footer className="mt-8 space-y-1 text-xs leading-5 text-faint">
        <p>
          * The gold answers for the {report.goldQuestions} F1 questions were written by the team&apos;s AI assistant, not by independent annotators, so treat
          F1 and BEAM-style scores as indicative.
        </p>
      </footer>
    </div>
  );
}
