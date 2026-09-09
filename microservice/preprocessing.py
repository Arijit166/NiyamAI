"""
preprocessing.py
-----------------
Adaptive image preprocessing pipeline for OCR (e.g. PaddleOCR / Tesseract),
built for packaged-commodity label images.

Design goal: don't blindly apply every filter to every image. First assess
image quality (blur, brightness, contrast, noise, skew), then apply ONLY the
corrections that image actually needs. This is faster and produces better
OCR results than a fixed filter chain.

Import in FastAPI like this:

    from preprocessing import preprocess_image

    @app.post("/ocr")
    async def ocr_endpoint(file: UploadFile = File(...)):
        image_bytes = await file.read()
        processed_img, report = preprocess_image(image_bytes)

        if report["reject"]:
            return {"error": report["reject_reason"], "quality_report": report}

        # pass `processed_img` (a numpy BGR array) into your OCR engine here
        # text = run_paddleocr(processed_img)

        return {"quality_report": report}
"""

from typing import Union, Tuple, Dict, Any, Optional
import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Config — tune these thresholds against your own dataset
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: Dict[str, Any] = {
    # Blur (Laplacian variance) — below this, image is considered too blurry
    "blur_reject_threshold": 15.0,
    "blur_warn_threshold": 60.0,

    # Brightness (mean pixel value, 0-255)
    "target_brightness": 128.0,
    "brightness_dark_threshold": 105.0,
    "brightness_bright_threshold": 155.0,

    # Contrast (std deviation of grayscale pixels)
    "contrast_low_threshold": 45.0,
    "contrast_high_threshold": 70.0,

    # Noise threshold (estimated noise standard deviation)
    "noise_threshold": 10.0,

    # Resize target for longest side (px). OCR is slow on raw phone-camera resolutions
    "resize_max_dim": 1800,

    # Skew angle (degrees) below which we don't bother deskewing
    "skew_ignore_threshold": 1.0,

    # Minimum resolution to even attempt OCR
    "min_dimension_px": 150,
}


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------

