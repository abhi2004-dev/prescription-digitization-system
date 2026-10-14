import os
import uuid
import re
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Body
from sqlalchemy.orm import Session
from thefuzz import fuzz

from app.services.ocr.ocr_engine import OCREngine
from app.services.medicine.extractor import parse_dosage_schedule
from app.services.safety_engine import check_interactions
from app.services.ocr.signature_detector import detect_signature
from app.services.verification_engine import verify_license
from app.services.database.db import get_db
from app.services.database.models import User, Prescription

router = APIRouter()
ocr_engine = OCREngine()

TEMP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../temp_uploads"))
os.makedirs(TEMP_DIR, exist_ok=True)

@router.post("/extract")
@router.post("/scan/extract")
@router.post("/scan")
async def extract_prescription(file: UploadFile = File(...)):
    """
    Endpoint 1: Extract prescription data via Vision OCR + spaCy NLP + verification.
    Does NOT run the safety engine and does NOT save to the database.
    Returns structured JSON for Human-in-the-Loop verification.
    """
    is_image = False
    if file.content_type and file.content_type.startswith("image/"):
        is_image = True
    elif file.filename and any(file.filename.lower().endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]):
        is_image = True
    elif file.content_type in ("application/octet-stream", "multipart/form-data"):
        is_image = True

    if not is_image:
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    file_ext = os.path.splitext(file.filename)[1] or ".png"
    temp_filepath = os.path.join(TEMP_DIR, f"temp_{uuid.uuid4()}{file_ext}")

    try:
        contents = await file.read()
        with open(temp_filepath, "wb") as f:
            f.write(contents)

        # 1. Vision OCR transcription + spaCy Clinical NLP pipeline
        parsed_data = ocr_engine.extract_text(temp_filepath)

        # 2. Extract Doctor Registration / License Number
        doc_id = parsed_data.get("license_code") or parsed_data.get("doctor_id") or parsed_data.get("doctor_license_number") or ""
        
        # 3. Verification Engine: Doctor License Verification
        license_verification = verify_license(doc_id)
        license_status = license_verification.get("status", "Not Found")
        
        # 4. Computer Vision Signature Detection on image bytes
        cv_signature_detected = detect_signature(contents)
        text_sig_detected = bool(parsed_data.get("sign_present", False) or parsed_data.get("signature_verified", False))
        final_signature_present = bool(cv_signature_detected or text_sig_detected)

        # 5. Append Verification Object to final response
        parsed_data["verification"] = {
            "license_status": license_status,
            "signature_present": final_signature_present
        }
        parsed_data["sign_present"] = final_signature_present
        parsed_data["signature_verified"] = final_signature_present
        parsed_data["doctor_license_validated"] = (license_status == "Valid")
        parsed_data["is_doctor_id_valid"] = (license_status == "Valid")
        if license_verification.get("doctor_name") and not parsed_data.get("doctor_name"):
            parsed_data["doctor_name"] = license_verification["doctor_name"]
        
        parsed_data["signature_details"] = {
            "cv_detected": cv_signature_detected,
            "text_heuristic_detected": text_sig_detected,
            "method": "opencv_contour" if cv_signature_detected else "text_heuristic"
        }
        
        # Build the frontend instruction badges
        formatted_meds = []
        scanned_drug_names = []
        raw_medicines = parsed_data.get("medicines", [])
        if not raw_medicines and parsed_data.get("prescribed_medications"):
            raw_medicines = parsed_data.get("prescribed_medications", [])

        for m in raw_medicines:
            if isinstance(m, str):
                m = {"drug_name": m}
            d_name = m.get("drug_name") or m.get("name") or m.get("drug") or "Medication"
            parts = [p for p in [m.get("strength"), m.get("form"), m.get("frequency"), m.get("duration"), m.get("timing")] if p]
            instructions = m.get("instructions") or (' • '.join(parts) if parts else 'As directed by physician')
            
            m["drug_name"] = d_name
            m["instructions"] = instructions
            if not m.get("schedule_text") or not m.get("schedule_slots"):
                sched_info = parse_dosage_schedule(m.get("frequency", ""))
                m["schedule_text"] = sched_info.get("schedule_text", "")
                m["schedule_slots"] = sched_info.get("schedule_slots", {"morning": False, "afternoon": False, "night": False})
                m["schedule"] = m["schedule_text"]
            formatted_meds.append(m)
            if d_name and d_name.lower() != "medication":
                scanned_drug_names.append(d_name)

        parsed_data["medicines"] = formatted_meds
        parsed_data["prescribed_medications"] = formatted_meds
        parsed_data["scanned_drugs"] = scanned_drug_names
        parsed_data["filename"] = file.filename
        parsed_data["status"] = "extracted"

        return parsed_data

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if os.path.exists(temp_filepath):
            os.remove(temp_filepath)


