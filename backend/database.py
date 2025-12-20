from sqlalchemy import create_engine, MetaData
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import os
from dotenv import load_dotenv

load_dotenv()

# Check if running in serverless environment (Vercel)
IS_SERVERLESS = os.getenv("VERCEL") == "1" or os.getenv("AWS_LAMBDA_FUNCTION_NAME") is not None

# Priority: Vercel Postgres > Local Postgres > SQLite (in-memory for serverless) > SQLite (file-based for local)
POSTGRES_URL = os.getenv("POSTGRES_URL")  # Vercel Postgres connection string
DATABASE_URL = os.getenv("DATABASE_URL")  # Generic database URL (can be Postgres or SQLite)

# Determine which database to use
if POSTGRES_URL:
    # Use Vercel Postgres (production)
    SQLALCHEMY_DATABASE_URL = POSTGRES_URL
    # Convert postgres:// to postgresql:// if needed (SQLAlchemy prefers postgresql://)
    if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
        SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)
    connect_args = {}
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args=connect_args,
        echo=False,
        pool_pre_ping=True,  # Verify connections before using them
        pool_recycle=300,  # Recycle connections after 5 minutes
    )
    print("✅ Using Vercel Postgres database")
elif DATABASE_URL and DATABASE_URL.startswith("postgres"):
    # Use local Postgres (if configured)
    SQLALCHEMY_DATABASE_URL = DATABASE_URL
    if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
        SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)
    connect_args = {}
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args=connect_args,
        echo=False,
        pool_pre_ping=True,
    )
    print("✅ Using PostgreSQL database")
elif IS_SERVERLESS:
    # Fallback to in-memory SQLite for serverless (not recommended for production)
    SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
    # Use StaticPool to ensure all connections share the same in-memory database
    connect_args = {"check_same_thread": False}
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args=connect_args,
        poolclass=StaticPool,  # Critical: ensures all connections share same in-memory DB
        echo=False
    )
    print("⚠️  Using in-memory SQLite (data will not persist - configure Vercel Postgres for production)")
else:
    # Use file-based SQLite for local development
    SQLALCHEMY_DATABASE_URL = DATABASE_URL or "sqlite:///./peregrine.db"
    # Only add check_same_thread for SQLite
    connect_args = {}
    if "sqlite" in SQLALCHEMY_DATABASE_URL:
        connect_args = {"check_same_thread": False}
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args)
    print("✅ Using SQLite database (local development)")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
metadata = MetaData()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()