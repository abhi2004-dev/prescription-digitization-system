import easyocr
import torch
import numpy as np
from PIL import Image, ImageOps
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from rapidfuzz import process, utils
import warnings
import os

warnings.filterwarnings("ignore", category=UserWarning)

# --- 1. MEDICINE MASTER DATABASE ---
DRUG_DATABASE = [
    "Levocet M", "Prolomet XL 25", "Livogen", "Erythrocin 250", 
    "Amoxicillin", "Paracetamol", "Metformin", "Pantocid"
]

def get_best_match(ocr_text):
    if not ocr_text or len(ocr_text.strip()) < 2:
        return ocr_text
    match = process.extractOne(ocr_text, DRUG_DATABASE, processor=utils.default_process, score_cutoff=60)
    return match[0] if match else ocr_text

def hybrid_prediction(image_path):
    model_path = "./data/best_model"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    # 1. SANITIZE IMAGE FIRST
    # This prevents OpenCV crashes inside EasyOCR
    print("Sanitizing image format...")
    raw_img = Image.open(image_path).convert("RGB")
    temp_path = "temp_sanitized.jpg"
    raw_img.save(temp_path, "JPEG")

    print(f"Initializing Hybrid System on {device}...")
    detector = easyocr.Reader(['en'], gpu=True)
    processor = TrOCRProcessor.from_pretrained(model_path)
    model = VisionEncoderDecoderModel.from_pretrained(model_path).to(device)

    print("Detecting text regions...")
    # Pass the sanitized image as a numpy array to avoid EasyOCR's internal file loader
    img_np = np.array(raw_img)
    results = detector.readtext(img_np)
    
    final_output = []
    print(f"Found {len(results)} segments. Processing...")

    for (bbox, text, prob) in results:
        (tl, tr, br, bl) = bbox
        x_min, y_min = int(min(tl[0], bl[0])), int(min(tl[1], tr[1]))
        x_max, y_max = int(max(tr[0], br[0])), int(max(bl[1], br[1]))

        # Safety Check
        if (x_max - x_min) < 5 or (y_max - y_min) < 5:
            continue
        
        line_image = raw_img.crop((x_min, y_min, x_max, y_max))
        line_image = ImageOps.expand(line_image, border=5, fill='white')

        try:
            pixel_values = processor(line_image, return_tensors="pt").pixel_values.to(device)
            with torch.no_grad():
                generated_ids = model.generate(pixel_values, max_new_tokens=64)
            
            raw_ocr = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
            final_text = get_best_match(raw_ocr)
            final_output.append((raw_ocr, final_text))
        except Exception:
            continue

    # Cleanup temp file
    if os.path.exists(temp_path):
        os.remove(temp_path)

    return final_output

if __name__ == "__main__":
    test_image = r"G:\prescription-digitization-system\body.jpeg" 
    
    try:
        results = hybrid_prediction(test_image)
        print("\n" + "="*55)
        print(f"{'RAW OCR OUTPUT':<22} | {'FINAL MEDICINE MATCH':<25}")
        print("-" * 55)
        for raw, corrected in results:
            print(f"{raw:<22} | {corrected:<25}")
        print("="*55)
    except Exception as e:
        print(f"\nCRITICAL ERROR: {e}")