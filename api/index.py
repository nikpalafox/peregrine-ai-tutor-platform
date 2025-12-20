"""
Vercel serverless function handler for FastAPI backend
"""
import sys
import os
from pathlib import Path

# Set Vercel environment flag before any imports
os.environ["VERCEL"] = "1"

# Add backend directory to path
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

# Set environment variables before importing main
os.environ.setdefault("PYTHONPATH", str(backend_dir))

# Load environment variables from Vercel (they're already in os.environ)
# But also try to load from .env if it exists (for local testing)
from dotenv import load_dotenv
load_dotenv()

# Import the FastAPI app (this will detect serverless mode)
try:
    from main import app
except Exception as e:
    print(f"Error importing main: {e}")
    import traceback
    traceback.print_exc()
    raise

# For Vercel, export the FastAPI app directly
# Vercel's Python runtime handles ASGI apps natively
handler = app
