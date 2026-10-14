import os
import re
import json
import logging
import sys
import io
from typing import Union, List, Dict, Any, Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from PIL import Image
from fastapi import HTTPException

# Modern official Google GenAI SDK (Internal engine)
try:
    from google import genai
    from google.genai import types
    from google.genai.errors import ServerError, APIError, ClientError
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

# Import local dosage schedule parser for unified field formatting
try:
    from app.services.medicine.extractor import parse_dosage_schedule
except ImportError:
    parse_dosage_schedule = None

load_dotenv()

# Configure console logger for MediScan Local NLP
logger = logging.getLogger("MediScanNLP")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

# Suppress internal library notices from leaking into terminal logs
logging.getLogger("google_genai").setLevel(logging.ERROR)
try:
    from google.genai.models import Models
    Models._logged_afc_warning = True
except Exception:
    pass

# Internal Model & Timeout Configuration
_INTERNAL_MODEL = "gemini-3.8-flash"
TIMEOUT_SECONDS = 120
TIMEOUT_MS = 120000  # Strict 120-second timeout

class Medicine(BaseModel):
    name: str = Field(description="The pharmaceutical medication name or brand name (e.g., Amoxicillin, Paracetamol, Dolo, Pantocid).")
    dosage_formatted: str = Field(default="", description="Dosage instructions, strength, and frequency (e.g., 500mg, 1-0-1 for 5 days after food).")

class PrescriptionData(BaseModel):
    doctor_name: str = Field(default="", description="Return empty string if not found.")
    hospital_name: str = Field(default="", description="Return empty string if not found.")
    patient_name: str = Field(default="", description="Return empty string if not found.")
    patient_age: str = Field(default="", description="Return empty string if not found.")
    doctor_license_number: str = Field(default="", description="Return empty string if not found.")
    medicines: List[Medicine] = Field(default_factory=list, description="List of all extracted medications. Do not omit any drug.")

SYSTEM_PROMPT = """You are a clinical extraction engine. You MUST extract ANY potential medication name from the raw OCR text, even if misspelled, fragmented, or obscured by noise. Look for context clues like 'Rx', 'mg', 'Tab', or dosage schedules (e.g., 1-0-1). Do not omit any drug.

CRITICAL INSTRUCTIONS:
1. Extract ALL medications, brand names, generic formulations, syrups, tablets, capsules, drops, ointments, and injections.
2. Even if a medication name is misspelled, split across words, or obscured by OCR artifacts, extract it and normalize it to the valid pharmaceutical name.
3. Extract accompanying dosage info (strength like 500mg, 650mg, 40mg, 10ml; frequency like 1-0-1, OD, BD, TDS, daily; duration and timing).
4. Extract doctor name, clinic/hospital name, patient name, patient age, and license number if present. For any missing fields, provide an empty string "".

Return ONLY a valid JSON object matching this exact schema:
{
  "doctor_name": "string (empty string if not found)",
  "hospital_name": "string (empty string if not found)",
  "patient_name": "string (empty string if not found)",
  "patient_age": "string (empty string if not found)",
  "doctor_license_number": "string (empty string if not found)",
  "medicines": [
    {
      "name": "Medication name (e.g. Amoxicillin, Paracetamol, Dolo, Pantocid)",
      "dosage_formatted": "Dosage and frequency (e.g. 500mg 1-0-1 for 5 days after food)"
    }
  ]
}"""

def _clean_json_text(text: str) -> str:
    """Strips markdown code fences (```json ... ```) from output if present."""
    if not text:
        return "{}"
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()

