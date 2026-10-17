"use client";

import { Check, ShieldCheck, X } from "lucide-react";
import type { RunState, ToolCall } from "./use-agent";

function StepIcon({ status }: { status?: "active" | "done" }) {
  if (status === "done")
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-bg">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  if (status === "active")
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-accent">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
    );
  return <span className="h-4 w-4 rounded-full border border-line-strong" />;
}

function fmtArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : String(v)}`)
    .join(", ");
}

function Call({ call }: { call: ToolCall }) {
  const pending = call.summary === undefined;
  return (
    <li className="fade-up relative pl-5">
      <span
        className={`absolute top-[7px] left-0 h-2 w-2 rounded-full ${
          pending ? "pulse-dot bg-accent" : call.agent === "verifier" ? "bg-accent" : "bg-line-strong"
        }`}
      />
      <div className="font-mono text-[12px] leading-5 break-words">
        {call.agent === "verifier" && <span className="mr-1 text-accent">verifier ›</span>}
        <span className="font-medium text-ink">{call.tool}</span>
        <span className="text-faint">({fmtArgs(call.args)})</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-muted">
        <span>{pending ? "running…" : call.summary}</span>
        {call.ms !== undefined && <span className="shrink-0 font-mono text-[11px] text-faint">{(call.ms / 1000).toFixed(1)}s</span>}
      </div>
    </li>
  );
}

export function Trace({ state }: { state: RunState }) {
  const { plan, stepStatus, calls, verifier, stats, status } = state;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Plan</h3>
        {plan.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> Planning…
          </p>
        ) : (
          <ol className="space-y-2">
            {plan.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5">
                  <StepIcon status={stepStatus[i]} />
                </span>
                <span className={stepStatus[i] ? "text-ink" : "text-muted"}>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {calls.length > 0 && (
        <section>
          <h3 className="mb-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Tool calls</h3>
          <ul className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[3.5px] before:w-px before:bg-line">
            {calls.map((c) => (
              <Call key={c.id} call={c} />
            ))}
          </ul>
        </section>
      )}

      {verifier && (
        <section className="fade-up rounded-lg border border-line bg-surface p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-accent" />
            Verifier
            <span className="ml-auto font-mono text-xs text-muted">
              {verifier.passed}/{verifier.checked} kept
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">Each quote must appear word for word in a filing, name the company, and contain any number used.</p>
          {verifier.rejected.map((r, i) => (
            <div key={i} className="mt-3 rounded-md bg-danger-soft p-2.5 text-xs">
              <div className="flex items-start gap-1.5 font-medium text-danger">
                <X className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                <span className="line-through decoration-1">{r.text}</span>
              </div>
              <p className="mt-1 pl-5 text-muted">{r.reason}</p>
            </div>
          ))}
        </section>
      )}

      {status === "done" && stats && (
        <p className="font-mono text-[11px] text-faint">
          {(stats.elapsedMs / 1000).toFixed(1)}s · {stats.toolCalls} tool calls
        </p>
      )}
    </div>
  );
}
