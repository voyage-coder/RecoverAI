from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ============================================================
# RECOVERY CASE
# ============================================================

class RecoveryCaseResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True
    )

    id: str
    case_number: str
    payment_id: str
    customer_id: str

    amount_at_risk: int

    status: str
    failure_category: str
    failure_reason: str

    root_cause: Optional[str] = None

    recovery_probability: int
    ai_confidence: int
    risk_level: str

    selected_strategy: Optional[str] = None

    current_step: str

    retry_count: int
    contact_count: int

    created_at: datetime
    updated_at: datetime


# ============================================================
# STRATEGY
# ============================================================

class RecoveryStrategyResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True
    )

    id: str
    case_id: str

    strategy_type: str
    rationale: str

    expected_probability: int

    stopping_rules: Optional[str] = None

    is_selected: bool

    created_at: datetime


# ============================================================
# ACTION
# ============================================================

class RecoveryActionResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True
    )

    id: str
    case_id: str

    action_type: str
    status: str

    attempt_number: int

    scheduled_at: Optional[datetime] = None
    executed_at: Optional[datetime] = None

    result_text: Optional[str] = None

    created_at: datetime


# ============================================================
# RECOVERY RESULT
# ============================================================

class RecoveryResultResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True
    )

    id: str
    case_id: str

    original_amount: int
    recovered_amount: int

    status: str

    recovery_method: Optional[str] = None

    recovered_at: Optional[datetime] = None

    created_at: datetime


# ============================================================
# COMMUNICATION
# ============================================================

class CommunicationResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True
    )

    id: str
    case_id: str

    channel: str
    direction: str

    content: str
    status: str

    sent_at: datetime


# ============================================================
# AUDIT LOG
# ============================================================

class AuditLogResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True
    )

    id: str

    case_id: Optional[str] = None

    action_type: str
    actor: str
    details: str

    timestamp: datetime


# ============================================================
# CASE LIST
# ============================================================

class RecoveryCaseListResponse(BaseModel):

    model_config = ConfigDict(
        from_attributes=True
    )

    id: str
    case_number: str

    amount_at_risk: int

    status: str
    failure_category: str

    recovery_probability: int
    risk_level: str

    selected_strategy: Optional[str] = None

    current_step: str

    created_at: datetime


# ============================================================
# TIMELINE
# ============================================================

class RecoveryTimelineResponse(BaseModel):

    case: RecoveryCaseResponse

    strategies: list[
        RecoveryStrategyResponse
    ]

    actions: list[
        RecoveryActionResponse
    ]

    communications: list[
        CommunicationResponse
    ]

    result: Optional[
        RecoveryResultResponse
    ] = None

    audit_logs: list[
        AuditLogResponse
    ]