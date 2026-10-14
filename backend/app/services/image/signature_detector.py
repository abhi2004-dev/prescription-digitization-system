import os
import cv2
import numpy as np
import logging

logger = logging.getLogger(__name__)

def detect_signature(image_path: str) -> dict:
    """
    Performs Computer Vision signature detection using OpenCV contour analysis.
    
    Analysis Pipeline:
    1. Reads the prescription image.
    2. Crops the bottom-right signature quadrant (lower 40% vertically, right 55% horizontally)
       as well as scanning the bottom 40% full width if the quadrant is inconclusive.
    3. Converts to grayscale, applies Gaussian blur, and utilizes Otsu thresholding
       to isolate dark ink strokes from the paper background.
    4. Finds contours and filters them based on area, perimeter complexity, stroke variance,
       and bounding box aspect ratio to reject clean printed text blocks, underlines, and borders,
       while isolating freehand handwritten signature strokes.
    5. Returns a structured detection dictionary with confidence score.
    """
    if not os.path.exists(image_path):
        return {
            "signature_detected": False,
            "confidence": 0.0,
            "method": "opencv_contour",
            "reason": "image_not_found"
        }

    try:
        image = cv2.imread(image_path)
        if image is None:
            return {
                "signature_detected": False,
                "confidence": 0.0,
                "method": "opencv_contour",
                "reason": "unable_to_decode_image"
            }

        height, width = image.shape[:2]
        if height < 50 or width < 50:
            return {
                "signature_detected": False,
                "confidence": 0.0,
                "method": "opencv_contour",
                "reason": "image_too_small"
            }

        # Analyze candidate signature regions:
        # Region A: Bottom-right quadrant (standard for prescription slips)
        # Region B: Bottom full width (for slips with centered or left-aligned signatures)
        regions = [
            ("bottom_right", image[int(height * 0.60):height, int(width * 0.40):width]),
            ("bottom_wide", image[int(height * 0.65):height, 0:width])
        ]

        best_confidence = 0.0
        signature_found = False

        for region_name, crop in regions:
            if crop is None or crop.size == 0:
                continue

            crop_h, crop_w = crop.shape[:2]
            crop_area = float(crop_h * crop_w)

            # Convert to grayscale
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

            # Apply Gaussian Blur to smooth minor noise
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)

            # Otsu thresholding to segment dark pen strokes (inverted: ink = white, bg = black)
            _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

            # Remove long straight horizontal lines (table borders, underline lines)
            if crop_w > 40:
                horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (int(crop_w * 0.25), 1))
                horiz_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horiz_kernel)
                thresh_clean = cv2.subtract(thresh, horiz_lines)
            else:
                thresh_clean = thresh

            # Find external contours
            contours, _ = cv2.findContours(thresh_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            sig_stroke_count = 0
            total_sig_area = 0.0
            max_contour_area = 0.0

            for cnt in contours:
                area = cv2.contourArea(cnt)
                perimeter = cv2.arcLength(cnt, True)
                x, y, w, h = cv2.boundingRect(cnt)

                # Skip tiny noise or giant artifacts spanning the entire region
                if area < 50 or area > (crop_area * 0.60):
                    continue

                aspect_ratio = float(w) / max(float(h), 1.0)

                # Reject straight horizontal or vertical lines
                if aspect_ratio > 10.0 or aspect_ratio < 0.1:
                    continue

                # Measure contour complexity (Perimeter^2 / Area).
                # Freehand handwriting / cursive signature strokes have high complexity.
                complexity = (perimeter * perimeter) / max(area, 1.0)

                # Signature stroke criteria:
                # - Moderate to large area
                # - Organic shape complexity (> 14.0)
                # - Reasonable dimensions (width >= 12px, height >= 8px)
                if (w >= 12 and h >= 8 and complexity > 14.0) or (area >= 180 and 0.25 <= aspect_ratio <= 5.0):
                    sig_stroke_count += 1
                    total_sig_area += area
                    if area > max_contour_area:
                        max_contour_area = area

            # Calculate confidence based on candidate stroke count and area coverage
            if sig_stroke_count >= 1 and total_sig_area > 120:
                confidence = min(0.95, 0.60 + (min(sig_stroke_count, 6) * 0.05) + (min(total_sig_area / crop_area, 0.1) * 2.0))
                if confidence > best_confidence:
                    best_confidence = confidence
                    signature_found = True

            if signature_found and best_confidence >= 0.75:
                break

        return {
            "signature_detected": signature_found,
            "confidence": round(best_confidence, 2) if signature_found else 0.0,
            "method": "opencv_contour"
        }

    except Exception as exc:
        logger.error(f"Error during CV signature detection: {exc}")
        return {
            "signature_detected": False,
            "confidence": 0.0,
            "method": "opencv_contour",
            "error": str(exc)
        }


class SignatureDetector:
    """Wrapper class for computer-vision signature detection."""
    def __init__(self):
        pass

    def detect(self, image_path: str) -> dict:
        return detect_signature(image_path)