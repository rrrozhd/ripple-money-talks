"use client";

import { useEffect, useRef } from "react";

// A candlestick tape whose price line rolls like a wave. Each candle opens at the
// previous close, so as the wave passes, candles flip between up (green) and down (red).
// Geometry is updated straight on the DOM each frame to avoid React re-renders.

const W = 1440;
const H = 900;
const N = 64;
const STEP = W / N;
const FPS = 30;

// Deterministic trend + wick sizes so the server render matches the first client frame.
function makeBase() {
  let seed = 20261017;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const trend: number[] = [];
  const wick: number[] = [];
  let p = 0;
  for (let i = 0; i <= N; i++) {
    p += 0.006 + Math.sin(i / 7) * 0.02 + (rand() - 0.5) * 0.04;
    trend.push(p);
    wick.push(0.008 + rand() * 0.022);
  }
  const lo = Math.min(...trend);
  const hi = Math.max(...trend);
  return { trend: trend.map((v) => (v - lo) / (hi - lo)), wick };
}

const BASE = makeBase();

/** Price at candle index i (−1..N−1) and time t (seconds), roughly in 0..1. */
function price(i: number, t: number) {
  const k = Math.max(0, i + 1); // trend is offset by one so index −1 exists
  return (
    BASE.trend[k] * 0.45 +
    0.27 +
    Math.sin(i * 0.3 - t * 0.85) * 0.13 + // main swell travelling right
    Math.sin(i * 0.09 + t * 0.37) * 0.06 // slow counter-swell
  );
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const y = (p: number) => r1(H - 60 - p * 230);
const xOf = (i: number) => i * STEP + STEP / 2;

interface Frame {
  candles: { up: boolean; strength: number; hi: number; lo: number; top: number; body: number }[];
  line: string;
  area: string;
  last: { x: number; y: number };
}

function frame(t: number): Frame {
  const candles: Frame["candles"] = [];
  let line = "";
  for (let i = 0; i < N; i++) {
    const o = price(i - 1, t);
    const c = price(i, t);
    const w = BASE.wick[i];
    const yo = y(o);
    const yc = y(c);
    candles.push({
      up: c >= o,
      // Bigger moves read stronger; tiny moves fade toward neutral.
      strength: Math.round(Math.min(1, Math.abs(c - o) / 0.035) * 100) / 100,
      hi: y(Math.max(o, c) + w),
      lo: y(Math.min(o, c) - w),
      top: Math.min(yo, yc),
      body: r1(Math.max(1.5, Math.abs(yo - yc))),
    });
    line += `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yc}`;
  }
  const area = `${line} L${xOf(N - 1)},${H} L${xOf(0)},${H} Z`;
  return { candles, line, area, last: { x: xOf(N - 1), y: y(price(N - 1, t)) } };
}

const INITIAL = frame(0);
const UP = "var(--candle-up)";
const DOWN = "var(--candle-down)";

export function WaveTape() {
  const candleRefs = useRef<(SVGGElement | null)[]>([]);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS) return;
      last = now;
      const f = frame((now - start) / 1000);
      f.candles.forEach((c, i) => {
        const g = candleRefs.current[i];
        if (!g) return;
        const color = c.up ? UP : DOWN;
        g.setAttribute("stroke", color);
        g.setAttribute("fill", color);
        g.setAttribute("opacity", (0.45 + 0.55 * c.strength).toFixed(2));
        const [wick, body] = g.children as unknown as [SVGLineElement, SVGRectElement];
        wick.setAttribute("y1", c.hi.toFixed(1));
        wick.setAttribute("y2", c.lo.toFixed(1));
        body.setAttribute("y", c.top.toFixed(1));
        body.setAttribute("height", c.body.toFixed(1));
      });
      lineRef.current?.setAttribute("d", f.line);
      areaRef.current?.setAttribute("d", f.area);
      dotRef.current?.setAttribute("transform", `translate(${f.last.x},${f.last.y.toFixed(1)})`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMaxYMax slice" className="absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id="bd-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="bd-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="25%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id="bd-mask">
          <rect width={W} height={H} fill="url(#bd-fade)" />
        </mask>
      </defs>
      <g mask="url(#bd-mask)">
        <path ref={areaRef} d={INITIAL.area} fill="url(#bd-area)" />
        {INITIAL.candles.map((c, i) => {
          const x = xOf(i);
          const color = c.up ? UP : DOWN;
          return (
            <g
              key={i}
              ref={(el) => {
                candleRefs.current[i] = el;
              }}
              stroke={color}
              fill={color}
              opacity={(0.45 + 0.55 * c.strength).toFixed(2)}
            >
              <line x1={x} x2={x} y1={c.hi} y2={c.lo} strokeWidth={1} />
              <rect x={x - STEP * 0.28} width={STEP * 0.56} y={c.top} height={c.body} strokeWidth={1} rx={1} />
            </g>
          );
        })}
        <path ref={lineRef} d={INITIAL.line} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeOpacity={0.35} />
        {/* Ripple on the last print, riding the wave */}
        <g ref={dotRef} transform={`translate(${INITIAL.last.x},${INITIAL.last.y})`}>
          <circle r={4} fill="var(--accent)" fillOpacity={0.6} />
          <circle r={4} fill="none" stroke="var(--accent)" className="ripple-ring" />
          <circle r={4} fill="none" stroke="var(--accent)" className="ripple-ring ripple-ring-late" />
        </g>
      </g>
    </svg>
  );
}
