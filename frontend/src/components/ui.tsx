import { ArrowUpRight } from "lucide-react";
import type { Filing, Relation, Sector } from "@/lib/types";

export const RELATION_COLOR: Record<Relation, string> = {
  supplier: "var(--rel-supplier)",
  customer: "var(--rel-customer)",
  competitor: "var(--rel-competitor)",
  partner: "var(--rel-partner)",
};

export const SECTOR_COLOR: Record<Sector, string> = {
  semis: "var(--sec-semis)",
  equipment: "var(--sec-equipment)",
  hardware: "var(--sec-hardware)",
  external: "var(--sec-external)",
};

export const SECTOR_LABEL: Record<Sector, string> = {
  semis: "Semiconductors",
  equipment: "Semi equipment",
  hardware: "Hardware",
  external: "Not covered",
};

export const SECTOR_SHORT: Record<Sector, string> = {
  semis: "Semis",
  equipment: "Equipment",
  hardware: "Hardware",
  external: "—",
};

export function fmtUsd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function RelationBadge({ relation }: { relation: Relation }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize"
      style={{ color: RELATION_COLOR[relation], background: `color-mix(in srgb, ${RELATION_COLOR[relation]} 12%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: RELATION_COLOR[relation] }} />
      {relation}
    </span>
  );
}

export function Ticker({ children, sector }: { children: string; sector?: Sector }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-[11px] font-medium text-ink">
      {sector && <span className="h-1.5 w-1.5 rounded-full" style={{ background: SECTOR_COLOR[sector] }} />}
      {children}
    </span>
  );
}

export function FilingLink({ filing }: { filing: Filing }) {
  return (
    <a
      href={filing.url}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-accent"
    >
      {filing.filer ? `${filing.filer} ` : ""}
      {filing.form}
      {filing.fiscalYear && ` FY${filing.fiscalYear}`}
      {filing.filedAt ? <span className="text-faint">· filed {filing.filedAt}</span> : <span className="text-faint">· open on SEC EDGAR</span>}
      <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
    </a>
  );
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Renders a filing sentence with the company mention and any numbers highlighted. */
export function Quote({ text, terms = [], className = "" }: { text: string; terms?: (string | undefined)[]; className?: string }) {
  const clean = terms.filter((t): t is string => !!t);
  const parts = clean.length ? text.split(new RegExp(`(${clean.map(escapeRe).join("|")})`, "g")) : [text];
  return (
    <q className={`filing-quote block text-[15px] text-ink before:content-['“'] after:content-['”'] ${className}`}>
      {parts.map((p, i) =>
        clean.includes(p) ? (
          <mark key={i} className="rounded-sm bg-highlight px-0.5 text-ink not-italic">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </q>
  );
}
