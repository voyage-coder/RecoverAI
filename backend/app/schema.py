from datetime import datetime
from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# ============================================================
# BASE
# ============================================================

class Base(DeclarativeBase):
    pass


# ============================================================
# ENUMS
# ============================================================

class CaseStatus(str, Enum):
    ACTIVE = "ACTIVE"
    IN_PROGRESS = "IN_PROGRESS"
    RECOVERED = "RECOVERED"
    ESCALATED = "ESCALATED"
    CLOSED = "CLOSED"


class FailureCategory(str, Enum):
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    CARD_DECLINED = "CARD_DECLINED"
    EXPIRED_CARD = "EXPIRED_CARD"
    GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT"
    TECHNICAL_FAILURE = "TECHNICAL_FAILURE"
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"


class StrategyType(str, Enum):
    IMMEDIATE_RETRY = "IMMEDIATE_RETRY"
    RETRY_AFTER_DELAY = "RETRY_AFTER_DELAY"
    SEND_PAYMENT_LINK = "SEND_PAYMENT_LINK"
    SEND_EMAIL_REMINDER = "SEND_EMAIL_REMINDER"
    SEND_SMS_REMINDER = "SEND_SMS_REMINDER"
    SEND_WHATSAPP_MESSAGE = "SEND_WHATSAPP_MESSAGE"
    OFFER_ALT_PAYMENT_METHOD = "OFFER_ALT_PAYMENT_METHOD"
    HUMAN_ESCALATION = "HUMAN_ESCALATION"
    STOP_RECOVERY = "STOP_RECOVERY"


class ActionStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    EXECUTED = "EXECUTED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"


class RecoveryResultStatus(str, Enum):
    PENDING = "PENDING"
    PARTIALLY_RECOVERED = "PARTIALLY_RECOVERED"
    FULLY_RECOVERED = "FULLY_RECOVERED"
    NOT_RECOVERED = "NOT_RECOVERED"


class CommunicationChannel(str, Enum):
    EMAIL = "EMAIL"
    SMS = "SMS"
    WHATSAPP = "WHATSAPP"


class CommunicationDirection(str, Enum):
    OUTBOUND = "OUTBOUND"
    INBOUND = "INBOUND"


class IntentType(str, Enum):
    POSITIVE_PAYMENT_INTENT = "POSITIVE_PAYMENT_INTENT"
    PROMISE_TO_PAY = "PROMISE_TO_PAY"
    PAYMENT_PROBLEM = "PAYMENT_PROBLEM"
    ALT_METHOD_REQUESTED = "ALT_METHOD_REQUESTED"
    REFUSAL = "REFUSAL"
    NO_RESPONSE = "NO_RESPONSE"


class PromiseStatus(str, Enum):
    PENDING = "PENDING"
    REMINDER_SENT = "REMINDER_SENT"
    KEPT = "KEPT"
    BROKEN = "BROKEN"


class ActorType(str, Enum):
    AI_AGENT = "AI_AGENT"
    SYSTEM = "SYSTEM"
    CUSTOMER = "CUSTOMER"
    HUMAN_OPERATOR = "HUMAN_OPERATOR"
    SAFETY_ENGINE = "SAFETY_ENGINE"


# ============================================================
# CUSTOMER
# ============================================================

