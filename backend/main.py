import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.services.database.db import init_db
from app.api.routes import router as prescription_router
from app.api.user import router as user_router
from app.api.safety import router as safety_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure SQLite tables exist upon startup
    init_db()
    yield

app = FastAPI(
    title="MediScan Backend",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for React Native / mobile client access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# User Profile endpoints (/api/user/profile, /api/v1/user/profile, /user/profile)
app.include_router(user_router, prefix="/api/user", tags=["User"])
app.include_router(user_router, prefix="/api/v1/user", tags=["User"])
app.include_router(user_router, prefix="/user", tags=["User Base"])

# Safety Check endpoints (/api/safety/check, /api/v1/safety/check, /safety/check)
app.include_router(safety_router, prefix="/api/safety", tags=["Safety"])
app.include_router(safety_router, prefix="/api/v1/safety", tags=["Safety"])
app.include_router(safety_router, prefix="/safety", tags=["Safety Base"])

# Prescriptions & Scan endpoints (/api/scan, /api/v1/scan, /api/prescriptions, /api/v1/prescriptions, etc.)
app.include_router(prescription_router, prefix="/api/scan", tags=["Scan API"])
app.include_router(prescription_router, prefix="/api/v1/scan", tags=["Scan API v1"])
app.include_router(prescription_router, prefix="/scan", tags=["Scan Base"])
app.include_router(prescription_router, prefix="/api/prescriptions", tags=["Prescriptions Direct"])
app.include_router(prescription_router, prefix="/api/v1/prescriptions", tags=["Prescriptions Direct v1"])
app.include_router(prescription_router, prefix="/api/v1", tags=["Prescriptions API v1"])
app.include_router(prescription_router, prefix="/api", tags=["Prescriptions API"])
app.include_router(prescription_router, prefix="/prescriptions", tags=["Prescriptions Base"])

@app.get("/")
def health_check():
    return {"status": "healthy", "service": "PrescriptoAI"}