import os
import json
import google.generativeai as genai
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))

class Medicine(BaseModel):
    name: str = Field(description="The actual pharmaceutical name, correcting minor typos.")
    dosage_formatted: str = Field(description="Dosage and frequency in plain English.")

class PrescriptionData(BaseModel):
    doctor_name: str = Field(description="Return empty string if not found.")
    hospital_name: str = Field(description="Return empty string if not found.")
    patient_name: str = Field(description="Return empty string if not found.")
    patient_age: str = Field(description="Return empty string if not found.")
    doctor_license_number: str = Field(description="Return empty string if not found.")
    medicines: list[Medicine] = Field(description="List of verified medicines.")

def parse_ocr_text(raw_text_array: list[str]) -> dict:
    text_payload = " ".join(raw_text_array)
    print("\n--- RAW OCR TEXT RECEIVED BY GEMINI ---")
    print(text_payload)
    print("---------------------------------------\n")
    # ... rest of your code ...

def parse_ocr_text(raw_text_array: list[str]) -> dict:
    text_payload = " ".join(raw_text_array)
    
    prompt = f"""
    You are a strict clinical data extraction engine parsing noisy OCR text from a handwritten prescription.
    
    CRITICAL RULES:
    * ZERO HALLUCINATIONS: Do not guess or invent medications. If a word or phrase is not a recognized pharmaceutical, discard it completely.
    * IGNORE NOISE: Discard doctor signatures, printed boilerplate labels ("Rx", "Age", "Sex", "Lic No", "Address"), and OCR artifacts.
    * AUTOCORRECT TYPOS: If OCR extracts a clear typo of a real medication, correct it to the valid name.
    * FORMAT DOSAGES: Translate clinical shorthand into clean English instructions.

    Raw OCR Text:
    {text_payload}
    """

    try:
        model = genai.GenerativeModel('gemini-3.6-flash')
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                response_schema=PrescriptionData,
                temperature=0.0,
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"CRITICAL: LLM Parsing Error: {e}")
        return {"error": str(e)}