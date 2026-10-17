// MOCK DATA — placeholder until the backend serves /graph.
// Quotes below are illustrative paraphrases written for the UI, NOT verbatim 10-K text.
// Revenue shares, betas and correlations are made-up values in a realistic range.

import type { Company, Edge, Filing, Graph, Relation, SectorStats, Ticker } from "../types";

export const COMPANIES: Company[] = [
  // Semiconductors
  { ticker: "NVDA", name: "NVIDIA", sector: "semis", revenueUsd: 130.5e9, cik: "1045810" },
  { ticker: "AMD", name: "Advanced Micro Devices", sector: "semis", revenueUsd: 25.8e9, cik: "2488" },
  { ticker: "INTC", name: "Intel", sector: "semis", revenueUsd: 53.1e9, cik: "50863" },
  { ticker: "QCOM", name: "Qualcomm", sector: "semis", revenueUsd: 39.0e9, cik: "804328" },
  { ticker: "MU", name: "Micron Technology", sector: "semis", revenueUsd: 25.1e9, cik: "723125" },
  // Semiconductor equipment
  { ticker: "AMAT", name: "Applied Materials", sector: "equipment", revenueUsd: 27.2e9, cik: "6951" },
  { ticker: "LRCX", name: "Lam Research", sector: "equipment", revenueUsd: 18.4e9, cik: "707549" },
  { ticker: "KLAC", name: "KLA", sector: "equipment", revenueUsd: 12.2e9, cik: "319201" },
  { ticker: "TER", name: "Teradyne", sector: "equipment", revenueUsd: 2.8e9, cik: "97210" },
  { ticker: "ENTG", name: "Entegris", sector: "equipment", revenueUsd: 3.2e9, cik: "1101302" },
  // Hardware
  { ticker: "AAPL", name: "Apple", sector: "hardware", revenueUsd: 391.0e9, cik: "320193" },
  { ticker: "DELL", name: "Dell Technologies", sector: "hardware", revenueUsd: 95.6e9, cik: "1571996" },
  { ticker: "HPQ", name: "HP Inc.", sector: "hardware", revenueUsd: 53.6e9, cik: "47217" },
  { ticker: "SMCI", name: "Super Micro Computer", sector: "hardware", revenueUsd: 22.0e9, cik: "1375365" },
  { ticker: "HPE", name: "Hewlett Packard Enterprise", sector: "hardware", revenueUsd: 30.1e9, cik: "1645590" },
  // Counterparties outside the covered 15 (no filings ingested)
  { ticker: "TSM", name: "TSMC", sector: "external" },
  { ticker: "SMSN", name: "Samsung Electronics", sector: "external" },
  { ticker: "SKHY", name: "SK hynix", sector: "external" },
  { ticker: "FXCN", name: "Foxconn", sector: "external" },
  { ticker: "MSFT", name: "Microsoft", sector: "external" },
];

const byTicker = new Map(COMPANIES.map((c) => [c.ticker, c]));
export const company = (t: Ticker) => byTicker.get(t);
export const nameOf = (t: Ticker) => byTicker.get(t)?.name ?? t;

const FISCAL: Record<string, [number, string]> = {
  NVDA: [2025, "2025-02-26"], AMD: [2024, "2025-02-05"], INTC: [2024, "2025-01-31"],
  QCOM: [2024, "2024-11-06"], MU: [2024, "2024-10-04"], AMAT: [2024, "2024-12-13"],
  LRCX: [2025, "2025-08-15"], KLAC: [2025, "2025-08-08"], TER: [2024, "2025-02-21"],
  ENTG: [2024, "2025-02-12"], AAPL: [2024, "2024-11-01"], DELL: [2025, "2025-03-25"],
  HPQ: [2024, "2024-12-12"], SMCI: [2025, "2025-08-28"], HPE: [2024, "2024-12-19"],
};

export function filingFor(filer: Ticker, quote: string): Filing {
  const [fiscalYear, filedAt] = FISCAL[filer];
  const cik = byTicker.get(filer)?.cik;
  // The real backend links the exact filing document; the text fragment scrolls to the sentence.
  const fragment = encodeURIComponent(quote.split(" ").slice(0, 8).join(" "));
  return {
    filer,
    form: "10-K",
    fiscalYear,
    filedAt,
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K#:~:text=${fragment}`,
  };
}

