"""The starter universe: 3 sectors x 5 companies, plus named counterparties outside it.

Aliases are matched with word boundaries; ``cs`` marks case-sensitive aliases
(short or common words like "Apple", "Intel", "KLA" that would otherwise collide).
"""

SECTORS = {
    "semis": {"name": "Semiconductors", "tickers": ["NVDA", "AMD", "INTC", "QCOM", "MU"]},
    "equipment": {"name": "Semiconductor Equipment", "tickers": ["AMAT", "LRCX", "KLAC", "TER", "ENTG"]},
    "hardware": {"name": "Hardware & Servers", "tickers": ["AAPL", "DELL", "HPQ", "SMCI", "HPE"]},
}

# entity_id -> (display name, [(alias, case_sensitive)])
ALIASES = {
    "NVDA": ("NVIDIA", [("NVIDIA", False)]),
    "AMD": ("AMD", [("Advanced Micro Devices", False), ("AMD", True)]),
    "INTC": ("Intel", [("Intel Corporation", False), ("Intel", True)]),
    "QCOM": ("Qualcomm", [("Qualcomm", False)]),
    "MU": ("Micron", [("Micron Technology", False), ("Micron", True)]),
    "AMAT": ("Applied Materials", [("Applied Materials", False)]),
    "LRCX": ("Lam Research", [("Lam Research", False)]),
    "KLAC": ("KLA", [("KLA Corporation", False), ("KLA", True)]),
    "TER": ("Teradyne", [("Teradyne", False)]),
    "ENTG": ("Entegris", [("Entegris", False)]),
    "AAPL": ("Apple", [("Apple Inc", False), ("Apple", True)]),
    "DELL": ("Dell", [("Dell Technologies", False), ("Dell", True)]),
    "HPQ": ("HP Inc.", [("HP Inc", False)]),
    "SMCI": ("Supermicro", [("Super Micro Computer", False), ("Supermicro", False)]),
    "HPE": ("Hewlett Packard Enterprise", [("Hewlett Packard Enterprise", False), ("HPE", True)]),
    # counterparties outside the universe (no 10-K ingested)
    "x:tsmc": ("TSMC", [("Taiwan Semiconductor Manufacturing", False), ("TSMC", True)]),
    "x:samsung": ("Samsung", [("Samsung", True)]),
    "x:skhynix": ("SK hynix", [("SK hynix", False)]),
    "x:foxconn": ("Foxconn (Hon Hai)", [("Foxconn", False), ("Hon Hai", False)]),
    "x:asml": ("ASML", [("ASML", True)]),
    "x:tel": ("Tokyo Electron", [("Tokyo Electron", False)]),
    "x:broadcom": ("Broadcom", [("Broadcom", True)]),
    "x:arm": ("Arm", [("Arm Holdings", False), ("Arm Limited", False)]),
    "x:microsoft": ("Microsoft", [("Microsoft", True)]),
    "x:amazon": ("Amazon", [("Amazon", True)]),
    "x:google": ("Alphabet/Google", [("Alphabet", True), ("Google", True)]),
    "x:meta": ("Meta", [("Meta Platforms", False)]),
    "x:oracle": ("Oracle", [("Oracle", True)]),
    "x:globalfoundries": ("GlobalFoundries", [("GlobalFoundries", False)]),
    "x:umc": ("UMC", [("United Microelectronics", False)]),
}

TICKER_SECTOR = {t: s for s, v in SECTORS.items() for t in v["tickers"]}
