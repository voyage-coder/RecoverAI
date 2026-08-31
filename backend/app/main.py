import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine
from .schema import Base
from app.routes.recovery_routes import router as recovery_router
from app.routes.dashboard_routes import (
    router as dashboard_router,
)
from app.routes.webhook_routes import router as webhook_router
from app.routes.event_routes import router as event_router
from app.routes.integration_routes import router as integration_router
from app.routes.customer_routes import router as customer_router
from app.routes.demo_routes import router as demo_router
from app.schema import CustomerRecoveryLink, MerchantSettings

app = FastAPI(
    title="RecoverAI API",
    description="AI-powered revenue recovery platform",
    version="0.1.0"
)

_cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    recovery_router
)

app.include_router(
    dashboard_router
)

app.include_router(
    webhook_router
)

app.include_router(
    event_router
)

app.include_router(
    integration_router
)

app.include_router(
    customer_router
)

app.include_router(
    demo_router
)


# Ensure newer tables/columns exist even if alembic was not run (demo safety).
try:
    CustomerRecoveryLink.__table__.create(bind=engine, checkfirst=True)
except Exception:
    pass

try:
    MerchantSettings.__table__.create(bind=engine, checkfirst=True)
except Exception:
    pass

try:
    from sqlalchemy import text

    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE payments ADD COLUMN IF NOT EXISTS "
                "event_source VARCHAR(32) DEFAULT 'DEMO_EVENT'"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE recovery_actions ADD COLUMN IF NOT EXISTS "
                "requires_approval BOOLEAN DEFAULT FALSE"
            )
        )
except Exception:
    pass


@app.get("/")
def root():

    return {
        "message": "RecoverAI API is running"
    }

@app.get("/health")
def health():
    return {
        "status": "healthy"
    }