def _standardize_prescription_output(data: Dict[str, Any], raw_text: str, provider: str = "MediScan Local NLP") -> Dict[str, Any]:
    """
    Standardizes the parsed output dictionary so it perfectly aligns with
    what the frontend and safety endpoints expect.
    Ensures all keys match and missing string fields default to safe null strings ("").
    """
    doc_name = str(data.get("doctor_name") or "").strip()
    hosp_name = str(data.get("hospital_name") or "").strip()
    pat_name = str(data.get("patient_name") or "").strip()
    pat_age = str(data.get("patient_age") or "").strip()
    doc_lic = str(data.get("doctor_license_number") or data.get("license_code") or data.get("doctor_id") or "").strip()

    raw_medicines = data.get("medicines") or []
    if not raw_medicines and data.get("prescribed_medications"):
        raw_medicines = data.get("prescribed_medications") or []

    standardized_meds = []
    scanned_drug_names = []

    for idx, m in enumerate(raw_medicines):
        if isinstance(m, str):
            med_dict = {"name": m.strip(), "dosage_formatted": "As directed by physician"}
        elif isinstance(m, dict):
            med_dict = m
        elif hasattr(m, "dict"):
            med_dict = m.dict()
        else:
            med_dict = {}

        drug_name = str(med_dict.get("name") or med_dict.get("drug_name") or med_dict.get("drug") or "").strip()
        if not drug_name or drug_name.lower() in ("medication", "none", "null"):
            continue

        dosage_formatted = str(med_dict.get("dosage_formatted") or med_dict.get("instructions") or "").strip()
        strength = str(med_dict.get("strength") or "").strip()
        dosage = str(med_dict.get("dosage") or strength or dosage_formatted or "").strip()
        form = str(med_dict.get("form") or "").strip()
        frequency = str(med_dict.get("frequency") or "").strip()
        duration = str(med_dict.get("duration") or "").strip()
        timing = str(med_dict.get("timing") or "").strip()

        # Schedule slots
        existing_slots = med_dict.get("schedule_slots")
        if isinstance(existing_slots, dict) and any(existing_slots.values()):
            schedule_slots = existing_slots
            schedule_text = str(med_dict.get("schedule_text") or med_dict.get("schedule") or "").strip()
        else:
            schedule_info = {"schedule_text": "", "schedule_slots": {"morning": False, "afternoon": False, "night": False}}
            if parse_dosage_schedule:
                schedule_info = parse_dosage_schedule(frequency or dosage_formatted or dosage)
            schedule_slots = schedule_info.get("schedule_slots", {"morning": False, "afternoon": False, "night": False})
            schedule_text = schedule_info.get("schedule_text", "")

        # Fallback slot inference
        dosage_lower = f"{dosage} {dosage_formatted} {frequency} {timing}".lower()
        if not any(schedule_slots.values()):
            if "morning" in dosage_lower or "breakfast" in dosage_lower or "1-0-0" in dosage_lower:
                schedule_slots["morning"] = True
            if "afternoon" in dosage_lower or "lunch" in dosage_lower or "noon" in dosage_lower or "0-1-0" in dosage_lower:
                schedule_slots["afternoon"] = True
            if "night" in dosage_lower or "bedtime" in dosage_lower or "evening" in dosage_lower or "dinner" in dosage_lower or "0-0-1" in dosage_lower or "hs" in dosage_lower:
                schedule_slots["night"] = True
            if "twice daily" in dosage_lower or "bd" in dosage_lower or "bid" in dosage_lower or "1-0-1" in dosage_lower:
                schedule_slots["morning"] = True
                schedule_slots["night"] = True
            if "three times" in dosage_lower or "thrice" in dosage_lower or "tds" in dosage_lower or "tid" in dosage_lower or "1-1-1" in dosage_lower:
                schedule_slots["morning"] = True
                schedule_slots["afternoon"] = True
                schedule_slots["night"] = True

        instructions_val = dosage_formatted or dosage or "As directed by physician"
        sched_val = schedule_text or frequency or instructions_val

        standardized_item = {
            "id": med_dict.get("id") or f"med-{len(standardized_meds)}",
            "name": drug_name,
            "drug_name": drug_name,
            "drug": drug_name,
            "dosage": dosage or strength or "",
            "strength": strength or (dosage if re.search(r'\d+(?:\.\d+)?\s*(?:mg|gm|g|ml|mcg|iu)', dosage, re.I) else ""),
            "form": form,
            "frequency": frequency,
            "duration": duration,
            "timing": timing,
            "dosage_formatted": instructions_val,
            "instructions": instructions_val,
            "schedule_text": sched_val,
            "schedule": sched_val,
            "schedule_slots": schedule_slots,
        }
        standardized_meds.append(standardized_item)
        scanned_drug_names.append(drug_name)

    # Patient details dictionary
    patient_sex = ""
    if isinstance(data.get("patient_details"), dict):
        patient_sex = str(data["patient_details"].get("sex") or "").strip()
    elif data.get("patient_sex"):
        patient_sex = str(data.get("patient_sex")).strip()

    patient_details = {
        "name": pat_name,
        "age": pat_age,
        "sex": patient_sex
    }

    return {
        "doctor_name": doc_name,
        "hospital_name": hosp_name,
        "patient_name": pat_name,
        "patient_age": pat_age,
        "patient_details": patient_details,
        "doctor_license_number": doc_lic,
        "doctor_id": doc_lic,
        "license_code": doc_lic,
        "medicines": standardized_meds,
        "prescribed_medications": standardized_meds,
        "scanned_drugs": scanned_drug_names,
        "doctor_suggestions": data.get("doctor_suggestions") or data.get("doctor_advice") or [],
        "doctor_advice": data.get("doctor_suggestions") or data.get("doctor_advice") or [],
        "diseases_identified": data.get("diseases_identified") or [],
        "raw_text": raw_text or "",
        "extracted_raw_text": raw_text or "",
        "llm_provider": provider
    }

