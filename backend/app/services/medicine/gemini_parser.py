import os
import re
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Union, List, Dict, Any, Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from openai import OpenAI

# Modern official Google GenAI SDK
try:
    from google import genai
    from google.genai import types
    from google.genai.errors import ServerError, APIError, ClientError
    GENAI_NEW_SDK = True
except ImportError:
    GENAI_NEW_SDK = False

# Import local dosage schedule parser for unified field formatting
try:
    from app.services.medicine.extractor import parse_dosage_schedule
except ImportError:
    parse_dosage_schedule = None

load_dotenv()

# Configure console logger
logger = logging.getLogger("LLMFallbackRouter")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

# Primary model: Gemini 3.8 (strictly no Gemini 3.7)
PRIMARY_GEMINI_MODEL = "gemini-3.8-flash"
GEMINI_STRICT_TIMEOUT_SEC = 8.0  # Strict 8-second HTTP timeout
GEMINI_HTTP_DEADLINE_MS = 10000  # API allowed deadline minimum (10s)

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

# Standardized system prompt identical for both Gemini 3.8 and Grok
SYSTEM_PROMPT = """You are a strict clinical data extraction engine parsing noisy OCR text from a handwritten prescription.

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
        # Remove opening ```json or ```
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        # Remove trailing ```
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()

def _standardize_prescription_output(data: Dict[str, Any], raw_text: str, provider: str) -> Dict[str, Any]:
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

def _parse_with_gemini_38(text_payload: str) -> Dict[str, Any]:
    """
    Primary Provider: Gemini 3.8 with strict 8-second HTTP timeout.
    Returns parsed JSON dictionary if successful.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not configured.")

    if not GENAI_NEW_SDK:
        raise ImportError("google-genai client library is not available.")

    logger.info(f"[LLM Router] Dispatching request to Primary Provider: Gemini 3.8 ({PRIMARY_GEMINI_MODEL}, timeout={GEMINI_STRICT_TIMEOUT_SEC}s)...")

    # Configure client with 1 attempt (prevent slow retry loops on 503) and 10s API deadline
    http_options = types.HttpOptions(
        timeout=GEMINI_HTTP_DEADLINE_MS,
        retry_options=types.HttpRetryOptions(attempts=1)
    )
    client = genai.Client(api_key=api_key, http_options=http_options)

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=PrescriptionData,
        temperature=0.0,
        http_options=http_options
    )

    # Strictly enforce 8.0-second HTTP execution timeout via ThreadPoolExecutor
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        future = executor.submit(
            client.models.generate_content,
            model=PRIMARY_GEMINI_MODEL,
            contents=[f"Raw OCR Text:\n{text_payload}"],
            config=config
        )
        response = future.result(timeout=GEMINI_STRICT_TIMEOUT_SEC)
    except FuturesTimeoutError:
        raise TimeoutError(f"Gemini 3.8 exceeded strict HTTP timeout of {GEMINI_STRICT_TIMEOUT_SEC}s.")
    finally:
        executor.shutdown(wait=False)

    raw_response_text = response.text.strip() if (response and response.text) else ""
    if not raw_response_text:
        raise ValueError("Empty response received from Gemini 3.8.")

    parsed_json = json.loads(raw_response_text)
    logger.info("[LLM Router] Successfully parsed prescription using Primary Provider (Gemini 3.8).")
    return _standardize_prescription_output(parsed_json, text_payload, provider="gemini-3.8")

