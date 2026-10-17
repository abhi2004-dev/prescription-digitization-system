import os
import time
import logging
from PIL import Image
from dotenv import load_dotenv
from google import genai
from google.genai import types
from app.services.medicine.extractor import NLPExtractor
from app.services.medicine.gemini_parser import parse_ocr_text

load_dotenv(override=True)

logger = logging.getLogger(__name__)

# Active, supported 2026 Gemini vision models
MODELS_TO_TRY = [
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite"
]

class OCREngine:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is not set in backend .env file.")

        http_opts = types.HttpOptions(
            timeout=20000,
            retry_options=types.HttpRetryOptions(attempts=1)
        )
        self.client = genai.Client(api_key=self.api_key, http_options=http_opts)
        self.nlp_extractor = NLPExtractor()
        print(f"[OCREngine] Initialized using API Key ending in: ...{self.api_key[-6:] if self.api_key else 'NONE'}")

    def transcribe_image_raw_text(self, image_path: str) -> str:
        if not os.path.exists(image_path):
            print(f"[OCREngine] ERROR: Image path does not exist: {image_path}", flush=True)
            return ""

        file_size = os.path.getsize(image_path)
        if file_size == 0:
            print(f"[OCREngine] ERROR: Image file is 0 bytes! Check file upload saving in routes.py.", flush=True)
            return ""

        print(f"[OCREngine] Preparing image payload ({file_size / 1024:.1f} KB)...", flush=True)

        try:
            pil_image = Image.open(image_path).convert("RGB")
        except Exception as img_err:
            print(f"[OCREngine] ERROR: Failed to open image with PIL: {img_err}", flush=True)
            return ""

        prompt = (
            "Transcribe all handwritten and printed text from this medical prescription image verbatim line by line. "
            "Return ONLY the exact raw transcribed text. "
            "Do NOT format as JSON, Markdown code blocks, bullet points, or summaries."
        )

        for model in MODELS_TO_TRY:
            try:
                print(f"[OCREngine] Calling {model}...", flush=True)
                response = self.client.models.generate_content(
                    model=model,
                    contents=[pil_image, prompt]
                )
                
                if response and response.text:
                    raw_text = response.text.strip()
                    if raw_text:
                        print(f"[OCREngine] SUCCESS ({model}): Transcribed {len(raw_text)} characters.", flush=True)
                        return raw_text
                    else:
                        print(f"[OCREngine] WARNING: {model} returned an empty text string.", flush=True)
                else:
                    finish_reason = "Unknown"
                    if response and getattr(response, 'candidates', None) and len(response.candidates) > 0:
                        finish_reason = getattr(response.candidates[0], 'finish_reason', 'Unknown')
                    print(f"[OCREngine] WARNING: {model} response.text is None. Finish Reason: {finish_reason}", flush=True)

            except Exception as exc:
                print(f"[OCREngine] FAILED {model}: {exc}", flush=True)
                time.sleep(0.5)

        print("[OCREngine] CRITICAL: All model candidates failed to return raw text.", flush=True)
        return ""

    def extract_text(self, image_path: str) -> dict:
        raw_ocr_text = self.transcribe_image_raw_text(image_path)
        print("\n--- RAW TRANSCRIPTION FROM GEMINI API ---")
        print(raw_ocr_text if raw_ocr_text else "<EMPTY STRING RETURNED>")
        print("------------------------------------------\n")

        parsed_data = self.nlp_extractor.parse_prescription(raw_ocr_text) if raw_ocr_text else {}

        if not parsed_data.get("medicines") and raw_ocr_text:
            print("[MediScan Local NLP] Local parser returned 0 medicines. Triggering secondary extraction...", flush=True)
            gemini_fallback = parse_ocr_text(raw_ocr_text)
            
            extracted_meds = gemini_fallback.get("medicines", [])
            if extracted_meds:
                parsed_data["medicines"] = extracted_meds
                parsed_data["medicines_extracted"] = extracted_meds
                parsed_data["prescribed_medications"] = extracted_meds
                parsed_data["scanned_drugs"] = [m.get("name") or m.get("drug_name") for m in extracted_meds if m.get("name") or m.get("drug_name")]
                
                if gemini_fallback.get("doctor_name") and not parsed_data.get("doctor_name"):
                    parsed_data["doctor_name"] = gemini_fallback["doctor_name"]
                if gemini_fallback.get("hospital_name") and not parsed_data.get("hospital_name"):
                    parsed_data["hospital_name"] = gemini_fallback["hospital_name"]
                if gemini_fallback.get("patient_name") and not parsed_data.get("patient_name"):
                    parsed_data["patient_name"] = gemini_fallback["patient_name"]

        parsed_data["raw_text"] = raw_ocr_text
        parsed_data["extracted_raw_text"] = raw_ocr_text
        return parsed_data