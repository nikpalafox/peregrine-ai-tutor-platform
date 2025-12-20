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

# Import Mangum for AWS Lambda/API Gateway compatibility (Vercel uses similar)
try:
    from mangum import Mangum
    MANGUM_AVAILABLE = True
except ImportError:
    print("Warning: mangum not installed, using basic handler")
    MANGUM_AVAILABLE = False

# Import the FastAPI app (this will detect serverless mode)
from main import app

# Wrap FastAPI app with Mangum for serverless compatibility
if MANGUM_AVAILABLE:
    handler = Mangum(app, lifespan="off")  # Disable lifespan events in serverless
else:
    # Basic handler fallback - Vercel Python runtime should handle this
    handler = app

