"""
readability.py
---------------
Measures HOW READABLE the image and each extracted declaration are.
This is a different job from preprocessing.py: preprocessing.py improves
the image; readability.py never touches pixels, it only scores them.

IMPORTANT ARCHITECTURAL BOUNDARY: this module never estimates physical
font size (mm) and never makes a Legal Metrology font-height compliance
decision. It reports `relative_text_height` — how tall a field's text is
relative to the *photo*, which depends on camera distance and therefore
says nothing about the physical/printed size of the text. Physical
height estimation (px -> mm) and the pass/fail against Legal Metrology's
1/2/4/6 mm thresholds belongs entirely to a downstream `font.py` module.
Pipeline shape:

    preprocessing.py -> ocr.py -> normalizer.py -> validator.py
        -> readability.py (this file: "can a human read it?")
        -> font.py ("is the declaration's physical height legally sufficient?")
        -> rule_engine.py (final compliance report)

Three things are produced:

    1. image_quality      — one score for the whole processed image
                             (blur, brightness, contrast, edge density,
                             noise, OCR confidence, resolution, rotation),
                             plus text_occupancy, a best-effort
                             perspective_distortion estimate, and a
                             photo_diagnosis section naming the primary/
                             secondary issue and an aggregated,
                             deduplicated recommendation.

    2. field_visibility   — one score PER extracted field, computed on
                             just that field's cropped region, with its
                             own risk bucket, reasons, an aggregated
                             recommendation, and occlusion/clipping flags.

    3. overall_readability — a small pipeline-friendly summary (score,
                             grade, human_readable, retake_required,
                             major_issue) for callers that don't want to
                             walk the full report.

Nothing in here decides Legal Metrology compliance of any kind — that's
the rule engine (and font.py) downstream. This module only produces
evidence about how much to trust what was extracted and whether a human
could read it.

Usage:
    from readability import compute_readability

    readability_report = compute_readability(
        image=processed_img,              # np.ndarray, BGR (post preprocessing.py)
        detections=ocr_payload["detections"],
        structured_data=ocr_payload["structured_data"],
        ocr_average_confidence=ocr_payload["metrics"]["average_confidence"],
    )
"""

from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple

import re
import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Config — tune against your own dataset, same spirit as preprocessing.py's
# DEFAULT_CONFIG and ocr.py's FIELD_VALUE_PATTERNS. Nearly every constant
# used below lives here (rather than inline in the algorithms) so a caller
# can retune the module for a new dataset/camera setup without touching code.
# ---------------------------------------------------------------------------

DEFAULT_READABILITY_CONFIG: Dict[str, Any] = {
    # Blur (Laplacian variance) normalization ceiling — a crop/image at or
    # above this variance scores a full 100 on the blur component.
    "blur_score_ceiling": 250.0,

    # Ideal brightness (mean pixel value, 0-255) — deviation from this
    # linearly reduces the brightness component.
    "target_brightness": 128.0,

    # Contrast (std deviation of grayscale pixels) normalization ceiling.
    "contrast_score_ceiling": 80.0,

    # Edge density (fraction of Canny edge pixels in a crop) normalization
    # ceiling — text sitting on a background with too little edge contrast
    # can still look "sharp" on blur/contrast alone, so this catches text
    # that risks disappearing into the background.
    "edge_density_score_ceiling": 0.15,
    # Canny thresholds shared by edge-density scoring and the perspective
    # contour search.
    "canny_threshold1": 50.0,
    "canny_threshold2": 150.0,

    # Noise (Immerkær fast noise-sigma estimate) normalization ceiling —
    # higher raw noise scores lower. Re-tune if you change the estimator.
    "noise_score_ceiling": 10.0,

    # A pixel (0-255 grayscale) at or above this is treated as blown-out /
    # specular highlight for glare detection.
    "glare_pixel_threshold": 245,
    # Fraction of glare pixels in a region above which glare is treated as
    # a readability problem.
    "glare_ratio_cap_threshold": 0.03,
    # Score cap applied when glare exceeds the threshold above (image or
    # field level) — glare degrades legibility in a way that isn't fully
    # captured by blur/contrast/edge alone.
    "glare_penalty_score_cap": 65.0,

    # Grid size used to sample block-mean brightness for shadow detection.
    "illumination_grid_size": 8,
    # Std of block-mean brightness above which lighting is considered
    # uneven enough to suggest a shadow across the packaging.
    "illumination_variance_cap_threshold": 40.0,
    "shadow_penalty_score_cap": 65.0,

    # Whole-image component weights (sum to 1.0). OCR confidence is
    # deliberately capped well under half — a confident OCR guess on
    # blurry text doesn't mean a human can read it.
    "image_weights": {
        "blur": 0.25,
        "brightness": 0.15,
        "contrast": 0.15,
        "edge_density": 0.10,
        "noise": 0.10,
        "ocr_confidence": 0.25,
    },

    # Per-field crop component weights (sum to 1.0). Blur is weighted
    # highest and OCR confidence reduced relative to the first cut of this
    # module: a 99%-confident OCR read on an unreadably blurry crop should
    # not score as "clear".
    "field_weights": {
        "blur": 0.35,
        "contrast": 0.15,
        "edge_density": 0.10,
        "noise": 0.15,
        "ocr_confidence": 0.25,
    },

    # Score thresholds -> status buckets, shared by image and field level.
    "status_clear_threshold": 80.0,
    "status_readable_threshold": 65.0,
    "status_difficult_threshold": 50.0,

    # Visibility-score thresholds -> risk buckets for a field.
    "risk_low_threshold": 80.0,
    "risk_medium_threshold": 50.0,
    # CRITICAL overrides the score-based bucket entirely: a field this
    # unreliable (or with no crop to inspect at all) is flagged regardless
    # of what the weighted score says.
    "risk_critical_score_threshold": 25.0,
    "risk_critical_ocr_confidence_threshold": 0.3,

    # A crop smaller than this (either dimension, px) is considered too
    # small to score reliably regardless of its other metrics.
    "min_crop_dimension_px": 8,

    # Padding added around a field's detected bbox before cropping, so
    # letters touching the raw box edge don't distort the crop metrics.
    "crop_padding_px": 5,

    # Minimum resolution (shorter side, px) for the whole image to count
    # as "GOOD" resolution rather than "LOW".
    "min_good_resolution_px": 600,

    # Average/per-field OCR box tilt (degrees off axis-aligned) above
    # which rotation is treated as a readability problem.
    "max_acceptable_rotation_degrees": 10.0,
    # A whole image whose average detection tilt exceeds the threshold
    # above has its combined score capped at this value, similar to the
    # low-resolution cap.
    "rotation_penalty_score_cap": 70.0,

    # Perspective-distortion estimation tuning (see
    # _compute_perspective_distortion for how each is used).
    "perspective_min_contour_area_fraction": 0.1,
    "perspective_approx_epsilon_factor": 0.02,
    "perspective_quad_score_scale": 200.0,
    "perspective_baseline_score_scale": 8.0,

    # If a field is entirely undetected but the document's average OCR
    # confidence is at/above this, the rest of the photo is evidently
    # readable — so the more likely explanation is that this specific
    # field is occluded, folded away, or outside the frame, not that the
    # photo itself is poor quality.
    "occlusion_suspect_ocr_confidence_threshold": 0.6,

    # A field's bbox within this many pixels of the image edge is flagged
    # as possibly clipped/incomplete.
    "clipped_edge_margin_px": 2,
}


