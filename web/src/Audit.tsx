import { useCallback, useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Item = { id: number; filer_name: string; company: string; relation: string; quote: string; link: string; verdict: string | null }
type Metric = { value: number | null; ci95: [number, number] | null; n: number }
type Metrics = { reviewed: number; total: number; graph_precision: Metric; reference_precision: Metric; recall: Metric; recall_known_companies: Metric }

const PHRASE: Record<string, string> = {
  supplier: "supplies", customer: "buys from", competitor: "competes with", partner: "partners with",
}

export default function Audit() {
  const [items, setItems] = useState<Item[]>([])
  const [i, setI] = useState(0)
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  const loadMetrics = () => fetch("/api/audit/metrics").then(r => r.json()).then(setMetrics)
  useEffect(() => {
    fetch("/api/audit/items").then(r => r.json()).then((xs: Item[]) => {
      setItems(xs)
      const next = xs.findIndex(x => !x.verdict)
      setI(next === -1 ? 0 : next)
    })
    loadMetrics()
  }, [])

  const judge = useCallback(async (verdict: string) => {
    const it = items[i]
    if (!it) return
    await fetch(`/api/audit/${it.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict }) })
    setItems(xs => xs.map(x => x.id === it.id ? { ...x, verdict } : x))
    setI(k => Math.min(k + 1, items.length - 1))
    loadMetrics()
  }, [items, i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return
      if (e.key === "1") judge("correct")
      if (e.key === "2") judge("wrong")
      if (e.key === "3") judge("unsure")
      if (e.key === "ArrowLeft") setI(k => Math.max(0, k - 1))
      if (e.key === "ArrowRight") setI(k => Math.min(items.length - 1, k + 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [judge, items.length])

  const it = items[i]
  const done = items.filter(x => x.verdict).length

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Graph audit</h1>
        <p className="text-sm text-muted-foreground">
          Blind sample: {items.length} relationships, half from Ripple's graph and half from an independent extraction, shuffled.
          Judge only whether the quote states the relationship. Keys: 1 correct · 2 wrong · 3 unsure · ← →
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Graph precision" sub="graph links you marked correct" m={metrics?.graph_precision} />
        <MetricCard title="Recall, known companies" sub="true reference links among the 30 companies Ripple knows" m={metrics?.recall_known_companies} />
        <MetricCard title="Recall, all companies" sub="automatic, unweighted: known companies are oversampled in this sample, so use the coverage report's 31% for this" m={metrics?.recall} />
        <MetricCard title="Reference precision" sub="sanity check of the independent extractor" m={metrics?.reference_precision} />
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${items.length ? (100 * done) / items.length : 0}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{done} of {items.length} reviewed · item {i + 1}</p>

      {it && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg leading-snug">
              {it.filer_name}'s 10-K: <span className="font-semibold">{it.company}</span> {PHRASE[it.relation] ?? it.relation} {it.filer_name}
            </CardTitle>
            <CardDescription>
              Claimed relationship: <Badge variant="secondary">{it.relation}</Badge>
              {it.verdict && <> · your verdict: <Badge>{it.verdict}</Badge></>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <blockquote className="break-words border-l-2 pl-3 italic text-muted-foreground">“{it.quote}”</blockquote>
            <a className="inline-flex items-center gap-1 text-sm underline underline-offset-4" href={it.link} target="_blank" rel="noopener">
              Open in SEC filing <ExternalLink className="size-3" />
            </a>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => judge("correct")}>1 · Correct</Button>
              <Button variant="destructive" onClick={() => judge("wrong")}>2 · Wrong</Button>
              <Button variant="outline" onClick={() => judge("unsure")}>3 · Unsure</Button>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setI(k => Math.max(0, k - 1))}>← Back</Button>
                <Button variant="ghost" onClick={() => setI(k => Math.min(items.length - 1, k + 1))}>Skip →</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricCard({ title, sub, m }: { title: string; sub: string; m?: Metric }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-3xl font-semibold tabular-nums">{m?.value == null ? "–" : `${Math.round(m.value * 100)}%`}</div>
        <div className="text-xs text-muted-foreground">
          {m?.ci95 ? `95% CI ${Math.round(m.ci95[0] * 100)}–${Math.round(m.ci95[1] * 100)}% · n=${m.n}` : "no reviews yet"}
        </div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  )
}