type Row = [from: Ticker, to: Ticker, relation: Relation, quote: string, revenueShare?: number];

const ROWS: Row[] = [
  // NVIDIA
  ["NVDA", "TSM", "supplier", "We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, to produce our semiconductor wafers."],
  ["NVDA", "SKHY", "supplier", "We purchase memory from SK hynix and other suppliers for use in our data center products."],
  ["NVDA", "MU", "supplier", "Our memory suppliers include Micron Technology, which supplies high-bandwidth memory used in our accelerated computing platforms."],
  ["NVDA", "AMD", "competitor", "Our current competitors include suppliers of GPUs and CPUs, such as Advanced Micro Devices, Inc. and Intel Corporation."],
  ["NVDA", "INTC", "competitor", "Intel Corporation competes with us in data center accelerators and CPUs."],
  ["NVDA", "HPE", "partner", "We work with system makers, including Hewlett Packard Enterprise, to bring our platforms to enterprise customers."],
  // AMD
  ["AMD", "TSM", "supplier", "We rely on Taiwan Semiconductor Manufacturing Company Limited to manufacture our products at advanced process nodes."],
  ["AMD", "NVDA", "competitor", "In data center GPUs, our principal competitor is NVIDIA Corporation."],
  ["AMD", "INTC", "competitor", "Intel Corporation is our principal competitor in the microprocessor market."],
  ["AMD", "MSFT", "customer", "Microsoft Corporation accounted for a significant portion of our gaming segment net revenue."],
  // Intel
  ["INTC", "TSM", "supplier", "We use third-party foundries, including Taiwan Semiconductor Manufacturing Company, for certain products and components."],
  ["INTC", "AMAT", "supplier", "We purchase manufacturing equipment from a limited number of suppliers, including Applied Materials, Inc."],
  ["INTC", "LRCX", "supplier", "Lam Research Corporation is one of the suppliers of etch and deposition equipment we rely on."],
  ["INTC", "DELL", "customer", "Dell Technologies Inc. was one of our three largest customers by net revenue."],
  ["INTC", "HPQ", "customer", "HP Inc. was among our largest customers by net revenue."],
  ["INTC", "AMD", "competitor", "We face significant competition from Advanced Micro Devices, Inc. in client and server CPUs."],
  // Qualcomm
  ["QCOM", "AAPL", "customer", "Apple Inc. is one of our largest customers for modem products."],
  ["QCOM", "TSM", "supplier", "We rely on foundries such as Taiwan Semiconductor Manufacturing Company to manufacture our integrated circuits."],
  ["QCOM", "SMSN", "supplier", "Samsung Electronics manufactures certain of our integrated circuits."],
  ["QCOM", "AAPL", "competitor", "Apple has announced it is developing its own modem products that would compete with ours."],
  // Micron
  ["MU", "NVDA", "customer", "Sales to NVIDIA Corporation were 11% of our total revenue in the year.", 0.11],
  ["MU", "AMAT", "supplier", "We obtain semiconductor equipment from a limited number of suppliers, including Applied Materials."],
  ["MU", "LRCX", "supplier", "Lam Research Corporation supplies deposition and etch tools used in our fabs."],
  ["MU", "SKHY", "competitor", "We compete with SK hynix and Samsung Electronics in DRAM and NAND."],
  ["MU", "SMSN", "competitor", "Samsung Electronics is one of our principal competitors in memory."],
  // Applied Materials
  ["AMAT", "TSM", "customer", "Taiwan Semiconductor Manufacturing Company accounted for 15% of our net revenue.", 0.15],
  ["AMAT", "SMSN", "customer", "Samsung Electronics accounted for a significant portion of our net revenue."],
  ["AMAT", "INTC", "customer", "Intel Corporation is among our largest semiconductor systems customers."],
  ["AMAT", "LRCX", "competitor", "Our competitors include Lam Research Corporation and Tokyo Electron Limited."],
  ["AMAT", "KLAC", "competitor", "In process control, we compete with KLA Corporation."],
  // Lam Research
  ["LRCX", "TSM", "customer", "Revenue from Taiwan Semiconductor Manufacturing Company represented 16% of total revenue.", 0.16],
  ["LRCX", "SMSN", "customer", "Samsung Electronics Company, Ltd. accounted for a significant portion of our revenues."],
  ["LRCX", "MU", "customer", "Micron Technology, Inc. was among our most significant customers."],
  ["LRCX", "AMAT", "competitor", "We compete with Applied Materials, Inc. in deposition and etch."],
  // KLA
  ["KLAC", "TSM", "customer", "Taiwan Semiconductor Manufacturing Company accounted for more than 10% of our revenues."],
  ["KLAC", "AMAT", "competitor", "Applied Materials, Inc. competes with us in certain inspection and metrology markets."],
  // Teradyne
  ["TER", "TSM", "customer", "Taiwan Semiconductor Manufacturing Company was a significant customer of our semiconductor test segment."],
  // Entegris
  ["ENTG", "TSM", "customer", "Taiwan Semiconductor Manufacturing Company accounted for 13% of our net sales.", 0.13],
  ["ENTG", "INTC", "customer", "Intel Corporation is one of our largest customers."],
  ["ENTG", "SMSN", "customer", "Samsung Electronics is among our largest customers."],
  // Apple
  ["AAPL", "TSM", "supplier", "Substantially all of our processors are manufactured by Taiwan Semiconductor Manufacturing Company."],
  ["AAPL", "QCOM", "supplier", "We purchase cellular modems from Qualcomm Incorporated."],
  ["AAPL", "FXCN", "partner", "Substantially all of our hardware products are manufactured by outsourcing partners, including Hon Hai Precision Industry Co., Ltd. (Foxconn)."],
  ["AAPL", "SMSN", "competitor", "Samsung Electronics competes with us in smartphones and tablets."],
  // Dell
  ["DELL", "NVDA", "supplier", "We rely on NVIDIA Corporation for GPUs used in our AI-optimized servers."],
  ["DELL", "INTC", "supplier", "We purchase processors from Intel Corporation and Advanced Micro Devices, Inc."],
  ["DELL", "AMD", "supplier", "Advanced Micro Devices, Inc. supplies processors for certain of our server and client products."],
  ["DELL", "HPQ", "competitor", "HP Inc. is one of our principal competitors in personal computers."],
  ["DELL", "HPE", "competitor", "We compete with Hewlett Packard Enterprise in servers and storage."],
  ["DELL", "SMCI", "competitor", "Super Micro Computer, Inc. competes with us in AI servers."],
  // HP Inc.
  ["HPQ", "INTC", "supplier", "We source processors from Intel Corporation for many of our personal systems products."],
  ["HPQ", "AMD", "supplier", "Advanced Micro Devices, Inc. supplies processors used in certain of our products."],
  ["HPQ", "DELL", "competitor", "Dell Technologies Inc. is among our primary competitors in personal systems."],
  // Super Micro
  ["SMCI", "NVDA", "supplier", "We depend on NVIDIA Corporation for GPUs used in a substantial portion of our systems."],
  ["SMCI", "AMD", "supplier", "We purchase CPUs and GPUs from Advanced Micro Devices, Inc."],
  ["SMCI", "INTC", "supplier", "Intel Corporation supplies processors for many of our server products."],
  ["SMCI", "DELL", "competitor", "We compete with Dell Technologies Inc. and Hewlett Packard Enterprise."],
  ["SMCI", "HPE", "competitor", "Hewlett Packard Enterprise is one of our principal competitors in servers."],
  // HPE
  ["HPE", "NVDA", "partner", "We collaborate with NVIDIA Corporation on AI computing solutions."],
  ["HPE", "AMD", "supplier", "Advanced Micro Devices, Inc. supplies processors used in our servers."],
  ["HPE", "DELL", "competitor", "Dell Technologies Inc. is a principal competitor in compute and storage."],
];

