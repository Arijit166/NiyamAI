"""
confidence.py
-------------
Computes per-field and overall document confidence scores.

A field's score blends three signals:
    1. source_weight  — how reliable the extraction method was
                         (spatial/pattern-validated > regex label-proximity
                         > LLM text-only extraction > none)
    2. ocr_confidence  — the underlying OCR detection confidence for the
                         text that produced this field, when available
    3. validation      — whether validator.py accepted the value's format

None of these alone is enough: a field pulled by rock-solid spatial
matching but that fails format validation should still score low, and a
high-OCR-confidence line that came from a weak extraction path (LLM
text-only) shouldn't be treated as authoritative.
"""

from typing import Any, Dict, List, Optional

# Extraction-source reliability weights (0-1). Keys match the
# `field_sources` values produced by ocr.py, plus a couple of generic
# buckets normalizer.py/field_extractor.py may use.
SOURCE_WEIGHTS = {
    "ocr_spatial": 0.95,
    "spatial": 0.95,
    "regex_label_proximity": 0.80,
    "llm_text_extraction": 0.60,
    "entity_recognition": 0.55,
    "none": 0.0,
}


def _source_weight(source: Optional[str]) -> float:
    if not source:
        return SOURCE_WEIGHTS["none"]
    if source.startswith("paddle_roi_variant"):
        return 0.75
    if source.startswith("tesseract_variant"):
        return 0.65
    return SOURCE_WEIGHTS.get(source, 0.5)


def field_confidence(
    field_name: str,
    value: Any,
    source: Optional[str],
    ocr_confidence: Optional[float] = None,
    validation_result: Optional[Dict[str, Any]] = None,
) -> float:
    """Combines source reliability, OCR confidence, and validation outcome
    into a single 0.0-1.0 confidence score for one field."""
    if value is None or str(value).strip().upper() == "UNKNOWN":
        return 0.0

    weight = _source_weight(source)
    ocr_component = ocr_confidence if ocr_confidence is not None else weight
    base = 0.6 * weight + 0.4 * ocr_component

    if validation_result is not None:
        if validation_result.get("valid") is False:
            base *= 0.4  # format validation failed -> heavy penalty, not zero
        elif validation_result.get("valid") is True and not validation_result.get("reason"):
            base = min(1.0, base * 1.05)  # clean pass, slight boost

    return round(max(0.0, min(1.0, base)), 4)


def compute_field_scores(
    structured_data: Dict[str, Any],
    field_sources: Dict[str, str],
    field_validations: Dict[str, Dict[str, Any]],
    detection_confidences: Optional[Dict[str, float]] = None,
) -> Dict[str, float]:
    """Returns {field_name: confidence_score} for every field in
    structured_data."""
    detection_confidences = detection_confidences or {}
    scores: Dict[str, float] = {}
    for field, value in structured_data.items():
        scores[field] = field_confidence(
            field_name=field,
            value=value,
            source=field_sources.get(field),
            ocr_confidence=detection_confidences.get(field),
            validation_result=field_validations.get(field),
        )
    return scores


# Fields that matter most for downstream compliance/analytics use get more
# weight in the overall document score. Anything not listed defaults to 1.0.
_FIELD_IMPORTANCE = {
    "mrp": 2.0,
    "expiry_date": 2.0,
    "manufacturer": 1.5,
    "net_quantity": 1.5,
    "batch_number": 1.2,
    "manufacturing_date": 1.2,
    "mfg_license_no": 1.0,
    "consumer_care": 0.8,
    "country_of_origin": 0.6,
    "marketer": 0.8,
    "manufacturer_address": 0.8,
}


def compute_document_score(field_scores: Dict[str, float]) -> float:
    if not field_scores:
        return 0.0
    total_weight = 0.0
    weighted_sum = 0.0
    for field, score in field_scores.items():
        weight = _FIELD_IMPORTANCE.get(field, 1.0)
        total_weight += weight
        weighted_sum += weight * score
    return round(weighted_sum / total_weight, 4) if total_weight else 0.0


def compute_overall_confidence(
    structured_data: Dict[str, Any],
    field_sources: Dict[str, str],
    field_validations: Dict[str, Dict[str, Any]],
    detection_confidences: Optional[Dict[str, float]] = None,
    ocr_average_confidence: Optional[float] = None,
) -> Dict[str, Any]:
    """Top-level entry point: returns both the per-field scores and the
    weighted document_score, in the shape json_builder.py expects."""
    field_scores = compute_field_scores(
        structured_data, field_sources, field_validations, detection_confidences
    )
    document_score = compute_document_score(field_scores)

    # Blend in raw OCR quality slightly, since a document can have
    # perfectly-scored extracted fields but still come from a generally
    # noisy/low-confidence OCR pass on the fields we didn't structure.
    if ocr_average_confidence is not None:
        document_score = round(0.85 * document_score + 0.15 * ocr_average_confidence, 4)

    return {
        "document_score": document_score,
        "field_scores": field_scores,
    }