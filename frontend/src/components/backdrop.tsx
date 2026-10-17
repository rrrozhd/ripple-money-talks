// Page backdrop: ledger grid, slowly breathing glows, and a faint candlestick tape
// that rolls like a wave with a "ripple" pulse on the last price. Purely decorative.

import { WaveTape } from "./wave-tape";

export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Ledger grid, fading out from the top */}
      <div className="backdrop-grid absolute inset-0" />

      {/* Breathing glows */}
      <div className="breathe absolute -top-40 -left-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,var(--glow-1),transparent)]" />
      <div className="breathe breathe-late absolute top-1/3 -right-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,var(--glow-2),transparent)]" />

      {/* Candlestick tape along the bottom, rolling like a wave */}
      <WaveTape />
    </div>
  );
}
