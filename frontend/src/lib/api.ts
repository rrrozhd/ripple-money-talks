// Single entry point for backend data.
//
// Backends:
//   NEXT_PUBLIC_RIPPLE_AGENT_URL  the Ripple API in this repo (src/ripple/web.py): Ask, Graph and Evaluation.
//                                 Proxied through /rapi/* by next.config.ts; see lib/ripple-app.ts.
// Without the agent URL, Ask / Graph / Evaluation run on mock data (lib/mock/) and Shock is hidden.

import type { AgentEvent, EvalReport, Graph, ShockBuyer, ShockResult } from "./types";

const AGENT_URL = process.env.NEXT_PUBLIC_RIPPLE_AGENT_URL;

/** True while Ask / Graph / Evaluation run on mock data. */
export const usingMock = !AGENT_URL;

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

export async function getShockBuyers(): Promise<ShockBuyer[]> {
  if (!AGENT_URL) return [];
  return (await import("./ripple-app")).getShockBuyers();
}

export async function runShock(company: string, dropPct: number, signal?: AbortSignal): Promise<ShockResult> {
  if (!AGENT_URL) throw new Error("Shock needs the Ripple API: set NEXT_PUBLIC_RIPPLE_AGENT_URL in frontend/.env.local");
  return (await import("./ripple-app")).runShock(company, dropPct, signal);
}
