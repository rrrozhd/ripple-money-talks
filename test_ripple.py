"""Live check of Nicrron via run_agent_query and PRISM trace logging.

Run: python test_ripple.py
"""
from ripple_client import run_agent_query

if __name__ == "__main__":
    prompt = (
        "Who are the main suppliers in the semiconductor supply chain for NVIDIA, "
        "and how exposed is each if NVIDIA cut purchases? Name foundries, equipment "
        "makers, and materials companies, and say what each typically supplies."
    )
    result = run_agent_query(
        prompt,
        session_id="test-session-semiconductor-supply-chain",
        agent_id="ripple-test",
    )
    print(result)
