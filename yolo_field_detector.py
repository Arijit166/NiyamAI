"""
yolo_field_detector.py
-----------------------
YOLO-based ROI detector for packaged-commodity labels. Its job in this
pipeline is narrow: find WHERE each field lives on the label so
roi_preprocessing.py / pipeline.py can crop it and OCR it directly, instead
of relying only on label-proximity spatial matching over full-page OCR
detections (which is what ocr.py's spatial_extract_labeled_fields already
does as a fallback layer).

Classes (index position matters, must match your dataset's data.yaml
and the class ids inside every labels/*/*.txt file):

     0: manufacturer_name
     1: manufacturer_address
     2: packer_name
     3: packer_address
     4: importer_name
     5: importer_address
     6: country_of_origin
     7: brand
     8: product_name
     9: net_quantity
    10: mrp
    11: manufacturing_date
    12: expiry_date
    13: consumer_care_name
    14: consumer_care_address
    15: consumer_care_phone
    16: batch_number
    17: lot_number
    18: serial_number
    19: dimensions
    20: fssai_license
    21: bis_mark
    22: agmark
    23: hallmark
    24: barcode
    25: qr_code
    26: storage_instructions
    27: usage_instructions
    28: marketing_claims

Wraps Ultralytics YOLOv8 (pip install ultralytics).

------------------------------------------------------------------------
YOU MUST TRAIN THIS YOURSELF FIRST — there is no pretrained model for
these label-specific classes. Detection quality is entirely a function
of how many labeled example images you give it.
------------------------------------------------------------------------

Usage — training:
    python yolo_field_detector.py train --data dataset/data.yaml --epochs 100 --imgsz 1024

Usage — inference (standalone):
    from yolo_field_detector import FieldDetector
    detector = FieldDetector("runs/detect/field_detector/weights/best.pt")
    regions = detector.detect("label.jpg")
"""

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import numpy as np

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None  # module stays importable (e.g. for FIELD_CLASSES) without ultralytics installed


# NOTE: order matters — this must match the class ids CVAT wrote into your
# labels/*/*.txt files (0 = manufacturer_name ... 28 = marketing_claims).
# If you ever re-export from CVAT with a different class order, update
# this list to match, don't just append/reorder casually.
FIELD_CLASSES = [
    "manufacturer_name",
    "manufacturer_address",
    "packer_name",
    "packer_address",
    "importer_name",
    "importer_address",
    "country_of_origin",
    "brand",
    "product_name",
    "net_quantity",
    "mrp",
    "manufacturing_date",
    "expiry_date",
    "consumer_care_name",
    "consumer_care_address",
    "consumer_care_phone",
    "batch_number",
    "lot_number",
    "serial_number",
    "dimensions",
    "fssai_license",
    "bis_mark",
    "agmark",
    "hallmark",
    "barcode",
    "qr_code",
    "storage_instructions",
    "usage_instructions",
    "marketing_claims",
]


def _require_ultralytics():
    if YOLO is None:
        print("\n[ERROR] ultralytics is not installed.")
        print("Install via: pip install ultralytics --break-system-packages\n")
        sys.exit(1)


def create_dataset_yaml(dataset_root: Union[str, Path], output_path: Optional[Union[str, Path]] = None) -> Path:
    """
    Generates data.yaml for the standard YOLO layout:

        dataset_root/images/train,val/*.jpg|png
        dataset_root/labels/train,val/*.txt   (class x_center y_center w h, normalized 0-1)

    This intentionally does NOT use CVAT's own exported data.yaml (which
    points at train.txt/val.txt file lists with path: .). Your pipeline
    uses the folder-based layout produced by cleanup_and_split.py, so we
    keep writing that format here and only borrow the class *names* list
    from CVAT.
    """
    dataset_root = Path(dataset_root)
    output_path = Path(output_path) if output_path else dataset_root / "data.yaml"
    content = (
        f"path: {dataset_root.resolve()}\n"
        f"train: images/train\n"
        f"val: images/val\n\n"
        f"nc: {len(FIELD_CLASSES)}\n"
        f"names: {FIELD_CLASSES}\n"
    )
    output_path.write_text(content)
    print(f"Wrote dataset config to {output_path}")
    return output_path


