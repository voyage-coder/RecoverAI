"""Demo health, inventory, and safe DEMO_EVENT reset."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.demo_service import (
    demo_health,
    demo_inventory,
    reset_demo_data,
)


router = APIRouter(
    prefix="/api/demo",
    tags=["Demo"],
)


class DemoResetRequest(BaseModel):
    confirmation: str


@router.get("/health")
def get_demo_health(db: Session = Depends(get_db)):
    payload = demo_health(db)
    if payload.get("secrets_returned"):
        raise HTTPException(
            status_code=500,
            detail="Refusing to return secrets.",
        )
    return payload


@router.get("/inventory")
def get_demo_inventory(db: Session = Depends(get_db)):
    return demo_inventory(db)


@router.post("/reset")
def post_demo_reset(
    body: DemoResetRequest,
    db: Session = Depends(get_db),
):
    try:
        result = reset_demo_data(db, body.confirmation)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        if str(exc) == "confirmation_required":
            raise HTTPException(
                status_code=400,
                detail=(
                    "Type CLEAR_DEMO_DATA to confirm. "
                    "Live provider records will not be removed."
                ),
            ) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
