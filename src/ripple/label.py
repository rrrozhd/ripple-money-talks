"""v2 graph labels: re-type every filing claim with a Nicrron model (same question and context as the Jev run),
cached in data/llm_labels_ctx500.jsonl in the format ripple.evaluate reads.

    uv run python -m ripple.label
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import duckdb
from pydantic import BaseModel

from .jev import CRITERIA, INSTRUCTIONS, LABELS, claim_key
from .llm import ROOT, chat

MODEL = "openai/gpt-4.1-mini"
CONTEXT_CHARS = 500
OUT = ROOT / "data" / f"llm_labels_ctx{CONTEXT_CHARS}.jsonl"


MENTION_CONTEXT = 1500  # long competitor lists put their "competitors include" header far before the name


def out_path(model: str, table: str = "claim"):
    if table == "mention":  # keyword-free candidates (every sentence naming another company)
        return ROOT / "data" / f"llm_labels_mentions_{model.split('/')[-1]}.jsonl"
    return OUT if model == "openai/gpt-4.1-mini" else ROOT / "data" / f"llm_labels_ctx{CONTEXT_CHARS}_{model.split('/')[-1]}.jsonl"


class Label(BaseModel):
    relation: Literal["supplier", "customer", "competitor", "partner", "none"]


def label_all(model: str = MODEL, table: str = "claim") -> None:
    out = out_path(model, table)
    con = duckdb.connect(str(ROOT / "data" / "ripple.duckdb"), read_only=True)
    names = dict(con.execute("SELECT entity_id, name FROM entity").fetchall())
    claims = con.execute(f"SELECT accession, char_start, char_end, filer, counterparty FROM {table}").df().to_dict("records")
    done = {json.loads(l)["key"] for l in out.read_text().splitlines()} if out.exists() else set()
    todo = [c for c in claims if claim_key(c) not in done]
    # Anthropic models via Nicrron reject forced tool calls (structured output), so they answer with one word
    plain = model.startswith("anthropic/")
    texts, llm = {}, (chat(model) if plain else chat(model).with_structured_output(Label))
    rubric = "\n".join(f"- {k}: {v}" for k, v in CRITERIA.items())
    ctx = MENTION_CONTEXT if table == "mention" else CONTEXT_CHARS
    extra = ("\nBuying or selling shares, investments and acquisitions are not supply: answer none unless the paragraph "
             "also states a current supply, purchase, competition or partnership relationship."
             "\nItems in a list introduced as competitors are competitors, even if the item says 'suppliers of ...'.")

    def one(c):
        t = texts.setdefault(c["accession"], (ROOT / "data" / "raw" / "text" / f"{c['accession']}.txt").read_text())
        para = t[max(0, c["char_start"] - ctx):c["char_end"]]
        prompt = (f"{INSTRUCTIONS}\n\nfiler: {names[c['filer']]}\ncompany: {names[c['counterparty']]}\n"
                  f"paragraph: \"\"\"{para}\"\"\"\n\nAnswer with one of:\n{rubric}{extra if table == 'mention' else ''}")
        if plain:
            reply = llm.invoke(prompt + "\n\nReply with exactly one word from: " + ", ".join(LABELS)).content
            words = re.findall(r"[a-z]+", (reply if isinstance(reply, str) else str(reply)).lower())
            rel = next((w for w in words if w in LABELS), "none")
        else:
            rel = llm.invoke(prompt).relation
        # one-hot "probabilities" so ripple.evaluate can read this file like the Jev cache
        return {"key": claim_key(c), "choice": rel, "p": 1.0, "probs": {k: float(k == rel) for k in LABELS},
                "orders_agree": True, "model": model}

    with ThreadPoolExecutor(6) as pool, out.open("a") as sink:
        for row in pool.map(one, todo):
            sink.write(json.dumps(row) + "\n")
    print(json.dumps({"claims": len(claims), "labelled_now": len(todo), "model": model}))


if __name__ == "__main__":
    import sys
    label_all(sys.argv[1] if len(sys.argv) > 1 else MODEL, sys.argv[2] if len(sys.argv) > 2 else "claim")
