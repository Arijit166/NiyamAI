"""
train_and_evaluate.py
----------------------
Trains the existing yolo_field_detector.py model on dataset/images/train +
dataset/labels/train (the 80% split), then runs the trained model on
dataset/images/val (the 20% split) to generate predicted labels, and
compares those predictions against the ground-truth dataset/labels/val
annotations to report how well the model is doing (per-class
precision/recall/F1 at IoU >= 0.5).

Does NOT modify yolo_field_detector.py — only imports from it.

Run:
    python train_and_evaluate.py --dataset-root dataset --epochs 100 --imgsz 1024
"""

import argparse
from collections import defaultdict
from pathlib import Path

import cv2

from yolo_field_detector import (
    FIELD_CLASSES,
    create_dataset_yaml,
    train_field_detector,
    FieldDetector,
)


def load_yolo_label(label_path: Path):
    """Returns list of (class_id, x_center, y_center, w, h) — all normalized 0-1."""
    boxes = []
    if not label_path.exists():
        return boxes
    for line in label_path.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        cls_id, x, y, w, h = parts
        boxes.append((int(cls_id), float(x), float(y), float(w), float(h)))
    return boxes


def yolo_to_xyxy(box, img_w, img_h):
    cls_id, x, y, w, h = box
    x1 = (x - w / 2) * img_w
    y1 = (y - h / 2) * img_h
    x2 = (x + w / 2) * img_w
    y2 = (y + h / 2) * img_h
    return cls_id, [x1, y1, x2, y2]


def compute_iou(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area

    return inter_area / union if union > 0 else 0.0


def predictions_to_yolo_lines(detections, img_w, img_h, class_names):
    """Converts FieldDetector.detect() output (pixel xyxy) into YOLO-format lines."""
    lines = []
    name_to_id = {name: i for i, name in enumerate(class_names)}
    for det in detections:
        cls_name = det["class"]
        if cls_name not in name_to_id:
            continue  # predicted class outside this dataset's names, skip
        x1, y1, x2, y2 = det["bbox"]
        x_center = ((x1 + x2) / 2) / img_w
        y_center = ((y1 + y2) / 2) / img_h
        w = (x2 - x1) / img_w
        h = (y2 - y1) / img_h
        lines.append(f"{name_to_id[cls_name]} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}")
    return lines


def evaluate(images_val_dir, labels_val_dir, pred_labels_dir, detector, class_names, iou_threshold=0.5):
    pred_labels_dir.mkdir(parents=True, exist_ok=True)

    stats = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    image_paths = sorted([p for p in images_val_dir.iterdir()
                           if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}])

    for img_path in image_paths:
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"  [skip] could not read {img_path.name}")
            continue
        h, w = img.shape[:2]

        # --- run YOLO, save predicted labels ---
        detections = detector.detect(img)
        pred_lines = predictions_to_yolo_lines(detections, w, h, class_names)
        (pred_labels_dir / f"{img_path.stem}.txt").write_text("\n".join(pred_lines))

        # --- load ground truth ---
        gt_boxes_raw = load_yolo_label(labels_val_dir / f"{img_path.stem}.txt")
        gt_boxes = [yolo_to_xyxy(b, w, h) for b in gt_boxes_raw]

        pred_boxes = []
        for line in pred_lines:
            parts = line.split()
            cls_id = int(parts[0])
            x, y, bw, bh = map(float, parts[1:])
            pred_boxes.append(yolo_to_xyxy((cls_id, x, y, bw, bh), w, h))

        matched_gt = set()
        for pred_cls, pred_box in pred_boxes:
            best_iou, best_idx = 0.0, None
            for idx, (gt_cls, gt_box) in enumerate(gt_boxes):
                if idx in matched_gt or gt_cls != pred_cls:
                    continue
                iou = compute_iou(pred_box, gt_box)
                if iou > best_iou:
                    best_iou, best_idx = iou, idx
            cls_name = class_names[pred_cls]
            if best_idx is not None and best_iou >= iou_threshold:
                matched_gt.add(best_idx)
                stats[cls_name]["tp"] += 1
            else:
                stats[cls_name]["fp"] += 1

        for idx, (gt_cls, _) in enumerate(gt_boxes):
            if idx not in matched_gt:
                stats[class_names[gt_cls]]["fn"] += 1

    return stats


def print_report(stats, class_names):
    print(f"\n{'Class':<22}{'TP':>6}{'FP':>6}{'FN':>6}{'Precision':>12}{'Recall':>10}{'F1':>8}")
    print("-" * 66)
    total_tp = total_fp = total_fn = 0
    for cls in class_names:
        s = stats.get(cls, {"tp": 0, "fp": 0, "fn": 0})
        tp, fp, fn = s["tp"], s["fp"], s["fn"]
        total_tp += tp; total_fp += fp; total_fn += fn
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        print(f"{cls:<22}{tp:>6}{fp:>6}{fn:>6}{precision:>12.3f}{recall:>10.3f}{f1:>8.3f}")

    overall_p = total_tp / (total_tp + total_fp) if (total_tp + total_fp) else 0.0
    overall_r = total_tp / (total_tp + total_fn) if (total_tp + total_fn) else 0.0
    overall_f1 = 2 * overall_p * overall_r / (overall_p + overall_r) if (overall_p + overall_r) else 0.0
    print("-" * 66)
    print(f"{'OVERALL':<22}{total_tp:>6}{total_fp:>6}{total_fn:>6}{overall_p:>12.3f}{overall_r:>10.3f}{overall_f1:>8.3f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", default="dataset")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=1024)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--base-model", default="yolov8n.pt")
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--iou-threshold", type=float, default=0.5)
    args = parser.parse_args()

    root = Path(args.dataset_root)

    # --- Step 1: data.yaml (uses FIELD_CLASSES from yolo_field_detector.py, unchanged) ---
    data_yaml = create_dataset_yaml(root)

    # --- Step 2: train on the 80% train split ---
    best_weights = train_field_detector(
        data_yaml=data_yaml,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        base_model=args.base_model,
    )

    # --- Step 3: run the trained model on the 20% val split, save predicted labels ---
    detector = FieldDetector(best_weights, confidence_threshold=args.conf)
    pred_labels_dir = root / "labels" / "val_predicted"

    stats = evaluate(
        images_val_dir=root / "images" / "val",
        labels_val_dir=root / "labels" / "val",
        pred_labels_dir=pred_labels_dir,
        detector=detector,
        class_names=FIELD_CLASSES,
        iou_threshold=args.iou_threshold,
    )

    print_report(stats, FIELD_CLASSES)
    print(f"\nPredicted labels saved to: {pred_labels_dir}")


if __name__ == "__main__":
    main()