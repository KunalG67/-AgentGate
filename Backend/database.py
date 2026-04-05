import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set in your .env file. "
        "Expected format: postgresql://user:password@localhost:5432/dbname"
    )

engine = create_engine(
    DATABASE_URL,
    pool_size=5,           # keep 5 connections open and ready
    max_overflow=10,       # allow up to 10 extra connections under heavy load
    pool_pre_ping=True,    # test connection before using — prevents "server gone away" crashes
    pool_recycle=1800,     # recycle connections every 30 min — prevents stale connection errors
    pool_timeout=30,       # wait up to 30 seconds for a connection from the pool
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import Base
    Base.metadata.create_all(bind=engine)
    
    # Migration: Update existing StepUpChallenge records with NULL expires_at
    from models import StepUpChallenge
    from datetime import datetime, timedelta
    db = SessionLocal()
    try:
        challenges = db.query(StepUpChallenge).filter(StepUpChallenge.expires_at.is_(None)).all()
        for challenge in challenges:
            challenge.expires_at = datetime.utcnow() + timedelta(minutes=15)
        db.commit()
    except Exception as e:
        print(f"Migration error: {e}")
        raise e  # Re-raise to fail loudly
    finally:
        db.close()