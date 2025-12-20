"""
Vercel serverless function handler for FastAPI backend
"""
import sys
import os
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

# Set environment variables before importing main
os.environ.setdefault("PYTHONPATH", str(backend_dir))

# Load environment variables from Vercel
from dotenv import load_dotenv
load_dotenv()

# Import Mangum for AWS Lambda/API Gateway compatibility (Vercel uses similar)
try:
    from mangum import Mangum
except ImportError:
    # Fallback if mangum is not available
    print("Warning: mangum not installed, using basic handler")
    Mangum = None

# Import the FastAPI app
from main import app

# Wrap FastAPI app with Mangum for serverless compatibility
if Mangum:
    handler = Mangum(app, lifespan="off")  # Disable lifespan events in serverless
else:
    # Basic handler fallback
    handler = app

