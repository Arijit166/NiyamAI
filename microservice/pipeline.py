"""
pipeline.py
-----------
Ties every stage together:

    Image
      |
      v
    preprocess_image()        (preprocessing.py)
      |
      v
    LabelOCRProcessor.process_image()   (ocr.py: OCR + LLM cleanup +
                                          field_extractor + spatial/regex
                                          field capture, all internal to
                                          ocr.py already)
      |
      v
    normalize_*()              (normalizer.py)
      |
      v
    extract_entities()         (field_extractor.py)
      |
      v
    validate_field() / cross_field_validate()   (validator.py)
      |
      v
    compute_overall_confidence()   (confidence.py)
      |
      v
    build_review_flags()       (validator.py)
      |
      v
    compute_readability()      (readability.py: "can a human read it?")
      |
      v
    compute_font_measurements() (font.py: physical font-height in mm)
      |
      v
    build_final_json()         (json_builder.py)
      |
      v
    JSON Output

One LabelOCRProcessor instance (which loads the PaddleOCR + LLM client)
is created once and reused across images — that's the expensive part.
"""

from pathlib import Path
from typing import Any, Dict, Optional, Union

import cv2
import numpy as np

from ocr import LabelOCRProcessor
from preprocessing import preprocess_image
import normalizer as normalizer
import validator as validator
import confidence as confidence_mod
import field_extractor
import json_builder as json_builder
import readability as readability_mod
import font as font_mod


