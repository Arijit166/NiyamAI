"""
font.py
-------
Measures the PHYSICAL printed height of each declaration's text, in
millimetres, using a known-size ArUco marker placed beside the package as
a calibration reference.
"""

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import cv2

try:
    from cv2 import aruco  # type: ignore
except Exception:  # pragma: no cover - depends on opencv-contrib being installed
    aruco = None

try:
    from readability import _find_detection_for_value, _compute_bbox_angle
except ImportError as e:
    raise ImportError(
        "font.py could not import _find_detection_for_value / _compute_bbox_angle "
        "from readability.py. This almost always means one of:\n"
        "  1. readability.py is not in the same folder as font.py (or not on PYTHONPATH).\n"
        "  2. A stale __pycache__/readability.cpython-*.pyc is shadowing your current "
        "readability.py -- delete the __pycache__ folder next to readability.py and retry.\n"
        "  3. Your local readability.py is an older version that doesn't define "
        "_find_detection_for_value with this name/signature yet -- make sure both files "
        "are the latest versions.\n"
        f"Original error: {e}"
    ) from e


DEFAULT_FONT_CONFIG: Dict[str, Any] = {
    "marker_size_mm": 20.0,
    "aruco_dict_name": "DICT_4X4_50",
    "expected_marker_id": None,
    "canonical_marker_px": 200,
    "min_marker_area_fraction": 0.001,
    "min_marker_border_margin_px": 5,
    "max_marker_side_length_cv": 0.08,
    "marker_blur_score_ceiling": 250.0,
    "min_marker_blur_score": 30.0,
    "max_rectified_canvas_px": 6000,
    "rectification_self_check_enabled": True,
    "rectification_side_length_tolerance_fraction": 0.05,
    "coplanarity_warning_distance_mm": 60.0,
    "crop_padding_px": 6,
    "binarize_block_size": 25,
    "binarize_c": 10,
    "morph_open_kernel_size": 2,
    "line_band_min_gap_px": 3,
    "min_component_height_px": 4,
    "min_component_width_px": 1,
    "max_component_aspect_ratio": 6.0,
    "punctuation_max_relative_height": 0.35,
    "outlier_height_ratio": 1.8,
    "min_characters_for_measurement": 3,
    "confidence_high_max_height_cv": 0.12,
    "confidence_high_max_tilt_degrees": 3.0,
    "confidence_high_min_characters": 5,
    "confidence_medium_max_height_cv": 0.25,
    "confidence_medium_max_tilt_degrees": 8.0,
    "confidence_medium_min_characters": 3,
}

_CONFIDENCE_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(np.asarray(a, dtype=float) - np.asarray(b, dtype=float)))


def _quad_side_lengths(corners: np.ndarray) -> List[float]:
    return [_dist(corners[i], corners[(i + 1) % 4]) for i in range(4)]


def _get_aruco_dictionary(name: str):
    dict_id = getattr(aruco, name)
    if hasattr(aruco, "getPredefinedDictionary"):
        return aruco.getPredefinedDictionary(dict_id)
    return aruco.Dictionary_get(dict_id)


def _detect_aruco_markers(gray: np.ndarray, aruco_dict) -> Tuple[List[np.ndarray], Optional[np.ndarray]]:
    if hasattr(aruco, "ArucoDetector"):
        params = aruco.DetectorParameters()
        detector = aruco.ArucoDetector(aruco_dict, params)
        corners, ids, _rejected = detector.detectMarkers(gray)
    else:
        params = aruco.DetectorParameters_create()
        corners, ids, _rejected = aruco.detectMarkers(gray, aruco_dict, parameters=params)
    return corners, ids


def _worse_confidence(a: str, b: str) -> str:
    return a if _CONFIDENCE_ORDER.get(a, 0) <= _CONFIDENCE_ORDER.get(b, 0) else b


