// Shared types between the UI and the Ripple backend.
// The backend should return JSON in exactly these shapes; see lib/api.ts.

export type Ticker = string;

export type Sector = "semis" | "equipment" | "hardware" | "external";

export type Relation = "supplier" | "customer" | "competitor" | "partner";

export const RELATIONS: Relation[] = ["supplier", "customer", "competitor", "partner"];

export interface Company {
  ticker: Ticker;
  name: string;
  sector: Sector;
  /** Annual revenue in USD (SEC XBRL company facts). Absent for companies outside the 15 covered. */
  revenueUsd?: number;
  /** SEC Central Index Key, used to build EDGAR links. */
  cik?: string;
  /** Short label for the graph node when the ticker is an internal id (e.g. "x:tsmc"). */
  label?: string;
}

export interface Filing {
  /** Ticker of the company whose 10-K contains the sentence. */
  filer: Ticker;
  form: "10-K";
  fiscalYear?: number;
  filedAt?: string; // ISO date
  /** Link that opens the filing at (or near) the quoted sentence. */
  url: string;
}

/**
 * A directed relationship read from `from`'s filing:
 * "`to` is a `relation` of `from`".
 */
export interface Edge {
  id: string;
  from: Ticker;
  to: Ticker;
  relation: Relation;
  /** Exact sentence from the filing that states the relationship. */
  quote: string;
  /** The substring of `quote` that names the counterparty (for highlighting). */
  mention?: string;
  filing: Filing;
  /** On customer links: share of the filer's revenue that comes from `to`, when disclosed (0–1). */
  revenueShare?: number;
}

export interface SectorStats {
  ticker: Ticker;
  sector: Sector;
  /** Beta to the company's own sector index over the last year of daily prices. */
  beta: number;
  /** Correlation of daily returns to its own sector. */
  correlation: number;
  /** The sector the stock actually tracks most closely (when computed). */
  followsSector?: Sector;
  followsCorrelation?: number;
}

export interface Graph {
  companies: Company[];
  edges: Edge[];
  stats: SectorStats[];
  asOf: string;
}

/* ---------- Agent ---------- */

// Known tools, but the live agent may call others (e.g. deepagents' write_todos / task).
export type ToolName = "graph_lookup" | "sector_stats" | "shock" | "kb_search" | "check_claims" | (string & {});

export interface Claim {
  id: string;
  company: Ticker;
  relation?: Relation;
  /** The claim as it appears in the memo. */
  text: string;
  quote: string;
  /** The substring of `quote` that names the company (the verifier requires one). */
  mention?: string;
  filing: Filing;
  /** Numbers the claim relies on; each must appear in the quote. */
  numbers?: string[];
  /** Verifier result; undefined means only verified claims were returned. */
  verified?: boolean;
}

export interface RejectedClaim {
  text: string;
  company: Ticker;
  reason: string;
}

export interface MemoSection {
  heading: string;
  /** Markdown-lite paragraphs. `[c1]` style markers reference claim ids. */
  paragraphs: string[];
}

export interface ExposureRow {
  supplier: Ticker;
  revenueUsd: number;
  revenueShare: number;
  dropPct: number;
  atRiskUsd: number;
  claimId: string;
}

export interface Memo {
  question: string;
  headline: string;
  sections: MemoSection[];
  claims: Claim[];
  exposure?: ExposureRow[];
  caveats: string[];
}

export type AgentEvent =
  | { type: "plan"; steps: string[] }
  | { type: "step"; index: number; status: "active" | "done" }
  | { type: "tool_call"; id: string; tool: ToolName; args: Record<string, unknown>; agent: "analyst" | "verifier" }
  | { type: "tool_result"; id: string; summary: string; ms: number }
  | { type: "verifier"; checked: number; passed: number; rejected: RejectedClaim[] }
  | { type: "memo"; memo: Memo }
  | { type: "done"; elapsedMs: number; toolCalls: number }
  | { type: "error"; message: string };

/* ---------- Evaluation ---------- */

export interface EvalMetric {
  key: string;
  label: string;
  baseline: number;
  ripple: number;
  unit: "pct" | "count" | "score" | "seconds";
  /** Whether a smaller value is better (time, tool calls). */
  lowerIsBetter?: boolean;
  /** Out-of value for counts, e.g. 60 runs. */
  outOf?: number;
  footnote?: boolean;
}

export interface EvalRun {
  id: string;
  question: string;
  category: "supplier" | "customer" | "competitor" | "exposure" | "market";
  baseline: { backed: number; total: number; seconds: number };
  ripple: { backed: number; total: number; seconds: number };
}

export interface EvalVersion {
  version: string;
  runs: number;
  precision: number;
  recall: number;
  grounded: number;
  seconds: number;
}

export interface PrismStatus {
  connected?: string;
  traces?: number;
  kb_documents?: number;
  kb_assigned_to_ripple?: number;
  error?: string;
}

export interface EvalReport {
  questions: number;
  goldQuestions: number;
  metrics: EvalMetric[];
  runs: EvalRun[];
  /** Names of the two compared versions (defaults: Plain RAG / Ripple v1). */
  labels?: { baseline: string; ripple: string };
  /** Every evaluated version, when the backend reports more than two. */
  versions?: EvalVersion[];
  prism?: PrismStatus;
}

/* ---------- Demand shock (live backend: POST /api/demand-shock) ---------- */

export interface MarketCrossCheck {
  beta_on_company: number | null;
  corr: number | null;
  r2: number | null;
  n_obs: number;
  reliable: boolean;
  implied_price_move_pct: number | null;
}

export interface ShockImpact {
  supplier: Ticker;
  sells_to: Ticker;
  hops: number;
  evidence_edge_ids: string[];
  /** Share of the supplier's revenue from the customer; null when not disclosed. */
  weight_used: number | null;
  weight_assumed: boolean;
  exposure_disclosed: boolean;
  revenue_impact_pct: number | null;
  market_cross_check: MarketCrossCheck | null;
}

export interface ShockResult {
  tool: "demand_shock";
  company: Ticker;
  shock_pct: number;
  assumptions: { max_hops: number; hop_decay: number; default_weight: number | null; note: string };
  impacts: ShockImpact[];
}

export interface ShockResponse {
  status: "success";
  data: ShockResult;
  /** LLM summary, or the error text when the model call failed (see ai_ok). */
  ai_analysis: string;
  ai_ok: boolean;
  /** "synthetic" prices / "fallback" edges mean demo data, not filings or market prices. */
  data_sources: { prices: "daily_prices.csv" | "synthetic"; edges: "edges.json" | "fallback" };
}