class LabelExtractionPipeline:
    def __init__(self, ocr_processor: Optional[LabelOCRProcessor] = None, **ocr_kwargs):
        self.ocr_processor = ocr_processor or LabelOCRProcessor(**ocr_kwargs)

    # ------------------------------------------------------------------
    # Stage: normalization
    # ------------------------------------------------------------------
    def _normalize_all_fields(self, structured_data: Dict[str, Any], brand_hint: Optional[str]) -> Dict[str, Any]:
        normalized: Dict[str, Any] = {}

        for field in ("manufacturer", "marketer"):
            raw = structured_data.get(field)
            if raw and raw.upper() != "UNKNOWN":
                normalized[field] = normalizer.normalize_spacing(raw)

        addr_raw = structured_data.get("manufacturer_address")
        address_info: Dict[str, Any] = {}
        if addr_raw and addr_raw.upper() != "UNKNOWN":
            address_info = normalizer.normalize_address(addr_raw)
            normalized["manufacturer_address"] = address_info

        for field in ("manufacturing_date", "expiry_date"):
            raw = structured_data.get(field)
            if raw and raw.upper() != "UNKNOWN":
                normalized[field] = normalizer.normalize_date_field(raw, field)

        mrp_raw = structured_data.get("mrp")
        if mrp_raw and mrp_raw.upper() != "UNKNOWN":
            normalized["mrp"] = normalizer.normalize_price(mrp_raw)

        qty_raw = structured_data.get("net_quantity")
        if qty_raw and qty_raw.upper() != "UNKNOWN":
            normalized["net_quantity"] = normalizer.normalize_quantity(qty_raw)

        care_raw = structured_data.get("consumer_care")
        if care_raw and care_raw.upper() != "UNKNOWN":
            if "@" in care_raw:
                normalized["consumer_care"] = normalizer.normalize_email(care_raw)
            else:
                normalized["consumer_care"] = normalizer.normalize_phone(care_raw)

        return normalized, address_info

    def _apply_normalized_values(self, structured_data: Dict[str, Any], normalized: Dict[str, Any]) -> Dict[str, Any]:
        """Produces a copy of structured_data where normalized values
        replace raw ones for validation/scoring purposes, while keeping
        the raw values available under *_raw for audit."""
        merged = dict(structured_data)
        for field, norm_entry in normalized.items():
            norm_value = norm_entry.get("normalized")
            if norm_value:
                merged[f"{field}_raw"] = structured_data.get(field)
                merged[field] = norm_value
                if field in ("manufacturing_date", "expiry_date"):
                    merged[f"{field}_normalized"] = norm_value
        return merged

    # ------------------------------------------------------------------
    # Stage: validation
    # ------------------------------------------------------------------
    def _validate_all_fields(self, structured_data: Dict[str, Any], entities: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        field_validations: Dict[str, Dict[str, Any]] = {}
        for field, value in structured_data.items():
            if field.endswith("_raw") or field.endswith("_normalized"):
                continue
            field_validations[field] = validator.validate_field(field, value)

        if entities.get("email") and entities["email"] != "UNKNOWN":
            field_validations["email"] = validator.validate_email(entities["email"])
        if entities.get("website") and entities["website"] != "UNKNOWN":
            field_validations["website"] = validator.validate_url(entities["website"])
        if entities.get("phone") and entities["phone"] != "UNKNOWN":
            field_validations["phone"] = validator.validate_phone(entities["phone"])

        return field_validations

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------
    def process(
        self,
        image_input: Union[str, Path, bytes, np.ndarray],
        filename: str = "in_memory_image.jpg",
        font_config: Optional[Dict[str, Any]] = None,   # NEW — e.g. {"marker_size_mm": 25.0}
    ) -> Dict[str, Any]:
        # 1. Preprocess
        processed_img, quality_report = preprocess_image(image_input)
        if quality_report.get("reject"):
            return {
                "metadata": {"filename": filename},
                "quality": quality_report,
                "error": quality_report.get("reject_reason"),
            }, None

        # 2. OCR + LLM cleanup + spatial/regex field capture (ocr.py)
        ocr_payload, annotated_img = self.ocr_processor.process_image(processed_img, filename=filename)
        structured_data_raw = ocr_payload.get("structured_data", {})
        field_sources = ocr_payload.get("field_sources", {})

        # 3. Normalize
        normalized_fields, address_info = self._normalize_all_fields(
            structured_data_raw, ocr_payload.get("brand")
        )
        structured_data = self._apply_normalized_values(structured_data_raw, normalized_fields)

        # 3b. Semantic sectioning + ingredient parsing from OCR "sections"
        sections = ocr_payload.get("sections", [])
        semantic = normalizer.build_semantic_sections(sections, structured_data)
        if semantic.get("ingredients"):
            structured_data["ingredients"] = ", ".join(semantic["ingredients"])
            field_sources["ingredients"] = "section_parsing"

        # 4. Entity recognition
        entities = field_extractor.extract_entities(
            llm_brand=ocr_payload.get("brand"),
            llm_product_name=ocr_payload.get("product_name"),
            structured_data=structured_data,
            corrected_full_text=ocr_payload.get("corrected_full_text", ""),
        )

        # 5. Validation (per-field + cross-field)
        field_validations = self._validate_all_fields(structured_data, entities)
        cross_field_results = validator.cross_field_validate(structured_data, address_info)

        # 6. Confidence scoring
        detection_confidences = {
            d.get("roi_recovered_for"): d.get("confidence")
            for d in ocr_payload.get("detections", [])
            if d.get("roi_recovered_for")
        }
        confidence_result = confidence_mod.compute_overall_confidence(
            structured_data=structured_data,
            field_sources=field_sources,
            field_validations=field_validations,
            detection_confidences=detection_confidences,
            ocr_average_confidence=ocr_payload.get("metrics", {}).get("average_confidence"),
        )

        # 7. Review flags
        review_flags = validator.build_review_flags(
            structured_data=structured_data,
            field_validations=field_validations,
            cross_field_results=cross_field_results,
            uncertain_or_flagged_text=ocr_payload.get("uncertain_or_flagged_text", []),
        )

        # 7b. Readability ("can a human read it?") — scored on the same
        # processed_img/detections that ocr.py's bboxes are relative to.
        readability_result = readability_mod.compute_readability(
            image=processed_img,
            detections=ocr_payload.get("detections", []),
            structured_data=structured_data,
            ocr_average_confidence=ocr_payload.get("metrics", {}).get("average_confidence"),
        )

        # 7c. Physical font-height measurement (mm), via ArUco calibration
        # marker. Uses the same processed_img/detections as readability.py
        # so bbox coordinates line up; returns measurement_available=False
        # cleanly if no marker is present in frame.
        font_result = font_mod.compute_font_measurements(
            image=processed_img,
            detections=ocr_payload.get("detections", []),
            structured_data=structured_data,
            config=font_config,   # NEW — lets the officer's declared block size override the default 20mm
        )

        # 8. Assemble final JSON
        final_json = json_builder.build_final_json(
            metadata=ocr_payload.get("metadata", {"filename": filename}),
            quality_report=quality_report,
            ocr_payload=ocr_payload,
            normalized_fields={k: v for k, v in normalized_fields.items()},
            entities=entities,
            structured_data_raw=structured_data,
            field_validations=field_validations,
            cross_field_results=cross_field_results,
            confidence_result=confidence_result,
            review_flags=review_flags,
            readability_result=readability_result,
            font_result=font_result,
        )
        final_json["semantic_sections"] = {
            "claims": semantic.get("claims", []),
            "marketing_text": semantic.get("marketing_text"),
        }

        return final_json, annotated_img

    def process_file(self, image_path: Union[str, Path], font_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        image_path = Path(image_path)
        result, annotated_img = self.process(str(image_path), filename=image_path.name, font_config=font_config)
        return result, annotated_img