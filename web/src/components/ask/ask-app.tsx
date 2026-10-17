"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { Logo } from "../nav";
import { AskBox } from "./ask-box";
import { MemoSkeleton, MemoView } from "./memo";
import { Trace } from "./trace";
import { useAgent } from "./use-agent";

const EXAMPLES = [
  { q: "Who supplies NVIDIA, and how exposed is each supplier?", tag: "Suppliers · exposure" },
  { q: "Who are Lam Research's most significant customers?", tag: "Customers" },
  { q: "If TSMC cuts purchases by 30%, how much revenue is at risk for Entegris?", tag: "Shock" },
];

const TOOLS = [
  ["graph_lookup", "Supplier, customer, competitor and partner links, each with its filing quote"],
  ["sector_stats", "Beta and correlation to sector from a year of daily prices"],
  ["shock", "Suppliers' revenue at risk if a buyer cuts purchases"],
  ["kb_search", "Hybrid BM25 + embedding search over the filings, LLM-reranked"],
  ["verifier", "Rejects any claim whose quote isn't word for word in a filing"],
] as const;

export function AskApp() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { state, run, stop, reset } = useAgent();
  const q = params.get("q") ?? "";
  const lastRun = useRef<string | null>(null);

  // The URL is the source of truth for the current question, so memos are linkable.
  useEffect(() => {
    if (q && q !== lastRun.current) {
      lastRun.current = q;
      run(q);
    }
    if (!q && lastRun.current) {
      lastRun.current = null;
      reset();
    }
  }, [q, run, reset]);

  const submit = (question: string) => {
    if (question === q) run(question);
    else router.push(`${pathname}?q=${encodeURIComponent(question)}`);
  };

  if (!q) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <Logo className="h-10 w-10 text-accent" />
        <h1 className="mt-6 font-serif text-4xl leading-[1.1] tracking-tight text-ink sm:text-5xl">
          Who depends on whom?
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted">
          Ask about suppliers, customers, competitors and partners across 15 US tech companies. Every company Ripple names is backed by
          the exact sentence from its 10-K.
        </p>
        <div className="mt-8">
          <AskBox size="lg" onSubmit={submit} autoFocus />
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {EXAMPLES.map((e) => (
            <li key={e.q}>
              <button
                onClick={() => submit(e.q)}
                className="group flex h-full w-full flex-col rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong"
              >
                <span className="text-[11px] font-medium tracking-wider text-faint uppercase">{e.tag}</span>
                <span className="mt-1 flex-1 text-sm leading-5 text-ink">{e.q}</span>
                <ArrowRight className="mt-2 h-3.5 w-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-14 border-t border-line pt-6">
          <h2 className="text-[11px] font-medium tracking-wider text-faint uppercase">How the agent works</h2>
          <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {TOOLS.map(([name, desc]) => (
              <div key={name} className="flex gap-3 text-sm">
                <dt className="w-28 shrink-0 font-mono text-[12px] leading-5 text-ink">{name}</dt>
                <dd className="text-muted">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  }

  const running = state.status === "running";

  return (
    <div className="mx-auto grid w-full max-w-[1400px] flex-1 gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-10">
      <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wider text-faint uppercase">Question</p>
            <p className="mt-1 text-[15px] leading-6 text-ink">{state.question || q}</p>
          </div>
          <button
            onClick={() => router.push(pathname)}
            title="New question"
            aria-label="New question"
            className="mt-1 shrink-0 rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-6 border-t border-line pt-5">
          <Trace state={state} />
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mx-auto max-w-[760px]">
          <AskBox key={q} initial={q} running={running} onSubmit={submit} onStop={stop} />
          <div className="mt-8">
            {state.status === "error" ? (
              <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
                The agent run failed: {state.error}
              </div>
            ) : state.status === "stopped" && !state.memo ? (
              <p className="text-sm text-muted">Run stopped. Ask again to restart it.</p>
            ) : state.memo ? (
              <MemoView memo={state.memo} elapsedMs={state.stats?.elapsedMs} />
            ) : (
              <MemoSkeleton />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
