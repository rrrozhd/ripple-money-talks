import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { Company, Edge, Sector, Ticker } from "@/lib/types";

// Cluster centers as fractions of the canvas, so the layout follows the container's shape.
const CENTERS: Record<Sector, [number, number]> = {
  semis: [0.28, 0.28],
  equipment: [0.74, 0.3],
  hardware: [0.3, 0.74],
  external: [0.68, 0.66],
};

export interface PositionedNode extends SimulationNodeDatum {
  id: Ticker;
  company: Company;
  r: number;
  x: number;
  y: number;
}

export function radiusFor(c: Company) {
  // Without revenue data, covered filers are still drawn larger than outside counterparties.
  if (!c.revenueUsd) return c.sector === "external" ? 15 : 21;
  // sqrt scale: $2.8B → ~17, $390B → ~38
  return 13 + Math.sqrt(c.revenueUsd / 1e9) * 1.3;
}

/** Deterministic force layout, clustered by sector. Laid out in container pixels so text stays readable; recomputed only when the container is resized. */
export function layout(companies: Company[], edges: Edge[], width: number, height: number): Map<Ticker, PositionedNode> {
  const cx = (s: Sector) => CENTERS[s][0] * width;
  const cy = (s: Sector) => CENTERS[s][1] * height;
  const nodes: PositionedNode[] = companies.map((c) => ({
    id: c.ticker,
    company: c,
    r: radiusFor(c),
    x: cx(c.sector),
    y: cy(c.sector),
  }));
  const links = edges.map((e) => ({ source: e.from, target: e.to }));

  const sim = forceSimulation(nodes)
    .force("link", forceLink<PositionedNode, { source: string; target: string }>(links).id((d) => d.id).distance(140).strength(0.05))
    .force("charge", forceManyBody().strength(-700))
    .force("x", forceX<PositionedNode>((d) => cx(d.company.sector)).strength(0.16))
    .force("y", forceY<PositionedNode>((d) => cy(d.company.sector)).strength(0.16))
    .force("collide", forceCollide<PositionedNode>((d) => d.r + 28))
    .stop();
  for (let i = 0; i < 400; i++) sim.tick();

  return new Map(nodes.map((n) => [n.id, n]));
}

/** Curved path between two circles, trimmed to their borders so arrowheads stay visible. */
export function edgePath(a: PositionedNode, b: PositionedNode, bend: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  // Control point offset perpendicular to the chord.
  const cx = (a.x + b.x) / 2 + nx * bend;
  const cy = (a.y + b.y) / 2 + ny * bend;
  const trim = (p: PositionedNode, tx: number, ty: number, extra: number) => {
    const vx = tx - p.x;
    const vy = ty - p.y;
    const l = Math.hypot(vx, vy) || 1;
    return [p.x + (vx / l) * (p.r + extra), p.y + (vy / l) * (p.r + extra)];
  };
  const [sx, sy] = trim(a, cx, cy, 2);
  const [ex, ey] = trim(b, cx, cy, 6);
  return { d: `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`, mx: (sx + 2 * cx + ex) / 4, my: (sy + 2 * cy + ey) / 4 };
}
