import os
import uuid
import re
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from PIL import Image
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Body
from sqlalchemy.orm import Session
from thefuzz import fuzz

from app.services.ocr.ocr_engine import OCREngine
from app.services.medicine.extractor import parse_dosage_schedule

try:
    from app.services.safety_engine import check_interactions
except ImportError:
    def check_interactions(scanned, profile): return []

try:
    from app.services.ocr.signature_detector import detect_signature
except ImportError:
    def detect_signature(contents): return False

try:
    from app.services.verification_engine import verify_license
except ImportError:
    def verify_license(doc_id): return {"status": "Not Found"}

try:
    from app.services.database.db import get_db
    from app.services.database.models import User, Prescription
except ImportError:
    get_db = None
    User = None
    Prescription = None

router = APIRouter()
ocr_engine = OCREngine()

TEMP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../temp_uploads"))
os.makedirs(TEMP_DIR, exist_ok=True)


@router.post("/extract")
@router.post("/scan/extract")
@router.post("/scan")
@router.post("/api/v1/scan/extract")
def extract_prescription(file: UploadFile = File(...)):
    """
    Endpoint 1: Extract prescription data via Vision OCR + Local Clinical NLP + verification.
    """
    is_image = False
    if file.content_type and file.content_type.startswith("image/"):
        is_image = True
    elif file.filename and any(file.filename.lower().endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]):
        is_image = True

    if not is_image:
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    file_ext = os.path.splitext(file.filename)[1] or ".png"
    temp_filepath = os.path.join(TEMP_DIR, f"temp_{uuid.uuid4()}{file_ext}")

    try:
        contents = file.file.read()
        with open(temp_filepath, "wb") as f:
            f.write(contents)

        # Compress and downscale immediately
        try:
            with Image.open(temp_filepath) as img:
                img = img.convert("RGB")
                img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                img.save(temp_filepath, "JPEG", quality=70, optimize=True)
                file_size_kb = os.path.getsize(temp_filepath) / 1024
                print(f"[Image Compressor] Compressed file saved: {file_size_kb:.1f} KB", flush=True)
        except Exception as img_err:
            print(f"[Image Compressor] Warning: Could not compress image: {img_err}", flush=True)

        parsed_data = ocr_engine.extract_text(temp_filepath)

        doc_id = parsed_data.get("license_code") or parsed_data.get("doctor_id") or parsed_data.get("doctor_license_number") or ""
        
        license_verification = verify_license(doc_id)
        license_status = license_verification.get("status", "Not Found")
        
        cv_signature_detected = detect_signature(contents)
        text_sig_detected = bool(parsed_data.get("sign_present", False) or parsed_data.get("signature_verified", False))
        final_signature_present = bool(cv_signature_detected or text_sig_detected)

        parsed_data["verification"] = {
            "license_status": license_status,
            "signature_present": final_signature_present
        }
        parsed_data["sign_present"] = final_signature_present
        parsed_data["signature_verified"] = final_signature_present
        parsed_data["doctor_license_validated"] = (license_status == "Valid") or (len(re.sub(r'[^0-9]', '', str(doc_id))) >= 4)
        parsed_data["is_doctor_id_valid"] = parsed_data["doctor_license_validated"]
        
        if license_verification.get("doctor_name") and not parsed_data.get("doctor_name"):
            parsed_data["doctor_name"] = license_verification["doctor_name"]

        raw_meds = parsed_data.get("medicines") or parsed_data.get("medicines_extracted") or parsed_data.get("prescribed_medications") or []
        formatted_meds = []
        scanned_drug_names = []

        for m in raw_meds:
            if isinstance(m, str):
                m = {"drug_name": m}
            d_name = m.get("drug_name") or m.get("name") or m.get("drug") or "Medication"
            parts = [p for p in [m.get("strength"), m.get("form"), m.get("frequency"), m.get("duration"), m.get("timing")] if p]
            instructions = m.get("instructions") or (' • '.join(parts) if parts else 'As directed by physician')
            
            m["drug_name"] = d_name
            m["instructions"] = instructions

            # Force re-check if schedule_slots has no True values
            slots = m.get("schedule_slots")
            has_active_slots = isinstance(slots, dict) and any(slots.values())
            
            if not has_active_slots:
                search_text = f"{m.get('frequency', '')} {m.get('instructions', '')} {m.get('timing', '')} {m.get('dosage_formatted', '')}"
                sched_info = parse_dosage_schedule(search_text)
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
            try:
                os.remove(temp_filepath)
            except Exception:
                pass


