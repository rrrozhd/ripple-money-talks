// Single entry point for backend data.
//
// Backends:
//   NEXT_PUBLIC_RIPPLE_AGENT_URL  the Ripple API in this repo (src/ripple/web.py): Ask, Graph and Evaluation.
//                                 Proxied through /rapi/* by next.config.ts; see lib/ripple-app.ts.
//   NEXT_PUBLIC_RIPPLE_API_URL    optional separate demand-shock service (POST /api/demand-shock) for the
//                                 Shock page; the page is hidden from the nav when this is unset.
// Without the agent URL, Ask / Graph / Evaluation run on mock data (lib/mock/).

import type { AgentEvent, EvalReport, Graph, ShockResponse } from "./types";

export const BACKEND_URL = process.env.NEXT_PUBLIC_RIPPLE_API_URL?.replace(/\/$/, "");
const AGENT_URL = process.env.NEXT_PUBLIC_RIPPLE_AGENT_URL;

/** True while Ask / Graph / Evaluation run on mock data. */
export const usingMock = !AGENT_URL;

export async function demandShock(company: string, shockPct: number, signal?: AbortSignal): Promise<ShockResponse> {
  if (!BACKEND_URL) throw new Error("Backend not configured: set NEXT_PUBLIC_RIPPLE_API_URL in web/.env.local");
  const res = await fetch(`${BACKEND_URL}/api/demand-shock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ company, shock_pct: shockPct }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? res.statusText);
    throw new Error(`Backend error ${res.status}: ${detail}`);
  }
  return res.json();
}

export async function getGraph(): Promise<Graph> {
  if (!AGENT_URL) return (await import("./mock/graph")).MOCK_GRAPH;
  return (await import("./ripple-app")).getGraph();
}

export async function getEval(): Promise<EvalReport> {
  if (!AGENT_URL) return (await import("./mock/eval")).MOCK_EVAL;
  return (await import("./ripple-app")).getEval();
}

export async function* ask(question: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  if (!AGENT_URL) {
    yield* (await import("./mock/agent")).mockAsk(question, signal);
    return;
  }
  yield* (await import("./ripple-app")).ask(question, signal);
}
