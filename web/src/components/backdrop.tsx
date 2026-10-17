// Page backdrop: ledger grid, slowly breathing glows, and a faint candlestick tape
// with a "ripple" pulse on the last price. Purely decorative and static-rendered.

const W = 1440;
const H = 900;
const N = 64;

// Deterministic random walk so server and client render the same chart.
function series() {
  let seed = 20261017;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out: { o: number; c: number; h: number; l: number }[] = [];
  let price = 0.62;
  for (let i = 0; i < N; i++) {
    const drift = 0.006 + Math.sin(i / 7) * 0.025;
    const o = price;
    const c = o + drift + (rand() - 0.5) * 0.07;
    const h = Math.max(o, c) + rand() * 0.025;
    const l = Math.min(o, c) - rand() * 0.025;
    out.push({ o, c, h, l });
    price = c;
  }
  return out;
}

const DATA = series();
const step = W / N;
const LO = Math.min(...DATA.map((d) => d.l));
const HI = Math.max(...DATA.map((d) => d.h));
// Map the price range into a band near the bottom of the page.
const y = (p: number) => H - 50 - ((p - LO) / (HI - LO)) * 230;
const LINE = DATA.map((d, i) => `${i === 0 ? "M" : "L"}${(i * step + step / 2).toFixed(1)},${y(d.c).toFixed(1)}`).join(" ");
const AREA = `${LINE} L${W - step / 2},${H} L${step / 2},${H} Z`;
const LAST = { x: (N - 1) * step + step / 2, y: y(DATA[N - 1].c) };

export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Ledger grid, fading out from the top */}
      <div className="backdrop-grid absolute inset-0" />

      {/* Breathing glows */}
      <div className="breathe absolute -top-40 -left-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,var(--glow-1),transparent)]" />
      <div className="breathe breathe-late absolute top-1/3 -right-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,var(--glow-2),transparent)]" />

      {/* Candlestick tape along the bottom */}
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
        <g mask="url(#bd-mask)" className="backdrop-tape">
          <path d={AREA} fill="url(#bd-area)" />
          {DATA.map((d, i) => {
            const x = i * step + step / 2;
            const up = d.c >= d.o;
            const color = up ? "var(--candle-up)" : "var(--candle-down)";
            return (
              <g key={i} stroke={color} fill={color}>
                <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} strokeWidth={1} />
                <rect x={x - step * 0.28} width={step * 0.56} y={y(Math.max(d.o, d.c))} height={Math.max(1.5, Math.abs(y(d.o) - y(d.c)))} strokeWidth={1} rx={1} />
              </g>
            );
          })}
          <path d={LINE} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeOpacity={0.35} className="draw-line" pathLength={1} />
          {/* Ripple on the last print */}
          <g transform={`translate(${LAST.x},${LAST.y})`}>
            <circle r={4} fill="var(--accent)" fillOpacity={0.6} />
            <circle r={4} fill="none" stroke="var(--accent)" className="ripple-ring" />
            <circle r={4} fill="none" stroke="var(--accent)" className="ripple-ring ripple-ring-late" />
          </g>
        </g>
      </svg>
    </div>
  );
}
