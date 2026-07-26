import cv2
import numpy as np
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
import sys
import logging
import os

logger = logging.getLogger(__name__)

# --- Lazy Model Loading ---
# Model path is configurable via environment variable.
# Default: pre-built model. Swap to custom model by changing this value.
MODEL_NAME = os.environ.get("TROCR_MODEL_PATH", "microsoft/trocr-base-handwritten")

_processor = None
_model = None


def get_model():
    """Lazy-load the TrOCR model on first use. Subsequent calls return cached instances."""
    global _processor, _model
    if _processor is None or _model is None:
        logger.info(f"Loading TrOCR model: {MODEL_NAME} (this takes 30-60 seconds on first run)...")
        _processor = TrOCRProcessor.from_pretrained(MODEL_NAME)
        _model = VisionEncoderDecoderModel.from_pretrained(MODEL_NAME)
        logger.info("Model loaded successfully.")
    return _processor, _model



def crop_paper(gray):
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blurred, 180, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return gray
    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)
    pad = 10
    x, y = max(0, x - pad), max(0, y - pad)
    w = min(gray.shape[1] - x, w + 2 * pad)
    h = min(gray.shape[0] - y, h + 2 * pad)
    return gray[y:y+h, x:x+w]


def get_spans(projection, threshold, min_gap):
    """Generic: find contiguous spans where projection > threshold."""
    in_span = False
    spans = []
    start = 0
    for i, val in enumerate(projection):
        if val > threshold and not in_span:
            in_span = True
            start = i
        elif val <= threshold and in_span:
            in_span = False
            if i - start > min_gap:
                spans.append((start, i))
    if in_span:
        spans.append((start, len(projection)))
    return spans


def get_word_crops(line_img, binary_line):
    """Split a line image into word crops using vertical projection."""
    v_proj = np.sum(binary_line, axis=0) // 255
    threshold = line_img.shape[0] * 0.02  # 2% of line height
    word_spans = get_spans(v_proj, threshold, min_gap=3)

    # Merge spans that are close together (same word)
    merged = []
    for span in word_spans:
        if merged and span[0] - merged[-1][1] < 20:
            merged[-1] = (merged[-1][0], span[1])
        else:
            merged.append(list(span))

    crops = []
    for x1, x2 in merged:
        pad = 4
        x1p = max(0, x1 - pad)
        x2p = min(line_img.shape[1], x2 + pad)
        crop = line_img[:, x1p:x2p]
        if crop.shape[1] > 5:
            crops.append(crop)
    return crops


def run_trocr(img_array):
    """Run TrOCR inference on a single image crop."""
    proc, mdl = get_model()
    pil_img = Image.fromarray(img_array).convert("RGB")
    pixel_values = proc(pil_img, return_tensors="pt").pixel_values
    generated_ids = mdl.generate(pixel_values, max_new_tokens=32)
    return proc.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()


def extract_text(image_path):
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, h=15)
    paper = crop_paper(gray)

    binary = cv2.adaptiveThreshold(
        paper, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31, 10
    )

    # Get lines via horizontal projection
    h_proj = np.sum(binary, axis=1) // 255
    threshold = paper.shape[1] * 0.01
    line_spans = get_spans(h_proj, threshold, min_gap=10)
    logger.info(f"Found {len(line_spans)} text lines in image")

    full_text = []
    for i, (y1, y2) in enumerate(line_spans):
        y1p = max(0, y1 - 4)
        y2p = min(paper.shape[0], y2 + 4)
        line_img = paper[y1p:y2p, :]
        binary_line = binary[y1p:y2p, :]

        word_crops = get_word_crops(line_img, binary_line)
        logger.debug(f"Line {i+1}: {len(word_crops)} word crops")

        words = []
        for wc in word_crops:
            t = run_trocr(wc)
            if t:
                words.append(t)

        line_text = " ".join(words)
        logger.debug(f"Line {i+1} text: {line_text}")
        if line_text.strip():
            full_text.append(line_text)

    if not full_text:
        logger.info("No lines detected, fallback: scanning full image")
        return run_trocr(paper)

    return "\n".join(full_text)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ocr/ocr_engine.py <path_to_image>")
        sys.exit(1)
    result = extract_text(sys.argv[1])
    print("\n===== EXTRACTED TEXT =====")
    print(result)