// Names as they appear in filings, longest first, used to find the mention inside a quote.
const LEGAL_NAMES: Record<Ticker, string[]> = {
  NVDA: ["NVIDIA Corporation", "NVIDIA"],
  AMD: ["Advanced Micro Devices, Inc.", "Advanced Micro Devices"],
  INTC: ["Intel Corporation", "Intel"],
  QCOM: ["Qualcomm Incorporated", "Qualcomm"],
  MU: ["Micron Technology, Inc.", "Micron Technology", "Micron"],
  AMAT: ["Applied Materials, Inc.", "Applied Materials"],
  LRCX: ["Lam Research Corporation", "Lam Research"],
  KLAC: ["KLA Corporation"],
  TER: ["Teradyne"],
  ENTG: ["Entegris"],
  AAPL: ["Apple Inc.", "Apple"],
  DELL: ["Dell Technologies Inc.", "Dell Technologies"],
  HPQ: ["HP Inc."],
  SMCI: ["Super Micro Computer, Inc."],
  HPE: ["Hewlett Packard Enterprise"],
  TSM: ["Taiwan Semiconductor Manufacturing Company Limited", "Taiwan Semiconductor Manufacturing Company"],
  SMSN: ["Samsung Electronics Company, Ltd.", "Samsung Electronics"],
  SKHY: ["SK hynix"],
  FXCN: ["Hon Hai Precision Industry Co., Ltd. (Foxconn)", "Foxconn"],
  MSFT: ["Microsoft Corporation"],
};

