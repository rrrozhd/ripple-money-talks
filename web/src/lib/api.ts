// Single entry point for backend data.
//
// Set NEXT_PUBLIC_RIPPLE_API_URL to use the real backend; otherwise the UI runs on mock data.
// Expected backend contract:
//   POST {API}/ask    body {question}   → NDJSON stream, one AgentEvent per line
//   GET  {API}/graph                    → Graph
//   GET  {API}/eval                     → EvalReport

import type { AgentEvent, EvalReport, Graph } from "./types";

const API = process.env.NEXT_PUBLIC_RIPPLE_API_URL?.replace(/\/$/, "");

export const usingMock = !API;

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
