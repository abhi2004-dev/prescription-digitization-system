import json
from typing import List, Optional, Union, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services.database.db import get_db
from app.services.database.models import User
from app.services.safety_engine import check_interactions

router = APIRouter()

class SafetyCheckRequest(BaseModel):
    scanned_drugs: List[Union[str, Dict[str, Any]]] = []
    profile_drugs: Optional[List[Union[str, Dict[str, Any]]]] = None

class SafetyCheckResponse(BaseModel):
    interactions: List[Dict[str, Any]]
    total_interactions: int
    status: str = "success"

@router.post("/check", response_model=SafetyCheckResponse)
def run_safety_check(payload: SafetyCheckRequest, db: Session = Depends(get_db)):
    scanned = payload.scanned_drugs or []
    profile = payload.profile_drugs

    # If profile_drugs not explicitly provided, fetch from registered user in database
    if profile is None:
        user = db.query(User).first()
        if user and user.active_medications:
            try:
                parsed = json.loads(user.active_medications)
                if isinstance(parsed, list):
                    profile = parsed
                else:
                    profile = [str(parsed)]
            except Exception:
                profile = [p.strip() for p in str(user.active_medications).split(",") if p.strip()]
        else:
            profile = []

    interactions = check_interactions(scanned, profile)

    return SafetyCheckResponse(
        interactions=interactions,
        total_interactions=len(interactions),
        status="success"
    )
