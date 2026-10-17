// Single entry point for backend data.
//
// NEXT_PUBLIC_RIPPLE_API_URL points at the FastAPI backend (app.py). It currently serves
//   POST {API}/api/demand-shock  body {company, shock_pct}  → ShockResponse   (live)
// Ask, Graph and Evaluation stay on mock data until the backend adds:
//   POST {API}/ask    body {question}   → NDJSON stream, one AgentEvent per line
//   GET  {API}/graph                    → Graph
//   GET  {API}/eval                     → EvalReport
// Flip LIVE_AGENT to true once those exist.

import type { AgentEvent, EvalReport, Graph, ShockResponse } from "./types";

export const BACKEND_URL = process.env.NEXT_PUBLIC_RIPPLE_API_URL?.replace(/\/$/, "");
const LIVE_AGENT = false;
const API = LIVE_AGENT ? BACKEND_URL : undefined;

/** True while Ask / Graph / Evaluation run on mock data. */
export const usingMock = !API;

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
  if (!API) return (await import("./mock/graph")).MOCK_GRAPH;
  const res = await fetch(`${API}/graph`);
  if (!res.ok) throw new Error(`GET /graph failed: ${res.status}`);
  return res.json();
}

export async function getEval(): Promise<EvalReport> {
  if (!API) return (await import("./mock/eval")).MOCK_EVAL;
  const res = await fetch(`${API}/eval`);
  if (!res.ok) throw new Error(`GET /eval failed: ${res.status}`);
  return res.json();
}

export async function* ask(question: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  if (!API) {
    yield* (await import("./mock/agent")).mockAsk(question, signal);
    return;
  }
  const res = await fetch(`${API}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`POST /ask failed: ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as AgentEvent;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as AgentEvent;
}