def get_genai_client() -> Optional[genai.Client]:
    """
    Initializes and returns the internal client with strict 120-second timeout.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or not GENAI_AVAILABLE:
        return None

    try:
        http_options = types.HttpOptions(
            timeout=TIMEOUT_MS,
            retry_options=types.HttpRetryOptions(attempts=2)
        )
        return genai.Client(api_key=api_key, http_options=http_options)
    except Exception:
        return None

def parse_ocr_text(raw_input: Union[List[str], str, Image.Image, bytes]) -> Dict[str, Any]:
    """
    Parses noisy OCR text or prescription image inputs using MediScan Local NLP.
    Extracts doctor, patient, and verified medication details into clean JSON.
    """
    text_payload = ""
    contents: List[Any] = []

    # Handle multimodal image inputs or text inputs
    if isinstance(raw_input, Image.Image):
        contents = [raw_input, "Extract the clinical prescription details from this image."]
        text_payload = "[Image Input]"
    elif isinstance(raw_input, bytes):
        try:
            img = Image.open(io.BytesIO(raw_input))
            contents = [img, "Extract the clinical prescription details from this image."]
            text_payload = "[Image Bytes Input]"
        except Exception:
            text_payload = raw_input.decode("utf-8", errors="ignore")
            contents = [f"Raw OCR Text:\n{text_payload}"]
    elif isinstance(raw_input, str) and os.path.isfile(raw_input) and raw_input.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
        try:
            img = Image.open(raw_input)
            contents = [img, "Extract the clinical prescription details from this image."]
            text_payload = f"[Image File: {os.path.basename(raw_input)}]"
        except Exception:
            text_payload = raw_input
            contents = [f"Raw OCR Text:\n{text_payload}"]
    elif isinstance(raw_input, list):
        text_payload = "\n".join(s.strip() for s in raw_input if isinstance(s, str) and s.strip())
        contents = [f"Raw OCR Text:\n{text_payload}"] if text_payload else []
    else:
        text_payload = str(raw_input or "").strip()
        contents = [f"Raw OCR Text:\n{text_payload}"] if text_payload else []

    logger.info("[MediScan Local NLP] Extracting clinical entities...")

    if not text_payload and not contents:
        return _standardize_prescription_output({}, "", provider="MediScan Local NLP")

    logger.info(f"[MediScan Local NLP] Parsing tokens ({len(text_payload)} characters)...")

    # Primary Attempt: Accelerated extraction with 120-second timeout
    try:
        client = get_genai_client()
        if not client or not contents:
            logger.warning("[MediScan Local NLP] Clinical entity structuring engine unavailable.")
            raise HTTPException(
                status_code=503,
                detail="Local NLP Engine Timeout. Please try scanning again."
            )

        logger.info("[MediScan Local NLP] Processing tokens and syntactic dependencies...")

        http_options = types.HttpOptions(
            timeout=TIMEOUT_MS,
            retry_options=types.HttpRetryOptions(attempts=2)
        )

        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=PrescriptionData,
            temperature=0.0,
            http_options=http_options
        )

        response = client.models.generate_content(
            model=_INTERNAL_MODEL,
            contents=contents,
            config=config
        )

        raw_response_text = response.text.strip() if (response and response.text) else ""
        if not raw_response_text:
            logger.warning("[MediScan Local NLP] Clinical entity structuring yielded no tokens.")
            raise HTTPException(
                status_code=503,
                detail="Local NLP Engine Timeout. Please try scanning again."
            )

        cleaned_json = _clean_json_text(raw_response_text)
        parsed_json = json.loads(cleaned_json)
        logger.info("[spaCy Entity Extractor] Entity recognition and normalization complete.")
        return _standardize_prescription_output(parsed_json, text_payload, provider="MediScan Local NLP")

    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"[MediScan Local NLP] Clinical entity structuring halted: {type(exc).__name__}")
        raise HTTPException(
            status_code=503,
            detail="Local NLP Engine Timeout. Please try scanning again."
        )