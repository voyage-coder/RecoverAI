from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


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

    event_source: Optional[str] = None
    event_source_label: Optional[str] = None
    webhook_authority_label: Optional[str] = None
    outcome_kind: Optional[str] = None
    recommended_action: Optional[str] = None
    approval_state: Optional[str] = None
    safety_decision: Optional[str] = None
    requires_approval: Optional[bool] = None
    policy_reason: Optional[str] = None
    next_step_code: Optional[str] = None
    next_step_label: Optional[str] = None
    next_step_detail: Optional[str] = None


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

    expected_probability: Optional[int] = None

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
# DECISION EXPLANATION (Phase 13 — derived, non-mutating)
# ============================================================

class DecisionExplanationText(BaseModel):

    summary: str
    factors: list[str]
    strategy_reason: Optional[str] = None
    safety_reason: Optional[str] = None


class DecisionPredictionBlock(BaseModel):

    recovery_probability: Optional[int] = None
    ai_confidence: Optional[int] = None
    label: str
    band: Optional[str] = None
    disclaimer: str


class StrategyComparisonItem(BaseModel):

    strategy: Optional[str] = None
    selected: bool = False
    available: bool = True
    expected_probability: Optional[int] = None
    reason: Optional[str] = None
    role: Optional[str] = None
    safety_allowed: Optional[bool] = None
    is_ranked_score: bool = False


class StrategyComparisonBlock(BaseModel):

    ranked_probabilities_supported: bool
    note: str
    strategies: list[StrategyComparisonItem]


class DecisionSafetyBlock(BaseModel):

    decision: str
    reason: Optional[str] = None
    execution_status: str
    escalation_required: bool
    stopping_rules_applied: bool
    stopping_rules_text: Optional[str] = None
    blocked_result_text: Optional[str] = None


class DecisionOutcomeBlock(BaseModel):

    case_status: Optional[str] = None
    result_status: Optional[str] = None
    recovered_amount: Optional[int] = None
    original_amount: Optional[int] = None
    recovery_method: Optional[str] = None
    recovered_at: Optional[str] = None
    source: str


class CaseDecisionExplanationResponse(BaseModel):

    case_id: str
    case_number: str
    decision_state: str
    failure_category: Optional[str] = None
    failure_reason: Optional[str] = None
    root_cause: Optional[str] = None
    recovery_probability: Optional[int] = None
    ai_confidence: Optional[int] = None
    risk_level: Optional[str] = None
    selected_strategy: Optional[str] = None
    current_step: Optional[str] = None
    decision_explanation: DecisionExplanationText
    prediction: DecisionPredictionBlock
    strategy_comparison: StrategyComparisonBlock
    safety: DecisionSafetyBlock
    outcome: DecisionOutcomeBlock
    fabricated: bool = False


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
    failure_reason: Optional[str] = None

    recovery_probability: int
    risk_level: str

    selected_strategy: Optional[str] = None

    current_step: str

    retry_count: int = 0
    contact_count: int = 0

    created_at: datetime

    event_source: Optional[str] = None
    event_source_label: Optional[str] = None
    outcome_kind: Optional[str] = None
    recommended_action: Optional[str] = None
    approval_state: Optional[str] = None
    safety_decision: Optional[str] = None
    requires_approval: Optional[bool] = None
    policy_reason: Optional[str] = None
    webhook_authority_label: Optional[str] = None
    next_step_code: Optional[str] = None
    next_step_label: Optional[str] = None
    next_step_detail: Optional[str] = None


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


# ============================================================
# PAYMENT DETAILS (read-only)
# ============================================================

class PaymentDetailsPaymentResponse(BaseModel):

    payment_id: str
    amount: int
    currency: str
    payment_type: str
    status: str
    failure_code: Optional[str] = None
    failure_reason: Optional[str] = None
    created_at: datetime


class PaymentAttemptDetailsResponse(BaseModel):

    id: str
    attempt_number: int
    status: str
    error_code: Optional[str] = None
    error_description: Optional[str] = None
    error_source: Optional[str] = None
    created_at: datetime
    gateway: dict


class GatewaySummaryResponse(BaseModel):

    mode: Optional[str] = None
    order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    status: Optional[str] = None
    awaiting_webhook: Optional[bool] = None
    attempt_number: Optional[int] = None
    error_code: Optional[str] = None
    error_source: Optional[str] = None


class CasePaymentDetailsResponse(BaseModel):

    case_id: str
    case_number: str
    payment: PaymentDetailsPaymentResponse
    attempts: list[PaymentAttemptDetailsResponse]
    gateway_summary: GatewaySummaryResponse


# ============================================================
# SIMULATED PAYMENT EVENTS (demo ingestion)
# ============================================================

class PaymentEventCustomerRequest(BaseModel):

    name: str
    email: str
    phone: Optional[str] = None


class PaymentEventFailureRequest(BaseModel):

    code: str
    reason: str


class PaymentEventRequest(BaseModel):

    event: str
    amount: int = Field(gt=0, description="Amount in paise (e.g. 249900 = ₹2499)")
    currency: str = "INR"
    customer: PaymentEventCustomerRequest
    failure: PaymentEventFailureRequest
    idempotency_key: Optional[str] = None


