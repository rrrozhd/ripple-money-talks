"""Model access. Every model call goes through Nicrron (OpenAI-compatible), as the event requires.
PRISM tracing is attached when a valid PRISM key (pt-sk-...) is configured."""

from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values
from langchain_openai import ChatOpenAI

ROOT = Path(__file__).resolve().parents[2]
CFG = dotenv_values(ROOT / ".env")
NICRRON_URL = "https://api.nicrron.ai/v1"
DEFAULT_MODEL = "openai/gpt-5-mini"


def chat(model: str = DEFAULT_MODEL) -> ChatOpenAI:
    return ChatOpenAI(model=model, base_url=NICRRON_URL, api_key=CFG["NICRRON_API_KEY"], max_retries=3, timeout=90)


@lru_cache
def prism_handler():
    """LangChain callback handler for PRISM, or None if no valid key is set."""
    key = CFG.get("PRISMTRACE_API_KEY") or ""
    if not key.startswith("pt-sk-"):
        return None
    from prismtrace import PRISMtraceCallbackHandler
    # agent_name becomes the trace's agent_id: PRISM ties Knowledge Base documents, alerts and filters to it
    return PRISMtraceCallbackHandler(api_key=key, project_id=CFG["PRISMTRACE_PROJECT_ID"], host=CFG["PRISMTRACE_HOST"],
                                     agent_name="ripple")


def callbacks() -> list:
    h = prism_handler()
    return [h] if h else []
