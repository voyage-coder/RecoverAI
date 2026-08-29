from fastapi import FastAPI

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
from app.schema import CustomerRecoveryLink

app = FastAPI(
    title="RecoverAI API",
    description="AI-powered revenue recovery platform",
    version="0.1.0"
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


# Ensure Phase 11 table exists even if alembic was not run (demo safety).
try:
    CustomerRecoveryLink.__table__.create(bind=engine, checkfirst=True)
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

