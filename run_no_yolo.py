"""
run_no_yolo.py
---------------
Runs preprocessing.py + ocr.py's full-page OCR + LLM pipeline directly on
one image (no YOLO), then re-validates/normalizes the format-sensitive
fields through postprocess.py's stricter pattern checks.

Two independent validation layers, not one replacing the other:
    - ocr.py's own validate_field_value / regex_extract_fields already
      rejected obviously-wrong values before a field ever reached
      structured_data.
    - postprocess.py applies a SECOND, more detailed pass (multipack
      quantities, currency-marker fixes, many more date formats, digit
      confusion correction) and NORMALIZES the value into a clean format
      (e.g. "Rs. 199", "2024-05").

If postprocess.py's stricter check disagrees with what ocr.py accepted,
the original ocr.py value is kept (never silently dropped or overwritten
with None) but flagged in "postprocess_flags" for manual review — since
ocr.py's value came from a real OCR reading, a failed stricter re-check
means "format looks unusual", not "definitely wrong".
"""

import json
import cv2
from pathlib import Path
from preprocessing import preprocess_image
from ocr import LabelOCRProcessor
from postprocess import postprocess_field, validate_date_pair

img_path = r"C:\Users\kritt\Downloads\niyamAI\dataset_raw\WhatsApp Image 2026-09-03 at 12.16.47 PM.jpeg"

# 1. Adaptive image quality preprocessing (blur/brightness/contrast/noise/skew)
processed_img, quality_report = preprocess_image(img_path)

if quality_report["reject"]:
    print(f"✗ Image rejected: {quality_report['reject_reason']}")
else:
    # 2. Initialize the OCR + LLM processor (no YOLO weights needed)
    processor = LabelOCRProcessor(
        use_angle_cls=True,
        lang="en",
        min_confidence=0.30,
        low_confidence_threshold=0.60,
        llm_model="qwen/qwen3.6-27b"
    )

    # 3. Process the (preprocessed) image
    payload, annotated_img = processor.process_image(processed_img, filename=Path(img_path).name)
    payload["quality_report"] = quality_report

    # 4. Second-pass validation/normalization via postprocess.py, for the
    #    fields it has dedicated extractors for. Maps ocr.py's structured_data
    #    keys -> postprocess.py's field_class names.
    structured_data = payload.get("structured_data", {})
    postprocess_flags = []

    _POSTPROCESS_FIELD_MAP = {
        "mrp": "mrp",
        "net_quantity": "net_quantity",
        "manufacturing_date": "manufacturing_date",
        "expiry_date": "expiry_date",
    }

    for ocr_key, pp_field_class in _POSTPROCESS_FIELD_MAP.items():
        raw_val = structured_data.get(ocr_key)
        if not raw_val or raw_val.strip().upper() == "UNKNOWN":
            continue  # nothing to re-validate

        result = postprocess_field(pp_field_class, raw_val)
        if result.valid:
            # Stricter pass confirmed AND normalized it — use the clean value.
            structured_data[ocr_key] = result.value
        else:
            # Stricter pass didn't recognize the format — keep ocr.py's
            # original value (it's still a real OCR/LLM reading), but flag
            # it so you know it didn't pass the tighter format check.
            postprocess_flags.append({
                "field": ocr_key,
                "original_value": raw_val,
                "reason": result.reason,
            })

    # Also re-validate brand / product_name (top-level, not in structured_data)
    for top_key, pp_field_class in (("brand", "brand"), ("product_name", "product_name")):
        raw_val = payload.get(top_key)
        if not raw_val:
            continue
        result = postprocess_field(pp_field_class, raw_val)
        if result.valid:
            payload[top_key] = result.value
        else:
            postprocess_flags.append({
                "field": top_key,
                "original_value": raw_val,
                "reason": result.reason,
            })

    # Cross-field date sanity check: expiry must be strictly after manufacturing.
    mfg_date = structured_data.get("manufacturing_date")
    exp_date = structured_data.get("expiry_date")
    if mfg_date and exp_date:
        pair_valid, pair_reason = validate_date_pair(mfg_date, exp_date)
        if not pair_valid:
            postprocess_flags.append({
                "field": "manufacturing_date/expiry_date",
                "original_value": f"{mfg_date} / {exp_date}",
                "reason": pair_reason,
            })

    payload["structured_data"] = structured_data
    payload["postprocess_flags"] = postprocess_flags

    # 5. Save JSON output
    json_out_path = "output.json"
    with open(json_out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"✓ Wrote JSON result to: {Path(json_out_path).resolve()}")

    # 6. Save the annotated image (OCR detection boxes, not YOLO field boxes)
    annotated_out_path = "annotated_output.jpg"
    cv2.imwrite(annotated_out_path, annotated_img)
    print(f"✓ Wrote annotated image to: {Path(annotated_out_path).resolve()}")

    # 7. Print a quick summary
    print("\n--- Structured Data ---")
    print(json.dumps({
        "brand": payload.get("brand"),
        "product_name": payload.get("product_name"),
        **structured_data
    }, indent=2, ensure_ascii=False))

    if postprocess_flags:
        print("\n--- Flagged for review (failed stricter postprocess check) ---")
        print(json.dumps(postprocess_flags, indent=2, ensure_ascii=False))