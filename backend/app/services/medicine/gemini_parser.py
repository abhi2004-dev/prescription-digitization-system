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

# Modern official Google GenAI SDK
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

# Configure console logger
logger = logging.getLogger("GeminiParser")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

# Gemini 3.8 Flash configuration
MODEL_NAME = "gemini-3.8-flash"
GEMINI_TIMEOUT_SECONDS = 60
GEMINI_TIMEOUT_MS = 60000  # 60-second HTTP timeout in milliseconds

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
    """Strips markdown code fences (```json ... ```) from LLM output if present."""
    if not text:
        return "{}"
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()

def _standardize_prescription_output(data: Dict[str, Any], raw_text: str, provider: str = MODEL_NAME) -> Dict[str, Any]:
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

def get_gemini_client() -> genai.Client:
    """
    Initializes and returns the Google GenAI Client with a 60-second standard timeout.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not configured.")

    if not GENAI_AVAILABLE:
        raise ImportError("google-genai client library is not available. Install with `pip install google-genai`.")

    http_options = types.HttpOptions(
        timeout=GEMINI_TIMEOUT_MS,
        retry_options=types.HttpRetryOptions(attempts=3)
    )
    return genai.Client(api_key=api_key, http_options=http_options)

def parse_ocr_text(raw_input: Union[List[str], str, Image.Image, bytes]) -> Dict[str, Any]:
    """
    Parses noisy OCR text or prescription image inputs strictly using Gemini 3.8 Flash (google-genai).
    Extracts doctor, patient, and verified medication details into a clean, standardized JSON format.
    Configured with a 60-second timeout to handle complex requests gracefully.
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

    print("\n--- CLINICAL INPUT RECEIVED BY GEMINI 3.8 PARSER ---")
    print(text_payload)
    print("----------------------------------------------------\n")

    if not text_payload and not contents:
        return _standardize_prescription_output({}, "", provider=MODEL_NAME)

    try:
        client = get_gemini_client()
        logger.info(f"Dispatching extraction request to Gemini 3.8 ({MODEL_NAME}, timeout={GEMINI_TIMEOUT_SECONDS}s)...")

        http_options = types.HttpOptions(
            timeout=GEMINI_TIMEOUT_MS,
            retry_options=types.HttpRetryOptions(attempts=3)
        )

        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=PrescriptionData,
            temperature=0.0,
            http_options=http_options
        )

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=contents,
            config=config
        )

        raw_response_text = response.text.strip() if (response and response.text) else ""
        if not raw_response_text:
            raise ValueError("Empty response received from Gemini 3.8 Flash.")

        cleaned_json = _clean_json_text(raw_response_text)
        parsed_json = json.loads(cleaned_json)
        logger.info("Successfully parsed prescription with Gemini 3.8 Flash.")
        return _standardize_prescription_output(parsed_json, text_payload, provider=MODEL_NAME)

    except (ServerError, APIError, ClientError) as api_err:
        logger.error(f"Gemini 3.8 Flash API error: {api_err}")
        fallback = _standardize_prescription_output({}, text_payload, provider=f"{MODEL_NAME} (api_error)")
        fallback["error"] = str(api_err)
        return fallback

    except Exception as exc:
        logger.error(f"Gemini 3.8 Flash extraction failed: {exc}", exc_info=True)
        fallback = _standardize_prescription_output({}, text_payload, provider=f"{MODEL_NAME} (failed)")
        fallback["error"] = str(exc)
        return fallback