@router.post("/finalize")
@router.post("/scan/finalize")
async def finalize_prescription(payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    """
    Endpoint 2: Finalize verified prescription data.
    - Accepts verified/edited prescription JSON from the frontend.
    - Runs Patient Name-Matching Router (Scenario 1 vs Scenario 2).
    - If is_owner == True, runs check_interactions() and appends medications to the users table.
    - Saves the final record to the prescriptions table in SQLite.
    - Returns interaction warnings and final status.
    """
    try:
        # Extract medicines (from 'medicines' or 'prescribed_medications')
        meds = payload.get("medicines")
        if meds is None:
            meds = payload.get("prescribed_medications", [])
        
        if not isinstance(meds, list):
            meds = []

        formatted_meds = []
        scanned_drug_names = []
        for m in meds:
            if isinstance(m, str):
                m = {"drug_name": m}
            d_name = m.get("drug_name") or m.get("name") or m.get("drug") or "Medication"
            parts = [p for p in [m.get("strength"), m.get("form"), m.get("frequency"), m.get("duration"), m.get("timing")] if p]
            instructions = m.get("instructions") or (' • '.join(parts) if parts else 'As directed by physician')
            
            m["drug_name"] = d_name
            m["instructions"] = instructions
            if not m.get("schedule_text") or not m.get("schedule_slots"):
                sched_info = parse_dosage_schedule(m.get("frequency", ""))
                m["schedule_text"] = sched_info.get("schedule_text", "")
                m["schedule_slots"] = sched_info.get("schedule_slots", {"morning": False, "afternoon": False, "night": False})
                m["schedule"] = m["schedule_text"]
            formatted_meds.append(m)
            if d_name and d_name.lower() != "medication":
                scanned_drug_names.append(d_name)

        payload["medicines"] = formatted_meds
        payload["prescribed_medications"] = formatted_meds
        payload["scanned_drugs"] = scanned_drug_names

        # Patient Name Fuzzy Matching & Safety Routing
        scanned_patient_name = (
            payload.get("patient_name")
            or payload.get("scanned_patient_name")
            or (payload.get("patient_details", {}).get("name") if isinstance(payload.get("patient_details"), dict) else "")
            or ""
        )

        user = db.query(User).first()
        match_score = 0
        if user and user.name and scanned_patient_name:
            match_score = fuzz.token_sort_ratio(scanned_patient_name.lower().strip(), user.name.lower().strip())

        payload["match_score"] = match_score

        if match_score >= 80 and user:
            # Scenario 1: Prescription belongs to logged-in user
            is_owner = True
            user_id = user.id

            # Parse user profile medications
            profile_meds = []
            if user.active_medications:
                try:
                    parsed_user_meds = json.loads(user.active_medications)
                    if isinstance(parsed_user_meds, list):
                        profile_meds = [str(x) for x in parsed_user_meds]
                    else:
                        profile_meds = [str(parsed_user_meds)]
                except Exception:
                    profile_meds = [p.strip() for p in str(user.active_medications).split(",") if p.strip()]

            # Cross-check drug interactions with profile medications and within scanned drugs
            interactions = check_interactions(scanned_drug_names, profile_meds)

            # Append newly verified medications into user's active_medications column
            existing_meds_lower = {m.lower().strip() for m in profile_meds}
            updated_meds = list(profile_meds)
            for d in scanned_drug_names:
                if d.lower().strip() not in existing_meds_lower:
                    updated_meds.append(d.strip())
                    existing_meds_lower.add(d.lower().strip())

            user.active_medications = json.dumps(updated_meds)
            db.commit()

            payload["is_owner"] = True
            payload["interactions"] = interactions
            payload["warnings"] = interactions

        else:
            # Scenario 2: Different patient name or no registered profile
            is_owner = False
            user_id = None

            payload["is_owner"] = False
            payload["interactions"] = []
            payload["warnings"] = []

        # Store prescription record in database
        try:
            filename_val = payload.get("filename") or "prescription_scan.png"
            db_record = Prescription(
                user_id=user_id,
                scanned_patient_name=scanned_patient_name,
                extracted_data=json.dumps(payload),
                date_scanned=datetime.utcnow(),
                filename=filename_val,
                extracted_text=payload.get("raw_text") or payload.get("extracted_raw_text") or json.dumps(payload)
            )
            db.add(db_record)
            db.commit()
            db.refresh(db_record)
            payload["prescription_id"] = db_record.id
            payload["id"] = db_record.id
        except Exception as db_err:
            print(f"Error persisting prescription record: {db_err}")
            db.rollback()

        payload["status"] = "success"
        return payload

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/prescriptions")
@router.get("")
@router.get("/")
def get_prescriptions(db: Session = Depends(get_db)):
    """
    Retrieves all analyzed prescriptions from SQLite ordered by date_scanned DESC.
    """
    try:
        records = db.query(Prescription).order_by(Prescription.date_scanned.desc()).all()
    except Exception:
        records = db.query(Prescription).order_by(Prescription.id.desc()).all()

    results = []
    for r in records:
        parsed_payload = {}
        raw_json = r.extracted_data or r.extracted_text
        if raw_json:
            try:
                parsed_payload = json.loads(raw_json)
            except Exception:
                parsed_payload = {"raw_text": raw_json}

        date_val = r.date_scanned or r.created_at or datetime.utcnow()
        patient_name = r.scanned_patient_name or (parsed_payload.get("patient_name") if isinstance(parsed_payload, dict) else "")
        doctor_name = parsed_payload.get("doctor_name", "") if isinstance(parsed_payload, dict) else ""
        medicines = parsed_payload.get("medicines", []) if isinstance(parsed_payload, dict) else []

        results.append({
            "id": r.id,
            "user_id": r.user_id,
            "scanned_patient_name": patient_name,
            "patient_name": patient_name,
            "doctor_name": doctor_name,
            "medicines": medicines,
            "is_owner": r.user_id is not None,
            "extracted_data": parsed_payload,
            "date_scanned": date_val.isoformat() if hasattr(date_val, 'isoformat') else str(date_val),
            "created_at": date_val.isoformat() if hasattr(date_val, 'isoformat') else str(date_val),
            "filename": r.filename
        })

    return results


@router.post("/parse")
@router.post("/ocr/parse")
async def parse_raw_ocr_text(payload: Dict[str, Any] = Body(...)):
    """
    Endpoint: Parse raw OCR text using Multi-Provider LLM Fallback Router (Gemini 3.8 -> Grok).
    Accepts raw text or line array from TrOCR/EasyOCR and returns standardized clinical JSON.
    """
    raw_input = (
        payload.get("raw_text")
        or payload.get("raw_text_array")
        or payload.get("text")
        or payload.get("lines")
        or payload.get("extracted_text")
        or ""
    )
    from app.services.medicine.gemini_parser import parse_ocr_text
    parsed_json = parse_ocr_text(raw_input)
    return parsed_json