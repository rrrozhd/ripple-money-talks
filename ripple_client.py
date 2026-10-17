"""Nicrron agent calls with native PRISM run tracing."""
from __future__ import annotations

import time

import requests
from openai import OpenAI

from config import NICRRON_API_KEY, PRISM_API_KEY, PRISM_HOST, PRISM_PROJECT_ID

NICRRON_BASE_URL = "https://api.nicrron.ai/v1"
NICRRON_MODEL = "nicrron/auto"

def log_run_to_prism(
    model: str,
    input_messages: list,
    output_message: str,
    latency_ms: float,
    session_id: str,
    agent_id: str,
) -> None:
    """Send an agent execution trace to PRISM. Failures are logged, never raised."""
    url = f"{PRISM_HOST.rstrip('/')}/api/traces"
    payload = {
        "project_id": PRISM_PROJECT_ID,
        "model": model,
        "input_messages": input_messages,
        "output_message": output_message,
        "latency_ms": latency_ms,
        "session_id": session_id,
        "agent_id": agent_id,
    }
    try:
        requests.post(
            url,
            headers={
                "X-PRISMtrace-Key": PRISM_API_KEY,
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
    except requests.RequestException as exc:
        print(f"Warning: failed to log run to PRISM: {exc}")

def run_agent_query(prompt: str, session_id: str, agent_id: str) -> str:
    """Call Nicrron, measure latency, and log the run to PRISM on success or failure."""
    input_messages = [{"role": "user", "content": prompt}]
    client = OpenAI(api_key=NICRRON_API_KEY, base_url=NICRRON_BASE_URL)
    started = time.perf_counter()
    try:
        response = client.chat.completions.create(
            model=NICRRON_MODEL,
            messages=input_messages,
        )
        latency_ms = int(round((time.perf_counter() - started) * 1000))
        output_message = (response.choices[0].message.content or "").strip()
        log_run_to_prism(
            model=NICRRON_MODEL,
            input_messages=input_messages,
            output_message=output_message,
            latency_ms=latency_ms,
            session_id=session_id,
            agent_id=agent_id,
        )
        return output_message
    except Exception as exc:
        latency_ms = int(round((time.perf_counter() - started) * 1000))
        error_message = f"Agent query failed: {exc}"
        log_run_to_prism(
            model=NICRRON_MODEL,
            input_messages=input_messages,
            output_message=error_message,
            latency_ms=latency_ms,
            session_id=session_id,
            agent_id=agent_id,
        )
        return error_message
