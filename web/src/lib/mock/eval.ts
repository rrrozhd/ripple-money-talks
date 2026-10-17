// Headline metrics are the README's results table.
// Per-question runs are MOCK rows for the UI until PRISM exports are wired in.

import type { EvalReport, EvalRun } from "../types";

const RUNS: Array<[string, EvalRun["category"], [number, number, number], [number, number, number]]> = [
  ["Who supplies NVIDIA, and how exposed is each supplier?", "exposure", [3, 6, 261], [4, 4, 182]],
  ["Who are Lam Research's most significant customers?", "customer", [2, 4, 214], [3, 3, 151]],
  ["If TSMC cuts purchases by 30%, how much revenue is at risk for Entegris?", "exposure", [1, 3, 297], [3, 3, 204]],
  ["Which companies compete with AMD in data center GPUs?", "competitor", [2, 3, 188], [2, 2, 133]],
  ["Who manufactures Apple's processors?", "supplier", [2, 2, 176], [2, 2, 120]],
  ["Which hardware makers depend on NVIDIA GPUs?", "supplier", [2, 5, 242], [4, 5, 171]],
  ["Does Apple's stock move with the hardware sector?", "market", [0, 1, 205], [1, 1, 98]],
  ["Who are Applied Materials' largest customers?", "customer", [2, 3, 231], [3, 3, 167]],
  ["Which suppliers does Super Micro rely on?", "supplier", [3, 5, 266], [3, 3, 189]],
  ["Who competes with Dell in servers?", "competitor", [3, 4, 199], [3, 3, 142]],
  ["Which equipment makers sell to Micron?", "customer", [1, 4, 284], [2, 2, 196]],
  ["How concentrated is Micron's revenue?", "exposure", [0, 2, 318], [1, 1, 210]],
];

export const MOCK_EVAL: EvalReport = {
  questions: 60,
  goldQuestions: 24,
  metrics: [
    { key: "backed", label: "Claims backed by an exact filing quote naming the company", baseline: 0.64, ripple: 0.84, unit: "pct" },
    { key: "fullyBacked", label: "Runs where every claim is backed", baseline: 16, ripple: 25, unit: "count", outOf: 60 },
    { key: "f1", label: "F1 on 24 gold questions", baseline: 0.81, ripple: 0.9, unit: "score", footnote: true },
    { key: "beam", label: "BEAM-style score", baseline: 0.71, ripple: 0.82, unit: "score", footnote: true },
    { key: "time", label: "Time per question", baseline: 248, ripple: 175, unit: "seconds", lowerIsBetter: true },
    { key: "tools", label: "Tool calls per question", baseline: 14, ripple: 7, unit: "count", lowerIsBetter: true },
  ],
  runs: RUNS.map(([question, category, b, r], i) => ({
    id: `q${String(i + 1).padStart(2, "0")}`,
    question,
    category,
    baseline: { backed: b[0], total: b[1], seconds: b[2] },
    ripple: { backed: r[0], total: r[1], seconds: r[2] },
  })),
};