# ---------------------------------------------------------------------------
# Structured recommendation libraries
# ---------------------------------------------------------------------------

# Field-level: keyed by the exact string used in a field's `reasons` list.
RECOMMENDATION_LIBRARY: Dict[str, Dict[str, Any]] = {
    "Very blurry": {
        "summary": "This declaration is too blurry to read reliably.",
        "actions": [
            "Hold the camera steady and refocus before retaking.",
            "Move closer instead of relying on digital zoom.",
        ],
    },
    "Low contrast": {
        "summary": "Text and background have too little contrast here.",
        "actions": [
            "Improve lighting to increase contrast against the background.",
            "Avoid a capture angle that washes out the text.",
        ],
    },
    "Text blending into background": {
        "summary": "Text edges are too soft to separate from the background.",
        "actions": [
            "Capture under better, more even lighting.",
            "Avoid glossy or laminated glare that softens edges.",
        ],
    },
    "Noisy image": {
        "summary": "This crop is grainy or shows compression artifacts.",
        "actions": [
            "Use better lighting so the camera doesn't need a high ISO.",
            "Avoid heavy digital zoom or over-compression.",
        ],
    },
    "Low OCR confidence": {
        "summary": "OCR could not read this text reliably.",
        "actions": [
            "Retake the image with better focus and lighting.",
            "Make sure the declaration is fully inside the frame.",
        ],
    },
    "Small crop / text too small": {
        "summary": "This declaration is too small in the frame to assess reliably.",
        "actions": ["Capture the image closer to this declaration."],
    },
    "Tilted text": {
        "summary": "This text is tilted, which can reduce OCR reliability.",
        "actions": ["Align the label flat and reduce tilt when capturing."],
    },
    "Glare / reflection over text": {
        "summary": "Reflection or glare is obscuring this text.",
        "actions": [
            "Disable flash or move it away from the reflective surface.",
            "Tilt the package slightly to avoid direct reflections.",
            "Retake in diffuse, indirect lighting.",
        ],
    },
    "Text crop touches image edge — possibly clipped/incomplete": {
        "summary": "Part of this declaration may be cut off at the edge of the photo.",
        "actions": ["Recapture with the full declaration inside the frame, away from the image border."],
    },
    "Rest of image reads well — this field may be occluded or outside the frame rather than a photo-quality issue": {
        "summary": "This declaration wasn't found even though the rest of the image reads well.",
        "actions": [
            "Check that nothing (a finger, sticker, or wrapping) is covering this declaration.",
            "Confirm the declaration is present and inside the frame.",
        ],
    },
    "No matching OCR region found for this value": {
        "summary": "Couldn't locate a specific region backing this value.",
        "actions": ["Retake ensuring this declaration is clearly separated from surrounding text."],
    },
    "Matching detection has no bounding box": {
        "summary": "OCR found this text but without a location to inspect visually.",
        "actions": ["Retake with better focus and lighting."],
    },
    "Field not detected": {
        "summary": "This declaration wasn't found anywhere in the image.",
        "actions": [
            "Ensure this declaration is visible and legible in the photo.",
            "Check that it isn't occluded, folded away, or outside the frame.",
        ],
    },
}

# Image-level: keyed by photo_diagnosis issue name.
IMAGE_ISSUE_LIBRARY: Dict[str, Dict[str, Any]] = {
    "Blur": {
        "summary": "The image is too blurry to read reliably.",
        "actions": ["Hold the camera steady and refocus before retaking."],
    },
    "Low Lighting": {
        "summary": "The image is too dark.",
        "actions": [
            "Increase ambient lighting.",
            "Avoid backlighting.",
            "Disable flash reflection.",
            "Retake closer to the declaration.",
        ],
    },
    "Low Contrast": {
        "summary": "Text and background have too little contrast overall.",
        "actions": ["Improve lighting or angle to increase contrast between text and background."],
    },
    "Text Blending Into Background": {
        "summary": "Text is blending into the background across the image.",
        "actions": ["Capture under better lighting so text edges stand out clearly."],
    },
    "Noisy Image": {
        "summary": "The image has visible grain or compression artifacts.",
        "actions": [
            "Improve lighting so a high ISO isn't needed.",
            "Avoid digital zoom; move the camera physically closer instead.",
        ],
    },
    "Low Resolution": {
        "summary": "The image resolution is too low for reliable reading.",
        "actions": ["Move closer or use a higher-resolution camera."],
    },
    "Tilted Capture": {
        "summary": "The photo is tilted relative to the packaging.",
        "actions": ["Align the label flat and reduce tilt when capturing."],
    },
    "Glare / Reflection": {
        "summary": "Reflection or glare is washing out parts of the image.",
        "actions": [
            "Disable flash or move it away from reflective surfaces.",
            "Tilt the package to avoid direct reflections.",
            "Use diffuse, indirect lighting.",
        ],
    },
    "Uneven Lighting / Shadow": {
        "summary": "Lighting is uneven across the image, causing shadowed regions.",
        "actions": [
            "Use even, diffuse lighting from multiple angles.",
            "Avoid direct overhead light that casts hard shadows.",
        ],
    },
}


