// Adapter for the ripple-app agent backend (src/ripple/web.py on the ripple-app branch).
// The browser calls /rapi/*, which next.config.ts rewrites to {NEXT_PUBLIC_RIPPLE_AGENT_URL}/api/*,
// so the backend needs no CORS setup. Responses are mapped onto the UI's own types.

import type {
  AgentEvent,
  Claim,
  Company,
  Edge,
  EvalMetric,
  EvalReport,
  EvalRun,
  EvalVersion,
  Graph,
  Memo,
  PrismStatus,
  Relation,
  Sector,
  SectorStats,
} from "./types";

const BASE = "/rapi";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text().catch(() => "")}`.trim());
  return res.json();
}

/* ---------- graph ---------- */

interface RawGraph {
  nodes: { id: string; name: string; sector: Sector | null }[];
  edges: { src: string; dst: string; type: "SUPPLIES" | "COMPETES_WITH" | "PARTNERS"; stated_by: string; quote: string; link: string }[];
  sector_links: { ticker: string; sector: Sector; beta: number; corr: number }[];
}

/** First substring of the quote that names the company, for highlighting. */
function mentionOf(quote: string, name: string) {
  const lower = quote.toLowerCase();
  for (const cand of [name, name.split(/[\s,(]/)[0]]) {
    const i = cand.length > 1 ? lower.indexOf(cand.toLowerCase()) : -1;
    if (i >= 0) return quote.slice(i, i + cand.length);
  }
  return undefined;
}

export async function getGraph(): Promise<Graph> {
  const raw = await get<RawGraph>("/graph");
  const byName = new Map(raw.nodes.map((n) => [n.name.toLowerCase(), n.id]));
  const nameOf = new Map(raw.nodes.map((n) => [n.id, n.name]));

  const companies: Company[] = raw.nodes.map((n) => ({
    ticker: n.id,
    name: n.name,
    sector: n.sector ?? "external",
    // Counterparties outside the 15 filers have ids like "x:tsmc"; show a short readable label instead.
    label: n.id.startsWith("x:") ? n.name.split(/[\s,(]/)[0].slice(0, 8).toUpperCase() : undefined,
  }));

  // UI edges are "filer names counterparty as <relation>", so orient each link from the filer's side.
  const edges: Edge[] = raw.edges.map((e, i) => {
    const filer = byName.get(e.stated_by.toLowerCase()) ?? (e.type === "SUPPLIES" ? e.dst : e.src);
    let from = filer;
    let to = filer === e.src ? e.dst : e.src;
    let relation: Relation;
    if (e.type === "SUPPLIES") {
      // src supplies dst: from the customer's filing the counterparty is a supplier, from the supplier's a customer.
      if (filer === e.src) relation = "customer";
      else if (filer === e.dst) relation = "supplier";
      else [from, to, relation] = [e.dst, e.src, "supplier"];
    } else {
      relation = e.type === "COMPETES_WITH" ? "competitor" : "partner";
    }
    return {
      id: `r${i}`,
      from,
      to,
      relation,
      quote: e.quote,
      mention: mentionOf(e.quote, nameOf.get(to) ?? to),
      filing: { filer: from.startsWith("x:") ? "" : from, form: "10-K", url: e.link },
    };
  });

  const stats: SectorStats[] = raw.sector_links.map((s) => ({ ticker: s.ticker, sector: s.sector, beta: s.beta, correlation: s.corr }));
  return { companies, edges, stats, asOf: "live" };
}

/* ---------- evaluation ---------- */

interface RawProofs {
  table: EvalVersion[];
  coverage: unknown;
  prism: PrismStatus & { steps?: Record<string, string> };
}
interface RawSample {
  id: string;
  question: string;
  saved: string[];
}
interface RawRun {
  memo: { claims: { verified: boolean }[] };
  verified: number;
  total: number;
  seconds?: number;
  tool_calls: string[];
}

function category(q: string): EvalRun["category"] {
  if (/compet/i.test(q)) return "competitor";
  if (/customer|sells? to/i.test(q)) return "customer";
  if (/cut|shock|expos|at risk|revenue/i.test(q)) return "exposure";
  if (/beta|correl|stock|sector/i.test(q)) return "market";
  return "supplier";
}

export async function getEval(): Promise<EvalReport> {
  const [proofs, samples] = await Promise.all([get<RawProofs>("/proofs"), get<RawSample[]>("/samples")]);
  const base = proofs.table.find((v) => /rag/i.test(v.version)) ?? proofs.table[0];
  const best = proofs.table[proofs.table.length - 1];

  // Per-question rows: saved Plain RAG vs Ripple runs for the first questions that have both.
  const both = samples.filter((s) => s.saved.includes("rag") && s.saved.includes("v1")).slice(0, 12);
  const runs: EvalRun[] = (
    await Promise.all(
      both.map(async (s) => {
        try {
          const [r, v] = await Promise.all([get<RawRun>(`/saved/${s.id}/rag`), get<RawRun>(`/saved/${s.id}/v1`)]);
          return {
            id: s.id,
            question: s.question,
            category: category(s.question),
            baseline: { backed: r.verified, total: r.total, seconds: Math.round(r.seconds ?? 0) },
            ripple: { backed: v.verified, total: v.total, seconds: Math.round(v.seconds ?? 0) },
          } satisfies EvalRun;
        } catch {
          return null;
        }
      }),
    )
  ).filter((r): r is EvalRun => r !== null);

  const metrics: EvalMetric[] = [
    { key: "backed", label: "Claims backed by an exact filing quote naming the company", baseline: base.grounded, ripple: best.grounded, unit: "pct" },
    { key: "precision", label: "Precision on gold questions", baseline: base.precision, ripple: best.precision, unit: "score", footnote: true },
    { key: "recall", label: "Recall on gold questions", baseline: base.recall, ripple: best.recall, unit: "score", footnote: true },
    { key: "time", label: "Time per question", baseline: Math.round(base.seconds), ripple: Math.round(best.seconds), unit: "seconds", lowerIsBetter: true },
  ];

  return {
    questions: Math.max(base.runs, best.runs),
    goldQuestions: 24,
    metrics,
    runs,
    labels: { baseline: base.version, ripple: best.version },
    versions: proofs.table,
    prism: proofs.prism,
  };
}

/* ---------- ask: start a job, poll it, replay progress as AgentEvents ---------- */

interface RawClaim {
  company: string;
  relation: string;
  evidence: string;
  number: string | number | null;
  source_link: string;
  verified: boolean;
}
interface RawJob {
  status: "running" | "done" | "error";
  steps?: string[];
  elapsed: number;
  error?: string;
  result?: { memo: { answer: string; claims: RawClaim[] }; verified: number; total: number; tool_calls: string[]; seconds: number };
}

const INTERNAL_STEPS = new Set(["MISSING", "json"]);
const PLAN = ["Plan the research and pick tools", "Query the filing graph, prices and 10-K text", "Verify every claim against the filings", "Write the memo"];

function toRelation(r: string): Relation | undefined {
  const s = r.toLowerCase();
  if (s.startsWith("supplie")) return "supplier";
  if (s.startsWith("customer")) return "customer";
  if (s.startsWith("compet")) return "competitor";
  if (s.startsWith("partner")) return "partner";
  return undefined;
}

function filerFromLink(link: string) {
  // EDGAR path: /Archives/edgar/data/{cik}/{accession}/{ticker}-{date}.htm
  return link.match(/\/([a-z]+)-\d{8}\.htm/i)?.[1]?.toUpperCase() ?? "";
}

function toMemo(question: string, answer: string, raw: RawClaim[]): Memo {
  const claims: Claim[] = raw.map((c, i) => ({
    id: `c${i + 1}`,
    company: c.company,
    relation: toRelation(c.relation),
    text: `${c.company} — ${c.relation}`,
    quote: c.evidence,
    mention: mentionOf(c.evidence, c.company),
    filing: { filer: filerFromLink(c.source_link), form: "10-K", url: c.source_link },
    numbers: c.number != null && c.number !== "" ? [String(c.number)] : undefined,
    verified: c.verified,
  }));
  const paras = answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // First sentence becomes the headline; the rest stays as prose.
  const first = paras[0] ?? "";
  const cut = first.search(/(?<=[.!?])\s/);
  const headline = cut > 0 && cut < 220 ? first.slice(0, cut) : question;
  const rest = cut > 0 && cut < 220 ? [first.slice(cut).trim(), ...paras.slice(1)].filter(Boolean) : paras;
  return {
    question,
    headline,
    sections: rest.length ? [{ heading: "Answer", paragraphs: rest }] : [],
    claims,
    caveats: ["Claims are checked word for word against the 10-K text; unverified claims are flagged.", "Research aid, not investment advice."],
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

export async function* ask(question: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${BASE}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, version: "v1" }),
    signal,
  });
  if (!res.ok) throw new Error(`POST /ask failed: ${res.status} ${await res.text().catch(() => "")}`.trim());
  const { job } = (await res.json()) as { job: string };

  yield { type: "plan", steps: PLAN };
  yield { type: "step", index: 0, status: "active" };

  let seen = 0;
  let step = 0;
  const advance = function* (to: number): Generator<AgentEvent> {
    while (step < to) {
      yield { type: "step", index: step, status: "done" };
      step++;
      yield { type: "step", index: step, status: "active" };
    }
  };

  for (;;) {
    await sleep(1500, signal);
    const j = await get<RawJob>(`/job/${job}`, signal);
    // "MISSING" / "json" are the agent framework's internal structured-output calls, not research tools.
    const steps = (j.steps ?? []).filter((t) => !INTERNAL_STEPS.has(t));
    // Each new tool name is a new call; the previous one has finished by then.
    for (; seen < steps.length; seen++) {
      const tool = steps[seen];
      if (seen > 0) yield { type: "tool_result", id: `t${seen}`, summary: "done", ms: 0 };
      const verifier = tool === "task" || /verif|check/i.test(tool);
      yield* advance(verifier ? 2 : tool === "write_todos" ? 0 : 1);
      yield { type: "tool_call", id: `t${seen + 1}`, tool, args: {}, agent: verifier ? "verifier" : "analyst" };
    }

    if (j.status === "error") {
      yield { type: "error", message: j.error ?? "agent run failed" };
      return;
    }
    if (j.status === "done" && j.result) {
      if (seen > 0) yield { type: "tool_result", id: `t${seen}`, summary: "done", ms: 0 };
      const r = j.result;
      const memo = toMemo(question, r.memo.answer, r.memo.claims);
      yield* advance(2);
      yield {
        type: "verifier",
        checked: r.total,
        passed: r.verified,
        rejected: r.memo.claims
          .filter((c) => !c.verified)
          .map((c) => ({ company: c.company, text: `${c.company} — ${c.relation}`, reason: "Quote not found word for word in a filing, or it doesn't name the company." })),
      };
      yield* advance(3);
      yield { type: "memo", memo };
      yield { type: "step", index: 3, status: "done" };
      yield { type: "done", elapsedMs: Math.round(r.seconds * 1000), toolCalls: r.tool_calls.length };
      return;
    }
  }
}