def train_field_detector(
    data_yaml: Union[str, Path],
    epochs: int = 100,
    imgsz: int = 1024,
    base_model: str = "yolov8n.pt",
    batch: int = 16,
    project: str = "runs/detect",
    name: str = "field_detector",
    patience: int = 30,
) -> Path:
    """
    base_model="yolov8n.pt" is fastest to train/deploy. With 29 classes and
    a small dataset (~100 train images), watch val loss closely — you are
    likely to overfit well before epoch 100. `patience` enables Ultralytics'
    built-in early stopping (stops if val metrics don't improve for that
    many epochs) so a long epoch count is safe to leave as a ceiling.
    """
    _require_ultralytics()
    model = YOLO(base_model)
    model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        project=project,
        name=name,
        patience=patience,
        # ROI boxes are small relative to the full label; these help the
        # detector generalize across phone photos at different distances/
        # angles/lighting.
        degrees=10,
        perspective=0.0005,
        hsv_v=0.3,
        mosaic=1.0,
    )
    best_weights = Path(project) / name / "weights" / "best.pt"
    print(f"\nTraining complete. Best weights: {best_weights}")
    return best_weights


class FieldDetector:
    """Inference wrapper around a trained YOLO field detector."""

    def __init__(self, weights_path: Union[str, Path], confidence_threshold: float = 0.35):
        _require_ultralytics()
        weights_path = Path(weights_path)
        if not weights_path.exists():
            raise FileNotFoundError(
                f"No trained weights found at {weights_path}. "
                f"Run training first: python yolo_field_detector.py train --data <data.yaml>"
            )
        self.model = YOLO(str(weights_path))
        self.confidence_threshold = confidence_threshold

    def detect(self, image: Union[str, Path, np.ndarray], confidence_threshold: Optional[float] = None) -> List[Dict[str, Any]]:
        """
        Runs detection on a single image (path or numpy array — e.g. the
        output of preprocessing.preprocess_image).

        Returns: [{"class": "expiry_date", "bbox": [x1,y1,x2,y2], "confidence": 0.91}, ...]
        """
        threshold = confidence_threshold if confidence_threshold is not None else self.confidence_threshold
        results = self.model.predict(source=image, conf=threshold, verbose=False)

        detections: List[Dict[str, Any]] = []
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue
            for box in boxes:
                cls_idx = int(box.cls[0])
                cls_name = result.names.get(cls_idx, f"class_{cls_idx}")
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                detections.append({
                    "class": cls_name,
                    "bbox": [int(x1), int(y1), int(x2), int(y2)],
                    "confidence": round(conf, 4),
                })
        return detections

    def detect_best_per_class(self, image: Union[str, Path, np.ndarray], confidence_threshold: Optional[float] = None) -> Dict[str, Dict[str, Any]]:
        """
        Returns only the single highest-confidence detection per class, as
        {class_name: detection}. A class not detected is simply absent —
        never guessed — so pipeline.py knows to fall back to ocr.py's
        full-page spatial/LLM extraction for that field instead.
        """
        all_detections = self.detect(image, confidence_threshold)
        best: Dict[str, Dict[str, Any]] = {}
        for det in all_detections:
            cls = det["class"]
            if cls not in best or det["confidence"] > best[cls]["confidence"]:
                best[cls] = det
        return best


def _cli():
    parser = argparse.ArgumentParser(description="Train or run the YOLO field detector")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init-dataset", help="Generate data.yaml for a dataset folder")
    init_parser.add_argument("--dataset-root", required=True)

    train_parser = subparsers.add_parser("train", help="Train the field detector")
    train_parser.add_argument("--data", required=True)
    train_parser.add_argument("--epochs", type=int, default=100)
    train_parser.add_argument("--imgsz", type=int, default=1024)
    train_parser.add_argument("--batch", type=int, default=16)
    train_parser.add_argument("--base-model", default="yolov8n.pt")
    train_parser.add_argument("--patience", type=int, default=30)

    detect_parser = subparsers.add_parser("detect", help="Run inference on a single image")
    detect_parser.add_argument("--weights", required=True)
    detect_parser.add_argument("--image", required=True)
    detect_parser.add_argument("--conf", type=float, default=0.35)

    args = parser.parse_args()

    if args.command == "init-dataset":
        create_dataset_yaml(args.dataset_root)
    elif args.command == "train":
        train_field_detector(
            data_yaml=args.data,
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            base_model=args.base_model,
            patience=args.patience,
        )
    elif args.command == "detect":
        detector = FieldDetector(args.weights, confidence_threshold=args.conf)
        regions = detector.detect(args.image)
        import json
        print(json.dumps(regions, indent=2))


if __name__ == "__main__":
    _cli()