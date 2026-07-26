import torch
import cv2
import numpy as np
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

def process_full_prescription(image_path):
    model_path = "./data/best_model_v2_final"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    print(f"Loading specialized model on {device}...")
    
    # 1. Load Processor and Model correctly (Instance-based loading)
    processor = TrOCRProcessor.from_pretrained(model_path)
    model = VisionEncoderDecoderModel.from_pretrained(model_path).to(device)

    # 2. Image Pre-processing for Detection
    image = cv2.imread(image_path)
    if image is None:
        print(f"Error: Could not open {image_path}")
        return

    # Convert to grayscale and apply thresholding
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Connect separate letters into single horizontal lines
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 5))
    dilated = cv2.dilate(thresh, kernel, iterations=2)
    
    # This helps you debug! Open this file to see the detection boxes.
    cv2.imwrite("debug_detection.png", dilated)

    # 3. Find and Sort Contours (Top to Bottom)
    cnts, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnts = sorted(cnts, key=lambda x: cv2.boundingRect(x)[1])

    print(f"\n--- SCANNING PRESCRIPTION LINES ---")
    results = []

    for i, c in enumerate(cnts):
        x, y, w, h = cv2.boundingRect(c)
        
        # Only process objects that are wide and tall enough to be words
        if w > 40 and h > 15:
            # Add padding so the TrOCR model sees the whole letter
            padding = 8
            y_s, y_e = max(0, y-padding), min(image.shape[0], y+h+padding)
            x_s, x_e = max(0, x-padding), min(image.shape[1], x+w+padding)

            line_img = image[y_s:y_e, x_s:x_e]
            line_pil = Image.fromarray(cv2.cvtColor(line_img, cv2.COLOR_BGR2RGB))

            # Move pixel values to the same device as the model
            pixel_values = processor(line_pil, return_tensors="pt").pixel_values.to(device)
            
            # Using Beam Search for higher accuracy on medical terms
            generated_ids = model.generate(
                pixel_values,
                max_new_tokens=64,
                num_beams=5,
                early_stopping=True
            )
            
            text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
            results.append(text)
            print(f"Line {i+1}: {text}")

    print(f"\n" + "="*40)
    print("FINAL SYSTEM SUMMARY:")
    print(" | ".join(results))
    print("="*40 + "\n")

if __name__ == "__main__":
    process_full_prescription("body.jpeg")