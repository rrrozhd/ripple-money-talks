"use client";

import { Minus, Plus, Scan } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Edge, Relation, Ticker } from "@/lib/types";
import { RELATION_COLOR, SECTOR_COLOR } from "../ui";
import { edgePath, type PositionedNode } from "./layout";

export type Selection = { kind: "node"; id: Ticker } | { kind: "edge"; id: string } | null;

interface Props {
  nodes: Map<Ticker, PositionedNode>;
  edges: Edge[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}

/** Spread parallel edges between the same pair so they don't overlap. */
function bends(edges: Edge[]) {
  const groups = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = [e.from, e.to].sort().join("|");
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out = new Map<string, number>();
  for (const group of groups.values()) {
    group.forEach((e, i) => {
      const base = (i - (group.length - 1) / 2) * 34 + 14;
      // Flip sign when drawn in the opposite direction so offsets stay on the same side.
      out.set(e.id, e.from < e.to ? base : -base);
    });
  }
  return out;
}

export function GraphCanvas({ nodes, edges, selection, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<Ticker | null>(null);
  const [, force] = useState(0);
  const drag = useRef<{ mode: "pan" | "node"; id?: Ticker; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const bend = useMemo(() => bends(edges), [edges]);

  // Fit the viewBox to the laid-out nodes (plus room for labels) so the graph fills any container shape.
  const box = useMemo(() => {
    const all = [...nodes.values()];
    if (!all.length) return { x: 0, y: 0, w: 1000, h: 680 };
    const pad = 40;
    const x0 = Math.min(...all.map((n) => n.x - n.r - 50)) - pad;
    const x1 = Math.max(...all.map((n) => n.x + n.r + 50)) + pad;
    const y0 = Math.min(...all.map((n) => n.y - n.r)) - pad;
    const y1 = Math.max(...all.map((n) => n.y + n.r + 18)) + pad;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [nodes]);

  const focus = hover ?? (selection?.kind === "node" ? selection.id : null);
  const neighbors = useMemo(() => {
    if (!focus) return null;
    const s = new Set<Ticker>([focus]);
    for (const e of edges) if (e.from === focus || e.to === focus) s.add(e.from).add(e.to);
    return s;
  }, [focus, edges]);

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const zoomAt = (factor: number, cx = box.x + box.w / 2, cy = box.y + box.h / 2) =>
    setView((v) => {
      const k = Math.min(3, Math.max(0.5, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });

  const onPointerDown = (e: React.PointerEvent, id?: Ticker) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toSvg(e.clientX, e.clientY);
    const n = id ? nodes.get(id) : undefined;
    drag.current = n
      ? { mode: "node", id, sx: p.x, sy: p.y, ox: n.x, oy: n.y, moved: false }
      : { mode: "pan", sx: p.x, sy: p.y, ox: view.x, oy: view.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e.clientX, e.clientY);
    const dx = p.x - d.sx;
    const dy = p.y - d.sy;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    if (d.mode === "pan") setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else {
      const n = nodes.get(d.id!)!;
      n.x = d.ox + dx / view.k;
      n.y = d.oy + dy / view.k;
      force((x) => x + 1);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect(d.mode === "node" ? { kind: "node", id: d.id! } : null);
  };

  const relations = [...new Set(edges.map((e) => e.relation))] as Relation[];

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-line bg-surface">
      <svg
        ref={svgRef}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        className="h-full w-full touch-none select-none"
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => {
          const p = toSvg(e.clientX, e.clientY);
          zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
        }}
        role="img"
        aria-label="Relationship graph of companies and their filing-backed links"
      >
        <defs>
          <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--line)" />
          </pattern>
          {relations.map((r) => (
            <marker key={r} id={`arrow-${r}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" fill={RELATION_COLOR[r]} />
            </marker>
          ))}
        </defs>
        <rect x={box.x - 5000} y={box.y - 5000} width={box.w + 10000} height={box.h + 10000} fill="url(#dots)" />

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {edges.map((e) => {
            const a = nodes.get(e.from);
            const b = nodes.get(e.to);
            if (!a || !b) return null;
            const { d } = edgePath(a, b, bend.get(e.id) ?? 0);
            const selected = selection?.kind === "edge" && selection.id === e.id;
            const dim = neighbors && !(neighbors.has(e.from) && neighbors.has(e.to) && (e.from === focus || e.to === focus));
            return (
              <g key={e.id} opacity={dim ? 0.08 : 1} className="transition-opacity">
                <path d={d} fill="none" stroke="transparent" strokeWidth={12} className="cursor-pointer" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => onSelect({ kind: "edge", id: e.id })} />
                <path
                  d={d}
                  fill="none"
                  stroke={RELATION_COLOR[e.relation]}
                  strokeWidth={selected ? 2.6 : 1.4}
                  strokeDasharray={e.relation === "competitor" ? "4 3" : undefined}
                  markerEnd={`url(#arrow-${e.relation})`}
                  opacity={selected ? 1 : 0.75}
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {[...nodes.values()].map((n) => {
            const selected = selection?.kind === "node" && selection.id === n.id;
            const dim = neighbors && !neighbors.has(n.id);
            const external = n.company.sector === "external";
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.25 : 1}
                className="cursor-pointer transition-opacity"
                onPointerDown={(e) => onPointerDown(e, n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                role="button"
                aria-label={n.company.name}
              >
                {selected && <circle r={n.r + 6} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                <circle
                  r={n.r}
                  fill="var(--surface)"
                  stroke={SECTOR_COLOR[n.company.sector]}
                  strokeWidth={external ? 1.5 : 2.5}
                  strokeDasharray={external ? "3 3" : undefined}
                />
                <circle r={n.r - 5} fill={SECTOR_COLOR[n.company.sector]} opacity={external ? 0.06 : 0.12} />
                <text textAnchor="middle" dy="0.35em" className="fill-ink font-mono text-[11px] font-medium" pointerEvents="none">
                  {n.id}
                </text>
                <text textAnchor="middle" y={n.r + 14} className="fill-muted font-sans text-[10px]" pointerEvents="none">
                  {n.company.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <button onClick={() => zoomAt(1.25)} className="p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={() => zoomAt(0.8)} className="border-t border-line p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <button onClick={() => setView({ k: 1, x: 0, y: 0 })} className="border-t border-line p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Reset view">
          <Scan className="h-4 w-4" />
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-faint">Arrows point from the filer to the company it names · drag to pan · scroll to zoom</p>
    </div>
  );
}