def load_image(image: Union[str, bytes, np.ndarray]) -> np.ndarray:
    """
    Accepts a file path, raw bytes (e.g. from FastAPI's UploadFile.read()),
    or an already-decoded numpy array, and returns a BGR numpy array
    (OpenCV's native format).
    """
    if isinstance(image, np.ndarray):
        return image.copy()

    if isinstance(image, (bytes, bytearray)):
        arr = np.frombuffer(image, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image bytes. Unsupported or corrupt format.")
        return img

    if isinstance(image, str):
        img = cv2.imread(image, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"Could not read image from path: {image}")
        return img

    raise TypeError(f"Unsupported image input type: {type(image)}")


def image_to_bytes(image: np.ndarray, ext: str = ".jpg", quality: int = 92) -> bytes:
    """Encode a numpy BGR image back to bytes (useful for FastAPI responses)."""
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext.lower() in (".jpg", ".jpeg") else []
    success, buffer = cv2.imencode(ext, image, params)
    if not success:
        raise ValueError("Failed to encode image.")
    return buffer.tobytes()


# ---------------------------------------------------------------------------
# STEP 1 — Quality assessment
# ---------------------------------------------------------------------------

def estimate_noise_sigma(gray: np.ndarray) -> float:
    """
    Estimates Gaussian/sensor noise standard deviation in a grayscale image
    using Median Absolute Deviation (MAD) of the Laplacian.
    """
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    sigma = float(np.median(np.abs(lap - np.median(lap))) / 0.6745)
    return round(sigma, 2)


def assess_quality(gray: np.ndarray, config: Dict[str, Any]) -> Dict[str, Any]:
    h, w = gray.shape[:2]

    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    noise_sigma = estimate_noise_sigma(gray)
    skew_angle = estimate_skew_angle(gray)

    is_too_blurry = blur_score < config["blur_reject_threshold"]
    is_too_small = min(h, w) < config["min_dimension_px"]

    return {
        "resolution": {"width": int(w), "height": int(h)},
        "blur_score": round(blur_score, 2),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
        "noise_sigma": noise_sigma,
        "skew_angle_deg": round(skew_angle, 2),
        "is_too_blurry": is_too_blurry,
        "is_too_small": is_too_small,
    }


def estimate_skew_angle(gray: np.ndarray) -> float:
    """
    Estimates document/label skew using minAreaRect over thresholded
    foreground pixels. Works well for a mostly-rectangular label/package
    against a reasonably plain background. Returns angle in degrees
    (positive = rotated counter-clockwise).
    """
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(thresh)

    if coords is None or len(coords) < 50:
        return 0.0

    angle = cv2.minAreaRect(coords)[-1]

    if angle < -45:
        angle = 90 + angle
    if angle > 45:
        angle = angle - 90

    return float(angle)


# ---------------------------------------------------------------------------
# STEP 2 — Resize
# ---------------------------------------------------------------------------

def resize_image(img: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = img.shape[:2]
    longest = max(h, w)

    if longest <= max_dim:
        return img  # already small enough, skip

    scale = max_dim / float(longest)
    new_w, new_h = int(w * scale), int(h * scale)
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


# ---------------------------------------------------------------------------
# STEP 3 — Brightness Correction
# ---------------------------------------------------------------------------

def correct_brightness(img: np.ndarray, brightness: float, config: Dict[str, Any]) -> np.ndarray:
    """
    Adaptive gamma correction to balance dark (under-exposed) or bright (over-exposed)
    images toward a target mean luminance (~128).
    """
    target = config.get("target_brightness", 128.0)

    if config["brightness_dark_threshold"] <= brightness <= config["brightness_bright_threshold"]:
        return img

    current_norm = max(brightness, 1.0) / 255.0
    target_norm = target / 255.0

    gamma = float(np.log(target_norm) / np.log(current_norm))
    gamma = float(np.clip(gamma, 0.35, 2.2))

    table = np.array([((i / 255.0) ** gamma) * 255.0 for i in range(256)]).astype("uint8")
    return cv2.LUT(img, table)


# ---------------------------------------------------------------------------
# STEP 4 — Contrast Enhancement & Dynamic Range Optimization
# ---------------------------------------------------------------------------

def enhance_contrast(img: np.ndarray, contrast: float, config: Dict[str, Any]) -> np.ndarray:
    """
    Adaptive contrast correction:
    - Low contrast (std < contrast_low_threshold): Min-Max stretch + CLAHE expansion.
    - High contrast (std > contrast_high_threshold): Dynamic range tone-smoothing CLAHE.
    """
    low_thresh = config["contrast_low_threshold"]
    high_thresh = config.get("contrast_high_threshold", 70.0)

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    if contrast < low_thresh:
        # Min-Max stretch on L channel (between 1st and 99th percentiles)
        p1, p99 = np.percentile(l_channel, (1, 99))
        if p99 > p1:
            l_channel = np.clip((l_channel.astype(float) - p1) * (255.0 / (p99 - p1)), 0, 255).astype(np.uint8)

        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        l_enhanced = clahe.apply(l_channel)

        merged = cv2.merge((l_enhanced, a_channel, b_channel))
        return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    elif contrast > high_thresh:
        # High contrast: tone compression using gentle CLAHE
        clahe = cv2.createCLAHE(clipLimit=1.2, tileGridSize=(8, 8))
        l_enhanced = clahe.apply(l_channel)

        merged = cv2.merge((l_enhanced, a_channel, b_channel))
        return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    return img


# ---------------------------------------------------------------------------
# STEP 5 — Adaptive Noise Removal
# ---------------------------------------------------------------------------

def remove_noise(img: np.ndarray, noise_sigma: float, config: Dict[str, Any]) -> np.ndarray:
    """
    Applies Non-Local Means denoising for heavily noisy images,
    or edge-preserving bilateral filtering for standard noise levels.
    """
    noise_thresh = config.get("noise_threshold", 10.0)

    if noise_sigma > 25.0:
        # Heavy noise (e.g. Gaussian / ISO noise variants)
        return cv2.fastNlMeansDenoisingColored(img, None, h=8, hColor=8, templateWindowSize=7, searchWindowSize=15)
    elif noise_sigma > noise_thresh:
        # Moderate noise
        return cv2.bilateralFilter(img, d=7, sigmaColor=50, sigmaSpace=50)
    else:
        # Mild / low noise
        return cv2.bilateralFilter(img, d=5, sigmaColor=30, sigmaSpace=30)


# ---------------------------------------------------------------------------
# STEP 6 — Deskew
# ---------------------------------------------------------------------------

def deskew(img: np.ndarray, angle: float) -> np.ndarray:
    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        img, matrix, (w, h),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
    )


# ---------------------------------------------------------------------------
# STEP 7 — Smart Sharpen
# ---------------------------------------------------------------------------

def sharpen(img: np.ndarray, noise_sigma: float) -> np.ndarray:
    """
    Edge-preserving unsharp mask. Sharpening is softened if high residual noise remains
    to prevent amplifying noise artifacts.
    """
    if noise_sigma > 25.0:
        blurred = cv2.GaussianBlur(img, (0, 0), sigmaX=2)
        return cv2.addWeighted(img, 1.2, blurred, -0.2, 0)
    else:
        blurred = cv2.GaussianBlur(img, (0, 0), sigmaX=3)
        return cv2.addWeighted(img, 1.4, blurred, -0.4, 0)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def preprocess_image(
    image: Union[str, bytes, np.ndarray],
    config: Optional[Dict[str, Any]] = None,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Runs the full adaptive preprocessing pipeline on a single image.

    Args:
        image: file path (str), raw bytes, or a decoded BGR numpy array.
        config: optional dict to override any key in DEFAULT_CONFIG.

    Returns:
        (processed_img, report)
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}

    img = load_image(image)
    steps_applied = []

    # --- Step 1: Quality assessment (on original image, before resize) ---
    gray_original = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    quality = assess_quality(gray_original, cfg)

    report: Dict[str, Any] = {
        "quality": quality,
        "steps_applied": steps_applied,
        "reject": False,
        "reject_reason": None,
    }

    if quality["is_too_small"]:
        report["reject"] = True
        report["reject_reason"] = (
            f"Image resolution too small "
            f"({quality['resolution']['width']}x{quality['resolution']['height']}). "
            f"Please recapture at a higher resolution."
        )
        return img, report

    if quality["is_too_blurry"]:
        report["reject"] = True
        report["reject_reason"] = (
            f"Image too blurry (blur_score={quality['blur_score']}, "
            f"threshold={cfg['blur_reject_threshold']}). Please recapture."
        )
        return img, report

    # --- Step 2: Resize (always, if needed — speeds up every later step) ---
    resized = resize_image(img, cfg["resize_max_dim"])
    if resized.shape[:2] != img.shape[:2]:
        steps_applied.append("resize")
    img = resized

    # --- Step 3: Brightness correction ---
    if quality["brightness"] < cfg["brightness_dark_threshold"] or quality["brightness"] > cfg["brightness_bright_threshold"]:
        img = correct_brightness(img, quality["brightness"], cfg)
        steps_applied.append(f"adaptive_brightness_gamma(target={cfg['target_brightness']})")

    # --- Step 4: Contrast enhancement ---
    if quality["contrast"] < cfg["contrast_low_threshold"]:
        img = enhance_contrast(img, quality["contrast"], cfg)
        steps_applied.append("contrast_expansion_minmax_clahe")
    elif quality["contrast"] > cfg["contrast_high_threshold"]:
        img = enhance_contrast(img, quality["contrast"], cfg)
        steps_applied.append("contrast_compression_clahe")

    # --- Step 5: Noise removal ---
    if quality["noise_sigma"] > cfg["noise_threshold"]:
        img = remove_noise(img, quality["noise_sigma"], cfg)
        steps_applied.append(f"adaptive_denoising(sigma={quality['noise_sigma']})")

    # --- Step 6: Deskew ---
    if abs(quality["skew_angle_deg"]) > cfg["skew_ignore_threshold"]:
        img = deskew(img, quality["skew_angle_deg"])
        steps_applied.append(f"deskew({quality['skew_angle_deg']:.1f}deg)")

    # --- Step 7: Sharpen ---
    img = sharpen(img, quality["noise_sigma"])
    steps_applied.append("smart_sharpen")

    return img, report


# ---------------------------------------------------------------------------
# Quick manual test: `python preprocessing.py path/to/image.jpg`
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python preprocessing.py <image_path>")
        sys.exit(1)

    processed, rep = preprocess_image(sys.argv[1])
    print(rep)

    if not rep["reject"]:
        out_path = "processed_output.jpg"
        cv2.imwrite(out_path, processed)
        print(f"Saved processed image to {out_path}")