"""
Customer-facing recovery routes.

GET /api/customer/recovery/{token} — customer-safe payload only.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.api_schemas import CustomerRecoveryResponse
from app.services.customer_recovery_service import (
    resolve_customer_recovery,
)


router = APIRouter(
    prefix="/api/customer",
    tags=["Customer Recovery"],
)


@router.get(
    "/recovery/{token}",
    response_model=CustomerRecoveryResponse,
    summary="Resolve customer recovery token",
    description=(
        "Returns customer-safe payment recovery information for a hashed "
        "recovery token. Never marks the case recovered."
    ),
)
def get_customer_recovery(
    token: str,
    db: Session = Depends(get_db),
):
    try:
        payload = resolve_customer_recovery(
            db,
            token,
            mark_opened=True,
        )
        db.commit()
        return payload
    except ValueError as exc:
        db.rollback()
        code = str(exc)
        if code == "invalid_token":
            raise HTTPException(
                status_code=404,
                detail="This recovery link is invalid.",
            ) from exc
        if code in {"expired_token", "revoked_token"}:
            raise HTTPException(
                status_code=410,
                detail=(
                    "This recovery link has expired or was replaced. "
                    "Open the latest Pay as customer link from the case."
                ),
            ) from exc
        if code == "case_not_found":
            raise HTTPException(
                status_code=404,
                detail="Payment recovery is unavailable.",
            ) from exc
        raise HTTPException(
            status_code=400,
            detail="Unable to load this recovery link.",
        ) from exc
    except Exception:
        db.rollback()
        raise
