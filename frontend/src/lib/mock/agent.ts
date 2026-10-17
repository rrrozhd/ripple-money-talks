// MOCK agent: replays a plausible Deep Agent run over the mock graph so the UI can be
// built before the backend exists. It emits the same AgentEvent stream the real /ask
// endpoint is expected to send.

import type { AgentEvent, Claim, Edge, ExposureRow, Memo, MemoSection, Relation, RejectedClaim, Ticker, ToolName } from "../types";
import { COMPANIES, EDGES, company, mentionIn, nameOf, statsFor } from "./graph";

const ALIASES: Array<[RegExp, Ticker]> = [
  [/\bnvidia|\bnvda\b/i, "NVDA"],
  [/\bamd\b|advanced micro/i, "AMD"],
  [/\bintel\b|\bintc\b/i, "INTC"],
  [/qualcomm|\bqcom\b/i, "QCOM"],
  [/micron|\bmu\b/i, "MU"],
  [/applied materials|\bamat\b/i, "AMAT"],
  [/lam research|\blrcx\b|\blam\b/i, "LRCX"],
  [/\bkla\b|\bklac\b/i, "KLAC"],
  [/teradyne|\bter\b/i, "TER"],
  [/entegris|\bentg\b/i, "ENTG"],
  [/apple|\baapl\b/i, "AAPL"],
  [/\bdell\b/i, "DELL"],
  [/\bhp inc|\bhpq\b/i, "HPQ"],
  [/super ?micro|\bsmci\b/i, "SMCI"],
  [/hewlett packard enterprise|\bhpe\b/i, "HPE"],
  [/tsmc|taiwan semi|\btsm\b/i, "TSM"],
  [/samsung/i, "SMSN"],
];

const INVERSE: Record<Relation, Relation> = {
  supplier: "customer",
  customer: "supplier",
  competitor: "competitor",
  partner: "partner",
};