def _parse_with_grok(text_payload: str) -> Dict[str, Any]:
    """
    Secondary Provider: Grok API fallback using key loaded from .env.
    Uses identical system prompt and schema for standardized output.
    """
    xai_api_key = os.getenv("XAI_API_KEY") or os.getenv("GROK_API_KEY")
    if not xai_api_key:
        raise ValueError("XAI_API_KEY / GROK_API_KEY environment variable is not configured for Grok fallback.")

    logger.info("[LLM Router] Executing Secondary Fallback: Grok API...")

    # Determine endpoint & models based on API key type:
    # Groq API keys start with 'gsk_', while xAI native keys start with 'xai-'
    is_groq_key = xai_api_key.startswith("gsk_")

    endpoints_to_try = []
    if is_groq_key:
        endpoints_to_try.append({
            "base_url": "https://api.groq.com/openai/v1",
            "models": ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]
        })
    else:
        endpoints_to_try.append({
            "base_url": "https://api.x.ai/v1",
            "models": ["grok-2-latest", "grok-beta", "grok-2"]
        })
        endpoints_to_try.append({
            "base_url": "https://api.groq.com/openai/v1",
            "models": ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]
        })

    last_error = None
    for ep in endpoints_to_try:
        base_url = ep["base_url"]
        models = ep["models"]
        try:
            client = OpenAI(
                api_key=xai_api_key,
                base_url=base_url,
                timeout=10.0
            )
            for model_name in models:
                try:
                    logger.info(f"[LLM Router] Calling Grok client at {base_url} with model {model_name}...")
                    response = client.chat.completions.create(
                        model=model_name,
                        messages=[
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": f"Raw OCR Text:\n{text_payload}"}
                        ],
                        temperature=0.0,
                        response_format={"type": "json_object"}
                    )
                    raw_content = response.choices[0].message.content if response.choices else ""
                    cleaned_content = _clean_json_text(raw_content)
                    if cleaned_content:
                        parsed_json = json.loads(cleaned_content)
                        logger.info(f"[LLM Router] Successfully parsed prescription using Grok ({model_name}).")
                        return _standardize_prescription_output(parsed_json, text_payload, provider=f"grok ({model_name})")
                except Exception as m_err:
                    last_error = m_err
                    logger.warning(f"[LLM Router] Model {model_name} at {base_url} failed: {m_err}")
                    continue
        except Exception as ep_err:
            last_error = ep_err
            continue

    raise RuntimeError(f"Secondary Grok fallback failed across all models: {last_error}")

def parse_ocr_text(raw_text_input: Union[List[str], str]) -> Dict[str, Any]:
    """
    Multi-Provider LLM Fallback Router:
    1. Primary: Gemini 3.8 with strict 8-second HTTP timeout.
    2. Secondary Fallback: Grok API triggered instantly on timeout, 503, or connection error.
    3. Output Standardization: Identical prompt and output schema for seamless frontend & safety engine integration.
    """
    if isinstance(raw_text_input, list):
        text_payload = "\n".join(s.strip() for s in raw_text_input if s.strip())
    else:
        text_payload = str(raw_text_input).strip()

    print("\n--- RAW OCR TEXT RECEIVED BY LLM ROUTER ---")
    print(text_payload)
    print("-------------------------------------------\n")

    if not text_payload:
        return _standardize_prescription_output({}, "", provider="none")

    # 1. Primary Attempt: Gemini 3.8 with strict 8s timeout
    try:
        return _parse_with_gemini_38(text_payload)
    except (FuturesTimeoutError, TimeoutError, ServerError, APIError, ClientError, Exception) as exc:
        # Catch 503 Service Unavailable, HTTP timeouts, connection errors, or other failures
        logger.warning(
            f"[LLM Router] Gemini 3.8 Primary failed with error ({type(exc).__name__}: {exc}). "
            f"Instantly failing over to Secondary Provider (Grok)..."
        )
        print(f"\n[ALERT] Gemini 3.8 Primary Encountered: {exc}")
        print(">>> Instantly triggering Secondary Fallback: Grok API <<<\n")

    # 2. Secondary Attempt: Grok API fallback
    try:
        return _parse_with_grok(text_payload)
    except Exception as grok_exc:
        logger.error(f"[LLM Router] Both Gemini 3.8 and Grok failed. Error: {grok_exc}")
        print(f"CRITICAL: Multi-provider LLM Parsing Error: {grok_exc}")
        return {
            "error": str(grok_exc),
            "doctor_name": None,
            "hospital_name": None,
            "patient_name": None,
            "patient_age": None,
            "doctor_license_number": None,
            "medicines": [],
            "raw_text": text_payload,
            "llm_provider": "failed"
        }