# ---------------------------------------------------------------------------
# Config handling
# ---------------------------------------------------------------------------

def _deep_merge_config(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merges `override` onto a deep copy of `base`. A plain
    `{**base, **override}` shallow merge would replace nested dicts (like
    image_weights/field_weights) wholesale, so passing
    `config={"image_weights": {"blur": 0.3}}` would silently drop
    brightness/contrast/noise/ocr_confidence from the merged weights. This
    updates matching nested dicts key-by-key instead."""
    merged = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_config(merged[key], value)
        else:
            merged[key] = value
    return merged


# ---------------------------------------------------------------------------
# Shared scoring primitives
# ---------------------------------------------------------------------------

def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _score_blur(blur_var: float, ceiling: float) -> float:
    """Higher Laplacian variance = sharper = higher score."""
    if ceiling <= 0:
        return 0.0
    return _clamp((blur_var / ceiling) * 100.0)


def _score_brightness(brightness: float, target: float) -> float:
    """Score drops the further brightness is from the target midpoint,
    in either direction (too dark or too bright both hurt)."""
    deviation = abs(brightness - target)
    return _clamp(100.0 - (deviation / target) * 100.0)


def _score_contrast(contrast_std: float, ceiling: float) -> float:
    if ceiling <= 0:
        return 0.0
    return _clamp((contrast_std / ceiling) * 100.0)


def _score_edge_density(edge_density: float, ceiling: float) -> float:
    """Higher edge density = text/graphics stand out from the background
    more crisply = higher score."""
    if ceiling <= 0:
        return 0.0
    return _clamp((edge_density / ceiling) * 100.0)


def _score_noise(noise_level: float, ceiling: float) -> float:
    """Lower noise = higher score."""
    if ceiling <= 0:
        return 100.0
    return _clamp(100.0 - (noise_level / ceiling) * 100.0)


def _status_for_score(score: float, config: Dict[str, Any]) -> str:
    """Four-tier readability vocabulary shared by image- and field-level
    output: CLEAR / READABLE / DIFFICULT / UNREADABLE."""
    if score >= config["status_clear_threshold"]:
        return "CLEAR"
    if score >= config["status_readable_threshold"]:
        return "READABLE"
    if score >= config["status_difficult_threshold"]:
        return "DIFFICULT"
    return "UNREADABLE"


def _risk_for_field(
    score: float,
    config: Dict[str, Any],
    raw_ocr_confidence: Optional[float] = None,
    crop_missing: bool = False,
) -> str:
    """LOW / MEDIUM / HIGH from the score, escalated straight to CRITICAL
    when the score is very low, OCR confidence itself is very low, or
    there was no crop to inspect at all — any one of those alone is
    reason enough not to trust the field."""
    if (
        crop_missing
        or score < config["risk_critical_score_threshold"]
        or (raw_ocr_confidence is not None and raw_ocr_confidence < config["risk_critical_ocr_confidence_threshold"])
    ):
        return "CRITICAL"
    if score >= config["risk_low_threshold"]:
        return "LOW"
    if score >= config["risk_medium_threshold"]:
        return "MEDIUM"
    return "HIGH"


def _compute_noise_level(gray: np.ndarray) -> float:
    """Fast O(n) noise-sigma estimate (Immerkær, 1996): convolve with a
    zero-sum Laplacian-like kernel and scale the mean absolute response.
    This deliberately replaces a non-local-means denoise-and-diff
    approach — NLM is accurate but expensive, and this module may run it
    once per field on documents with dozens of declarations, so a single
    cheap convolution per crop matters a lot more than a marginally more
    accurate but much slower estimate."""
    h, w = gray.shape[:2]
    if h < 3 or w < 3:
        return 0.0
    laplacian_kernel = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float64)
    conv = cv2.filter2D(gray.astype(np.float64), -1, laplacian_kernel)
    sigma = np.sqrt(np.pi / 2.0) / (6.0 * (w - 2) * (h - 2)) * np.sum(np.abs(conv))
    return float(sigma)


def _compute_glare_ratio(gray: np.ndarray, threshold: int) -> float:
    """Fraction of near-blown-out (specular highlight) pixels — flash
    reflections off plastic/foil/lamination can leave OCR confidence high
    while a human still can't read the text underneath the glare."""
    if gray.size == 0:
        return 0.0
    return float(np.count_nonzero(gray >= threshold)) / float(gray.size)


def _compute_illumination_variance(gray: np.ndarray, grid_size: int) -> float:
    """Std of brightness across a coarse grid of the image — a
    fronto-lit, evenly exposed photo has a low value; a photo with a hard
    shadow across part of the packaging has a high one."""
    grid_size = max(2, int(grid_size))
    small = cv2.resize(gray, (grid_size, grid_size), interpolation=cv2.INTER_AREA)
    return float(np.std(small))


def _compute_crop_metrics(
    crop: np.ndarray,
    glare_pixel_threshold: int = 245,
    canny_threshold1: float = 50.0,
    canny_threshold2: float = 150.0,
) -> Dict[str, float]:
    """Raw (unnormalized) blur/brightness/contrast/edge-density/noise/
    glare metrics for any image or crop — same formulas preprocessing.py
    already uses for the whole-image quality assessment, applied here to
    arbitrary regions."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    edges = cv2.Canny(gray, canny_threshold1, canny_threshold2)
    edge_density = float(np.count_nonzero(edges)) / float(edges.size) if edges.size else 0.0
    noise = _compute_noise_level(gray)
    glare_ratio = _compute_glare_ratio(gray, glare_pixel_threshold)
    return {
        "blur": blur_var,
        "brightness": brightness,
        "contrast": contrast,
        "edge_density": edge_density,
        "noise": noise,
        "glare_ratio": glare_ratio,
    }


def _compute_bbox_angle(bbox: List[Any]) -> Optional[float]:
    """Best-effort tilt (degrees, 0-45) of a detection's bounding box off
    horizontal/vertical, via cv2.minAreaRect. Returns None if the bbox is
    degenerate."""
    try:
        pts = np.array(bbox, dtype=np.float32)
        if pts.shape[0] < 3:
            return None
        rect = cv2.minAreaRect(pts)
        angle = abs(rect[-1])
        # Normalize OpenCV's angle convention to a 0-45 "tilt off axis"
        # value regardless of which side minAreaRect measured from.
        if angle > 45:
            angle = 90 - angle
        return float(angle)
    except Exception:
        return None


def _collect_detection_angles(detections: List[Dict[str, Any]]) -> List[float]:
    angles = []
    for d in detections or []:
        bbox = d.get("bbox")
        if not bbox:
            continue
        angle = _compute_bbox_angle(bbox)
        if angle is not None:
            angles.append(angle)
    return angles


def _average_rotation_angle(detections: List[Dict[str, Any]]) -> Optional[float]:
    angles = _collect_detection_angles(detections)
    if not angles:
        return None
    return float(np.mean(angles))


def _compute_baseline_deviation(detections: List[Dict[str, Any]]) -> Optional[float]:
    """Spread (std) of individual detection tilt angles. A single global
    quadrilateral (see _compute_perspective_distortion) only works for
    flat documents; on curved/cylindrical packaging (bottles, pouches,
    tubes) OCR baselines drift by different amounts across the surface,
    so their angle spread is a usable stand-in signal for perspective/
    curvature distortion when no flat contour can be found."""
    angles = _collect_detection_angles(detections)
    if len(angles) < 2:
        return None
    return float(np.std(angles))


def _compute_text_occupancy(detections: List[Dict[str, Any]], image_shape) -> Optional[float]:
    """Total detected-text area as a fraction of the whole image area —
    catches the case where OCR succeeds but the text is so small a human
    inspector could never read it at a glance."""
    h, w = image_shape[:2]
    image_area = float(h * w)
    if image_area <= 0:
        return None
    total_text_area = 0.0
    for d in detections or []:
        bbox = d.get("bbox")
        if not bbox:
            continue
        try:
            pts = np.array(bbox, dtype=np.float32)
            total_text_area += abs(float(cv2.contourArea(pts)))
        except Exception:
            continue
    return round(total_text_area / image_area, 6)


def _compute_perspective_distortion(
    image: np.ndarray,
    detections: List[Dict[str, Any]],
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """Best-effort estimate of how far the photographed package deviates
    from a fronto-parallel rectangle. Primary method: find the largest
    quadrilateral contour and compare opposite side lengths (works well
    for flat documents/labels). That method structurally can't handle
    curved packaging — bottles, pouches, chip packets — so when no clean
    quadrilateral is found, falls back to the spread of individual OCR
    baseline angles as a rougher distortion signal. Reports
    detected=False only when neither signal is available, rather than
    guessing.

    Caveat (largest-contour selection): on cluttered backgrounds the
    largest external contour can be a table edge, a hand, or a cast
    shadow rather than the package itself. This is a known limitation of
    the single-largest-contour heuristic; a production deployment should
    constrain the search to the pipeline's known package region (e.g. the
    crop preprocessing.py already isolated) rather than the raw frame."""
    baseline_dev = _compute_baseline_deviation(detections or [])

    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, config["canny_threshold1"], config["canny_threshold2"])
        edges = cv2.dilate(edges, None, iterations=1)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        image_area = gray.shape[0] * gray.shape[1]
        largest = max(contours, key=cv2.contourArea) if contours else None

        if largest is not None and cv2.contourArea(largest) >= config["perspective_min_contour_area_fraction"] * image_area:
            peri = cv2.arcLength(largest, True)
            approx = cv2.approxPolyDP(largest, config["perspective_approx_epsilon_factor"] * peri, True)
            if len(approx) == 4:
                pts = approx.reshape(4, 2).astype(float)

                def _dist(a, b):
                    return float(np.linalg.norm(a - b))

                d01, d12 = _dist(pts[0], pts[1]), _dist(pts[1], pts[2])
                d23, d30 = _dist(pts[2], pts[3]), _dist(pts[3], pts[0])
                ratio_a = (min(d01, d23) / max(d01, d23)) if max(d01, d23) > 0 else 1.0
                ratio_b = (min(d12, d30) / max(d12, d30)) if max(d12, d30) > 0 else 1.0
                symmetry = (ratio_a + ratio_b) / 2.0  # 1.0 = no skew

                return {
                    "score": round(_clamp((1.0 - symmetry) * config["perspective_quad_score_scale"])),
                    "detected": True,
                    "method": "quadrilateral_symmetry",
                    "baseline_angle_variation_degrees": round(baseline_dev, 2) if baseline_dev is not None else None,
                    "note": None,
                }
    except Exception:
        pass

    # Fall back to baseline-angle spread for non-flat/undetected-contour cases.
    if baseline_dev is not None:
        return {
            "score": round(_clamp(baseline_dev * config["perspective_baseline_score_scale"])),
            "detected": True,
            "method": "baseline_angle_variance",
            "baseline_angle_variation_degrees": round(baseline_dev, 2),
            "note": "estimated from OCR baseline angle spread — no flat document contour found "
                    "(expected for bottles, pouches, and other non-flat packaging)",
        }

    return {
        "score": None,
        "detected": False,
        "method": None,
        "baseline_angle_variation_degrees": None,
        "note": "no document contour or sufficient OCR detections to estimate perspective",
    }


def _aggregate_recommendations(
    issue_names: List[str],
    library: Dict[str, Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Merges every matching library entry for the given issue names into
    one recommendation instead of returning only the first match — a
    field that's simultaneously blurry, glared, and clipped should surface
    all three, not just whichever reason happened to be checked first.
    Summaries and actions are deduplicated while preserving first-seen
    order."""
    matched = [library[name] for name in issue_names if name in library]
    if not matched:
        return None
    summaries: List[str] = []
    actions: List[str] = []
    for entry in matched:
        if entry["summary"] not in summaries:
            summaries.append(entry["summary"])
        for action in entry.get("actions", []):
            if action not in actions:
                actions.append(action)
    return {"summary": " ".join(summaries), "actions": actions}


