from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Database URL from environment variable, default to SQLite for local development
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./ssrf_accounting.db")

# Handle Railway PostgreSQL URL format. Name the psycopg2 driver explicitly: SQLAlchemy 2.1+
# defaults plain "postgresql://" to psycopg (v3), which is not installed.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# For SQLite, use check_same_thread=False
# For PostgreSQL, don't use check_same_thread
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