function findCompanies(q: string): Ticker[] {
  return ALIASES.map(([re, t]) => ({ t, at: q.search(re) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.t);
}

function detectRelation(q: string): Relation {
  if (/supplie|supply|vendor|manufactur|source/i.test(q)) return "supplier";
  if (/customer|buyer|sell to|sells to/i.test(q)) return "customer";
  if (/compet|rival/i.test(q)) return "competitor";
  if (/partner|collaborat/i.test(q)) return "partner";
  return "supplier";
}

/** Counterparties of `t` for `rel`, from t's own filing and from inverse links in others' filings. */
function lookup(t: Ticker, rel: Relation): Array<{ counterparty: Ticker; edge: Edge; direct: boolean }> {
  const direct = EDGES.filter((e) => e.from === t && e.relation === rel).map((edge) => ({ counterparty: edge.to, edge, direct: true }));
  const inverse = EDGES.filter((e) => e.to === t && e.relation === INVERSE[rel]).map((edge) => ({ counterparty: edge.from, edge, direct: false }));
  return [...direct, ...inverse];
}

const fmtUsd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B` : `$${Math.round(n / 1e6)}M`;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

const REL_PHRASE: Record<Relation, string> = {
  supplier: "a supplier",
  customer: "a customer",
  competitor: "a competitor",
  partner: "a partner",
};

function claimFromEdge(id: string, subject: Ticker, hit: ReturnType<typeof lookup>[number]): Claim {
  const { edge, counterparty } = hit;
  const filer = nameOf(edge.filing.filer);
  const text = hit.direct
    ? `${filer}'s FY${edge.filing.fiscalYear} 10-K names ${nameOf(counterparty)} as ${REL_PHRASE[edge.relation]}.`
    : `${filer}'s own FY${edge.filing.fiscalYear} 10-K names ${nameOf(subject)} as ${REL_PHRASE[edge.relation]}.`;
  const numbers = edge.quote.match(/\d+(\.\d+)?%/g) ?? undefined;
  const mention = mentionIn(edge.quote, counterparty) ?? mentionIn(edge.quote, subject);
  return { id, company: counterparty, relation: edge.relation, text, quote: edge.quote, mention, filing: edge.filing, numbers };
}

interface Script {
  plan: string[];
  calls: Array<{ step: number; tool: ToolName; args: Record<string, unknown>; summary: string; agent?: "analyst" | "verifier" }>;
  rejected: RejectedClaim[];
  memo: Memo;
}

function buildScript(question: string): Script {
  const tickers = findCompanies(question);
  const shockMatch = question.match(/(\d+(?:\.\d+)?)\s*%/);
  const wantsShock = !!shockMatch || /expos|at risk|cut|shock/i.test(question);
  const relation = detectRelation(question);

  // For "If X cuts purchases…, how much is at risk for Y?" the buyer is X and the focus is Y.
  const subject = tickers[0] ?? "NVDA";
  const focus = wantsShock && tickers.length > 1 ? tickers[1] : undefined;
  const rel: Relation = wantsShock && focus ? "supplier" : relation;
  const dropPct = shockMatch ? Number(shockMatch[1]) : 10;

  let hits = lookup(subject, rel);
  if (focus) hits = hits.filter((h) => h.counterparty === focus);
  // Dedupe: keep the first evidence per counterparty, but keep a second quote if it carries a number.
  const seen = new Set<Ticker>();
  hits = hits.filter((h) => {
    if (!seen.has(h.counterparty)) return seen.add(h.counterparty), true;
    return h.edge.revenueShare !== undefined;
  });

  const claims = hits.map((h, i) => claimFromEdge(`c${i + 1}`, subject, h));
  const counterparties = [...new Set(hits.map((h) => h.counterparty))];
  const covered = counterparties.filter((t) => statsFor(t));

  // Exposure: suppliers' disclosed revenue share from the subject × their revenue × cut.
  const exposure: ExposureRow[] = wantsShock
    ? hits
        .filter((h) => h.edge.revenueShare !== undefined && company(h.counterparty)?.revenueUsd)
        .map((h) => {
          const revenueUsd = company(h.counterparty)!.revenueUsd!;
          const share = h.edge.revenueShare!;
          const claimId = claims[hits.indexOf(h)].id;
          return { supplier: h.counterparty, revenueUsd, revenueShare: share, dropPct, atRiskUsd: revenueUsd * share * (dropPct / 100), claimId };
        })
    : [];

  const subjectName = nameOf(subject);
  const relWord = rel === "supplier" ? "suppliers" : rel === "customer" ? "customers" : rel === "competitor" ? "competitors" : "partners";

  const plan = [
    `Resolve ${subjectName}${focus ? ` and ${nameOf(focus)}` : ""} in the filing graph`,
    `Look up ${relWord} with filing evidence`,
    "Pull market links (sector beta & correlation)",
    ...(wantsShock ? [`Estimate revenue at risk for a ${dropPct}% cut`] : []),
    "Search filings for supporting context",
    "Draft memo with cited claims",
    "Verify every claim word-for-word against filings",
  ];
  const s = (label: string) => plan.findIndex((p) => p.startsWith(label));

  const calls: Script["calls"] = [
    {
      step: s("Look up"),
      tool: "graph_lookup",
      args: { company: subject, relation: rel },
      summary: `${hits.length} link${hits.length === 1 ? "" : "s"}: ${counterparties.join(", ") || "none"}`,
    },
    ...covered.slice(0, 3).map((t) => {
      const st = statsFor(t)!;
      return {
        step: s("Pull market"),
        tool: "sector_stats" as const,
        args: { company: t },
        summary: `β ${st.beta.toFixed(2)} · ρ ${st.correlation.toFixed(2)} to ${st.sector}`,
      };
    }),
    ...(wantsShock
      ? [
          {
            step: s("Estimate"),
            tool: "shock" as const,
            args: { company: subject, drop_pct: dropPct },
            summary: exposure.length
              ? exposure.map((x) => `${x.supplier} ${fmtUsd(x.atRiskUsd)}`).join(", ")
              : "no disclosed revenue share — dollar exposure not quantifiable",
          },
        ]
      : []),
    {
      step: s("Search"),
      tool: "kb_search",
      args: { query: `${subjectName} ${relWord}`, company: subject },
      summary: `8 passages · reranked, top score 0.91`,
    },
    {
      step: s("Verify"),
      tool: "check_claims",
      args: { claims: claims.length + 1 },
      summary: `${claims.length}/${claims.length + 1} claims pass`,
      agent: "verifier",
    },
  ];

  // A realistic distractor the verifier catches: a company mentioned near the subject but in a different role.
  const competitorMention = COMPANIES.find(
    (c) => c.ticker !== subject && !counterparties.includes(c.ticker) && lookup(subject, "competitor").some((h) => h.counterparty === c.ticker),
  );
  const distractor =
    competitorMention ?? COMPANIES.find((c) => c.ticker !== subject && !counterparties.includes(c.ticker) && c.sector === "external")!;
  const rejected: RejectedClaim[] = [
    {
      company: distractor.ticker,
      text: `${distractor.name} is one of ${subjectName}'s ${relWord}.`,
      reason: competitorMention
        ? `The only quote mentions ${distractor.name} as a competitor, not as ${REL_PHRASE[rel]}; no filing sentence states this relationship.`
        : `No sentence in the covered filings names both ${distractor.name} and ${subjectName}; the claim came from model background knowledge.`,
    },
  ];

  const findings: string[] = counterparties.length
    ? counterparties.map((t) => {
        const refs = claims.filter((c) => c.company === t).map((c) => `[${c.id}]`).join("");
        const st = statsFor(t);
        const extra = st ? ` Its stock tracks ${st.followsSector ?? st.sector} with ρ ${(st.followsCorrelation ?? st.correlation).toFixed(2)}.` : " It is outside the 15 covered filers, so there are no price stats for it.";
        return `**${nameOf(t)} (${t})** is identified as ${REL_PHRASE[rel]} ${rel === "competitor" || rel === "partner" ? "of" : "to"} ${subjectName} ${refs}.${extra}`;
      })
    : [`No filing sentence in the covered 10-Ks names ${relWord} of ${subjectName}.`];

  const sections: MemoSection[] = [{ heading: focus ? `${nameOf(focus)} ↔ ${subjectName}` : `${subjectName} ${relWord}`, paragraphs: findings }];

  if (wantsShock) {
    const total = exposure.reduce((a, x) => a + x.atRiskUsd, 0);
    sections.push({
      heading: `Revenue at risk from a ${dropPct}% cut`,
      paragraphs: exposure.length
        ? [
            `Using disclosed revenue shares, a ${dropPct}% cut in ${subjectName}'s purchases puts roughly **${fmtUsd(total)}** of annual revenue at risk across ${exposure.length} quantifiable supplier${exposure.length === 1 ? "" : "s"} ${exposure.map((x) => `[${x.claimId}]`).join("")}.`,
            "Estimate = supplier revenue × disclosed revenue share × cut %. It assumes the cut is spread evenly across product lines.",
          ]
        : [`None of these suppliers discloses ${subjectName}'s share of its revenue, so dollar exposure cannot be quantified from filings.`],
    });
  }

  const headline = focus
    ? exposure.length
      ? `A ${dropPct}% cut by ${subjectName} puts ~${fmtUsd(exposure.reduce((a, x) => a + x.atRiskUsd, 0))} of ${nameOf(focus)}'s revenue at risk`
      : `${nameOf(focus)}'s exposure to ${subjectName} is real but not quantifiable from filings`
    : `${counterparties.length} filing-backed ${relWord} of ${subjectName}`;

  return {
    plan,
    calls,
    rejected,
    memo: {
      question,
      headline,
      sections,
      claims,
      exposure: exposure.length ? exposure : undefined,
      caveats: [
        "Relationships are only as complete as the filings; counterparties that are not named do not appear.",
        "10-Ks can be up to ~13 months old.",
        "Research aid, not investment advice.",
      ],
    },
  };
}

export async function* mockAsk(question: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const started = performance.now();
  const script = buildScript(question);

  await sleep(500, signal);
  yield { type: "plan", steps: script.plan };

  let toolCalls = 0;
  let currentStep = -1;
  const advanceTo = async function* (step: number): AsyncGenerator<AgentEvent> {
    while (currentStep < step) {
      if (currentStep >= 0) yield { type: "step", index: currentStep, status: "done" };
      currentStep++;
      yield { type: "step", index: currentStep, status: "active" };
      await sleep(250, signal);
    }
  };

  for (const call of script.calls) {
    yield* advanceTo(call.step);
    const id = `t${++toolCalls}`;
    yield { type: "tool_call", id, tool: call.tool, args: call.args, agent: call.agent ?? "analyst" };
    const ms = 400 + Math.round(Math.random() * 900);
    await sleep(ms, signal);
    yield { type: "tool_result", id, summary: call.summary, ms };

    // Draft step sits just before verification.
    if (call.tool === "kb_search") {
      yield* advanceTo(script.plan.length - 2);
      await sleep(900, signal);
    }
  }

  const n = script.memo.claims.length;
  yield { type: "verifier", checked: n + script.rejected.length, passed: n, rejected: script.rejected };
  yield { type: "step", index: currentStep, status: "done" };
  await sleep(300, signal);
  yield { type: "memo", memo: script.memo };
  yield { type: "done", elapsedMs: Math.round(performance.now() - started), toolCalls };
}