class PaymentEventResponse(BaseModel):

    message: str
    event: str
    simulated: bool
    idempotent: bool
    payment_id: str
    order_id: Optional[str] = None
    case_id: Optional[str] = None
    case_number: Optional[str] = None
    case_status: Optional[str] = None
    payment_status: Optional[str] = None
    failure_code: Optional[str] = None
    failure_reason: Optional[str] = None
    event_source: Optional[str] = None


class EventCapabilityItem(BaseModel):

    event: str
    supported: bool
    state_mutating: bool
    ingestion_path: Optional[str] = None
    note: str


class ProviderEventCapabilitiesResponse(BaseModel):

    environment: str
    label: str
    capabilities: list[EventCapabilityItem]


class RecentProviderEventItem(BaseModel):

    event: str
    timestamp: datetime
    amount: int
    currency: str
    customer_ref: str
    payment_id: str
    case_id: Optional[str] = None
    case_number: Optional[str] = None
    case_status: Optional[str] = None
    payment_status: Optional[str] = None
    failure_code: Optional[str] = None
    failure_reason: Optional[str] = None
    event_source: Optional[str] = None
    event_source_label: Optional[str] = None
    idempotency_state: str


class RecentProviderEventsResponse(BaseModel):

    events: list[RecentProviderEventItem]
    source: str
    note: str


class UnsupportedProviderEventRequest(BaseModel):

    event: str
    payment_id: Optional[str] = None
    amount: Optional[int] = None
    currency: Optional[str] = "INR"


class UnsupportedProviderEventResponse(BaseModel):

    message: str
    event: str
    simulated: bool
    simulation_only: bool
    mutates_state: bool
    supported: bool
    required: str


# ============================================================
# RECOVERY OPERATIONS (operator / demo)
# ============================================================

class ExecuteRecoveryActionResponse(BaseModel):

    message: str
    case_id: str
    case_number: str
    case_status: str
    action_id: Optional[str] = None
    action_type: Optional[str] = None
    action_status: Optional[str] = None
    result_text: Optional[str] = None
    blocked: bool = False


class CheckoutConfigResponse(BaseModel):

    available: bool
    test_mode: bool
    demo_label: str
    mode: Optional[str] = None
    razorpay_key_id: Optional[str] = None
    order_id: Optional[str] = None
    amount: Optional[int] = None
    currency: Optional[str] = None
    awaiting_webhook: Optional[bool] = None
    payment_link_url: Optional[str] = None
    payment_status: Optional[str] = None
    case_status: Optional[str] = None
    message: Optional[str] = None


# ============================================================
# CUSTOMER RECOVERY (merchant + customer-safe)
# ============================================================

class MerchantCustomerRecoveryLinkResponse(BaseModel):

    status: str
    has_active_link: bool
    expires_at: Optional[str] = None
    created_at: Optional[str] = None
    first_opened_at: Optional[str] = None
    case_status: Optional[str] = None
    amount_at_risk: Optional[int] = None
    recovery_path: Optional[str] = None
    token: Optional[str] = None
    note: Optional[str] = None


class CustomerCheckoutSafe(BaseModel):

    available: bool
    order_id: Optional[str] = None
    amount: Optional[int] = None
    currency: Optional[str] = None
    razorpay_key_id: Optional[str] = None
    payment_link_url: Optional[str] = None
    test_mode: bool = True


class CustomerRecoveryResponse(BaseModel):

    customer_status: str
    headline: str
    message: str
    amount: int
    currency: str
    recovered_amount: Optional[int] = None
    payment_action_available: bool
    expires_at: str
    test_mode: bool = True
    checkout: CustomerCheckoutSafe


# ============================================================
# MERCHANT SETTINGS / ONBOARDING
# ============================================================

class MerchantPolicyUpdateRequest(BaseModel):

    recovery_mode: Optional[str] = None
    automatic_recovery_enabled: Optional[bool] = None
    max_automatic_recovery_amount: Optional[int] = Field(default=None, gt=0)
    max_retry_attempts: Optional[int] = Field(default=None, ge=0)
    payment_link_expiry_hours: Optional[int] = Field(default=None, gt=0)
    high_value_approval_threshold: Optional[int] = Field(default=None, gt=0)


class RazorpayCredentialsRequest(BaseModel):

    key_id: Optional[str] = None
    key_secret: Optional[str] = None
    webhook_secret: Optional[str] = None


class MerchantSettingsResponse(BaseModel):

    recovery_mode: str
    automatic_recovery_enabled: bool
    max_automatic_recovery_amount: int
    max_retry_attempts: int
    payment_link_expiry_hours: int
    high_value_approval_threshold: int
    razorpay_key_id_configured: bool
    razorpay_key_id_hint: Optional[str] = None
    webhook_secret_configured: bool
    key_secret_configured: bool
    credentials_last_tested_at: Optional[str] = None
    credentials_last_test_ok: Optional[bool] = None
    credentials_last_test_detail: Optional[str] = None
    updated_at: Optional[str] = None


class ConnectionTestResponse(BaseModel):

    ok: bool
    mode: str
    detail: str
    secrets_returned: bool = False

