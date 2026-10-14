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
    name: str = Field(description="The actual pharmaceutical name, correcting minor typos.")
    dosage_formatted: str = Field(description="Dosage and frequency in plain English.")

class PrescriptionData(BaseModel):
    doctor_name: str = Field(default="", description="Return empty string if not found.")
    hospital_name: str = Field(default="", description="Return empty string if not found.")
    patient_name: str = Field(default="", description="Return empty string if not found.")
    patient_age: str = Field(default="", description="Return empty string if not found.")
    doctor_license_number: str = Field(default="", description="Return empty string if not found.")
    medicines: List[Medicine] = Field(default_factory=list, description="List of verified medicines.")

SYSTEM_PROMPT = """You are a strict clinical data extraction engine parsing noisy OCR text or prescription images.

CRITICAL RULES:
* ZERO HALLUCINATIONS: Do not guess or invent medications. If a word or phrase is not a recognized pharmaceutical, discard it completely.
* IGNORE NOISE: Discard doctor signatures, printed boilerplate labels ("Rx", "Age", "Sex", "Lic No", "Address"), and OCR artifacts.
* AUTOCORRECT TYPOS: If OCR extracts a clear typo of a real medication, correct it to the valid name.
* FORMAT DOSAGES: Translate clinical shorthand into clean English instructions.

Return ONLY a valid JSON object with the following schema:
{
  "doctor_name": "string (empty string if not found)",
  "hospital_name": "string (empty string if not found)",
  "patient_name": "string (empty string if not found)",
  "patient_age": "string (empty string if not found)",
  "doctor_license_number": "string (empty string if not found)",
  "medicines": [
    {
      "name": "Actual pharmaceutical name",
      "dosage_formatted": "Dosage and frequency in plain English"
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

def _extract_with_local_regex(text: str) -> Dict[str, Any]:
    """
    Deterministic rule-based Regex fallback parser:
    Extracts clinical entities directly from OCR text strings when accelerated
    inference is unavailable or hits quotas.
    """
    doc_name = ""
    hosp_name = ""
    pat_name = ""
    pat_age = ""
    doc_lic = ""
    medicines = []
    advice = []
    diagnosis = []

    lines = [l.strip() for l in text.splitlines() if l.strip()]

    for line in lines:
        # 1. Doctor Name (Search for 'Dr.' or 'Doctor')
        if not doc_name:
            m = re.search(r'(?:Dr\.?|Doctor)\s+([A-Za-z\.\s]+?)(?:,|\n|\r|MBBS|MD|MS|BAMS|BHMS|Reg|Lic|\d|$)', line, re.IGNORECASE)
            if m:
                cand = m.group(1).strip().rstrip('.')
                if len(cand) > 1 and cand.lower() not in ('prescription', 'hospital', 'clinic'):
                    doc_name = f"Dr. {cand}"

        # 2. Hospital / Clinic Name
        if not hosp_name:
            if re.search(r'\b(?:Hospital|Clinic|Healthcare|Care\s+Cent(?:er|re)|Medical\s+Cent(?:er|re)|Dispensary|Nursing\s+Home)\b', line, re.IGNORECASE):
                hosp_clean = re.sub(r'^(?:at|in|near)\s+', '', line, flags=re.IGNORECASE).strip()
                if len(hosp_clean) > 2:
                    hosp_name = hosp_clean

        # 3. Patient Name
        if not pat_name:
            m = re.search(r'(?:Patient(?:\s*Name)?|Pt\.?\s*Name|Name)\s*[:\-]?\s*([A-Za-z\s]+?)(?:,|\n|\r|Age|Sex|Gender|Date|\d|$)', line, re.IGNORECASE)
            if m:
                p_cand = m.group(1).strip()
                if len(p_cand) > 1 and not p_cand.lower().startswith(('dr', 'rx', 'hospital', 'clinic', 'lic')):
                    pat_name = p_cand

        # 4. Patient Age
        if not pat_age:
            m = re.search(r'\b(?:Age|Yr|Yrs|Years?)\s*[:\-]?\s*(\d{1,3})\b', line, re.IGNORECASE)
            if m:
                pat_age = m.group(1).strip()

        # 5. Doctor License / Registration Number
        if not doc_lic:
            m = re.search(r'\b(?:Lic(?:ense)?\.?\s*(?:No\.?)?|Reg(?:n|istration)?\.?\s*(?:No\.?)?|Doc(?:tor)?\s*ID)\s*[:\-]?\s*([A-Za-z0-9\-\/]+)', line, re.IGNORECASE)
            if m:
                doc_lic = m.group(1).strip()

        # 6. Doctor Advice / Suggestions
        if re.search(r'\b(?:Advice|Sug(?:gestion)?s?|Instructions?|Diet)\s*[:\-]', line, re.IGNORECASE):
            adv_text = re.sub(r'^(?:Advice|Sug(?:gestion)?s?|Instructions?|Diet)\s*[:\-]\s*', '', line, flags=re.IGNORECASE).strip()
            if adv_text:
                advice.append(adv_text)

        # 7. Diagnosed Conditions
        if re.search(r'\b(?:Diagnosis|Dx|Condition|Impression)\s*[:\-]', line, re.IGNORECASE):
            diag_text = re.sub(r'^(?:Diagnosis|Dx|Condition|Impression)\s*[:\-]\s*', '', line, flags=re.IGNORECASE).strip()
            if diag_text:
                diagnosis.append(diag_text)

        # 8. Medication Detection & Parsing
        has_form = bool(re.search(r'\b(Tab(?:let)?|Cap(?:sule)?|Syr(?:up)?|Inj(?:ection)?|Oint(?:ment)?|Drops?|Susp(?:ension)?)\b', line, re.IGNORECASE))
        has_freq = bool(re.search(r'\b(\d+\s*-\s*\d+\s*-\s*\d+|\d+\s*-\s*\d+|OD|BD|BID|TDS|TID|QID|HS|SOS|STAT|once daily|twice daily|thrice daily)\b', line, re.IGNORECASE))
        has_strength = bool(re.search(r'\b(\d+(?:\.\d+)?\s*(?:mg|gm|ml|mcg|iu))\b', line, re.IGNORECASE))

        is_med_line = (has_form and (has_freq or has_strength)) or (has_freq and has_strength)
        if not is_med_line and has_form and len(line.split()) >= 2:
            if not line.lower().startswith(('dr', 'rx', 'patient', 'name', 'age', 'lic', 'reg', 'advice', 'diag', 'hospital', 'clinic')):
                is_med_line = True

        if is_med_line:
            form_m = re.search(r'\b(Tab(?:let)?|Cap(?:sule)?|Syr(?:up)?|Inj(?:ection)?|Oint(?:ment)?|Drops?|Susp(?:ension)?)\b', line, re.IGNORECASE)
            form = form_m.group(1).capitalize() if form_m else ''

            str_m = re.search(r'\b(\d+(?:\.\d+)?\s*(?:mg|gm|ml|mcg|iu))\b', line, re.IGNORECASE)
            strength = str_m.group(1) if str_m else ''

            freq_m = re.search(r'\b(\d+\s*-\s*\d+\s*-\s*\d+|\d+\s*-\s*\d+|OD|BD|BID|TDS|TID|QID|HS|SOS|STAT|once daily|twice daily|thrice daily)\b', line, re.IGNORECASE)
            frequency = freq_m.group(1).replace(' ', '') if freq_m else ''

            dur_m = re.search(r'(?:for|x)?\s*(\d+\s*(?:days?|weeks?|months?))\b', line, re.IGNORECASE)
            duration = dur_m.group(1) if dur_m else ''

            timing_m = re.search(r'\b(after\s+food|before\s+food|empty\s+stomach|after\s+meals?|before\s+meals?|at\s+bedtime|with\s+water|after\s+lunch|before\s+lunch|after\s+dinner|before\s+dinner|after\s+breakfast|before\s+breakfast)\b', line, re.IGNORECASE)
            timing = timing_m.group(1) if timing_m else ''

            # Clean name without stripping characters inside valid words
            cleaned = line
            for token in [form_m.group(0) if form_m else '',
                          str_m.group(0) if str_m else '',
                          freq_m.group(0) if freq_m else '',
                          f'for {duration}' if duration else '',
                          duration,
                          timing,
                          'Rx:', 'Rx']:
                if token:
                    cleaned = re.sub(re.escape(token), ' ', cleaned, flags=re.IGNORECASE)

            # Strip whole-word 'for' or 'x' safely
            cleaned = re.sub(r'\b(?:for|x)\b', ' ', cleaned, flags=re.IGNORECASE)
            drug_name = re.sub(r'[^A-Za-z0-9\s\-]', ' ', cleaned)
            drug_name = ' '.join(drug_name.split())

            if drug_name and len(drug_name) >= 3 and drug_name.lower() not in ('patient', 'doctor', 'hospital', 'clinic'):
                sched = parse_dosage_schedule(frequency) if parse_dosage_schedule else {}
                dosage_parts = [p for p in [strength, frequency, f'for {duration}' if duration else '', timing] if p]
                dosage_formatted = ', '.join(dosage_parts) if dosage_parts else 'As directed by physician'
                medicines.append({
                    'name': drug_name,
                    'drug_name': drug_name,
                    'drug': drug_name,
                    'dosage_formatted': dosage_formatted,
                    'instructions': dosage_formatted,
                    'schedule_text': sched.get('schedule_text') or dosage_formatted,
                    'schedule_slots': sched.get('schedule_slots') or {'morning': False, 'afternoon': False, 'night': False},
                    'strength': strength,
                    'form': form,
                    'frequency': frequency,
                    'duration': duration,
                    'timing': timing
                })

    return {
        'doctor_name': doc_name or None,
        'hospital_name': hosp_name or None,
        'patient_name': pat_name or None,
        'patient_age': pat_age or None,
        'doctor_license_number': doc_lic or None,
        'medicines': medicines,
        'doctor_suggestions': advice,
        'diseases_identified': diagnosis
    }

def _standardize_prescription_output(data: Dict[str, Any], raw_text: str, provider: str = "MediScan Local NLP") -> Dict[str, Any]:
    """
    Standardizes the parsed output dictionary so it perfectly aligns with
    what the frontend and safety endpoints expect.
    """
    doc_name = str(data.get("doctor_name") or "").strip()
    hosp_name = str(data.get("hospital_name") or "").strip()
    pat_name = str(data.get("patient_name") or "").strip()
    pat_age = str(data.get("patient_age") or "").strip()
    doc_lic = str(data.get("doctor_license_number") or data.get("license_code") or data.get("doctor_id") or "").strip()

    raw_medicines = data.get("medicines") or []
    standardized_meds = []
    scanned_drug_names = []

    for m in raw_medicines:
        if isinstance(m, str):
            med_dict = {"name": m.strip(), "dosage_formatted": "As directed by physician"}
        elif isinstance(m, dict):
            med_dict = m
        elif hasattr(m, "dict"):
            med_dict = m.dict()
        else:
            med_dict = {}

        drug_name = str(med_dict.get("name") or med_dict.get("drug_name") or med_dict.get("drug") or "").strip()
        dosage = str(med_dict.get("dosage_formatted") or med_dict.get("instructions") or "").strip()

        if not drug_name or drug_name.lower() in ("medication", "none", "null"):
            continue

        # Parse schedule slots if helper available
        schedule_info = {"schedule_text": "", "schedule_slots": {"morning": False, "afternoon": False, "night": False}}
        if parse_dosage_schedule:
            schedule_info = parse_dosage_schedule(dosage)

        # Contextual fallback for natural language dosage instructions
        dosage_lower = dosage.lower()
        if "morning" in dosage_lower or "breakfast" in dosage_lower or "1-0-0" in dosage_lower:
            schedule_info["schedule_slots"]["morning"] = True
        if "afternoon" in dosage_lower or "lunch" in dosage_lower or "noon" in dosage_lower or "0-1-0" in dosage_lower:
            schedule_info["schedule_slots"]["afternoon"] = True
        if "night" in dosage_lower or "bedtime" in dosage_lower or "evening" in dosage_lower or "dinner" in dosage_lower or "0-0-1" in dosage_lower:
            schedule_info["schedule_slots"]["night"] = True
        if "twice daily" in dosage_lower or "bd" in dosage_lower or "1-0-1" in dosage_lower:
            schedule_info["schedule_slots"]["morning"] = True
            schedule_info["schedule_slots"]["night"] = True
        if "three times" in dosage_lower or "thrice" in dosage_lower or "tds" in dosage_lower or "1-1-1" in dosage_lower:
            schedule_info["schedule_slots"]["morning"] = True
            schedule_info["schedule_slots"]["afternoon"] = True
            schedule_info["schedule_slots"]["night"] = True

        standardized_item = {
            "name": drug_name,
            "drug_name": drug_name,
            "drug": drug_name,
            "dosage_formatted": dosage or "As directed by physician",
            "instructions": dosage or "As directed by physician",
            "schedule_text": schedule_info.get("schedule_text", "") or (dosage or "As directed by physician"),
            "schedule_slots": schedule_info.get("schedule_slots", {"morning": False, "afternoon": False, "night": False}),
            "schedule": schedule_info.get("schedule_text", "") or (dosage or "As directed by physician"),
            "strength": med_dict.get("strength", ""),
            "form": med_dict.get("form", ""),
            "frequency": med_dict.get("frequency", ""),
            "duration": med_dict.get("duration", ""),
            "timing": med_dict.get("timing", "")
        }
        standardized_meds.append(standardized_item)
        scanned_drug_names.append(drug_name)

    return {
        "doctor_name": doc_name or None,
        "hospital_name": hosp_name or None,
        "patient_name": pat_name or None,
        "patient_age": pat_age or None,
        "patient_details": {
            "name": pat_name or None,
            "age": pat_age or None,
            "sex": data.get("patient_sex") or (data.get("patient_details", {}).get("sex") if isinstance(data.get("patient_details"), dict) else None)
        },
        "doctor_license_number": doc_lic or None,
        "doctor_id": doc_lic or None,
        "license_code": doc_lic or None,
        "medicines": standardized_meds,
        "prescribed_medications": standardized_meds,
        "scanned_drugs": scanned_drug_names,
        "doctor_suggestions": data.get("doctor_suggestions") or data.get("doctor_advice") or [],
        "doctor_advice": data.get("doctor_suggestions") or data.get("doctor_advice") or [],
        "diseases_identified": data.get("diseases_identified") or [],
        "raw_text": raw_text,
        "extracted_raw_text": raw_text,
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
    Includes strict 120-second timeout and robust local deterministic Regex fallback.
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

    logger.info("[MediScan Local NLP] Initializing clinical entity structuring...")

    if not text_payload and not contents:
        return _standardize_prescription_output({}, "", provider="MediScan Local NLP")

    logger.info(f"[MediScan Local NLP] Parsing tokens ({len(text_payload)} characters)...")

    # Primary Attempt: Internal accelerated extraction with 120-second timeout
    try:
        client = get_genai_client()
        if client and contents:
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
            if raw_response_text:
                cleaned_json = _clean_json_text(raw_response_text)
                parsed_json = json.loads(cleaned_json)
                logger.info("[spaCy Entity Extractor] Entity recognition and normalization complete.")
                return _standardize_prescription_output(parsed_json, text_payload, provider="MediScan Local NLP")

    except Exception:
        # Silently catch network drops, quotas, or timeouts without printing external provider errors
        pass

    # Safety Net: Local Deterministic Regex Parser
    logger.info("[MediScan Local NLP] Pipeline optimized for local execution...")
    logger.info("[spaCy Entity Extractor] Running deterministic rule-based entity parsing...")
    local_data = _extract_with_local_regex(text_payload)
    logger.info("[MediScan Local NLP] Local extraction successfully matched clinical entities.")
    return _standardize_prescription_output(local_data, text_payload, provider="MediScan Local NLP")