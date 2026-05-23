import re
import secrets
from datetime import datetime, timedelta
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])
SESSION_COOKIE_NAME = "expense_tracker_session"
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterPayload(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)


class LoginPayload(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = False


class ProfilePayload(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class DeleteAccountPayload(BaseModel):
    password: str = Field(min_length=1, max_length=128)


def _validate_email(email: str) -> str:
    normalized = email.strip().lower()
    if not EMAIL_REGEX.match(normalized):
        raise HTTPException(status_code=400, detail="Please provide a valid email address.")
    return normalized


def _create_session(user: User, remember_me: bool) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(48)
    expires = datetime.utcnow() + timedelta(days=30 if remember_me else 1)
    user.session_token = token
    user.session_expires = expires
    return token, expires


def _set_session_cookie(response: Response, token: str, remember_me: bool) -> None:
    max_age = 60 * 60 * 24 * 30 if remember_me else None
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
        max_age=max_age,
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


def get_current_user(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
    db: Session = Depends(get_db),
) -> User:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    user = db.scalar(select(User).where(User.session_token == session_token))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.")
    if user.session_expires and user.session_expires < datetime.utcnow():
        user.session_token = None
        user.session_expires = None
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    return user


@router.post("/register")
def register(payload: RegisterPayload, response: Response, db: Session = Depends(get_db)) -> dict:
    email = _validate_email(payload.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    password_hash = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    user = User(email=email, password_hash=password_hash, display_name=payload.display_name)
    token, _ = _create_session(user, remember_me=True)

    db.add(user)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, token, remember_me=True)

    return {"success": True, "user": user.as_dict()}


@router.post("/login")
def login(payload: LoginPayload, response: Response, db: Session = Depends(get_db)) -> dict:
    email = _validate_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if not user:
        raise HTTPException(status_code=401, detail="No account found for this email.")

    valid_password = bcrypt.checkpw(payload.password.encode("utf-8"), user.password_hash.encode("utf-8"))
    if not valid_password:
        raise HTTPException(status_code=401, detail="Incorrect password.")

    token, _ = _create_session(user, payload.remember_me)
    db.commit()
    _set_session_cookie(response, token, payload.remember_me)

    return {"success": True, "user": user.as_dict()}


@router.post("/logout")
def logout(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    current_user.session_token = None
    current_user.session_expires = None
    db.commit()
    _clear_session_cookie(response)
    return {"success": True}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)) -> dict:
    return {"success": True, "user": current_user.as_dict()}


@router.patch("/profile")
def update_profile(payload: ProfilePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    current_user.display_name = payload.display_name
    db.commit()
    db.refresh(current_user)
    return {"success": True, "user": current_user.as_dict()}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not bcrypt.checkpw(payload.current_password.encode("utf-8"), current_user.password_hash.encode("utf-8")):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    current_user.password_hash = bcrypt.hashpw(
        payload.new_password.encode("utf-8"), bcrypt.gensalt(rounds=12)
    ).decode("utf-8")
    db.commit()
    return {"success": True}


@router.post("/delete-account")
def delete_account(
    payload: DeleteAccountPayload,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not bcrypt.checkpw(payload.password.encode("utf-8"), current_user.password_hash.encode("utf-8")):
        raise HTTPException(status_code=400, detail="Password is incorrect.")
    db.delete(current_user)
    db.commit()
    _clear_session_cookie(response)
    return {"success": True}