@router.post("/finalize")
@router.post("/scan/finalize")
@router.post("/api/v1/scan/finalize")
@router.post("/v1/scan/finalize")
def finalize_prescription(payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db) if get_db else None):
    """
    Endpoint 2: Finalize verified prescription data.
    Runs Patient Fuzzy Matching, Drug Interaction Checks, and saves to SQLite.
    """
    try:
        meds = payload.get("medicines") or payload.get("prescribed_medications") or []
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

            # Force re-check if schedule_slots has no True values
            slots = m.get("schedule_slots")
            has_active_slots = isinstance(slots, dict) and any(slots.values())
            
            if not has_active_slots:
                search_text = f"{m.get('frequency', '')} {m.get('instructions', '')} {m.get('timing', '')} {m.get('dosage_formatted', '')}"
                sched_info = parse_dosage_schedule(search_text)
                clean_sched = sched_info.get("schedule_text", "")
                has_active = any(sched_info.get("schedule_slots", {}).values())
                if clean_sched and has_active and clean_sched != search_text:
                    m["schedule_text"] = clean_sched
                    m["schedule_slots"] = sched_info.get("schedule_slots", {"morning": False, "afternoon": False, "night": False})
                    m["schedule"] = m["schedule_text"]

            formatted_meds.append(m)
            if d_name and d_name.lower() != "medication":
                scanned_drug_names.append(d_name)

        payload["medicines"] = formatted_meds
        payload["prescribed_medications"] = formatted_meds
        payload["scanned_drugs"] = scanned_drug_names

        scanned_patient_name = (
            payload.get("patient_name")
            or payload.get("scanned_patient_name")
            or (payload.get("patient_details", {}).get("name") if isinstance(payload.get("patient_details"), dict) else "")
            or ""
        )

        user = db.query(User).first() if db and User else None
        match_score = 0
        if user and user.name and scanned_patient_name:
            match_score = fuzz.token_sort_ratio(scanned_patient_name.lower().strip(), user.name.lower().strip())

        payload["match_score"] = match_score

        if match_score >= 80 and user:
            is_owner = True
            user_id = user.id

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

            interactions = check_interactions(scanned_drug_names, profile_meds)

            existing_meds_lower = {m.lower().strip() for m in profile_meds}
            updated_meds = list(profile_meds)
            for d in scanned_drug_names:
                if d.lower().strip() not in existing_meds_lower:
                    updated_meds.append(d.strip())
                    existing_meds_lower.add(d.lower().strip())

            user.active_medications = json.dumps(updated_meds)
            if db:
                db.commit()

            payload["is_owner"] = True
            payload["interactions"] = interactions
            payload["warnings"] = interactions
        else:
            payload["is_owner"] = False
            payload["interactions"] = []
            payload["warnings"] = []

        if db and Prescription:
            try:
                filename_val = payload.get("filename") or "prescription_scan.png"
                db_record = Prescription(
                    user_id=user_id if 'user_id' in locals() else None,
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
                print(f"Error persisting record: {db_err}")
                db.rollback()

        payload["status"] = "success"
        return payload

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/prescriptions")
@router.get("/api/v1/prescriptions")
@router.get("/v1/prescriptions")
def get_prescriptions(db: Session = Depends(get_db) if get_db else None):
    """
    Retrieves all analyzed prescriptions from SQLite.
    """
    if not db or not Prescription:
        return []

    try:
        records = db.query(Prescription).order_by(Prescription.date_scanned.desc()).all()
    except Exception:
        try:
            records = db.query(Prescription).order_by(Prescription.id.desc()).all()
        except Exception:
            return []

    results = []
    for r in records:
        parsed_payload = {}
        raw_json = r.extracted_data or r.extracted_text
        if raw_json:
            try:
                parsed_payload = json.loads(raw_json)
            except Exception:
                parsed_payload = {"raw_text": raw_json}

        date_val = getattr(r, 'date_scanned', None) or getattr(r, 'created_at', None) or datetime.utcnow()
        patient_name = getattr(r, 'scanned_patient_name', None) or (parsed_payload.get("patient_name") if isinstance(parsed_payload, dict) else "")
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
            "filename": getattr(r, 'filename', 'prescription.png')
        })

    return results