class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
    )

    phone: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    risk_tier: Mapped[str] = mapped_column(
        String(20),
        default="LOW",
        nullable=False,
    )

    payment_history_score: Mapped[int] = mapped_column(
        Integer,
        default=85,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    orders = relationship(
        "Order",
        back_populates="customer",
        cascade="all, delete-orphan",
    )

    recovery_cases = relationship(
        "RecoveryCase",
        back_populates="customer",
        cascade="all, delete-orphan",
    )


# ============================================================
# PRODUCT
# ============================================================

class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    price_in_paise: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    category: Mapped[str] = mapped_column(
        String(100),
        default="Software",
        nullable=False,
    )

    image: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    orders = relationship(
        "Order",
        back_populates="product",
    )


# ============================================================
# ORDER
# ============================================================

class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    customer_id: Mapped[str] = mapped_column(
        ForeignKey(
            "customers.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    product_id: Mapped[str] = mapped_column(
        ForeignKey(
            "products.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    total_amount: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="PENDING",
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    customer = relationship(
        "Customer",
        back_populates="orders",
    )

    product = relationship(
        "Product",
        back_populates="orders",
    )

    payments = relationship(
        "Payment",
        back_populates="order",
        cascade="all, delete-orphan",
    )


# ============================================================
# PAYMENT
# ============================================================

class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    order_id: Mapped[str] = mapped_column(
        ForeignKey(
            "orders.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    amount: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    currency: Mapped[str] = mapped_column(
        String(3),
        default="INR",
        nullable=False,
    )

    payment_type: Mapped[str] = mapped_column(
        String(20),
        default="ONE_TIME",
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="FAILED",
        nullable=False,
    )

    failure_code: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    failure_reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    order = relationship(
        "Order",
        back_populates="payments",
    )

    payment_attempts = relationship(
        "PaymentAttempt",
        back_populates="payment",
        cascade="all, delete-orphan",
    )

    recovery_cases = relationship(
        "RecoveryCase",
        back_populates="payment",
        cascade="all, delete-orphan",
    )


# ============================================================
# PAYMENT ATTEMPT
# ============================================================

class PaymentAttempt(Base):
    __tablename__ = "payment_attempts"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    payment_id: Mapped[str] = mapped_column(
        ForeignKey(
            "payments.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    attempt_number: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="FAILED",
        nullable=False,
    )

    error_code: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    error_description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    error_source: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    gateway_response: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    payment = relationship(
        "Payment",
        back_populates="payment_attempts",
    )


# ============================================================
# RECOVERY CASE
# ============================================================

class RecoveryCase(Base):
    __tablename__ = "recovery_cases"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_number: Mapped[str] = mapped_column(
        String(30),
        unique=True,
        nullable=False,
    )

    payment_id: Mapped[str] = mapped_column(
        ForeignKey(
            "payments.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    customer_id: Mapped[str] = mapped_column(
        ForeignKey(
            "customers.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    amount_at_risk: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    status: Mapped[CaseStatus] = mapped_column(
        SQLEnum(CaseStatus),
        default=CaseStatus.ACTIVE,
        nullable=False,
    )

    failure_category: Mapped[FailureCategory] = mapped_column(
        SQLEnum(FailureCategory),
        nullable=False,
    )

    failure_reason: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    root_cause: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    recovery_probability: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    ai_confidence: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    risk_level: Mapped[str] = mapped_column(
        String(20),
        default="MEDIUM",
        nullable=False,
    )

    selected_strategy: Mapped[StrategyType | None] = mapped_column(
        SQLEnum(StrategyType),
        nullable=True,
    )

    current_step: Mapped[str] = mapped_column(
        String(100),
        default="AI Analysis",
        nullable=False,
    )

    retry_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    contact_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    payment = relationship(
        "Payment",
        back_populates="recovery_cases",
    )

    customer = relationship(
        "Customer",
        back_populates="recovery_cases",
    )

    recovery_strategies = relationship(
        "RecoveryStrategy",
        back_populates="recovery_case",
        cascade="all, delete-orphan",
    )

    recovery_actions = relationship(
        "RecoveryAction",
        back_populates="recovery_case",
        cascade="all, delete-orphan",
    )

    recovery_result = relationship(
        "RecoveryResult",
        back_populates="recovery_case",
        uselist=False,
        cascade="all, delete-orphan",
    )

    customer_recovery_links = relationship(
        "CustomerRecoveryLink",
        back_populates="recovery_case",
        cascade="all, delete-orphan",
    )

    communications = relationship(
        "Communication",
        back_populates="recovery_case",
        cascade="all, delete-orphan",
    )

    promises = relationship(
        "PromiseToPay",
        back_populates="recovery_case",
        cascade="all, delete-orphan",
    )

    audit_logs = relationship(
        "AuditLog",
        back_populates="recovery_case",
        cascade="all, delete-orphan",
    )


# ============================================================
# RECOVERY STRATEGY
# ============================================================

class RecoveryStrategy(Base):
    __tablename__ = "recovery_strategies"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_id: Mapped[str] = mapped_column(
        ForeignKey(
            "recovery_cases.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    strategy_type: Mapped[StrategyType] = mapped_column(
        SQLEnum(StrategyType),
        nullable=False,
    )

    rationale: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    expected_probability: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    stopping_rules: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    is_selected: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    recovery_case = relationship(
        "RecoveryCase",
        back_populates="recovery_strategies",
    )


# ============================================================
# RECOVERY ACTION
# ============================================================

class RecoveryAction(Base):
    __tablename__ = "recovery_actions"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_id: Mapped[str] = mapped_column(
        ForeignKey(
            "recovery_cases.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    action_type: Mapped[StrategyType] = mapped_column(
        SQLEnum(StrategyType),
        nullable=False,
    )

    status: Mapped[ActionStatus] = mapped_column(
        SQLEnum(ActionStatus),
        default=ActionStatus.PENDING,
        nullable=False,
    )

    attempt_number: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    executed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    result_text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    recovery_case = relationship(
        "RecoveryCase",
        back_populates="recovery_actions",
    )


# ============================================================
# RECOVERY RESULT
# ============================================================

class RecoveryResult(Base):
    __tablename__ = "recovery_results"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_id: Mapped[str] = mapped_column(
        ForeignKey(
            "recovery_cases.id",
            ondelete="CASCADE",
        ),
        unique=True,
        nullable=False,
    )

    original_amount: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    recovered_amount: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    status: Mapped[RecoveryResultStatus] = mapped_column(
        SQLEnum(RecoveryResultStatus),
        default=RecoveryResultStatus.PENDING,
        nullable=False,
    )

    recovery_method: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    recovered_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    recovery_case = relationship(
        "RecoveryCase",
        back_populates="recovery_result",
    )


# ============================================================
# COMMUNICATION
# ============================================================

class Communication(Base):
    __tablename__ = "communications"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_id: Mapped[str] = mapped_column(
        ForeignKey(
            "recovery_cases.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    channel: Mapped[CommunicationChannel] = mapped_column(
        SQLEnum(CommunicationChannel),
        nullable=False,
    )

    direction: Mapped[CommunicationDirection] = mapped_column(
        SQLEnum(CommunicationDirection),
        default=CommunicationDirection.OUTBOUND,
        nullable=False,
    )

    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="SENT",
        nullable=False,
    )

    sent_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    recovery_case = relationship(
        "RecoveryCase",
        back_populates="communications",
    )

    customer_responses = relationship(
        "CustomerResponse",
        back_populates="communication",
        cascade="all, delete-orphan",
    )


# ============================================================
# CUSTOMER RESPONSE
# ============================================================

class CustomerResponse(Base):
    __tablename__ = "customer_responses"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    communication_id: Mapped[str] = mapped_column(
        ForeignKey(
            "communications.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    raw_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    detected_intent: Mapped[IntentType | None] = mapped_column(
        SQLEnum(IntentType),
        nullable=True,
    )

    sentiment: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )

    ai_confidence: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    communication = relationship(
        "Communication",
        back_populates="customer_responses",
    )


# ============================================================
# PROMISE TO PAY
# ============================================================

class PromiseToPay(Base):
    __tablename__ = "promise_to_pay"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_id: Mapped[str] = mapped_column(
        ForeignKey(
            "recovery_cases.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    promised_date: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )

    promised_amount: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    confidence_score: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    status: Mapped[PromiseStatus] = mapped_column(
        SQLEnum(PromiseStatus),
        default=PromiseStatus.PENDING,
        nullable=False,
    )

    reminder_scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    recovery_case = relationship(
        "RecoveryCase",
        back_populates="promises",
    )


# ============================================================
# AUDIT LOG
# ============================================================

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_id: Mapped[str | None] = mapped_column(
        ForeignKey(
            "recovery_cases.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    action_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    actor: Mapped[ActorType] = mapped_column(
        SQLEnum(ActorType),
        default=ActorType.SYSTEM,
        nullable=False,
    )

    details: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )

    timestamp: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    recovery_case = relationship(
        "RecoveryCase",
        back_populates="audit_logs",
    )


# ============================================================
# CUSTOMER RECOVERY LINK (hashed token)
# ============================================================

class CustomerRecoveryLink(Base):
    """
    Secure customer recovery access.

    Only the SHA-256 hash of the token is stored.
    The raw token is returned once at creation time.
    """

    __tablename__ = "customer_recovery_links"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    case_id: Mapped[str] = mapped_column(
        ForeignKey(
            "recovery_cases.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    token_hash: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
        index=True,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    first_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    last_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    recovery_case = relationship(
        "RecoveryCase",
        back_populates="customer_recovery_links",
    )