import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Supabase などの接続文字列を取得。なければローカルの SQLite を使用
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./english_app.db")

# Supabase等で "postgres://" となっている場合は "postgresql://" に修正する (SQLAlchemy 1.4+ 対応)
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLiteの場合のみ check_same_thread=False を設定
connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args=connect_args
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
