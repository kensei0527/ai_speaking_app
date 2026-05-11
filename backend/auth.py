import os
import httpx
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from sqlalchemy.orm import Session
import logging

from database import get_db
import models
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://tazaoowzpumqjkhlfpmg.supabase.co")
SUPABASE_JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
# Legacy HS256 secret is supported only when explicitly configured.
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

security = HTTPBearer()

# In-memory JWKS cache
_jwks_cache: Optional[dict] = None

def _get_jwks() -> dict:
    """Fetch and cache JWKS from Supabase."""
    global _jwks_cache
    if _jwks_cache is None:
        try:
            response = httpx.get(SUPABASE_JWKS_URL, timeout=5.0)
            response.raise_for_status()
            _jwks_cache = response.json()
        except Exception as e:
            logging.error(f"Failed to fetch JWKS: {e}")
            raise HTTPException(status_code=500, detail="Could not fetch signing keys")
    return _jwks_cache


def _decode_supabase_jwt(token: str) -> dict:
    """Decode a Supabase JWT and reject unsupported or unconfigured algorithms."""
    global _jwks_cache

    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")

    if alg in ("RS256", "ES256"):
        kid = header.get("kid")
        if not kid:
            raise JWTError("Missing key id in token header")

        jwks = _get_jwks()
        key_data = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if not key_data:
            _jwks_cache = None
            jwks = _get_jwks()
            key_data = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if not key_data:
            raise JWTError("Signing key not found in JWKS")

        return jwt.decode(
            token,
            key_data,
            algorithms=[alg],
            options={"verify_aud": False},
        )

    if alg == "HS256":
        if not SUPABASE_JWT_SECRET:
            raise JWTError("HS256 token received but SUPABASE_JWT_SECRET is not configured")
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )

    raise JWTError(f"Unsupported JWT signing algorithm: {alg or 'missing'}")


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Verify the Supabase JWT using JWKS or an explicitly configured HS256 secret."""
    token = credentials.credentials
    try:
        return _decode_supabase_jwt(token)

    except JWTError as e:
        logging.error(f"JWT Verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


def verify_token_raw(token: str, db: Session) -> Optional[models.User]:
    """
    WebSocket 用: 生トークン文字列を受け取り、対応する User を返す。
    失敗時は None を返す（HTTPException は raise しない）。
    """
    try:
        payload = _decode_supabase_jwt(token)

        user_id: str = payload.get("sub")
        email: str = payload.get("email", "")
        if not user_id:
            return None

        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            user = models.User(
                id=user_id,
                email=email or f"user_{user_id}@example.com",
                name=payload.get("user_metadata", {}).get("full_name") or "Guest",
                cefr_level="A1",
                placement_status="pending",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    except Exception as e:
        logging.error(f"verify_token_raw failed: {e}")
        return None


def get_current_user(
    payload: dict = Depends(verify_token),
    db: Session = Depends(get_db)
) -> models.User:
    """Get the current user from DB, or create on first visit."""
    user_id: str = payload.get("sub")
    email: str = payload.get("email")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token: missing subject")

    user = db.query(models.User).filter(models.User.id == user_id).first()

    if not user:
        try:
            user = models.User(
                id=user_id,
                email=email or f"user_{user_id}@example.com",
                name=payload.get("user_metadata", {}).get("full_name") or "Guest",
                cefr_level="A1",
                placement_status="pending",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception as e:
            logging.error(f"Error creating user in local DB: {e}")
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to sync user record.")

    return user
