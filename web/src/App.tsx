import { useEffect, useRef, useState } from "react"
import { ArrowUp, CheckCircle2, ChevronDown, ClipboardCheck, ExternalLink, Loader2, Mic, Network, Plus, ShieldCheck, Square, Volume2, XCircle } from "lucide-react"
import Audit from "./Audit"
import Graph from "./Graph"
import Proofs from "./Proofs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

type Claim = { company: string; relation: string; evidence: string; number?: string | null; source_link: string; verified: boolean }
type Run = { memo: { answer: string; claims: Claim[] }; tool_calls: string[]; seconds: number; verified: number; total: number }
type Answer =
  | { status: "running"; steps: string[]; elapsed: number }
  | { status: "done"; run: Run; source: "replay" | "live" }
  | { status: "error"; error: string }
type Turn = { id: number; question: string; answers: Record<string, Answer> }

const AGENTS: Record<string, { name: string; short: string; blurb: string }> = {
  rag: { name: "Plain RAG", short: "RAG", blurb: "Keyword + vector search over the 10-Ks, reranked" },
  v1: { name: "Ripple", short: "R", blurb: "Verified relationship graph, sector stats, shock maths, claim verifier" },
}
const STEP_LABEL: Record<string, string> = {
  task: "verifier", write_todos: "plan", graph_lookup: "graph lookup", kb_search: "search filings",
  sector_stats: "sector stats", shock: "demand shock",
}

export default function App() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState("")
  type View = "chat" | "audit" | "graph" | "proof"
  const [view, setView] = useState<View>((["audit", "graph", "proof"].find(v => window.location.hash === "#" + v) as View) ?? "chat")
  const [recording, setRecording] = useState(false)
  const [voiceNote, setVoiceNote] = useState("")
  const recorder = useRef<MediaRecorder | null>(null)
  const speakTurn = useRef<number | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }) }, [turns])
  useEffect(() => {
    const t = turns.find(t => t.id === speakTurn.current)
    const a = t && (t.answers.v1 ?? Object.values(t.answers)[0])
    if (a?.status === "done") { speakTurn.current = null; speak(a.run.memo.answer) }
  }, [turns])

  async function toggleMic() {
    if (recording) { recorder.current?.stop(); return }
    setVoiceNote("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream), chunks: Blob[] = []
      rec.ondataavailable = e => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); setRecording(false); setVoiceNote("Transcribing with ElevenLabs…")
        const form = new FormData(); form.append("audio", new Blob(chunks, { type: rec.mimeType }), "question.webm")
        const r = await fetch("/api/voice/transcribe", { method: "POST", body: form })
        const j = await r.json()
        if (!r.ok) { setVoiceNote(j.detail ?? "Transcription failed"); return }
        setVoiceNote(""); speakTurn.current = Date.now() + 1; send(j.text, speakTurn.current)
      }
      recorder.current = rec; rec.start(); setRecording(true)
    } catch { setVoiceNote("Microphone not available in this browser") }
  }

  const busy = turns.some(t => Object.values(t.answers).some(a => a.status === "running"))

  const setAnswer = (turnId: number, v: string, a: Answer) =>
    setTurns(ts => ts.map(t => t.id === turnId ? { ...t, answers: { ...t.answers, [v]: a } } : t))

  // earlier finished turns for this agent, so follow-up questions keep their context
  const history = (v: string) => turns.flatMap(t => {
    const a = t.answers[v]
    return a?.status === "done" ? [{ role: "user", content: t.question }, { role: "assistant", content: a.run.memo.answer }] : []
  })

  async function send(question: string, fixedId?: number) {
    question = question.trim()
    if (!question || busy) return
    setDraft("")
    const versions = ["v1"]  // the UI shows only the latest Ripple (agent v3)
    const turnId = fixedId ?? Date.now()
    setTurns(ts => [...ts, { id: turnId, question,
      answers: Object.fromEntries(versions.map(v => [v, { status: "running", steps: [], elapsed: 0 }])) }])
    for (const v of versions) {
      const { job } = await (await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, version: v, history: history(v) }) })).json()
      const poll = async () => {
        const j = await (await fetch(`/api/job/${job}`)).json()
        if (j.status === "running") { setAnswer(turnId, v, { status: "running", steps: j.steps ?? [], elapsed: j.elapsed }); setTimeout(poll, 1500) }
        else if (j.status === "done") setAnswer(turnId, v, { status: "done", run: j.result, source: "live" })
        else setAnswer(turnId, v, { status: "error", error: j.error })
      }
      poll()
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="px-4 pt-5 pb-3">
          <div className="text-lg font-semibold tracking-tight">Ripple</div>
          <p className="text-xs text-muted-foreground">Supply-chain research analyst · 15 US tech 10-Ks</p>
        </div>
        <div className="px-3">
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => { setTurns([]); setView("chat") }} disabled={busy}>
            <Plus className="size-4" /> New chat
          </Button>
          <Button variant={view === "graph" ? "secondary" : "ghost"} className="mt-1 w-full justify-start gap-2" onClick={() => setView(view === "graph" ? "chat" : "graph")}>
            <Network className="size-4" /> Relationship graph
          </Button>
          <Button variant={view === "proof" ? "secondary" : "ghost"} className="w-full justify-start gap-2" onClick={() => setView(view === "proof" ? "chat" : "proof")}>
            <ShieldCheck className="size-4" /> Proof it works
          </Button>
          <Button variant={view === "audit" ? "secondary" : "ghost"} className="w-full justify-start gap-2" onClick={() => setView(view === "audit" ? "chat" : "audit")}>
            <ClipboardCheck className="size-4" /> Graph audit
          </Button>
        </div>
        <Separator className="my-3" />
        <div className="flex-1" />
      </aside>

      {view !== "chat" ? <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex gap-1 border-b px-4 py-3 md:hidden">
          <Button variant="ghost" size="sm" onClick={() => setView("chat")}>← Chat</Button>
          <Button variant="ghost" size="sm" onClick={() => setView("graph")}>Graph</Button>
          <Button variant="ghost" size="sm" onClick={() => setView("proof")}>Proof</Button>
          <Button variant="ghost" size="sm" onClick={() => setView("audit")}>Audit</Button>
        </div>
        {view === "audit" ? <Audit /> : view === "graph" ? <Graph /> : <Proofs />}</main> :
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-sm text-muted-foreground">{AGENTS.v1.blurb}</div>
          <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1 md:hidden" onClick={() => setView("graph")}>
            <Network className="size-4" /> More
          </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
            {turns.length === 0 && <Welcome />}
            {turns.map(t => (
              <div key={t.id} className="space-y-4">
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">{t.question}</div>
                </div>
                <div className={`grid gap-4 ${Object.keys(t.answers).length === 2 ? "lg:grid-cols-2" : ""}`}>
                  {Object.entries(t.answers).map(([v, a]) => <AgentMessage key={v} version={v} answer={a} />)}
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
        </div>

        <form className="border-t p-4" onSubmit={e => { e.preventDefault(); send(draft) }}>
          <div className="mx-auto flex max-w-5xl items-end gap-2">
            <Textarea id="composer" value={draft} rows={1} className="min-h-11 resize-none"
              placeholder="Ask about suppliers, customers, competitors or exposure…"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft) } }} />
            <Button type="button" size="icon" variant={recording ? "destructive" : "outline"} className="size-11 shrink-0"
              onClick={toggleMic} disabled={busy && !recording} aria-label={recording ? "Stop recording" : "Ask by voice"}>
              {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
            </Button>
            <Button type="submit" size="icon" className="size-11 shrink-0" disabled={busy || !draft.trim()} aria-label="Send">
              <ArrowUp className="size-4" />
            </Button>
          </div>
          {voiceNote && <p className="mx-auto mt-2 max-w-5xl text-xs text-muted-foreground">{voiceNote}</p>}
        </form>
      </main>}
    </div>
  )
}

