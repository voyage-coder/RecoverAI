from fastapi import FastAPI

from .database import engine
from .schema import Base
from app.routes.recovery_routes import router as recovery_router
from app.routes.dashboard_routes import (
    router as dashboard_router,
)
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

