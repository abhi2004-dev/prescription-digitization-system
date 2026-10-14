import os
import cv2
import numpy as np
import logging
from typing import Union

logger = logging.getLogger(__name__)

def detect_signature(image_input: Union[bytes, str, np.ndarray]) -> bool:
    """
    Detects presence of doctor signature on prescription image using OpenCV.
    
    Pipeline:
    1. Loads / decodes image from bytes or file path.
    2. Crops the bottom-right quadrant of the prescription (standard signature location).
    3. Converts to grayscale, applies Gaussian blur, and applies binary Otsu thresholding.
    4. Eliminates straight horizontal line artifacts (ruling/underlines).
    5. Performs contour analysis to detect handwritten signature ink strokes.
    
    Returns:
        bool: True if signature contours/ink strokes exceed threshold, False otherwise.
    """
    if image_input is None:
        return False

    try:
        # 1. Decode image input (support bytes, file path, or numpy array)
        if isinstance(image_input, bytes):
            np_arr = np.frombuffer(image_input, np.uint8)
            image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        elif isinstance(image_input, str):
            if not os.path.exists(image_input):
                logger.warning(f"Signature detector image path not found: {image_input}")
                return False
            image = cv2.imread(image_input)
        elif isinstance(image_input, np.ndarray):
            image = image_input
        else:
            logger.warning(f"Unsupported image input type: {type(image_input)}")
            return False

        if image is None:
            return False

        height, width = image.shape[:2]
        if height < 40 or width < 40:
            return False

        # 2. Crop the bottom-right quadrant of the prescription image (where signatures reside)
        # Primary: Bottom-right quadrant (y: 50%-100%, x: 45%-100%)
        # Secondary: Bottom wide strip (y: 60%-100%, x: 0%-100%)
        candidate_crops = [
            image[int(height * 0.50):height, int(width * 0.45):width],
            image[int(height * 0.60):height, 0:width]
        ]

        for crop in candidate_crops:
            if crop is None or crop.size == 0:
                continue

            crop_h, crop_w = crop.shape[:2]
            crop_area = float(crop_h * crop_w)
            if crop_area <= 0:
                continue

            # 3. Convert to grayscale & Gaussian blur
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)

            # 4. Binary thresholding (Otsu: ink = white (255), background = black (0))
            _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

            # 5. Remove long horizontal ruling lines/underlines
            if crop_w > 30:
                horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, int(crop_w * 0.20)), 1))
                horiz_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horiz_kernel)
                thresh_clean = cv2.subtract(thresh, horiz_lines)
            else:
                thresh_clean = thresh

            # 6. Find external contours
            contours, _ = cv2.findContours(thresh_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            stroke_count = 0
            total_stroke_area = 0.0

            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < 35 or area > (crop_area * 0.55):
                    # Filter out tiny pixel noise or giant boundary blocks
                    continue

                perimeter = cv2.arcLength(cnt, True)
                x, y, w, h = cv2.boundingRect(cnt)

                aspect_ratio = float(w) / max(float(h), 1.0)
                if aspect_ratio > 10.0 or aspect_ratio < 0.1:
                    # Ignore extreme thin straight lines
                    continue

                # Contour complexity (perimeter^2 / area) - high for cursive/freehand strokes
                complexity = (perimeter * perimeter) / max(area, 1.0)

                # Signature stroke criteria:
                # - Freehand handwritten complexity (> 11.0)
                # - Or substantial stroke area with organic aspect ratio
                if (w >= 10 and h >= 6 and complexity > 11.0) or (area >= 120 and 0.2 <= aspect_ratio <= 6.0):
                    stroke_count += 1
                    total_stroke_area += area

            # 7. Check if ink strokes exceed minimum threshold
            if stroke_count >= 1 and total_stroke_area >= 70:
                return True

        return False

    except Exception as exc:
        logger.error(f"Error in OpenCV signature detection: {exc}")
        return False
