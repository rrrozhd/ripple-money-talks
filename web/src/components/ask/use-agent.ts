"use client";

import { useCallback, useRef, useState } from "react";
import { ask } from "@/lib/api";
import type { AgentEvent, Memo, RejectedClaim, ToolName } from "@/lib/types";

export interface ToolCall {
  id: string;
  tool: ToolName;
  agent: "analyst" | "verifier";
  args: Record<string, unknown>;
  summary?: string;
  ms?: number;
}

export interface RunState {
  question: string;
  status: "idle" | "running" | "done" | "stopped" | "error";
  plan: string[];
  stepStatus: Record<number, "active" | "done">;
  calls: ToolCall[];
  verifier?: { checked: number; passed: number; rejected: RejectedClaim[] };
  memo?: Memo;
  stats?: { elapsedMs: number; toolCalls: number };
  error?: string;
}

const EMPTY: RunState = { question: "", status: "idle", plan: [], stepStatus: {}, calls: [] };

function reduce(s: RunState, e: AgentEvent): RunState {
  switch (e.type) {
    case "plan":
      return { ...s, plan: e.steps };
    case "step":
      return { ...s, stepStatus: { ...s.stepStatus, [e.index]: e.status } };
    case "tool_call":
      return { ...s, calls: [...s.calls, { id: e.id, tool: e.tool, agent: e.agent, args: e.args }] };
    case "tool_result":
      return { ...s, calls: s.calls.map((c) => (c.id === e.id ? { ...c, summary: e.summary, ms: e.ms } : c)) };
    case "verifier":
      return { ...s, verifier: { checked: e.checked, passed: e.passed, rejected: e.rejected } };
    case "memo":
      return { ...s, memo: e.memo };
    case "done":
      return { ...s, status: "done", stats: { elapsedMs: e.elapsedMs, toolCalls: e.toolCalls } };
    case "error":
      return { ...s, status: "error", error: e.message };
  }
}

export function useAgent() {
  const [state, setState] = useState<RunState>(EMPTY);
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(async (question: string) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ ...EMPTY, question, status: "running" });
    try {
      for await (const event of ask(question, c.signal)) {
        setState((s) => reduce(s, event));
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((s) => ({ ...s, status: "error", error: (err as Error).message }));
    }
  }, []);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    setState((s) => (s.status === "running" ? { ...s, status: "stopped" } : s));
  }, []);

  const reset = useCallback(() => {
    ctrl.current?.abort();
    setState(EMPTY);
  }, []);

  return { state, run, stop, reset };
}
