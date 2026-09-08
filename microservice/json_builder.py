"""
json_builder.py
----------------
Assembles the final output JSON from everything the pipeline stages
produced. Owns the output SHAPE only — it does not extract, normalize,
validate, or score anything itself.

Final shape:
    {
      "metadata": {...},
      "quality": {...},              # image preprocessing quality report
      "ocr": {...},                  # raw OCR-level output (debug/audit trail)
      "normalized": {...},           # per-field {raw, normalized, ...}
      "entities": {...},             # brand/company/product/variant/contacts
      "structured_data": {...},      # final field -> {value, confidence} or
                                      #   {value: null, reason, confidence, manual_review}
      "validation": {...},           # per-field + cross-field validation results
      "confidence": {...},           # document_score + field_scores
      "review": {...},               # needs_manual_review + review_reason
      "readability": {...},          # image_quality + field_visibility + overall_readability
      "font_measurements": {...},    # physical (mm) font-height measurements, per field
    }
"""

from typing import Any, Dict, List, Optional


def _structured_field_entry(
    field: str,
    value: Any,
    confidence: float,
    validation_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Builds one field's entry in the final structured_data block, using
    the doc's recommended shape: a value+confidence pair when present, or
    a structured error object when the field is UNKNOWN."""
    is_missing = value is None or str(value).strip().upper() == "UNKNOWN"
    if is_missing:
        return {
            "value": None,
            "reason": "Not detected",
            "confidence": 0.0,
            "manual_review": False,  # set by review-flag merge step, see build_final_json
        }
    entry: Dict[str, Any] = {"value": value, "confidence": confidence}
    if validation_result is not None and validation_result.get("valid") is False:
        entry["validation_reason"] = validation_result.get("reason")
    return entry


def build_final_json(
    metadata: Dict[str, Any],
    quality_report: Optional[Dict[str, Any]],
    ocr_payload: Dict[str, Any],
    normalized_fields: Dict[str, Any],
    entities: Dict[str, Any],
    structured_data_raw: Dict[str, Any],
    field_validations: Dict[str, Dict[str, Any]],
    cross_field_results: List[Dict[str, Any]],
    confidence_result: Dict[str, Any],
    review_flags: Dict[str, Any],
    readability_result: Optional[Dict[str, Any]] = None,
    font_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    field_scores = confidence_result.get("field_scores", {})

    structured_data_final: Dict[str, Any] = {}
    review_fields = {
        reason.split(":")[0].strip()
        for reason in review_flags.get("review_reason", [])
        if ":" in reason or reason.endswith("not detected")
    }

    for field, value in structured_data_raw.items():
        entry = _structured_field_entry(
            field,
            value,
            field_scores.get(field, 0.0),
            field_validations.get(field),
        )
        if entry.get("value") is None:
            entry["manual_review"] = field in review_fields or f"{field} not detected" in review_flags.get("review_reason", [])
        structured_data_final[field] = entry

    return {
        "metadata": metadata,
        "quality": quality_report or {},
        "ocr": {
            "brand": ocr_payload.get("brand", ""),
            "product_name": ocr_payload.get("product_name", ""),
            "raw_full_text": ocr_payload.get("raw_full_text", ""),
            "corrected_full_text": ocr_payload.get("corrected_full_text", ""),
            "metrics": ocr_payload.get("metrics", {}),
            "corrections": ocr_payload.get("corrections", []),
            "field_sources": ocr_payload.get("field_sources", {}),
        },
        "normalized": normalized_fields,
        "entities": entities,
        "structured_data": structured_data_final,
        "validation": {
            "field_validations": field_validations,
            "cross_field": cross_field_results,
        },
        "confidence": confidence_result,
        "review": review_flags,
        "readability": readability_result or {},
        "font_measurements": font_result or {},
    }