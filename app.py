import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import market_tools as M
from ripple_client import run_agent_query

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows the frontend to connect from any port/preview link
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load Prices
try:
    PRICES_DF = M.load_prices("daily_prices.csv")
except Exception:
    PRICES_DF = M.load_prices(None)

# 2. LOAD EDGES (Do not pass [] or your frontend table will be empty)
try:
    with open("edges.json", "r") as f:
        EDGES = json.load(f)
except FileNotFoundError:
    # Fallback edges
    EDGES = [
        {"source": "TSM", "target": "NVDA", "relation": "supplier_of", "weight": 0.11, "edge_id": "E1"},
        {"source": "ASML", "target": "TSM", "relation": "supplier_of", "weight": None, "edge_id": "E2"},
        {"source": "ENTG", "target": "TSM", "relation": "supplier_of", "weight": None, "edge_id": "E3"}
    ]

class ShockRequest(BaseModel):
    company: str
    shock_pct: float

@app.post("/api/demand-shock")
def demand_shock(req: ShockRequest):
    try:
        # 3. FIX CASE MATCHING (nvda -> NVDA)
        ticker = req.company.upper().strip()
        
        shock_results = M.demand_shock(PRICES_DF, EDGES, ticker, req.shock_pct)
        prompt = (
            "Write a 2-sentence executive summary of this demand-shock analysis. "
            "Do not treat it as investment advice.\n\n"
            f"{shock_results}"
        )
        ai_analysis = run_agent_query(
            prompt,
            session_id="ui-test-session",
            agent_id="ripple-agent",
        )
        return {
            "status": "success",
            "data": shock_results,
            "ai_analysis": ai_analysis,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc