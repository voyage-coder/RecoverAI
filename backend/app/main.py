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

# Browser apps (Vercel, local Vite) call this API on another origin.
# Always allow them. A wrong CORS_ORIGINS env must not block the demo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=(
        r"https://([a-z0-9-]+\.)*vercel\.app|"
        r"http://(localhost|127\.0\.0\.1):\d+"
    ),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
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

