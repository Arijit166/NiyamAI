"""
roi_preprocessing.py
---------------------
Crops each YOLO-detected box and generates several enhanced variants per
field type, cheapest/most-reliable first — the same "generate variants,
let the caller stop at the first one whose OCR result validates" pattern
your ocr.py already uses in LabelOCRProcessor.enhance_roi_variants for its
own ROI re-OCR recovery pass. This module is the equivalent step, but
driven by YOLO box geometry instead of label-proximity.

Variant ordering matters: pipeline.py should try each variant through OCR
in order and take the FIRST one that passes postprocess_field(...).valid,
same as ocr.py's recover_value_multi_engine does.
"""

from typing import List
import cv2
import numpy as np


def crop_roi(image: np.ndarray, bbox: List[int], padding: int = 6, padding_pct: float = 0.20) -> np.ndarray:
    """
    Crops [x1,y1,x2,y2] out of `image`. Padding is the LARGER of a fixed
    pixel floor (`padding`) and a percentage of the box's own size
    (`padding_pct`) — a small/tight YOLO box gets padded proportionally
    more, giving OCR and the vision-LLM crop-reader extra surrounding
    context (adjacent label text, a value that spills slightly outside a
    tight box) instead of just the raw detected box edge. Clamped to image
    bounds.
    """
    h, w = image.shape[:2]
    x1, y1, x2, y2 = bbox
    box_w, box_h = max(1, x2 - x1), max(1, y2 - y1)
    pad_x = max(padding, int(box_w * padding_pct))
    pad_y = max(padding, int(box_h * padding_pct))
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w, x2 + pad_x)
    y2 = min(h, y2 + pad_y)
    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        raise ValueError(f"Empty crop for bbox {bbox} on image of shape {image.shape}")
    return crop


def _to_gray(image: np.ndarray) -> np.ndarray:
    return image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def variants_brand_or_product_name(roi: np.ndarray) -> List[np.ndarray]:
    """
    Brand logos / product name text — keep color (logos often depend on
    color contrast for legibility), try progressively stronger sharpening.
    """
    variants: List[np.ndarray] = []

    # A: light bilateral denoise + mild unsharp, color preserved
    v1 = cv2.bilateralFilter(roi, d=7, sigmaColor=50, sigmaSpace=50)
    blurred = cv2.GaussianBlur(v1, (0, 0), sigmaX=3)
    v1 = cv2.addWeighted(v1, 1.4, blurred, -0.4, 0)
    variants.append(v1)

    # B: CLAHE on L channel for low-contrast/glare logos, then sharpen
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
    l = clahe.apply(l)
    v2 = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
    blurred2 = cv2.GaussianBlur(v2, (0, 0), sigmaX=2)
    v2 = cv2.addWeighted(v2, 1.5, blurred2, -0.5, 0)
    variants.append(v2)

    # C: grayscale fallback — sometimes strips color noise that confuses OCR
    gray = _to_gray(roi)
    gray = cv2.equalizeHist(gray)
    variants.append(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))

    return variants


def variants_net_quantity_or_printed_mrp(roi: np.ndarray, upscale: float = 2.5) -> List[np.ndarray]:
    """
    Cleanly-printed fields (net quantity, and MRP when printed rather than
    dot-matrix stamped). Moderate upscale, progressively stronger threshold.
    """
    gray = _to_gray(roi)
    h, w = gray.shape[:2]
    variants: List[np.ndarray] = []

    # A: upscale + denoise + adaptive threshold (usually enough for printed text)
    up = cv2.resize(gray, (int(w * upscale), int(h * upscale)), interpolation=cv2.INTER_CUBIC)
    denoised = cv2.fastNlMeansDenoising(up, None, 7, 7, 21)
    thresh = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 10)
    variants.append(cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR))

    # B: same upscale, Otsu instead of adaptive (better for even lighting)
    up2 = cv2.resize(gray, (int(w * upscale), int(h * upscale)), interpolation=cv2.INTER_CUBIC)
    _, otsu = cv2.threshold(up2, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR))

    # C: unsharp mask, no binarization — for faint/thin printed digits that
    # lose detail under thresholding
    up3 = cv2.resize(gray, (int(w * upscale), int(h * upscale)), interpolation=cv2.INTER_CUBIC)
    blurred = cv2.GaussianBlur(up3, (0, 0), sigmaX=2)
    sharp = cv2.addWeighted(up3, 1.6, blurred, -0.6, 0)
    variants.append(cv2.cvtColor(sharp, cv2.COLOR_GRAY2BGR))

    return variants


def variants_dot_matrix(roi: np.ndarray, upscale: float = 3.0) -> List[np.ndarray]:
    """
    manufacturing_date / expiry_date (and dot-matrix-stamped MRP): small,
    often-broken-dot inkjet/dot-matrix printing. Mirrors ocr.py's
    LabelOCRProcessor.enhance_roi_variants approach directly, since that's
    the proven variant set for this exact failure mode in your codebase.
    """
    gray = _to_gray(roi)
    variants: List[np.ndarray] = []

    # A: equalize -> upscale -> Otsu threshold
    v1 = cv2.equalizeHist(gray)
    v1 = cv2.resize(v1, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    _, v1 = cv2.threshold(v1, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(cv2.cvtColor(v1, cv2.COLOR_GRAY2BGR))

    # B: CLAHE -> upscale -> adaptive threshold (handles uneven lighting
    # across the crop better than a single global Otsu)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    v2 = clahe.apply(gray)
    v2 = cv2.resize(v2, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    v2 = cv2.GaussianBlur(v2, (3, 3), 0)
    v2 = cv2.adaptiveThreshold(v2, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15)
    variants.append(cv2.cvtColor(v2, cv2.COLOR_GRAY2BGR))

    # C: upscale -> unsharp mask, no binarization (faint, non-thresholdable
    # dot-matrix impressions where binarization loses too much detail)
    v3 = cv2.resize(gray, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    blurred = cv2.GaussianBlur(v3, (0, 0), sigmaX=2)
    v3 = cv2.addWeighted(v3, 1.6, blurred, -0.6, 0)
    variants.append(cv2.cvtColor(v3, cv2.COLOR_GRAY2BGR))

    # D: morphological closing pass on variant B's threshold — merges
    # nearby broken dots into continuous strokes, helps the worst-case prints
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    v2_gray = cv2.cvtColor(v2, cv2.COLOR_BGR2GRAY) if v2.ndim == 3 else v2
    closed = cv2.morphologyEx(v2_gray, cv2.MORPH_CLOSE, kernel, iterations=2)
    variants.append(cv2.cvtColor(closed, cv2.COLOR_GRAY2BGR))

    return variants


def generate_roi_variants(roi: np.ndarray, field_class: str) -> List[np.ndarray]:
    """
    Dispatches to the right variant generator for a detected field class.
    Order is cheapest/most-reliable first — pipeline.py should stop at the
    first variant whose OCR result validates against postprocess_field.
    """
    if field_class in ("brand", "product_name"):
        return variants_brand_or_product_name(roi)
    if field_class == "net_quantity":
        return variants_net_quantity_or_printed_mrp(roi)
    if field_class == "mrp":
        # MRP is sometimes printed, sometimes dot-matrix stamped — try the
        # cheaper printed-text variants first, then dot-matrix as fallback.
        return variants_net_quantity_or_printed_mrp(roi) + variants_dot_matrix(roi)
    if field_class in ("manufacturing_date", "expiry_date"):
        return variants_dot_matrix(roi)
    # Generic fallback for any unexpected class
    gray = _to_gray(roi)
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return [cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR)]