def _diagnose_photo_quality(
    component_scores: Dict[str, float],
    resolution_status: str,
    rotation_angle: Optional[float],
    glare_ratio: Optional[float],
    illumination_variance: Optional[float],
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """Turns the component scores into a plain-language 'what's wrong and
    what to do about it' summary. primary_issue/secondary_issue are
    ranked by severity (lowest score/most severe first); the
    recommendation aggregates advice across *all* detected issues, not
    just the primary one."""
    issues: List[Tuple[str, float]] = []

    if component_scores.get("blur", 100.0) < config["status_difficult_threshold"]:
        issues.append(("Blur", component_scores["blur"]))
    if component_scores.get("brightness", 100.0) < config["status_difficult_threshold"]:
        issues.append(("Low Lighting", component_scores["brightness"]))
    if component_scores.get("contrast", 100.0) < config["status_difficult_threshold"]:
        issues.append(("Low Contrast", component_scores["contrast"]))
    if component_scores.get("edge_density", 100.0) < config["status_difficult_threshold"]:
        issues.append(("Text Blending Into Background", component_scores["edge_density"]))
    if component_scores.get("noise", 100.0) < config["status_difficult_threshold"]:
        issues.append(("Noisy Image", component_scores["noise"]))
    if resolution_status == "LOW":
        issues.append(("Low Resolution", 0.0))
    if rotation_angle is not None and rotation_angle > config["max_acceptable_rotation_degrees"]:
        issues.append(("Tilted Capture", 100.0 - rotation_angle))
    if glare_ratio is not None and glare_ratio > config["glare_ratio_cap_threshold"]:
        issues.append(("Glare / Reflection", 100.0 - _clamp(glare_ratio * 1000.0)))
    if illumination_variance is not None and illumination_variance > config["illumination_variance_cap_threshold"]:
        issues.append(("Uneven Lighting / Shadow", 100.0 - _clamp(illumination_variance)))

    if not issues:
        return {
            "primary_issue": None,
            "secondary_issue": None,
            "recommendation": {"summary": "Image quality is sufficient; no retake needed.", "actions": []},
        }

    issues.sort(key=lambda item: item[1])
    primary_name = issues[0][0]
    secondary_name = issues[1][0] if len(issues) > 1 else None
    all_names = [name for name, _ in issues]

    return {
        "primary_issue": primary_name,
        "secondary_issue": secondary_name,
        "recommendation": _aggregate_recommendations(all_names, IMAGE_ISSUE_LIBRARY)
        or {"summary": f"{primary_name} detected.", "actions": ["Retake the image."]},
    }


def _field_reasons(
    blur_score: Optional[float],
    contrast_score: Optional[float],
    edge_score: Optional[float],
    noise_score: Optional[float],
    ocr_conf_score: Optional[float],
    relative_text_height: Optional[float],
    rotation_angle: Optional[float],
    glare_ratio: Optional[float],
    config: Dict[str, Any],
) -> List[str]:
    reasons: List[str] = []
    if blur_score is not None and blur_score < config["status_difficult_threshold"]:
        reasons.append("Very blurry")
    if contrast_score is not None and contrast_score < config["status_difficult_threshold"]:
        reasons.append("Low contrast")
    if edge_score is not None and edge_score < config["status_difficult_threshold"]:
        reasons.append("Text blending into background")
    if noise_score is not None and noise_score < config["status_difficult_threshold"]:
        reasons.append("Noisy image")
    if ocr_conf_score is not None and ocr_conf_score < config["status_difficult_threshold"]:
        reasons.append("Low OCR confidence")
    if relative_text_height is not None and relative_text_height < 0.02:
        reasons.append("Small crop / text too small")
    if rotation_angle is not None and rotation_angle > config["max_acceptable_rotation_degrees"]:
        reasons.append("Tilted text")
    if glare_ratio is not None and glare_ratio > config["glare_ratio_cap_threshold"]:
        reasons.append("Glare / reflection over text")
    return reasons


# ---------------------------------------------------------------------------
# Step 2 — whole-image quality
# ---------------------------------------------------------------------------

def compute_image_quality(
    image: np.ndarray,
    detections: Optional[List[Dict[str, Any]]] = None,
    ocr_average_confidence: Optional[float] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Scores the WHOLE processed image: blur, brightness, contrast, edge
    density, noise, OCR confidence, resolution, and rotation. Also
    reports text_occupancy, a best-effort perspective_distortion
    diagnostic, and a photo_diagnosis summary with an aggregated
    recommendation.
    """
    cfg = _deep_merge_config(DEFAULT_READABILITY_CONFIG, config or {})
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image

    metrics = _compute_crop_metrics(
        image,
        glare_pixel_threshold=cfg["glare_pixel_threshold"],
        canny_threshold1=cfg["canny_threshold1"],
        canny_threshold2=cfg["canny_threshold2"],
    )
    blur_score = _score_blur(metrics["blur"], cfg["blur_score_ceiling"])
    brightness_score = _score_brightness(metrics["brightness"], cfg["target_brightness"])
    contrast_score = _score_contrast(metrics["contrast"], cfg["contrast_score_ceiling"])
    edge_score = _score_edge_density(metrics["edge_density"], cfg["edge_density_score_ceiling"])
    noise_score = _score_noise(metrics["noise"], cfg["noise_score_ceiling"])

    # OCR confidence is already 0-1; missing -> don't silently score 0 for a
    # dimension we have no evidence on, fall back to a neutral midpoint.
    ocr_conf_score = (ocr_average_confidence * 100.0) if ocr_average_confidence is not None else 50.0

    weights = cfg["image_weights"]
    combined = (
        weights["blur"] * blur_score
        + weights["brightness"] * brightness_score
        + weights["contrast"] * contrast_score
        + weights["edge_density"] * edge_score
        + weights["noise"] * noise_score
        + weights["ocr_confidence"] * ocr_conf_score
    )

    resolution_status = "GOOD" if min(h, w) >= cfg["min_good_resolution_px"] else "LOW"
    # A low-resolution image caps the overall score — resolution isn't one
    # of the weighted components, but it's a hard ceiling: no amount of
    # sharpness/contrast makes a 200px-wide photo actually readable.
    if resolution_status == "LOW":
        combined = min(combined, 60.0)

    rotation_angle = _average_rotation_angle(detections or [])
    # A heavily tilted capture likewise caps the score rather than being
    # folded into the weighted average, since tilt degrades every field
    # roughly uniformly regardless of what the other components say.
    if rotation_angle is not None and rotation_angle > cfg["max_acceptable_rotation_degrees"]:
        combined = min(combined, cfg["rotation_penalty_score_cap"])

    # Glare and shadow are likewise treated as hard ceilings rather than
    # weighted components: a bright reflection or a hard shadow can leave
    # the other metrics looking fine while still hiding the text.
    if metrics["glare_ratio"] > cfg["glare_ratio_cap_threshold"]:
        combined = min(combined, cfg["glare_penalty_score_cap"])
    illumination_variance = _compute_illumination_variance(gray, cfg["illumination_grid_size"])
    if illumination_variance > cfg["illumination_variance_cap_threshold"]:
        combined = min(combined, cfg["shadow_penalty_score_cap"])

    text_occupancy = _compute_text_occupancy(detections or [], image.shape)
    perspective = _compute_perspective_distortion(image, detections or [], cfg)

    score = round(_clamp(combined))

    photo_diagnosis = _diagnose_photo_quality(
        component_scores={
            "blur": blur_score,
            "brightness": brightness_score,
            "contrast": contrast_score,
            "edge_density": edge_score,
            "noise": noise_score,
        },
        resolution_status=resolution_status,
        rotation_angle=rotation_angle,
        glare_ratio=metrics["glare_ratio"],
        illumination_variance=illumination_variance,
        config=cfg,
    )

    return {
        "score": score,
        "status": _status_for_score(score, cfg),
        "blur": round(metrics["blur"], 2),
        "brightness": round(metrics["brightness"], 2),
        "contrast": round(metrics["contrast"], 2),
        "edge_density": round(metrics["edge_density"], 4),
        "noise": round(metrics["noise"], 2),
        "glare_ratio": round(metrics["glare_ratio"], 4),
        "illumination_variance": round(illumination_variance, 2),
        "ocr_confidence": round(ocr_average_confidence, 4) if ocr_average_confidence is not None else None,
        "resolution": resolution_status,
        "resolution_px": {"width": int(w), "height": int(h)},
        "rotation_angle_degrees": round(rotation_angle, 2) if rotation_angle is not None else None,
        "text_occupancy": text_occupancy,
        "perspective_distortion": perspective,
        "photo_diagnosis": photo_diagnosis,
    }


# ---------------------------------------------------------------------------
# Step 4 — per-declaration (field) visibility
# ---------------------------------------------------------------------------

def _find_detection_for_value(
    field_name: str,
    value: Any,
    detections: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    Locates the OCR detection that produced a given structured_data value,
    so its bbox can be cropped for field-level scoring. Tries, in order:
        1. A detection explicitly tagged for this exact field (ROI-recovered
           fields carry "roi_recovered_for" == field_name in ocr.py's
           output).
        2. An exact clean_text match.
        3. A substring match (handles multi-line/corrected values where the
           structured value is a joined or lightly-edited version of the
           original detected line).
    Returns None if nothing lines up — the caller falls back to a
    text-only score using the document's average OCR confidence instead
    of failing outright.
    """
    if value is None:
        return None

    if isinstance(value, dict):
        value_str = str(value.get("normalized") or value.get("value") or value.get("raw") or "")
    else:
        value_str = str(value)

    value_norm = value_str.strip().lower()
    if not value_norm or value_norm == "unknown":
        return None

    # 1. Exact field recovery tag
    for d in detections:
        if d.get("roi_recovered_for") == field_name:
            return d

    # 2. Exact clean_text match
    for d in detections:
        if str(d.get("clean_text", "")).strip().lower() == value_norm:
            return d

    # 3. Compact whitespace & punctuation match (handles e.g. "200 g" vs "200g", "Rs. 100" vs "Rs.100")
    val_compact = re.sub(r"[\s\.:\-_,/]+", "", value_norm)
    if val_compact:
        for d in detections:
            d_compact = re.sub(r"[\s\.:\-_,/]+", "", str(d.get("clean_text", "")).lower())
            if d_compact and (val_compact == d_compact or val_compact in d_compact or d_compact in val_compact):
                return d

    # 4. Field-specific numeric quantity matching for net_quantity
    if field_name == "net_quantity":
        num_m = re.search(r"\d+(?:\.\d+)?", value_norm)
        if num_m:
            num_str = num_m.group(0)
            # Find detection containing this quantity number and standard unit/quantity keywords
            for d in detections:
                t = str(d.get("clean_text", "")).lower()
                if num_str in t and any(kw in t for kw in ["g", "gm", "kg", "ml", "l", "ltr", "net", "qty", "wt", "weight", "quantity", "n"]):
                    return d
            for d in detections:
                t = str(d.get("clean_text", "")).lower()
                if num_str in t:
                    return d

    # 5. Field-specific numeric matching for mrp
    if field_name == "mrp":
        num_m = re.search(r"\d+(?:\.\d+)?", value_norm)
        if num_m:
            num_str = num_m.group(0)
            for d in detections:
                t = str(d.get("clean_text", "")).lower()
                if num_str in t and any(kw in t for kw in ["mrp", "rs", "₹", "inr", "/-", "incl"]):
                    return d

    # 6. General substring match
    for d in detections:
        text = str(d.get("clean_text", "")).strip().lower()
        if text and (value_norm in text or text in value_norm):
            return d

    return None


def compute_field_visibility(
    image: np.ndarray,
    field_name: str,
    value: Any,
    detections: List[Dict[str, Any]],
    ocr_average_confidence: Optional[float] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Scores ONE extracted field by cropping just its region (when a
    matching detection/bbox can be found) and measuring blur/contrast/
    edge density/noise/OCR confidence on that crop alone. Also reports:

        - relative_text_height: this field's crop height as a fraction of
          the *photo's* height — NOT a font-size or physical measurement.
          It moves with camera distance, so it says nothing about the
          printed text's real-world size. Physical height (mm) and any
          Legal Metrology font-size compliance decision belongs in a
          separate font.py module, never here.
        - risk / reasons / recommendation: a plain-language explanation of
          why the field scored the way it did and what to do about it,
          aggregated across every issue found (not just the first one).
        - possibly_clipped / possible_occlusion: heuristic flags for two
          failure modes a pure quality score can't distinguish on its own.
    """
    cfg = _deep_merge_config(DEFAULT_READABILITY_CONFIG, config or {})

    if value is None or str(value).strip().upper() == "UNKNOWN":
        possible_occlusion = bool(
            ocr_average_confidence is not None
            and ocr_average_confidence >= cfg["occlusion_suspect_ocr_confidence_threshold"]
        )
        reasons = ["Field not detected"]
        if possible_occlusion:
            reasons.append(
                "Rest of image reads well — this field may be occluded or outside the frame "
                "rather than a photo-quality issue"
            )
        return {
            "visibility_score": 0,
            "status": "UNREADABLE",
            "located": False,
            "risk": _risk_for_field(0, cfg, raw_ocr_confidence=None, crop_missing=True),
            "reasons": reasons,
            "possible_occlusion": possible_occlusion,
            "recommendation": _aggregate_recommendations(reasons, RECOMMENDATION_LIBRARY),
            "reason": "field not detected — nothing to score",
        }

    detection = _find_detection_for_value(field_name, value, detections)

    if detection is None:
        # Couldn't locate a source region for this value (e.g. it came from
        # whole-document LLM text extraction rather than a single OCR
        # line). Fall back to a text-only estimate using the document's
        # average OCR confidence, clearly marked as not crop-based.
        fallback_score = round((ocr_average_confidence or 0.5) * 100.0)
        reasons = ["No matching OCR region found for this value"]
        return {
            "visibility_score": fallback_score,
            "status": _status_for_score(fallback_score, cfg),
            "located": False,
            "risk": _risk_for_field(fallback_score, cfg, raw_ocr_confidence=ocr_average_confidence, crop_missing=True),
            "reasons": reasons,
            "recommendation": _aggregate_recommendations(reasons, RECOMMENDATION_LIBRARY),
            "reason": "no matching OCR region found for this value; "
                      "score estimated from document-average OCR confidence",
        }

    bbox = detection.get("bbox")
    h, w = image.shape[:2]

    if not bbox:
        fallback_score = round((detection.get("confidence") or 0.5) * 100.0)
        reasons = ["Matching detection has no bounding box"]
        return {
            "visibility_score": fallback_score,
            "status": _status_for_score(fallback_score, cfg),
            "located": True,
            "risk": _risk_for_field(fallback_score, cfg, raw_ocr_confidence=detection.get("confidence"), crop_missing=True),
            "reasons": reasons,
            "recommendation": _aggregate_recommendations(reasons, RECOMMENDATION_LIBRARY),
            "reason": "matching detection has no bounding box; "
                      "score estimated from its OCR confidence only",
        }

    xs = [pt[0] for pt in bbox]
    ys = [pt[1] for pt in bbox]
    x1, y1 = max(0, min(xs)), max(0, min(ys))
    x2, y2 = min(w, max(xs)), min(h, max(ys))

    if (x2 - x1) < cfg["min_crop_dimension_px"] or (y2 - y1) < cfg["min_crop_dimension_px"]:
        fallback_score = round((detection.get("confidence") or 0.5) * 100.0)
        reasons = ["Small crop / text too small"]
        return {
            "visibility_score": fallback_score,
            "status": _status_for_score(fallback_score, cfg),
            "located": True,
            "bbox": bbox,
            "risk": _risk_for_field(fallback_score, cfg, raw_ocr_confidence=detection.get("confidence"), crop_missing=True),
            "reasons": reasons,
            "recommendation": _aggregate_recommendations(reasons, RECOMMENDATION_LIBRARY),
            "reason": "detected region too small to crop reliably; "
                      "score estimated from its OCR confidence only",
        }

    text_height_px = y2 - y1
    relative_text_height = round(text_height_px / h, 4) if h else None

    # A field whose raw (unpadded) box sits right at the image boundary
    # may have been cut off by the frame rather than fully captured.
    margin = cfg["clipped_edge_margin_px"]
    possibly_clipped = bool(x1 <= margin or y1 <= margin or x2 >= w - margin or y2 >= h - margin)

    # Pad the crop so letters touching the raw bbox edge don't distort the
    # blur/contrast/edge/noise metrics.
    padding = cfg["crop_padding_px"]
    x1p, y1p = max(0, x1 - padding), max(0, y1 - padding)
    x2p, y2p = min(w, x2 + padding), min(h, y2 + padding)
    crop = image[y1p:y2p, x1p:x2p]

    # Defensive guard: clamping/padding shouldn't be able to produce an
    # empty crop given the size check above, but OpenCV calls on a
    # zero-sized array raise, so fail soft instead of crashing the pipeline.
    if crop.size == 0 or crop.shape[0] == 0 or crop.shape[1] == 0:
        fallback_score = round((detection.get("confidence") or 0.5) * 100.0)
        reasons = ["Small crop / text too small"]
        return {
            "visibility_score": fallback_score,
            "status": _status_for_score(fallback_score, cfg),
            "located": True,
            "bbox": bbox,
            "risk": _risk_for_field(fallback_score, cfg, raw_ocr_confidence=detection.get("confidence"), crop_missing=True),
            "reasons": reasons,
            "recommendation": _aggregate_recommendations(reasons, RECOMMENDATION_LIBRARY),
            "reason": "cropped region was empty after padding/clamping; "
                      "score estimated from its OCR confidence only",
        }

    crop_metrics = _compute_crop_metrics(
        crop,
        glare_pixel_threshold=cfg["glare_pixel_threshold"],
        canny_threshold1=cfg["canny_threshold1"],
        canny_threshold2=cfg["canny_threshold2"],
    )

    blur_score = _score_blur(crop_metrics["blur"], cfg["blur_score_ceiling"])
    contrast_score = _score_contrast(crop_metrics["contrast"], cfg["contrast_score_ceiling"])
    edge_score = _score_edge_density(crop_metrics["edge_density"], cfg["edge_density_score_ceiling"])
    noise_score = _score_noise(crop_metrics["noise"], cfg["noise_score_ceiling"])
    ocr_conf = detection.get("confidence")
    ocr_conf_score = (ocr_conf * 100.0) if ocr_conf is not None else (ocr_average_confidence or 0.5) * 100.0

    weights = cfg["field_weights"]
    combined = (
        weights["blur"] * blur_score
        + weights["contrast"] * contrast_score
        + weights["edge_density"] * edge_score
        + weights["noise"] * noise_score
        + weights["ocr_confidence"] * ocr_conf_score
    )

    # Glare over just this field's crop matters more than glare elsewhere
    # in the photo, so it's applied as a local cap the same way it is at
    # the whole-image level.
    if crop_metrics["glare_ratio"] > cfg["glare_ratio_cap_threshold"]:
        combined = min(combined, cfg["glare_penalty_score_cap"])

    score = round(_clamp(combined))
    rotation_angle = _compute_bbox_angle(bbox)

    reasons = _field_reasons(
        blur_score=blur_score,
        contrast_score=contrast_score,
        edge_score=edge_score,
        noise_score=noise_score,
        ocr_conf_score=ocr_conf_score,
        relative_text_height=relative_text_height,
        rotation_angle=rotation_angle,
        glare_ratio=crop_metrics["glare_ratio"],
        config=cfg,
    )
    if possibly_clipped:
        reasons.append("Text crop touches image edge — possibly clipped/incomplete")

    raw_ocr_confidence = ocr_conf if ocr_conf is not None else ocr_average_confidence

    return {
        "visibility_score": score,
        "status": _status_for_score(score, cfg),
        "located": True,
        "bbox": bbox,
        "blur": round(crop_metrics["blur"], 2),
        "contrast": round(crop_metrics["contrast"], 2),
        "edge_density": round(crop_metrics["edge_density"], 4),
        "noise": round(crop_metrics["noise"], 2),
        "glare_ratio": round(crop_metrics["glare_ratio"], 4),
        "ocr_confidence": round(ocr_conf, 4) if ocr_conf is not None else None,
        "text_height_px": int(text_height_px),
        "relative_text_height": relative_text_height,
        "rotation_angle_degrees": round(rotation_angle, 2) if rotation_angle is not None else None,
        "possibly_clipped": possibly_clipped,
        "risk": _risk_for_field(score, cfg, raw_ocr_confidence=raw_ocr_confidence, crop_missing=False),
        "reasons": reasons,
        "recommendation": _aggregate_recommendations(reasons, RECOMMENDATION_LIBRARY),
        "source": detection.get("roi_recovered_for") and "roi_recovery" or "ocr_detection",
    }


# ---------------------------------------------------------------------------
# Step 5/6 — overall summary + main entry point
# ---------------------------------------------------------------------------

_RISK_SEVERITY = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}


def _build_overall_readability(
    image_quality: Dict[str, Any],
    field_visibility: Dict[str, Any],
) -> Dict[str, Any]:
    """A small, pipeline-friendly summary for callers that just want to
    know whether to proceed or ask for a retake, without walking the full
    image_quality/field_visibility report."""
    score = image_quality["score"]
    grade = image_quality["status"]
    human_readable = grade in ("CLEAR", "READABLE")

    worst_field_risk = None
    for field in (field_visibility or {}).values():
        risk = field.get("risk")
        if risk and (worst_field_risk is None or _RISK_SEVERITY.get(risk, 0) > _RISK_SEVERITY.get(worst_field_risk, 0)):
            worst_field_risk = risk

    retake_required = (not human_readable) or worst_field_risk in ("HIGH", "CRITICAL")

    major_issue = image_quality.get("photo_diagnosis", {}).get("primary_issue")
    if major_issue is None and worst_field_risk in ("HIGH", "CRITICAL"):
        major_issue = "One or more declarations are difficult to read"

    return {
        "score": score,
        "grade": grade,
        "human_readable": human_readable,
        "retake_required": retake_required,
        "major_issue": major_issue,
    }


def compute_readability(
    image: np.ndarray,
    detections: List[Dict[str, Any]],
    structured_data: Optional[Dict[str, Any]] = None,
    ocr_average_confidence: Optional[float] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Main entry point. Returns:
        {
          "image_quality": {...},
          "field_visibility": {"mrp": {...}, "manufacturer": {...}, ...},
          "overall_readability": {...}
        }

    structured_data can be the raw ocr.py structured_data dict, or the
    pipeline's post-normalization version — any {field_name: value} mapping
    works, since matching happens by text content against `detections`.
    """
    cfg = _deep_merge_config(DEFAULT_READABILITY_CONFIG, config or {})

    image_quality = compute_image_quality(
        image, detections=detections, ocr_average_confidence=ocr_average_confidence, config=cfg
    )

    field_visibility: Dict[str, Any] = {}
    for field_name, value in (structured_data or {}).items():
        # Skip pipeline.py's audit-trail companion keys (e.g. "*_raw",
        # "*_normalized") — those aren't independent fields to re-score.
        if field_name.endswith("_raw") or field_name.endswith("_normalized"):
            continue
        field_visibility[field_name] = compute_field_visibility(
            image=image,
            field_name=field_name,
            value=value,
            detections=detections,
            ocr_average_confidence=ocr_average_confidence,
            config=cfg,
        )

    overall_readability = _build_overall_readability(image_quality, field_visibility)

    return {
        "image_quality": image_quality,
        "field_visibility": field_visibility,
        "overall_readability": overall_readability,
    }


# ---------------------------------------------------------------------------
# Quick manual test: `python readability.py path/to/processed_image.jpg`
# Runs image-quality scoring only (no OCR payload available standalone).
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) < 2:
        print("Usage: python readability.py <image_path>")
        sys.exit(1)

    img = cv2.imread(sys.argv[1])
    if img is None:
        print(f"Could not read image: {sys.argv[1]}")
        sys.exit(1)

    result = compute_image_quality(img)
    print(json.dumps(result, indent=2))