@router.get("/user/profile")
@router.get("/api/v1/user/profile")
@router.get("/v1/user/profile")
def get_user_profile(db: Session = Depends(get_db) if get_db else None):
    """
    Returns user profile data formatted defensively for React Native frontend components.
    Provides medications as both structured objects and flat string lists.
    """
    # 0. Query the user and prescription count from the database FIRST
    user = None
    if db and User:
        try:
            user = db.query(User).first()
        except Exception as e:
            print(f"[get_user_profile] Database query warning: {e}")
            user = None

    prescription_count = 0
    if db and Prescription:
        try:
            prescription_count = db.query(Prescription).count()
        except Exception:
            prescription_count = 0

    # If no user profile exists in database, return safe default dictionary instead of crashing
    if not user:
        default_name = "Registered Patient"
        default_email = "patient@example.com"
        return {
            "id": 1,
            "name": default_name,
            "email": default_email,
            "phone": "",
            "user_name": default_name,
            "user_email": default_email,
            "current_conditions": [],
            "conditions": [],
            "active_medications": [],
            "active_meds": [],
            "medications": [],
            "prescriptions_count": prescription_count,
            "total_prescriptions": prescription_count,
            "stats": {
                "prescriptions_count": prescription_count,
                "active_medications_count": 0
            },
            "user": {
                "id": 1,
                "name": default_name,
                "email": default_email,
                "phone": "",
                "current_conditions": [],
                "active_medications": [],
                "medications": [],
            },
            "profile": {
                "id": 1,
                "name": default_name,
                "email": default_email,
                "phone": "",
                "current_conditions": [],
                "active_medications": [],
            },
            "status": "success"
        }

    # 1. Parse active_medications into raw items
    raw_items = []
    if getattr(user, 'active_medications', None):
        raw_val = user.active_medications
        if isinstance(raw_val, str):
            try:
                parsed = json.loads(raw_val)
                if isinstance(parsed, list):
                    raw_items = parsed
                elif isinstance(parsed, str):
                    raw_items = [x.strip() for x in raw_val.split(",") if x.strip()]
                elif isinstance(parsed, dict):
                    raw_items = [parsed]
            except Exception:
                raw_items = [x.strip() for x in raw_val.split(",") if x.strip()]
        elif isinstance(raw_val, list):
            raw_items = raw_val

    # 2. Build structured list of dictionaries for active_medications
    formatted_med_objects = []
    raw_med_names = []
    for idx, item in enumerate(raw_items):
        if isinstance(item, dict):
            name = (item.get("drug_name") or item.get("name") or item.get("drug") or "").strip()
            if not name:
                continue
            formatted_med_objects.append({
                "id": item.get("id") or f"profile-med-{idx}",
                "drug_name": name,
                "name": name,
                "drug": name,
                "instructions": item.get("instructions") or "Active Prescription",
                "schedule_text": item.get("schedule_text") or "As prescribed",
                "schedule_slots": item.get("schedule_slots") or {"morning": True, "afternoon": False, "night": True}
            })
            raw_med_names.append(name)
        elif isinstance(item, str):
            name = item.strip()
            if not name:
                continue
            formatted_med_objects.append({
                "id": f"profile-med-{idx}",
                "drug_name": name,
                "name": name,
                "drug": name,
                "instructions": "Active Prescription",
                "schedule_text": "As prescribed",
                "schedule_slots": {"morning": True, "afternoon": False, "night": True}
            })
            raw_med_names.append(name)
        else:
            name = str(item).strip()
            if not name:
                continue
            formatted_med_objects.append({
                "id": f"profile-med-{idx}",
                "drug_name": name,
                "name": name,
                "drug": name,
                "instructions": "Active Prescription",
                "schedule_text": "As prescribed",
                "schedule_slots": {"morning": True, "afternoon": False, "night": True}
            })
            raw_med_names.append(name)

    # 3. Parse current_conditions safely
    conditions_list = []
    if getattr(user, 'current_conditions', None):
        raw_conds = user.current_conditions
        if isinstance(raw_conds, str):
            try:
                parsed_c = json.loads(raw_conds)
                if isinstance(parsed_c, list):
                    conditions_list = [str(x) for x in parsed_c]
                elif isinstance(parsed_c, str):
                    conditions_list = [x.strip() for x in raw_conds.split(",") if x.strip()]
            except Exception:
                conditions_list = [x.strip() for x in raw_conds.split(",") if x.strip()]
        elif isinstance(raw_conds, list):
            conditions_list = [str(x) for x in raw_conds]

    user_id = user.id if getattr(user, 'id', None) else 1
    user_name = user.name if getattr(user, 'name', None) else "Registered Patient"
    user_email = user.email if getattr(user, 'email', None) else "patient@example.com"
    user_phone = getattr(user, 'phone', "") or ""

    # 4. Multi-schema payload covering all React Native state access patterns
    payload = {
        "id": user_id,
        "name": user_name,
        "email": user_email,
        "phone": user_phone,
        "user_name": user_name,
        "user_email": user_email,
        "current_conditions": conditions_list,
        "conditions": conditions_list,
        "active_medications": formatted_med_objects,
        "active_meds": raw_med_names,
        "medications": formatted_med_objects,
        "prescriptions_count": prescription_count,
        "total_prescriptions": prescription_count,
        "stats": {
            "prescriptions_count": prescription_count,
            "active_medications_count": len(formatted_med_objects)
        },
        "user": {
            "id": user_id,
            "name": user_name,
            "email": user_email,
            "phone": user_phone,
            "current_conditions": conditions_list,
            "active_medications": formatted_med_objects,
            "medications": formatted_med_objects,
        },
        "profile": {
            "id": user_id,
            "name": user_name,
            "email": user_email,
            "phone": user_phone,
            "current_conditions": conditions_list,
            "active_medications": formatted_med_objects,
        },
        "status": "success"
    }

    return payload


@router.post("/ocr/parse")
async def parse_raw_ocr_text(payload: Dict[str, Any] = Body(...)):
    """
    Endpoint: Parse raw OCR text using MediScan Local NLP extraction pipeline.
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