export const mentionIn = (quote: string, t: Ticker) => LEGAL_NAMES[t]?.find((n) => quote.includes(n));

export const EDGES: Edge[] = ROWS.map(([from, to, relation, quote, revenueShare], i) => ({
  id: `e${i + 1}`,
  from,
  to,
  relation,
  quote,
  mention: mentionIn(quote, to),
  filing: filingFor(from, quote),
  ...(revenueShare ? { revenueShare } : {}),
}));

export const STATS: SectorStats[] = [
  { ticker: "NVDA", sector: "semis", beta: 1.38, correlation: 0.81, followsSector: "semis", followsCorrelation: 0.81 },
  { ticker: "AMD", sector: "semis", beta: 1.29, correlation: 0.74, followsSector: "semis", followsCorrelation: 0.74 },
  { ticker: "INTC", sector: "semis", beta: 0.92, correlation: 0.41, followsSector: "semis", followsCorrelation: 0.41 },
  { ticker: "QCOM", sector: "semis", beta: 0.97, correlation: 0.66, followsSector: "semis", followsCorrelation: 0.66 },
  { ticker: "MU", sector: "semis", beta: 1.44, correlation: 0.77, followsSector: "semis", followsCorrelation: 0.77 },
  { ticker: "AMAT", sector: "equipment", beta: 1.05, correlation: 0.88, followsSector: "equipment", followsCorrelation: 0.88 },
  { ticker: "LRCX", sector: "equipment", beta: 1.12, correlation: 0.9, followsSector: "equipment", followsCorrelation: 0.9 },
  { ticker: "KLAC", sector: "equipment", beta: 0.98, correlation: 0.86, followsSector: "equipment", followsCorrelation: 0.86 },
  { ticker: "TER", sector: "equipment", beta: 1.08, correlation: 0.58, followsSector: "equipment", followsCorrelation: 0.58 },
  { ticker: "ENTG", sector: "equipment", beta: 1.02, correlation: 0.72, followsSector: "equipment", followsCorrelation: 0.72 },
  { ticker: "AAPL", sector: "hardware", beta: 0.34, correlation: 0.11, followsSector: "semis", followsCorrelation: 0.36 },
  { ticker: "DELL", sector: "hardware", beta: 1.31, correlation: 0.69, followsSector: "hardware", followsCorrelation: 0.69 },
  { ticker: "HPQ", sector: "hardware", beta: 0.71, correlation: 0.52, followsSector: "hardware", followsCorrelation: 0.52 },
  { ticker: "SMCI", sector: "hardware", beta: 1.86, correlation: 0.61, followsSector: "semis", followsCorrelation: 0.63 },
  { ticker: "HPE", sector: "hardware", beta: 0.88, correlation: 0.64, followsSector: "hardware", followsCorrelation: 0.64 },
];

export const statsFor = (t: Ticker) => STATS.find((s) => s.ticker === t);

export const MOCK_GRAPH: Graph = {
  companies: COMPANIES,
  edges: EDGES,
  stats: STATS,
  asOf: "2026-10-17",
};
