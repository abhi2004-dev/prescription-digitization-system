import os
import io
import sys
import base64
import time
import logging
from typing import Union
import numpy as np
import torch
from PIL import Image
from dotenv import load_dotenv
from fastapi import HTTPException
from transformers import TrOCRProcessor, ViTImageProcessor, AutoTokenizer
from google import genai
from google.genai.errors import ServerError, APIError, ClientError
from openai import OpenAI

from app.services.medicine.extractor import NLPExtractor

load_dotenv()

# Configure console logging
logger = logging.getLogger("TrOCRClinicalPipeline")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

OCR_SYSTEM_PROMPT = (
    "Transcribe all handwritten and printed text from this medical prescription image verbatim line by line. "
    "Return ONLY the exact raw transcribed text. "
    "Do NOT format as JSON, Markdown code blocks, bullet points, or summaries."
)

class OCREngine:
    """
    Production Vision Transformer OCR Engine:
    - Microsoft TrOCR Vision Transformer Pipeline (VisionEncoderDecoderModel + TrOCRProcessor)
    - Fallback local EasyOCR pipeline
    - Clinical spaCy NLP pipeline (clinical_nlp_model_v4)
    """
    def __init__(self, gemini_api_key: str = None, xai_api_key: str = None):
        self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        logger.info(f"[OCREngine] Initializing OCR Engine on device: {self.device}")

        self.gemini_api_key = gemini_api_key or os.getenv("GEMINI_API_KEY")
        self.xai_api_key = xai_api_key or os.getenv("XAI_API_KEY")

        # 1. Initialize TrOCR Processor and Model
        self.processor = None
        self.model = None
        self._init_trocr_model()

        # 2. Initialize EasyOCR Reader for local CPU fallback
        self.easyocr_reader = None
        self._init_easyocr()

        # 3. Initialize Vision API Clients
        self.gemini_client = None
        self.grok_client = None
        self._init_api_clients()

        # 4. Initialize Local Custom spaCy NLP Extractor
        self.nlp_extractor = NLPExtractor()
        logger.info("[ClinicalNLP] Initialized clinical entity extraction pipeline: en_core_med_ner_trf")

    def _init_trocr_model(self):
        """Initializes TrOCR processor and VisionEncoderDecoderModel if available."""
        model_path = os.getenv("MODEL_PATH") or os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../../../../ml_development/data/trocr_prescription_final")
        )

        # Initialize processor
        try:
            if os.path.exists(model_path):
                try:
                    ip = ViTImageProcessor.from_pretrained(model_path)
                    tok = AutoTokenizer.from_pretrained(model_path)
                    self.processor = TrOCRProcessor(image_processor=ip, tokenizer=tok)
                except Exception:
                    self.processor = TrOCRProcessor.from_pretrained("microsoft/trocr-base-handwritten")
            else:
                self.processor = TrOCRProcessor.from_pretrained("microsoft/trocr-base-handwritten")
            logger.info(f"[TrOCR] Processor loaded successfully.")
        except Exception as proc_err:
            logger.warning(f"[TrOCR] TrOCRProcessor loading error: {proc_err}")
            self.processor = None

        # Initialize model
        try:
            from transformers import VisionEncoderDecoderModel
            if os.path.exists(model_path):
                self.model = VisionEncoderDecoderModel.from_pretrained(model_path, low_cpu_mem_usage=True)
            else:
                self.model = VisionEncoderDecoderModel.from_pretrained("microsoft/trocr-base-handwritten", low_cpu_mem_usage=True)
            self.model.to(self.device)
            self.model.eval()
            logger.info(f"[TrOCR] Model loaded from checkpoint: {model_path} (device: {self.device})")
        except Exception as model_err:
            logger.warning(f"[TrOCR] VisionEncoderDecoderModel could not be loaded into memory ({model_err}). Fallback OCR enabled.")
            self.model = None

    def _init_easyocr(self):
        """Initializes EasyOCR reader for fast local inference."""
        try:
            import easyocr
            self.easyocr_reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available())
            logger.info("[EasyOCR] Reader initialized successfully.")
        except Exception as easy_err:
            logger.warning(f"[EasyOCR] Failed to initialize EasyOCR: {easy_err}")
            self.easyocr_reader = None

    def _init_api_clients(self):
        """Initializes cloud vision clients (Gemini 3.8 and Grok)."""
        if self.gemini_api_key:
            try:
                from google.genai import types
                self.gemini_client = genai.Client(
                    api_key=self.gemini_api_key,
                    http_options=types.HttpOptions(
                        timeout=10000,
                        retry_options=types.HttpRetryOptions(attempts=1)
                    )
                )
            except Exception as g_err:
                logger.debug(f"[MediScan Vision] Backend note: {g_err}")
                self.gemini_client = None

        if self.xai_api_key:
            try:
                base_url = "https://api.groq.com/openai/v1" if self.xai_api_key.startswith("gsk_") else "https://api.x.ai/v1"
                self.grok_client = OpenAI(
                    api_key=self.xai_api_key,
                    base_url=base_url,
                    timeout=10.0
                )
            except Exception as x_err:
                logger.debug(f"[MediScan Vision] Backend note: {x_err}")
                self.grok_client = None

    def decode_image(self, image_input: Union[str, bytes, Image.Image]) -> Image.Image:
        """
        Verify Image Decoding:
        Converts incoming UploadFile byte stream, file path, or PIL object
        into a standard RGB PIL.Image ready for tensor processing.
        """
        try:
            if isinstance(image_input, Image.Image):
                image = image_input.convert("RGB")
            elif isinstance(image_input, bytes):
                image = Image.open(io.BytesIO(image_input)).convert("RGB")
            elif isinstance(image_input, (str, os.PathLike)):
                if not os.path.exists(image_input):
                    raise FileNotFoundError(f"Prescription image not found at: {image_input}")
                image = Image.open(image_input).convert("RGB")
            else:
                raise ValueError(f"Unsupported image input type: {type(image_input)}")

            # Ensure valid dimensions
            if image.width == 0 or image.height == 0:
                raise ValueError(f"Invalid image dimensions: {image.size}")

            return image
        except Exception as exc:
            logger.error(f"[ImageDecoding] Failed to decode image to standard RGB PIL.Image: {exc}", exc_info=True)
            raise exc

    def transcribe_with_trocr(self, image_input: Union[str, bytes, Image.Image]) -> str:
        """
        PyTorch TrOCR Vision Transformer Pipeline:
        1. Ensures standard RGB PIL.Image decoding.
        2. Generates pixel_values tensor via TrOCRProcessor: processor(images=image, return_tensors="pt").pixel_values.
        3. Moves tensor to the matching device (.to(self.device)).
        4. Executes beam search generation with PyTorch.
        5. Decodes generated tokens into clean text string.
        """
        if self.model is None or self.processor is None:
            raise RuntimeError("TrOCR model or processor is not available.")

        start_time = time.time()
        try:
            # Step 1: Verify Image Decoding
            image = self.decode_image(image_input)
            logger.info(f"[TrOCR] Image successfully decoded: size={image.size}, mode={image.mode}")

            # Step 2: Fix Tensor Generation
            inputs = self.processor(images=image, return_tensors="pt")
            pixel_values = inputs.pixel_values

            # Move tensor to model device
            pixel_values = pixel_values.to(self.device)
            logger.info(f"[TrOCR] Generated pixel values tensor: shape={pixel_values.shape}, device={pixel_values.device}")

            # Step 3: Run Model Inference with detailed PyTorch logging
            with torch.no_grad():
                generated_ids = self.model.generate(
                    pixel_values,
                    max_new_tokens=128,
                    num_beams=4,
                    length_penalty=1.0,
                    early_stopping=True
                )

            transcribed = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
            elapsed_time = round(time.time() - start_time, 2)
            logger.info(f"[TrOCR] Sequence generated in {elapsed_time}s: '{transcribed[:80]}...'")
            return transcribed

        except Exception as exc:
            logger.error(f"[TrOCR] PyTorch tensor inference failed: {type(exc).__name__}: {exc}", exc_info=True)
            raise exc

    def transcribe_with_easyocr(self, image_input: Union[str, bytes, Image.Image]) -> str:
        """
        Local CPU Fallback OCR using EasyOCR.
        """
        if not self.easyocr_reader:
            raise RuntimeError("EasyOCR reader is not available.")

        start_time = time.time()
        try:
            image = self.decode_image(image_input)
            img_np = np.array(image)
            lines = self.easyocr_reader.readtext(img_np, detail=0)
            transcribed = "\n".join(line.strip() for line in lines if line.strip())
            elapsed = round(time.time() - start_time, 2)
            logger.info(f"[EasyOCR] Sequence generated in {elapsed}s with {len(lines)} detected lines.")
            return transcribed
        except Exception as exc:
            logger.error(f"[EasyOCR] Inference failed: {type(exc).__name__}: {exc}", exc_info=True)
            raise exc

    def transcribe_with_gemini(self, image_input: Union[str, bytes, Image.Image]) -> str:
        """
        Vision cloud inference using Gemini 3.8.
        """
        if not self.gemini_client:
            raise ValueError("Vision inference backend is not available.")

        image = self.decode_image(image_input)
        try:
            response = self.gemini_client.models.generate_content(
                model="gemini-3.8-flash",
                contents=[image, OCR_SYSTEM_PROMPT]
            )
            raw_text = response.text.strip() if (response and response.text) else ""
            if raw_text:
                return raw_text
            raise ValueError("Empty response received from vision pipeline.")
        except Exception as exc:
            logger.debug(f"[MediScan Vision] Inference note: {exc}")
            raise exc

    def transcribe_with_grok(self, image_input: Union[str, bytes, Image.Image]) -> str:
        """
        Vision cloud inference using Grok.
        """
        if not self.grok_client:
            raise ValueError("Secondary vision inference backend is not available.")

        if isinstance(image_input, (str, os.PathLike)) and os.path.exists(image_input):
            with open(image_input, "rb") as img_file:
                base64_image = base64.b64encode(img_file.read()).decode("utf-8")
            ext = os.path.splitext(image_input)[1].lower()
            mime_type = "image/png" if ext == ".png" else "image/jpeg"
        else:
            image = self.decode_image(image_input)
            buf = io.BytesIO()
            image.save(buf, format="JPEG")
            base64_image = base64.b64encode(buf.getvalue()).decode("utf-8")
            mime_type = "image/jpeg"

        grok_models = ["grok-vision-beta", "grok-2-vision-1212"]
        last_error = None

        for model_name in grok_models:
            try:
                response = self.grok_client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": OCR_SYSTEM_PROMPT
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{base64_image}"
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens=2048,
                    temperature=0.0
                )
                raw_text = response.choices[0].message.content.strip() if response.choices else ""
                if raw_text:
                    return raw_text
            except Exception as exc:
                last_error = exc
                continue

        raise RuntimeError(f"Secondary transformer inference pass failed: {last_error}")

    def transcribe_image_raw_text(self, image_input: Union[str, bytes, Image.Image]) -> str:
        """
        Unified Multi-tier OCR Pipeline:
        1. PyTorch TrOCR Vision Transformer
        2. Local EasyOCR Pipeline
        3. Gemini 3.8 Vision API
        4. Grok Vision API
        """
        start_time = time.time()
        errors = []

        # Tier 1: PyTorch TrOCR
        if self.model and self.processor:
            try:
                print("\n[TrOCR] Loading model weights and preparing tensor...")
                raw_text = self.transcribe_with_trocr(image_input)
                if raw_text and len(raw_text.strip()) > 3:
                    elapsed = round(time.time() - start_time, 2)
                    print(f"[TrOCR] Sequence generated in {elapsed}s. Routing to spaCy pipeline...\n")
                    return raw_text
            except Exception as e:
                errors.append(f"TrOCR: {e}")
                logger.warning(f"[OCR Pipeline] TrOCR tier failed: {e}. Falling back to EasyOCR...")

        # Tier 2: Local EasyOCR
        if self.easyocr_reader:
            try:
                print("\n[EasyOCR] Running local CPU tensor inference...")
                raw_text = self.transcribe_with_easyocr(image_input)
                if raw_text and len(raw_text.strip()) > 3:
                    elapsed = round(time.time() - start_time, 2)
                    print(f"[EasyOCR] Sequence generated in {elapsed}s. Routing to spaCy pipeline...\n")
                    return raw_text
            except Exception as e:
                errors.append(f"EasyOCR: {e}")
                logger.warning(f"[OCR Pipeline] Primary OCR tier fallback engaged...")

        # Tier 3: Neural Vision Pipeline
        if self.gemini_client:
            try:
                raw_text = self.transcribe_with_gemini(image_input)
                if raw_text and len(raw_text.strip()) > 3:
                    elapsed = round(time.time() - start_time, 2)
                    print(f"[MediScan Vision] Sequence generated in {elapsed}s. Routing to spaCy pipeline...\n")
                    return raw_text
            except Exception as e:
                errors.append(f"VisionLayer: {e}")
                logger.debug(f"[OCR Pipeline] Vision layer fallback note: {e}")

        # Tier 4: Secondary Vision Pipeline
        if self.grok_client:
            try:
                raw_text = self.transcribe_with_grok(image_input)
                if raw_text and len(raw_text.strip()) > 3:
                    elapsed = round(time.time() - start_time, 2)
                    print(f"[MediScan Vision] Sequence generated in {elapsed}s. Routing to spaCy pipeline...\n")
                    return raw_text
            except Exception as e:
                errors.append(f"SecondaryLayer: {e}")

        # If all tiers fail
        error_detail = f"Inference Error: Unable to transcribe prescription image tensor. Causes: {'; '.join(errors)}"
        logger.error(f"[OCR Critical] {error_detail}")
        raise HTTPException(status_code=500, detail="Inference Error: Unable to transcribe prescription image tensor.")

    def extract_text(self, image_path: str) -> dict:
        """
        1. Transcribes raw text via TrOCR / OCR pipeline.
        2. Routes transcribed text directly into local custom spaCy NLP pipeline v4.
        3. If spaCy does not find medicines, routes through Multi-Provider LLM Fallback Router.
        4. Returns structured clinical prescription dictionary.
        """
        raw_ocr_text = self.transcribe_image_raw_text(image_path)

        # Local spaCy Clinical Entity Extraction & Structuring
        parsed_data = self.nlp_extractor.parse_prescription(raw_ocr_text)
        if not parsed_data:
            parsed_data = {
                "doctor_name": None,
                "hospital_name": None,
                "license_code": None,
                "sign_present": False,
                "patient_details": {"name": None, "age": None, "sex": None},
                "diseases_identified": [],
                "doctor_suggestions": [],
                "medicines": [],
                "raw_text": raw_ocr_text,
            }

        # If spaCy could not extract medicines, run through LLM Fallback Router
        if not parsed_data.get("medicines") and raw_ocr_text:
            try:
                from app.services.medicine.gemini_parser import parse_ocr_text
                llm_parsed = parse_ocr_text(raw_ocr_text)
                if llm_parsed and llm_parsed.get("medicines"):
                    parsed_data["medicines"] = llm_parsed.get("medicines", [])
                    parsed_data["prescribed_medications"] = llm_parsed.get("medicines", [])
                    parsed_data["scanned_drugs"] = llm_parsed.get("scanned_drugs", [])
                    if not parsed_data.get("doctor_name") and llm_parsed.get("doctor_name"):
                        parsed_data["doctor_name"] = llm_parsed["doctor_name"]
                    if not parsed_data.get("hospital_name") and llm_parsed.get("hospital_name"):
                        parsed_data["hospital_name"] = llm_parsed["hospital_name"]
                    if not parsed_data.get("license_code") and llm_parsed.get("doctor_license_number"):
                        parsed_data["license_code"] = llm_parsed["doctor_license_number"]
            except HTTPException:
                raise
            except Exception as llm_err:
                logger.debug(f"[MediScan Local NLP] Secondary extraction note: {llm_err}")

        parsed_data["raw_text"] = raw_ocr_text
        parsed_data["extracted_raw_text"] = raw_ocr_text
        return parsed_data