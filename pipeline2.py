"""
pipeline.py
-----------
End-to-end orchestrator. Ties your existing preprocessing.py and ocr.py
together with the three new modules, YOLO-first with a full-page fallback:

    Image bytes/path
          |
          v
    preprocessing.preprocess_image()        <- your adaptive quality pipeline
          |                                      (reject if too blurry/small)
          v
    yolo_field_detector.FieldDetector        <- detect the field ROIs
          |
          v
    For each detected ROI:
        roi_preprocessing.generate_roi_variants()   <- field-specific enhancement,
              |                                          several variants, cheapest first
              v
        OCR each variant via LabelOCRProcessor._ocr_roi (PaddleOCR),
        then _ocr_roi_tesseract as fallback engine
              |
              v
        postprocess.postprocess_field()      <- keep the FIRST variant that validates
              |
              v (only if no variant validated)
        LLMCorrector.extract_field_from_crop()  <- vision LLM reads the SAME
              |                                     crop (image + OCR text),
              |                                     re-validated the same way
              v
    Any field YOLO didn't detect, or still unresolved after the above:
        fall back to ocr.py's LabelOCRProcessor.process_image() on the
        whole preprocessed image (its spatial-proximity + LLM-correction
        pipeline), and pull the matching value from its structured_data —
        this only runs once, lazily, and only if at least one field needs it
          |
          v
    Structured JSON, every field tagged with where its value came from
    (yolo_roi_paddle / yolo_roi_tesseract / yolo_roi_llm_vision /
    ocr_fallback / none) — nothing is ever silently guessed.

Run:
    python pipeline.py --image label.jpg --weights runs/detect/field_detector/weights/best.pt --out result.json

See README.md for full setup instructions.
"""

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import numpy as np

from preprocessing import preprocess_image, load_image
from yolo_field_detector import FieldDetector, FIELD_CLASSES
from roi_preprocessing import crop_roi, generate_roi_variants
from postprocess import postprocess_field
from ocr import LabelOCRProcessor

# Maps a YOLO field class -> the key it lives under in ocr.py's output
# payload. brand/product_name are top-level keys there; the rest live in
# structured_data.
_OCR_FALLBACK_KEY_MAP = {
    "net_quantity": ("structured_data", "net_quantity"),
    "mrp": ("structured_data", "mrp"),
    "manufacturing_date": ("structured_data", "manufacturing_date"),
    "expiry_date": ("structured_data", "expiry_date"),
    "brand": ("top_level", "brand"),
    "product_name": ("top_level", "product_name"),
    "manufacturer_name": ("structured_data", "manufacturer"),
    "manufacturer_address": ("structured_data", "manufacturer_address"),
    "country_of_origin": ("structured_data", "country_of_origin"),
    "batch_number": ("structured_data", "batch_number"),
}


