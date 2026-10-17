import { useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

type Node = { id: string; name: string; sector: string | null }
type Edge = { src: string; dst: string; type: string; stated_by: string; quote: string; link: string }
type SectorLink = { ticker: string; sector: string; beta: number; corr: number }
type Data = { nodes: Node[]; edges: Edge[]; sector_links: SectorLink[] }
type GNode = { id: string; label: string; kind: "company" | "outside" | "sector"; color: string; x?: number; y?: number }
type GLink = { source: string | GNode; target: string | GNode; type: string; edge?: Edge; corr?: number; beta?: number }

const TYPE_COLOR: Record<string, string> = { SUPPLIES: "#2563eb", COMPETES_WITH: "#dc2626", PARTNERS: "#16a34a" }
const TYPE_LABEL: Record<string, string> = { SUPPLIES: "supplies", COMPETES_WITH: "competes with", PARTNERS: "partners with" }
const SECTORS: Record<string, { label: string; color: string }> = {
  semis: { label: "Semiconductors", color: "#7c3aed" },
  equipment: { label: "Equipment", color: "#d97706" },
  hardware: { label: "Hardware", color: "#0891b2" },
}
const id = (n: string | GNode) => (typeof n === "string" ? n : n.id)

export default function Graph() {
  const [data, setData] = useState<Data | null>(null)
  const [show, setShow] = useState<Record<string, boolean>>({ SUPPLIES: true, COMPETES_WITH: true, PARTNERS: false, SECTOR: true })
  const [picked, setPicked] = useState<Edge | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg = useRef<any>(null)
  const [size, setSize] = useState({ w: 800, h: 620 })

  useEffect(() => { fetch("/api/graph").then(r => r.json()).then(setData) }, [])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(480, Math.min(760, el.clientWidth * 0.75)) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [data])

  const graph = useMemo(() => {
    if (!data) return { nodes: [] as GNode[], links: [] as GLink[] }
    const nodes: GNode[] = [
      ...Object.entries(SECTORS).map(([k, s]) => ({ id: `sector:${k}`, label: s.label, kind: "sector" as const, color: s.color })),
      ...data.nodes.map(n => ({ id: n.id, label: n.sector ? n.id : n.name, kind: (n.sector ? "company" : "outside") as GNode["kind"],
        color: n.sector ? SECTORS[n.sector].color : "#94a3b8" })),
    ]
    const links: GLink[] = [
      ...(show.SECTOR ? data.sector_links.map(s => ({ source: s.ticker, target: `sector:${s.sector}`, type: "SECTOR", corr: s.corr, beta: s.beta })) : []),
      ...data.edges.filter(e => show[e.type]).map(e => ({ source: e.src, target: e.dst, type: e.type, edge: e })),
    ]
    return { nodes, links }
  }, [data, show])
  const near = useMemo(() => new Set(graph.links.flatMap(l =>
    id(l.source) === focus ? [id(l.target)] : id(l.target) === focus ? [id(l.source)] : [])), [graph, focus])
  useEffect(() => {
    fg.current?.d3Force("charge")?.strength(-220)
    fg.current?.d3Force("link")?.distance((l: GLink) => (l.type === "SECTOR" ? 60 : 110))
    fg.current?.d3ReheatSimulation()
  }, [graph])

  if (!data) return <p className="p-6 text-sm text-muted-foreground">Loading graph…</p>
  const name = (n: string) => data.nodes.find(x => x.id === n)?.name ?? n

  return (
    <div className="space-y-4 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Relationship graph</h1>
        <p className="text-sm text-muted-foreground">
          {data.nodes.length} companies · {data.edges.length} relationships, each stated in a 10-K and verified by quote.
          Drag, scroll to zoom. Click a company to focus on it, click a line to see the sentence behind it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[...Object.keys(TYPE_COLOR), "SECTOR"].map(t => (
          <button key={t} onClick={() => setShow(s => ({ ...s, [t]: !s[t] }))}
            className={`rounded-full border px-3 py-1 text-xs ${show[t] ? "" : "opacity-40"}`}
            style={{ borderColor: TYPE_COLOR[t] ?? "#64748b", color: TYPE_COLOR[t] ?? "#64748b" }}>
            {t === "SECTOR" ? "sector correlation (prices)" : `${TYPE_LABEL[t]} (${data.edges.filter(e => e.type === t).length})`}
          </button>
        ))}
        {focus && <button className="text-xs underline" onClick={() => setFocus(null)}>clear focus on {name(focus)}</button>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card ref={box} className="min-w-0 overflow-hidden p-0">
          <ForceGraph2D ref={fg}
            width={size.w} height={size.h} graphData={graph} backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={150} d3VelocityDecay={0.3}
            onEngineStop={() => fg.current?.zoomToFit(400, 70)}
            nodeLabel={(n: GNode) => n.kind === "outside" ? `${n.label} (outside the 15 filers)` : n.label}
            linkColor={(l: GLink) => {
              const on = focus && (id(l.source) === focus || id(l.target) === focus)
              if (l.type === "SECTOR") return `rgba(100,116,139,${on ? 0.5 : focus ? 0.04 : 0.15})`
              return TYPE_COLOR[l.type] + (on || l.edge === picked ? "dd" : focus ? "0d" : "33")
            }}
            linkWidth={(l: GLink) => l.type === "SECTOR" ? Math.max(0.5, (l.corr ?? 0) * 6) : (picked && l.edge === picked ? 4 : 1.4)}
            linkDirectionalArrowLength={(l: GLink) => l.type === "SUPPLIES" ? 5 : 0} linkDirectionalArrowRelPos={0.9}
            linkLabel={(l: GLink) => l.type === "SECTOR"
              ? `${id(l.source)} follows its sector: beta ${l.beta}, correlation ${l.corr}`
              : `${name(id(l.source))} ${TYPE_LABEL[l.type]} ${name(id(l.target))}`}
            onLinkClick={(l: GLink) => l.edge && setPicked(l.edge)}
            onNodeClick={(n: GNode) => n.kind !== "sector" && setFocus(f => (f === n.id ? null : n.id))}
            nodeCanvasObject={(n: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
              const r = n.kind === "sector" ? 14 : n.kind === "company" ? 8 : 5
              ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI)
              ctx.fillStyle = n.color; ctx.globalAlpha = focus && focus !== n.id && !near.has(n.id) ? 0.2 : 1; ctx.fill()
              if (focus === n.id) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = "#f59e0b"; ctx.stroke() }
              const fs = (n.kind === "sector" ? 14 : 12) / scale  // constant on-screen size at any zoom
              ctx.font = `${n.kind === "sector" ? 600 : 400} ${fs}px system-ui, sans-serif`
              ctx.textAlign = "center"; ctx.textBaseline = "top"
              const text = n.kind === "outside" ? n.label.split(" ")[0] : n.label
              ctx.lineWidth = 4 / scale; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineJoin = "round"
              ctx.strokeText(text, n.x!, n.y! + r + 2 / scale)
              ctx.fillStyle = "#0f172a"
              ctx.fillText(text, n.x!, n.y! + r + 2 / scale)
              ctx.globalAlpha = 1
            }}
            nodePointerAreaPaint={(n: GNode, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x!, n.y!, n.kind === "sector" ? 16 : 10, 0, 2 * Math.PI); ctx.fill()
            }}
          />
        </Card>
        <Card className="h-fit">
          <CardContent className="space-y-3 pt-6 text-sm">
            {!picked && <p className="text-muted-foreground">Click a relationship line to see the 10-K sentence behind it.</p>}
            {picked && (
              <>
                <div className="font-medium">{name(picked.src)}{" "}
                  <Badge style={{ background: TYPE_COLOR[picked.type] }}>{TYPE_LABEL[picked.type]}</Badge>{" "}{name(picked.dst)}</div>
                <div className="text-xs text-muted-foreground">Stated in {picked.stated_by}'s 10-K</div>
                <blockquote className="break-words border-l-2 pl-3 italic text-muted-foreground">“{picked.quote}”</blockquote>
                <a className="inline-flex items-center gap-1 text-xs underline underline-offset-4" href={picked.link} target="_blank" rel="noopener">
                  Open in SEC filing <ExternalLink className="size-3" />
                </a>
              </>
            )}
            <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
              {Object.entries(SECTORS).map(([k, s]) => (
                <div key={k} className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-full" style={{ background: s.color }} />{s.label}</div>
              ))}
              <div className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-full bg-slate-400" />Outside the 15 filers</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
