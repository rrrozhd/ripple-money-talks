import os

# TEMPLATE ONLY - DO NOT PUT REAL KEYS HERE
os.environ["PRISMTRACE_HOST"] = "https://prism.blockconvey.com"
os.environ["PRISMTRACE_PROJECT_ID"] = "YOUR_PROJECT_ID_HERE"
os.environ["PRISMTRACE_API_KEY"] = "pt-sk-YOUR_API_KEY_HERE"
os.environ["NICRRON_API_KEY"] = "YOUR_NICRRON_KEY_HERE"

# Expose configuration variables
PRISM_HOST = os.getenv("PRISMTRACE_HOST")
PRISM_PROJECT_ID = os.getenv("PRISMTRACE_PROJECT_ID")
PRISM_API_KEY = os.getenv("PRISMTRACE_API_KEY")
NICRRON_API_KEY = os.getenv("NICRRON_API_KEY")