"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usingMock } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Ask" },
  { href: "/graph", label: "Graph" },
  { href: "/shock", label: "Shock" },
  { href: "/eval", label: "Evaluation" },
] as const;

export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.65" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.3" />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:gap-6 sm:px-8 lg:px-12 xl:px-16">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <Logo className="h-6 w-6 text-accent" />
          <span className="font-serif text-xl tracking-tight">Ripple</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2 py-1.5 transition-colors sm:px-3 ${
                  active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span className="hidden font-mono md:inline">15 filers · latest 10-Ks · 1y daily prices</span>
          {usingMock && (
            <span
              title="Ask, Graph and Evaluation use mock data until the backend serves /ask, /graph and /eval. Shock is live."
              className="rounded-full border border-dashed border-line-strong px-2 py-0.5 whitespace-nowrap sm:px-2.5 font-mono uppercase tracking-wider"
            >
              mock<span className="hidden sm:inline"> data</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
