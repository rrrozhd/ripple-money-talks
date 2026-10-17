import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Row = { version: string; runs: number; precision: number; recall: number; grounded: number; seconds: number }
type Proof = {
  table: Row[]
  coverage: { reference_relationships: number; recall_all: number; recall_known_companies: number; funnel: Record<string, number> } | null
  prism: { connected?: string; traces?: number; steps?: Record<string, string>; kb_documents?: number; kb_assigned_to_ripple?: number; error?: string }
}
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "–")

export default function Proofs() {
  const [p, setP] = useState<Proof | null>(null)
  useEffect(() => { fetch("/api/proofs").then(r => r.json()).then(setP) }, [])
  if (!p) return <p className="p-6 text-sm text-muted-foreground">Computing proofs from the saved runs and PRISM…</p>

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Proof it works</h1>
        <p className="text-sm text-muted-foreground">Everything on this page is computed live from the saved runs, the SEC filings and PRISM's API.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Same 60 questions, every version</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="py-2">Version</th><th>Runs</th><th>Claims backed by exact quote*</th><th>Relationship precision†</th><th>Recall†</th><th>Seconds / question</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {p.table.map(r => (
                <tr key={r.version} className="border-t">
                  <td className="py-2 font-medium">{r.version}</td><td>{r.runs}</td><td>{pct(r.grounded)}</td>
                  <td>{pct(r.precision)}</td><td>{pct(r.recall)}</td><td>{Math.round(r.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            * Average per question: every claimed company's quote must appear word for word in the 10-K and name the company.
            † Against an independent reference extracted by reading every filing in full (only companies on Ripple's list).
          </p>
        </CardContent>
      </Card>

      {p.coverage && (
        <Card>
          <CardHeader><CardTitle>Graph coverage</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Stat label="Recall, companies Ripple knows" value={pct(p.coverage.recall_known_companies)} />
            <Stat label="Recall, all companies" value={pct(p.coverage.recall_all)} />
            <Stat label="Reference relationships" value={String(p.coverage.reference_relationships)} />
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Misses: {Object.entries(p.coverage.funnel).filter(([k]) => k !== "found").map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>PRISM</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {p.prism.error ? <p className="text-destructive">{p.prism.error}</p> : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge>{p.prism.connected}</Badge>
                <Badge variant="secondary">{p.prism.traces} traces</Badge>
                <Badge variant="secondary">Knowledge Base: {p.prism.kb_assigned_to_ripple}/{p.prism.kb_documents} filings assigned to agent ripple</Badge>
              </div>
              <ul className="list-disc pl-5 text-muted-foreground">
                {Object.entries(p.prism.steps ?? {}).filter(([, v]) => !/key/i.test(v)).map(([k, v]) => <li key={k}>{v}</li>)}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-3xl font-semibold tabular-nums">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
}