class LabelExtractionPipeline:
    def __init__(
        self,
        weights_path: str,
        detection_confidence: float = 0.35,
        llm_model: str = "qwen/qwen3.6-27b",
    ):
        self.detector = FieldDetector(weights_path, confidence_threshold=detection_confidence)
        # Reused for: (a) its ROI OCR methods (_ocr_roi / _ocr_roi_tesseract)
        # so we don't re-initialize a second PaddleOCR engine, (b) its
        # llm_corrector for the vision-LLM crop-reading step, and (c) as the
        # full-page fallback (process_image) for anything nothing else can resolve.
        self.ocr_processor = LabelOCRProcessor(llm_model=llm_model)

    def _ocr_roi_variants(self, field_class: str, variants: List[np.ndarray]):
        """
        Tries each preprocessed variant through PaddleOCR first, then
        Tesseract, in order — returns the first (postprocess_result,
        raw_text, source) whose postprocess result validates. Returns
        None if nothing validated across every variant/engine.
        """
        last_raw_text = ""

        for i, variant in enumerate(variants):
            try:
                text = self.ocr_processor._ocr_roi(variant)
            except Exception:
                text = ""
            if text:
                last_raw_text = text
            result = postprocess_field(field_class, text)
            if result.valid:
                return result, text, f"yolo_roi_paddle_variant_{i}"

        # Nothing validated via PaddleOCR — try Tesseract on the same variants.
        for i, variant in enumerate(variants):
            text = self.ocr_processor._ocr_roi_tesseract(variant)
            if text:
                last_raw_text = text
            result = postprocess_field(field_class, text)
            if result.valid:
                return result, text, f"yolo_roi_tesseract_variant_{i}"

        return None, last_raw_text, None

    def _get_ocr_fallback_value(self, field_class: str, fallback_payload: Dict[str, Any]) -> Optional[str]:
        entry = _OCR_FALLBACK_KEY_MAP.get(field_class)
        if entry is None:
            # No corresponding key in ocr.py's output for this YOLO class —
            # nothing to fall back to, not an error.
            return None
        location, key = entry
        if location == "top_level":
            val = fallback_payload.get(key)
        else:
            val = fallback_payload.get("structured_data", {}).get(key)
        if isinstance(val, str) and val.strip() and val.strip().upper() != "UNKNOWN":
            return val.strip()
        return None

    def run(self, image_input: Union[str, bytes, np.ndarray], filename: str = "label.jpg") -> Dict[str, Any]:
        # --- Stage 1: your adaptive preprocessing pipeline ---
        processed_img, quality_report = preprocess_image(image_input)

        if quality_report["reject"]:
            return {
                "image": filename,
                "rejected": True,
                "reject_reason": quality_report["reject_reason"],
                "quality_report": quality_report,
                "fields": {},
            }

        # --- Stage 2: YOLO ROI detection ---
        detections = self.detector.detect_best_per_class(processed_img)

        fields: Dict[str, Any] = {}
        fields_needing_fallback: List[str] = []

        for field_class in FIELD_CLASSES:
            det = detections.get(field_class)

            if det is None:
                fields[field_class] = {
                    "value": None, "valid": False, "reason": "field not detected by YOLO",
                    "raw_ocr_text": None, "source": None,
                    "detection_confidence": None, "bbox": None,
                }
                fields_needing_fallback.append(field_class)
                continue

            # --- Stage 3: crop + field-specific variant preprocessing ---
            crop = crop_roi(processed_img, det["bbox"])
            variants = generate_roi_variants(crop, field_class)

            # --- Stage 4 + 5: OCR each variant, keep first validated result ---
            result, raw_text, source = self._ocr_roi_variants(field_class, variants)

            if result is not None:
                fields[field_class] = {
                    "value": result.value, "valid": True, "reason": None,
                    "raw_ocr_text": raw_text, "source": source,
                    "detection_confidence": det["confidence"], "bbox": det["bbox"],
                }
                continue

            # No OCR variant validated — before giving up on this crop, let
            # the vision LLM read the SAME crop directly (image + whatever
            # OCR text was recovered), then re-validate through the same
            # postprocess pattern check. This compensates for weak YOLO
            # localization/OCR failure without ever bypassing validation.
            llm_value = self.ocr_processor.llm_corrector.extract_field_from_crop(
                crop, field_class, raw_text
            )
            llm_result = postprocess_field(field_class, llm_value) if llm_value else None

            if llm_result is not None and llm_result.valid:
                fields[field_class] = {
                    "value": llm_result.value, "valid": True, "reason": None,
                    "raw_ocr_text": raw_text or None, "source": "yolo_roi_llm_vision",
                    "detection_confidence": det["confidence"], "bbox": det["bbox"],
                }
            else:
                fields[field_class] = {
                    "value": None, "valid": False,
                    "reason": "detected by YOLO but no OCR/LLM variant validated",
                    "raw_ocr_text": raw_text or None, "source": None,
                    "detection_confidence": det["confidence"], "bbox": det["bbox"],
                }
                fields_needing_fallback.append(field_class)

        # --- Stage 6: fallback to ocr.py's full-page pipeline, only if needed ---
        if fields_needing_fallback:
            fallback_payload, _annotated = self.ocr_processor.process_image(processed_img, filename=filename)
            for field_class in fields_needing_fallback:
                fallback_value = self._get_ocr_fallback_value(field_class, fallback_payload)
                if fallback_value:
                    fields[field_class] = {
                        "value": fallback_value,
                        "valid": True,
                        "reason": "recovered via full-page fallback (ocr.py spatial/LLM pipeline)",
                        "raw_ocr_text": None,
                        "source": "ocr_fallback",
                        "detection_confidence": None,
                        "bbox": fields[field_class]["bbox"],  # keep YOLO bbox if it existed, else None
                    }
                # else: leave the "not detected/not validated" entry as-is —
                # never fabricate a value.

        return {
            "image": filename,
            "rejected": False,
            "quality_report": quality_report,
            "fields": fields,
            "all_fields_valid": all(f["valid"] for f in fields.values()),
        }


def _cli():
    parser = argparse.ArgumentParser(description="Run the full YOLO-first label extraction pipeline on one image")
    parser.add_argument("--image", required=True, help="Path to input label image")
    parser.add_argument("--weights", required=True, help="Path to trained YOLO weights (best.pt)")
    parser.add_argument("--conf", type=float, default=0.35, help="YOLO detection confidence threshold")
    parser.add_argument("--llm-model", default="qwen/qwen3.6-27b", help="Model used by ocr.py's LLMCorrector fallback")
    parser.add_argument("--out", default=None, help="Optional path to write JSON output to")
    args = parser.parse_args()

    pipeline = LabelExtractionPipeline(
        weights_path=args.weights,
        detection_confidence=args.conf,
        llm_model=args.llm_model,
    )
    result = pipeline.run(args.image, filename=Path(args.image).name)
    output_json = json.dumps(result, indent=2, ensure_ascii=False)

    print(output_json)
    if args.out:
        Path(args.out).write_text(output_json, encoding="utf-8")
        print(f"\nWrote result to {args.out}")


if __name__ == "__main__":
    _cli()