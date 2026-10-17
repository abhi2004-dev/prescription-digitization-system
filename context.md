1. Project Overview & Architecture
MediScan is a medical prescription digitization, verification, and clinical safety platform built as a final-year Computer Science engineering capstone project at Srinivas Institute of Technology.

System Stack
Frontend: React Native (Mobile App) featuring prescription scan uploads, interactive medication cards, dosage schedule alarm slots, regional translation, Read Aloud (Text-to-Speech), PDF export, and user profile management.

Backend: FastAPI (Python) running on Uvicorn, structured with modular routers, OCR engines, local spaCy NLP extractors, safety engines, and verification services.

Data Layer: Local SQLite database with SQLAlchemy ORM (users and prescriptions tables).

Vision & OCR Pipeline: Hybrid OCR architecture combining fast in-memory JPEG image compression, Gemini 3.5 Flash for vision-to-text transcription, a local fine-tuned spaCy Clinical NLP model (clinical_nlp_model_v2), and a secondary structured JSON fallback parser.

Clinical Intelligence & Safety:

Fuzzy patient name matching via thefuzz (token_sort_ratio).

Cross-referencing drug-drug interaction safety checks (check_interactions).

Doctor license registry verification (verification_engine.py) and CV/regex signature detection.

2. What Went Wrong (Root Causes & Debugging History)
During early testing and setup for the project presentation, the system experienced several critical failures:

Issue 1: High-Resolution Upload Timeouts & Blank Raw Text
Symptom: Mobile camera photos (5–10 MB) took over 15 seconds to upload, resulting in network timeouts and empty string returns ("").

Root Cause: Passing uncompressed raw image buffers or large PIL objects caused the SDK to serialize uncompressed PNG payloads (3–5 MB over the network), causing silent timeouts in Gemini calls.

Fix Applied: Enforced hardware-level in-memory downscaling (max dimension 1024px) and JPEG compression (quality=80, optimize=True) in routes.py, reducing upload payload size from 8 MB to ~120 KB and dropping transcription latency to under 1.5 seconds.

Issue 2: Gemini API Quota Exhaustion (429) & Retired Model Strings (404)
Symptom: The terminal logged 429 RESOURCE_EXHAUSTED for gemini-3.8-flash and 404 NOT_FOUND for fallbacks like gemini-2.0-flash or gemini-2.5-flash.

Root Cause: Free tier quotas capped gemini-3.8-flash at 20 requests per day per project. The fallback list contained deprecated model strings no longer supported by the API.

Fix Applied: Streamlined the active vision engine to gemini-3.5-flash, updated .env key management with load_dotenv(override=True) to prevent process memory key caching, and force-killed stale Python background processes (Stop-Process -Name "python" -Force).

Issue 3: "No Medicines Detected" UI Warning
Symptom: The backend returned 200 OK, but the app displayed "No medicines detected."

Root Cause 1 (Empty String Feeding): When transcription timed out, transcribe_image() returned "", passing zero text into NLPExtractor().parse_prescription("").

Root Cause 2 (Key Discrepancy): extractor.py returned the key medicines_extracted, while routes.py and React Native looked for medicines, resolving parsed_data.get("medicines") to [].

Fix Applied: Standardized return keys across extractor.py, ocr_engine.py, and routes.py so both medicines and medicines_extracted are always populated. Added a secondary Gemini structured JSON fallback that triggers if local NLP returns 0 drugs from valid OCR text.

Issue 4: React Native Profile Screen Crashes
Symptom: Tapping Profile logged GET /api/v1/user/profile HTTP/1.1 200 OK in Uvicorn, but React Native closed or crashed immediately.

Root Cause: ProfileScreen.js attempted to render .drug_name or run .map() on active_medications. When the backend returned stringified JSON ('["Ibuprofen"]') or flat strings (["Ibuprofen"]), React Native threw an uncaught JavaScript TypeError.

Fix Applied: Updated get_user_profile in routes.py to return multi-schema defensive payloads containing structured objects ([{"id": "...", "drug_name": "Ibuprofen", ...}]), raw string arrays, and nested user / profile keys.

Issue 5: Dosage Schedule Slots Not Populating (1-0-1)
Symptom: 1-0-1 appeared as text, but visual alarm slots (morning, afternoon, night) remained inactive (False).

Root Cause: In Python, a dictionary containing all False values ({"morning": False, "afternoon": False, "night": False}) is evaluated as truthy (bool(dict) == True). The code if not m.get("schedule_slots"): skipped recalculation. Furthermore, regex failed on spaces (1 - 0 - 1) or trailing text (1-0-1 for 5 days).

Fix Applied: Rewrote parse_dosage_schedule using flexible matrix regex (r'(\d+)\s*-\s*(\d+)\s*-\s*(\d+)') and updated routes.py to check any(slots.values()).

Issue 6: 404 Not Found on /api/v1/scan/finalize and /api/v1/prescriptions
Symptom: Confirming medication cards in the mobile app threw an error on POST /api/v1/scan/finalize.

Root Cause: Restored route files omitted the @router.post("/scan/finalize") endpoint and route aliases.

Fix Applied: Added comprehensive route alias decorators (@router.post("/finalize"), @router.post("/scan/finalize"), @router.post("/api/v1/scan/finalize")) to handle finalize, history list, and profile endpoints seamlessly.

3. Current Operational Status & Checklist
Vision Engine: gemini-3.5-flash running with in-memory JPEG compression (payloads ~120 KB).

Endpoints Functional: /extract, /finalize, /prescriptions, /user/profile.

Database & Verification: SQLite persisting scans and active medications. Doctor IDs configurable in backend/app/services/verification_engine.py.

UI Features Ready: Interactive medication cards, alarm slots, doctor advice, patient fuzzy matching, drug interaction alerts, translation, read aloud, and PDF export logic.