"""
PrescriptoAI — FastAPI Backend Server
=====================================
Endpoints:
  POST /api/upload   — Upload a prescription image for OCR analysis
  GET  /api/history   — Retrieve past prescription analyses
  GET  /                — Health check

Run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database.db import get_db, init_db
from database.models import Prescription
from ocr.ocr_engine import extract_text

# ─── Logging ────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-20s │ %(levelname)-7s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("prescriptoai")

# ─── Upload directory ───────────────────────────────────────────────
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "temp_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ─── Lifespan (startup / shutdown) ──────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database tables on startup."""
    logger.info("Starting PrescriptoAI server...")
    init_db()
    logger.info("Database tables created.")
    yield
    logger.info("Shutting down PrescriptoAI server.")


# ─── FastAPI App ────────────────────────────────────────────────────
app = FastAPI(
    title="PrescriptoAI",
    description="AI-powered prescription digitization and drug interaction checker",
    version="1.0.0",
    lifespan=lifespan,
)

# ─── CORS (allow React Native / Expo to connect) ───────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helper: Try to import Person 3's modules (graceful fallback) ──
def try_extract_medicines(raw_text: str) -> list:
    """
    Try to use Person 3's medicine extractor.
    Falls back to returning raw text as a single entry if not available yet.
    """
    try:
        from medicine.extractor import extract_medicines
        return extract_medicines(raw_text)
    except (ImportError, ModuleNotFoundError):
        logger.warning("medicine.extractor not available yet — returning raw text as-is")
        # Basic fallback: return raw text lines as unstructured entries
        lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
        return [{"name": line, "dosage": "", "frequency": ""} for line in lines]


def try_check_interactions(medicines: list) -> list:
    """
    Try to use Person 3's drug interaction checker.
    Falls back to empty list if not available yet.
    """
    try:
        from drug_interaction.checker import check_interactions
        return check_interactions(medicines)
    except (ImportError, ModuleNotFoundError):
        logger.warning("drug_interaction.checker not available yet — skipping interaction check")
        return []


# ─── Routes ─────────────────────────────────────────────────────────

@app.get("/")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "online",
        "service": "PrescriptoAI",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/upload")
async def upload_prescription(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Upload a prescription image for AI analysis.

    1. Saves the uploaded image to a temp file
    2. Runs TrOCR OCR (offloaded to thread pool so server stays responsive)
    3. Extracts medicine names (Person 3's module, with fallback)
    4. Checks drug interactions (Person 3's module, with fallback)
    5. Saves results to database
    6. Returns structured JSON matching the API contract
    """
    # ── Validate file type ──
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": f"Invalid file type: {file.content_type}. Upload a JPEG, PNG, or WebP image.",
            },
        )

    # ── Save uploaded file to temp directory ──
    file_ext = os.path.splitext(file.filename or "image.png")[1] or ".png"
    temp_filename = f"{uuid.uuid4().hex}{file_ext}"
    temp_path = os.path.join(UPLOAD_DIR, temp_filename)

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        logger.info(f"Saved upload: {temp_filename} ({file.content_type})")
    except Exception as e:
        logger.error(f"Failed to save upload: {e}")
        raise HTTPException(
            status_code=500,
            detail={"success": False, "error": "Failed to save uploaded file."},
        )

    # ── Run OCR (offloaded to thread pool) ──
    try:
        loop = asyncio.get_event_loop()
        raw_text = await loop.run_in_executor(None, extract_text, temp_path)
        logger.info(f"OCR complete. Extracted {len(raw_text)} characters.")
    except FileNotFoundError as e:
        logger.error(f"OCR file error: {e}")
        return {"success": False, "error": "Could not read the uploaded image."}
    except Exception as e:
        logger.error(f"OCR failed: {e}")
        return {"success": False, "error": "OCR processing failed. Please try a clearer image."}
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)
            logger.info(f"Cleaned up temp file: {temp_filename}")

    # ── Check if OCR returned anything ──
    if not raw_text or not raw_text.strip():
        return {
            "success": False,
            "error": "Could not read text from the image. Please upload a clearer image.",
        }

    # ── Extract medicines (Person 3's module) ──
    medicines = try_extract_medicines(raw_text)

    # ── Check drug interactions (Person 3's module) ──
    warnings = try_check_interactions(medicines)

    # ── Save to database ──
    try:
        prescription = Prescription(
            raw_text=raw_text,
            structured_medicines=medicines,
            interaction_warnings=warnings,
            status="completed",
        )
        db.add(prescription)
        db.commit()
        db.refresh(prescription)
        prescription_id = prescription.id
        logger.info(f"Saved prescription #{prescription_id} to database")
    except Exception as e:
        logger.error(f"Database save failed: {e}")
        db.rollback()
        prescription_id = None

    # ── Return API contract response ──
    return {
        "success": True,
        "raw_text": raw_text,
        "medicines": medicines,
        "warnings": warnings,
        "prescription_id": prescription_id,
    }


@app.get("/api/history")
async def get_history(db: Session = Depends(get_db)):
    """
    Retrieve past prescription analyses, newest first.
    """
    prescriptions = (
        db.query(Prescription)
        .order_by(Prescription.created_at.desc())
        .limit(50)
        .all()
    )

    return {
        "prescriptions": [
            {
                "id": p.id,
                "date": p.created_at.isoformat() if p.created_at else None,
                "raw_text": p.raw_text,
                "medicines": p.structured_medicines or [],
                "warnings": p.interaction_warnings or [],
                "medicine_count": len(p.structured_medicines) if p.structured_medicines else 0,
                "warning_count": len(p.interaction_warnings) if p.interaction_warnings else 0,
                "status": p.status,
            }
            for p in prescriptions
        ]
    }
