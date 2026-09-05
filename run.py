"""
run.py
------
CLI entry point for the full label-extraction pipeline.

Usage:
    python run.py <image_or_directory> [--output-dir OUTPUT_DIR]

Examples:
    python run.py dataset/processed
    python run.py sample_label.jpg --output-dir ocr_output
"""

import argparse
import json
import sys
from pathlib import Path

import cv2

from pipeline import LabelExtractionPipeline

VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# Default target used when no path is passed on the command line
DEFAULT_TARGET = r"C:\Users\kritt\Downloads\niyamAI\dataset_raw\WhatsApp Image 2026-09-03 at 12.17.13 PM.jpeg"


def collect_image_files(target: Path):
    if target.is_file() and target.suffix.lower() in VALID_EXTENSIONS:
        return [target]
    if target.is_dir():
        return sorted(f for f in target.iterdir() if f.suffix.lower() in VALID_EXTENSIONS)
    return []


def main():
    parser = argparse.ArgumentParser(description="Run the label OCR + extraction pipeline.")
    parser.add_argument(
        "target", type=str, nargs="?", default=DEFAULT_TARGET,
        help="Image file or directory of images to process.",
    )
    parser.add_argument(
        "--output-dir", type=str, default="pipeline_output",
        help="Directory to write JSON + annotated debug images to (default: pipeline_output)",
    )
    parser.add_argument(
        "--llm-model", type=str, default="qwen/qwen3.6-27b",
        help="LLM model name for the correction/extraction stage (passed to LabelOCRProcessor).",
    )
    args = parser.parse_args()

    target_path = Path(args.target)
    output_dir = Path(args.output_dir)
    annotated_dir = output_dir / "annotated"
    output_dir.mkdir(parents=True, exist_ok=True)
    annotated_dir.mkdir(parents=True, exist_ok=True)

    image_files = collect_image_files(target_path)
    if not image_files:
        print(f"[!] No valid image files found at '{target_path}'")
        sys.exit(1)

    print(f"[*] Initializing pipeline (loading OCR + LLM client)...")
    pipeline = LabelExtractionPipeline(llm_model=args.llm_model)

    print(f"[*] Processing {len(image_files)} file(s)...\n")
    for img_file in image_files:
        try:
            result, annotated_img = pipeline.process_file(img_file)

            json_out_path = output_dir / f"{img_file.stem}.json"
            with open(json_out_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)

            if annotated_img is not None:
                img_out_path = annotated_dir / img_file.name
                cv2.imwrite(str(img_out_path), annotated_img)
            else:
                img_out_path = None

            doc_score = result.get("confidence", {}).get("document_score")
            needs_review = result.get("review", {}).get("needs_manual_review")

            print(
                f"  [OK] {img_file.name} -> "
                f"document_score={doc_score} | needs_manual_review={needs_review}"
            )
            print(f"       Saved JSON: {json_out_path}")
            if img_out_path:
                print(f"       Saved Visual: {img_out_path}")
            print()

        except Exception as e:
            print(f"  [FAIL] Failed to process {img_file.name}: {e}\n")

    print("[*] Done.")


if __name__ == "__main__":
    main()