def detect_reference_marker(
    image: np.ndarray,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cfg = {**DEFAULT_FONT_CONFIG, **(config or {})}

    if aruco is None:
        return {
            "detected": False, "marker_id": None, "corners": None,
            "side_length_px": None, "side_length_cv": None,
            "blur_score": None, "area_fraction": None,
            "reason": "cv2.aruco is unavailable — install opencv-contrib-python",
        }

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = gray.shape[:2]

    try:
        aruco_dict = _get_aruco_dictionary(cfg["aruco_dict_name"])
        corners_list, ids = _detect_aruco_markers(gray, aruco_dict)
    except Exception as e:
        return {
            "detected": False, "marker_id": None, "corners": None,
            "side_length_px": None, "side_length_cv": None,
            "blur_score": None, "area_fraction": None,
            "reason": f"ArUco detection failed: {e}",
        }

    if ids is None or len(ids) == 0:
        return {
            "detected": False, "marker_id": None, "corners": None,
            "side_length_px": None, "side_length_cv": None,
            "blur_score": None, "area_fraction": None,
            "reason": "no ArUco marker detected in image",
        }

    ids_flat = [int(i[0]) for i in ids]
    expected_id = cfg["expected_marker_id"]
    if expected_id is not None:
        candidates = [(c, i) for c, i in zip(corners_list, ids_flat) if i == expected_id]
        if not candidates:
            return {
                "detected": False, "marker_id": None, "corners": None,
                "side_length_px": None, "side_length_cv": None,
                "blur_score": None, "area_fraction": None,
                "reason": f"expected marker id {expected_id} not found (saw {sorted(set(ids_flat))})",
            }
    else:
        candidates = list(zip(corners_list, ids_flat))
        if len(candidates) > 1:
            return {
                "detected": False, "marker_id": None, "corners": None,
                "side_length_px": None, "side_length_cv": None,
                "blur_score": None, "area_fraction": None,
                "reason": f"multiple ArUco markers detected ({sorted(set(ids_flat))}) and no "
                          f"expected_marker_id was given to disambiguate",
            }

    corners_raw, marker_id = candidates[0]
    corners = corners_raw.reshape(4, 2).astype(np.float32)

    area_fraction = float(cv2.contourArea(corners)) / float(h * w) if h * w > 0 else 0.0
    if area_fraction < cfg["min_marker_area_fraction"]:
        return {
            "detected": False, "marker_id": marker_id, "corners": corners,
            "side_length_px": None, "side_length_cv": None,
            "blur_score": None, "area_fraction": area_fraction,
            "reason": "marker is too small in the frame — move it closer or capture at higher resolution",
        }

    margin = cfg["min_marker_border_margin_px"]
    xs, ys = corners[:, 0], corners[:, 1]
    if xs.min() < margin or ys.min() < margin or xs.max() > (w - margin) or ys.max() > (h - margin):
        return {
            "detected": False, "marker_id": marker_id, "corners": corners,
            "side_length_px": None, "side_length_cv": None,
            "blur_score": None, "area_fraction": area_fraction,
            "reason": "marker is too close to the image border — it may be clipped",
        }

    sides = _quad_side_lengths(corners)
    side_mean = float(np.mean(sides))
    side_cv = float(np.std(sides) / side_mean) if side_mean > 0 else 1.0
    if side_cv > cfg["max_marker_side_length_cv"]:
        return {
            "detected": False, "marker_id": marker_id, "corners": corners,
            "side_length_px": side_mean, "side_length_cv": side_cv,
            "blur_score": None, "area_fraction": area_fraction,
            "reason": "marker shape is too irregular (occlusion or extreme viewing angle) to "
                      "trust for calibration",
        }

    x1, y1 = max(0, int(xs.min()) - 5), max(0, int(ys.min()) - 5)
    x2, y2 = min(w, int(xs.max()) + 5), min(h, int(ys.max()) + 5)
    marker_crop = gray[y1:y2, x1:x2]
    blur_var = float(cv2.Laplacian(marker_crop, cv2.CV_64F).var()) if marker_crop.size else 0.0
    blur_score = max(0.0, min(100.0, (blur_var / cfg["marker_blur_score_ceiling"]) * 100.0))
    if blur_score < cfg["min_marker_blur_score"]:
        return {
            "detected": False, "marker_id": marker_id, "corners": corners,
            "side_length_px": side_mean, "side_length_cv": side_cv,
            "blur_score": blur_score, "area_fraction": area_fraction,
            "reason": "reference marker is too blurry for reliable calibration",
        }

    return {
        "detected": True, "marker_id": marker_id, "corners": corners,
        "side_length_px": side_mean, "side_length_cv": side_cv,
        "blur_score": blur_score, "area_fraction": area_fraction,
        "reason": None,
    }


def _verify_rectification(
    rectified_image: np.ndarray,
    expected_marker_id: Optional[int],
    canonical: float,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    if aruco is None:
        return {"verified": False, "reason": "cv2.aruco unavailable for self-check", "side_length_px": None}

    gray = cv2.cvtColor(rectified_image, cv2.COLOR_BGR2GRAY) if rectified_image.ndim == 3 else rectified_image
    try:
        aruco_dict = _get_aruco_dictionary(config["aruco_dict_name"])
        corners_list, ids = _detect_aruco_markers(gray, aruco_dict)
    except Exception as e:
        return {"verified": False, "reason": f"self-check detection failed: {e}", "side_length_px": None}

    if ids is None or len(ids) == 0:
        return {"verified": False, "reason": "marker not re-detectable in the rectified image", "side_length_px": None}

    ids_flat = [int(i[0]) for i in ids]
    if expected_marker_id is not None and expected_marker_id in ids_flat:
        idx = ids_flat.index(expected_marker_id)
    else:
        idx = 0

    corners = corners_list[idx].reshape(4, 2).astype(np.float32)
    side_mean = float(np.mean(_quad_side_lengths(corners)))
    tolerance = canonical * config["rectification_side_length_tolerance_fraction"]

    if abs(side_mean - canonical) > tolerance:
        return {
            "verified": False,
            "reason": f"rectified marker measures {side_mean:.1f}px, expected ~{canonical:.0f}px "
                      f"(tolerance ±{tolerance:.1f}px) — rectification is not trustworthy",
            "side_length_px": side_mean,
        }

    return {"verified": True, "reason": None, "side_length_px": side_mean}


def compute_rectification(
    image: np.ndarray,
    marker_corners: np.ndarray,
    marker_id: Optional[int] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cfg = {**DEFAULT_FONT_CONFIG, **(config or {})}
    canonical = cfg["canonical_marker_px"]

    src = marker_corners.astype(np.float32)
    dst = np.array(
        [[0, 0], [canonical, 0], [canonical, canonical], [0, canonical]], dtype=np.float32
    )
    try:
        homography = cv2.getPerspectiveTransform(src, dst)
    except Exception as e:
        return {"success": False, "reason": f"homography estimation failed: {e}",
                "homography": None, "rectified_image": None, "pixels_per_mm": None,
                "marker_center_px": None, "self_check": None}

    h, w = image.shape[:2]
    original_corners = np.array(
        [[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32
    ).reshape(-1, 1, 2)
    warped_corners = cv2.perspectiveTransform(original_corners, homography).reshape(-1, 2)

    min_x, min_y = warped_corners.min(axis=0)
    max_x, max_y = warped_corners.max(axis=0)
    canvas_w = int(np.ceil(max_x - min_x))
    canvas_h = int(np.ceil(max_y - min_y))

    if canvas_w <= 0 or canvas_h <= 0 or max(canvas_w, canvas_h) > cfg["max_rectified_canvas_px"]:
        return {
            "success": False,
            "reason": "perspective correction would produce an unreasonably large rectified "
                      "image — the capture angle is likely too extreme; retake straighter-on",
            "homography": None, "rectified_image": None, "pixels_per_mm": None,
            "marker_center_px": None, "self_check": None,
        }

    translation = np.array([[1, 0, -min_x], [0, 1, -min_y], [0, 0, 1]], dtype=np.float64)
    full_homography = translation @ homography

    rectified_image = cv2.warpPerspective(image, full_homography, (canvas_w, canvas_h))
    pixels_per_mm = float(canonical) / float(cfg["marker_size_mm"])
    marker_center_px = (float(canonical) / 2.0 - float(min_x), float(canonical) / 2.0 - float(min_y))

    self_check = None
    if cfg["rectification_self_check_enabled"]:
        self_check = _verify_rectification(rectified_image, marker_id, canonical, cfg)
        if not self_check["verified"]:
            return {
                "success": False, "reason": self_check["reason"],
                "homography": None, "rectified_image": None, "pixels_per_mm": None,
                "marker_center_px": None, "self_check": self_check,
            }

    return {
        "success": True, "reason": None,
        "homography": full_homography, "rectified_image": rectified_image,
        "pixels_per_mm": pixels_per_mm, "marker_center_px": marker_center_px,
        "self_check": self_check,
    }


def _transform_bbox(bbox: List[List[float]], homography: np.ndarray) -> List[List[float]]:
    pts = np.array(bbox, dtype=np.float32).reshape(-1, 1, 2)
    transformed = cv2.perspectiveTransform(pts, homography).reshape(-1, 2)
    return transformed.tolist()


def _odd(n: int) -> int:
    n = int(n)
    return n if n % 2 == 1 else n + 1


def _split_into_line_bands(binary: np.ndarray, min_gap_px: int) -> List[Tuple[int, int]]:
    if binary.size == 0:
        return []
    row_has_ink = (binary > 0).any(axis=1)
    h = len(row_has_ink)

    bands: List[Tuple[int, int]] = []
    band_start = None
    gap_run = 0
    for y in range(h):
        if row_has_ink[y]:
            if band_start is None:
                band_start = y
            gap_run = 0
        else:
            if band_start is not None:
                gap_run += 1
                if gap_run >= min_gap_px:
                    bands.append((band_start, y - gap_run + 1))
                    band_start = None
                    gap_run = 0
    if band_start is not None:
        bands.append((band_start, h))

    return bands if bands else [(0, h)]


def _measure_character_heights(crop_gray: np.ndarray, config: Dict[str, Any]) -> Dict[str, Any]:
    if crop_gray.size == 0:
        return {"heights_px": [], "method": "insufficient_components"}

    blurred = cv2.GaussianBlur(crop_gray, (3, 3), 0)
    binary = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,
        max(3, _odd(config["binarize_block_size"])), config["binarize_c"],
    )

    kernel_size = config["morph_open_kernel_size"]
    if kernel_size and kernel_size > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    bands = _split_into_line_bands(binary, config["line_band_min_gap_px"])

    candidate_heights: List[float] = []
    for (y1, y2) in bands:
        band = binary[y1:y2, :]
        if band.size == 0:
            continue
        num_labels, _labels, stats, _centroids = cv2.connectedComponentsWithStats(band, connectivity=8)
        for i in range(1, num_labels):
            _x, _y, w, h, _area = stats[i]
            if h < config["min_component_height_px"] or w < config["min_component_width_px"]:
                continue
            aspect = max(w, h) / max(1, min(w, h))
            if aspect > config["max_component_aspect_ratio"]:
                continue
            candidate_heights.append(float(h))

    if not candidate_heights:
        return {"heights_px": [], "method": "insufficient_components"}

    prelim_median = float(np.median(candidate_heights))
    punctuation_floor = prelim_median * config["punctuation_max_relative_height"]
    de_punctuated = [hgt for hgt in candidate_heights if hgt >= punctuation_floor] or candidate_heights

    median_after_punct = float(np.median(de_punctuated))
    ratio = config["outlier_height_ratio"]
    filtered = [
        hgt for hgt in de_punctuated
        if median_after_punct > 0 and (hgt / median_after_punct) <= ratio and (median_after_punct / hgt) <= ratio
    ]
    final_heights = filtered if len(filtered) >= config["min_characters_for_measurement"] else de_punctuated

    if len(final_heights) < config["min_characters_for_measurement"]:
        return {"heights_px": final_heights, "method": "insufficient_components"}

    return {"heights_px": final_heights, "method": "connected_components"}


def _estimate_confidence(
    characters_measured: int,
    height_cv: Optional[float],
    residual_tilt_degrees: Optional[float],
    marker_side_length_cv: Optional[float],
    method: str,
    config: Dict[str, Any],
) -> str:
    if method != "connected_components":
        return "LOW" if characters_measured == 0 else "MEDIUM"

    high = (
        characters_measured >= config["confidence_high_min_characters"]
        and (height_cv is None or height_cv <= config["confidence_high_max_height_cv"])
        and (residual_tilt_degrees is None or residual_tilt_degrees <= config["confidence_high_max_tilt_degrees"])
        and (marker_side_length_cv is None or marker_side_length_cv <= config["max_marker_side_length_cv"] / 2)
    )
    if high:
        return "HIGH"

    medium = (
        characters_measured >= config["confidence_medium_min_characters"]
        and (height_cv is None or height_cv <= config["confidence_medium_max_height_cv"])
        and (residual_tilt_degrees is None or residual_tilt_degrees <= config["confidence_medium_max_tilt_degrees"])
    )
    return "MEDIUM" if medium else "LOW"


def compute_field_font_measurement(
    field_name: str,
    value: Any,
    detections: List[Dict[str, Any]],
    rectified_image: np.ndarray,
    homography: np.ndarray,
    pixels_per_mm: float,
    marker_diagnostics: Dict[str, Any],
    marker_center_px: Optional[Tuple[float, float]] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cfg = {**DEFAULT_FONT_CONFIG, **(config or {})}

    if value is None or str(value).strip().upper() == "UNKNOWN":
        return {"available": False, "reason": "field not detected — nothing to measure"}

    detection = _find_detection_for_value(field_name, value, detections)
    if detection is None:
        return {"available": False, "reason": "no matching OCR region found for this value"}

    bbox = detection.get("bbox")
    if not bbox:
        return {"available": False, "reason": "matching detection has no bounding box"}

    rect_bbox = _transform_bbox(bbox, homography)
    residual_tilt = _compute_bbox_angle(rect_bbox)

    xs = [p[0] for p in rect_bbox]
    ys = [p[1] for p in rect_bbox]
    rh, rw = rectified_image.shape[:2]
    pad = cfg["crop_padding_px"]
    x1 = max(0, int(min(xs)) - pad)
    y1 = max(0, int(min(ys)) - pad)
    x2 = min(rw, int(max(xs)) + pad)
    y2 = min(rh, int(max(ys)) + pad)

    if x2 <= x1 or y2 <= y1:
        return {"available": False, "reason": "field's rectified region is empty/degenerate"}

    crop = rectified_image[y1:y2, x1:x2]
    crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

    measurement = _measure_character_heights(crop_gray, cfg)
    heights = measurement["heights_px"]
    method = measurement["method"]

    if method == "connected_components":
        char_height_px = float(np.median(heights))
        height_std_px = float(np.std(heights))
        characters_measured = len(heights)
    else:
        char_height_px = float(max(ys) - min(ys)) if ys else 0.0
        height_std_px = None
        characters_measured = 0

    if char_height_px <= 0:
        return {"available": False, "reason": "could not measure any character/bbox height for this field"}

    height_cv = (height_std_px / char_height_px) if (height_std_px and char_height_px > 0) else None
    character_height_mm = round(char_height_px / pixels_per_mm, 3)

    pixel_spread_mm = (height_std_px / pixels_per_mm) if height_std_px else (1.0 / pixels_per_mm)
    marker_cv = marker_diagnostics.get("side_length_cv") or 0.0
    marker_error_mm = marker_cv * cfg["marker_size_mm"]
    measurement_uncertainty_mm = round(pixel_spread_mm + marker_error_mm, 3)
    measurement_range_mm = [
        round(character_height_mm - measurement_uncertainty_mm, 3),
        round(character_height_mm + measurement_uncertainty_mm, 3),
    ]

    confidence = _estimate_confidence(
        characters_measured=characters_measured,
        height_cv=height_cv,
        residual_tilt_degrees=residual_tilt,
        marker_side_length_cv=marker_diagnostics.get("side_length_cv"),
        method=method,
        config=cfg,
    )

    coplanarity_warning = False
    distance_from_marker_mm = None
    if marker_center_px is not None:
        field_center = (float(np.mean(xs)), float(np.mean(ys)))
        distance_px = _dist(np.array(field_center), np.array(marker_center_px))
        distance_from_marker_mm = round(distance_px / pixels_per_mm, 1)
        if distance_from_marker_mm > cfg["coplanarity_warning_distance_mm"]:
            coplanarity_warning = True
            confidence = _worse_confidence(confidence, "MEDIUM")

    return {
        "available": True,
        "character_height_px": round(char_height_px, 2),
        "character_height_mm": character_height_mm,
        "measurement_uncertainty_mm": measurement_uncertainty_mm,
        "measurement_range_mm": measurement_range_mm,
        "characters_measured": characters_measured,
        "height_std_px": round(height_std_px, 2) if height_std_px is not None else None,
        "residual_tilt_degrees": round(residual_tilt, 2) if residual_tilt is not None else None,
        "distance_from_marker_mm": distance_from_marker_mm,
        "coplanarity_warning": coplanarity_warning,
        "measurement_method": "connected_components" if method == "connected_components" else "bbox_fallback",
        "confidence": confidence,
        "ocr_confidence": detection.get("confidence"),
        "source": detection.get("roi_recovered_for") and "roi_recovery" or "ocr_detection",
    }


def compute_font_measurements(
    image: np.ndarray,
    detections: List[Dict[str, Any]],
    structured_data: Optional[Dict[str, Any]] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cfg = {**DEFAULT_FONT_CONFIG, **(config or {})}

    marker = detect_reference_marker(image, cfg)
    if not marker["detected"]:
        return {
            "measurement_available": False,
            "reason": marker["reason"],
            "marker": marker,
            "scale": None,
            "rectification_self_check": None,
            "fields": {},
        }

    rectification = compute_rectification(image, marker["corners"], marker["marker_id"], cfg)
    if not rectification["success"]:
        return {
            "measurement_available": False,
            "reason": rectification["reason"],
            "marker": marker,
            "scale": None,
            "rectification_self_check": rectification.get("self_check"),
            "fields": {},
        }

    pixels_per_mm = rectification["pixels_per_mm"]
    scale = {
        "pixels_per_mm": round(pixels_per_mm, 3),
        "marker_size_mm": cfg["marker_size_mm"],
        "marker_id": marker["marker_id"],
    }

    fields: Dict[str, Any] = {}
    for field_name, value in (structured_data or {}).items():
        if field_name.endswith("_raw") or field_name.endswith("_normalized"):
            continue
        fields[field_name] = compute_field_font_measurement(
            field_name=field_name,
            value=value,
            detections=detections,
            rectified_image=rectification["rectified_image"],
            homography=rectification["homography"],
            pixels_per_mm=pixels_per_mm,
            marker_diagnostics=marker,
            marker_center_px=rectification.get("marker_center_px"),
            config=cfg,
        )

    return {
        "measurement_available": True,
        "reason": None,
        "marker": marker,
        "scale": scale,
        "rectification_self_check": rectification.get("self_check"),
        "fields": fields,
    }


def validate_against_ground_truth(records: List[Dict[str, float]]) -> Dict[str, Any]:
    if not records:
        return {
            "count": 0, "mean_error_mm": None, "mean_absolute_error_mm": None,
            "std_error_mm": None, "max_absolute_error_mm": None,
        }

    errors = [r["measured_mm"] - r["true_mm"] for r in records]
    abs_errors = [abs(e) for e in errors]
    return {
        "count": len(records),
        "mean_error_mm": round(float(np.mean(errors)), 4),
        "mean_absolute_error_mm": round(float(np.mean(abs_errors)), 4),
        "std_error_mm": round(float(np.std(errors)), 4),
        "max_absolute_error_mm": round(float(np.max(abs_errors)), 4),
    }


if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) < 2:
        print("Usage: python font.py <image_path>")
        sys.exit(1)

    img = cv2.imread(sys.argv[1])
    if img is None:
        print(f"Could not read image: {sys.argv[1]}")
        sys.exit(1)

    marker_result = detect_reference_marker(img)
    if not marker_result["detected"]:
        print(json.dumps({"measurement_available": False, "reason": marker_result["reason"]}, indent=2))
        sys.exit(0)

    rect = compute_rectification(img, marker_result["corners"], marker_result["marker_id"])
    print(json.dumps({
        "marker": {k: v for k, v in marker_result.items() if k != "corners"},
        "rectification_success": rect["success"],
        "reason": rect.get("reason"),
        "pixels_per_mm": rect.get("pixels_per_mm"),
        "self_check": rect.get("self_check"),
    }, indent=2))