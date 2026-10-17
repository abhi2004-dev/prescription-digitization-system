import json
from typing import List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services.database.db import get_db
from app.services.database.models import User

router = APIRouter()

class UserProfileRequest(BaseModel):
    name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    current_conditions: Optional[Union[List[str], str]] = []
    active_medications: Optional[Union[List[str], str]] = []

class UserProfileResponse(BaseModel):
    id: int
    name: str = ""
    email: str = ""
    phone: str = ""
    current_conditions: List[str] = []
    active_medications: List[str] = []

def serialize_to_json_string(value: Union[List[str], str, None]) -> str:
    """Serializes lists or comma-separated strings into standard JSON strings."""
    if value is None:
        return "[]"
    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        return json.dumps(cleaned)
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return "[]"
        if trimmed.startswith("[") and trimmed.endswith("]"):
            try:
                parsed = json.loads(trimmed)
                if isinstance(parsed, list):
                    cleaned = [str(item).strip() for item in parsed if str(item).strip()]
                    return json.dumps(cleaned)
            except Exception:
                pass
        # Handle comma-separated string input
        parts = [p.strip() for p in trimmed.split(",") if p.strip()]
        return json.dumps(parts)
    return "[]"

def deserialize_json_string(value: Optional[str]) -> List[str]:
    """Deserializes JSON string back to list of strings."""
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
        return [str(parsed)]
    except Exception:
        return [p.strip() for p in str(value).split(",") if p.strip()]

@router.post("/profile", response_model=UserProfileResponse)
def save_user_profile(payload: UserProfileRequest, db: Session = Depends(get_db)):
    conditions_json = serialize_to_json_string(payload.current_conditions)
    medications_json = serialize_to_json_string(payload.active_medications)

    user = db.query(User).first()
    if user:
        user.name = (payload.name or "").strip()
        user.email = (payload.email or "").strip()
        user.phone = (payload.phone or "").strip()
        user.current_conditions = conditions_json
        user.active_medications = medications_json
    else:
        user = User(
            name=(payload.name or "").strip(),
            email=(payload.email or "").strip(),
            phone=(payload.phone or "").strip(),
            current_conditions=conditions_json,
            active_medications=medications_json,
        )
        db.add(user)

    db.commit()
    db.refresh(user)

    return UserProfileResponse(
        id=user.id,
        name=user.name or "",
        email=user.email or "",
        phone=user.phone or "",
        current_conditions=deserialize_json_string(user.current_conditions),
        active_medications=deserialize_json_string(user.active_medications),
    )

@router.get("/profile")
def get_user_profile(db: Session = Depends(get_db)):
    from app.api.routes import get_user_profile as get_profile_safe
    return get_profile_safe(db)