function Welcome() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-10 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Who depends on whom?</h1>
      <p className="text-muted-foreground">
        Ask about the suppliers, customers and competitors of 15 US tech companies. Ripple backs every company it names
        with the exact 10-K sentence, and a verifier rejects anything it can't find.
      </p>
    </div>
  )
}

// Reads an answer aloud with ElevenLabs text-to-speech (via the API, which holds the key)
async function speak(text: string) {
  const r = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
  if (!r.ok) { alert((await r.json()).detail ?? "Voice unavailable"); return }
  new Audio(URL.createObjectURL(await r.blob())).play()
}

function AgentMessage({ version, answer }: { version: string; answer: Answer }) {
  const agent = AGENTS[version]
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="grid size-7 place-items-center rounded-full bg-muted text-[10px] font-semibold">{agent.short}</div>
        <span className="font-medium">{agent.name}</span>
        {answer.status === "done" && (
          <>
            <Badge variant={answer.run.verified === answer.run.total ? "default" : "destructive"}>
              {answer.run.verified}/{answer.run.total} verified
            </Badge>
            <Badge variant="secondary">{Math.round(answer.run.seconds)} s · {answer.source}</Badge>
            <Button variant="ghost" size="icon" className="ml-auto size-7" aria-label="Read aloud" onClick={() => speak(answer.run.memo.answer)}>
              <Volume2 className="size-4" />
            </Button>
          </>
        )}
      </div>

      {answer.status === "running" && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Working… {answer.elapsed}s</div>
          <Steps steps={answer.steps} />
        </div>
      )}
      {answer.status === "error" && <p className="text-sm text-destructive">{answer.error}</p>}
      {answer.status === "done" && (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.run.memo.answer}</p>
          <Steps steps={answer.run.tool_calls} />
          <Sources claims={answer.run.memo.claims} />
        </div>
      )}
    </div>
  )
}

function Steps({ steps }: { steps: string[] }) {
  if (!steps.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((s, i) => <Badge key={i} variant="outline" className="font-mono text-[11px]">{STEP_LABEL[s] ?? s}</Badge>)}
    </div>
  )
}

function Sources({ claims }: { claims: Claim[] }) {
  const [open, setOpen] = useState(true)
  if (!claims.length) return <p className="text-sm text-muted-foreground">No companies claimed.</p>
  const ok = claims.filter(c => c.verified).length
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium">
        <ChevronDown className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />
        Sources · {ok} of {claims.length} verified in the filing
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        {claims.map((c, i) => (
          <div key={i} className="space-y-1 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {c.verified
                ? <CheckCircle2 className="size-4 text-emerald-600" aria-label="verified" />
                : <XCircle className="size-4 text-destructive" aria-label="not verified" />}
              <span className="font-medium">{c.company}</span>
              <Badge variant="secondary">{c.relation}</Badge>
              {c.number && <Badge variant="outline">{c.number}</Badge>}
            </div>
            <blockquote className="break-words border-l-2 pl-3 text-sm italic text-muted-foreground">“{c.evidence}”</blockquote>
            {c.source_link && (
              <a className="inline-flex items-center gap-1 text-xs underline underline-offset-4" href={c.source_link} target="_blank" rel="noopener">
                Open in SEC filing <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
