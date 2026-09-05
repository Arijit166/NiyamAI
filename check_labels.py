"""
check_labels.py
----------------
Sanity check: draws your YOLO labels/train/*.txt boxes back onto their
images so you can SEE with your own eyes whether the annotations line up
with the actual fields, before assuming the problem is "not enough data".

If mAP is exactly 0 across nearly every class despite having 13-18+
instances for several of them, that's more consistent with a coordinate
format / class-index bug than pure data scarcity -- this script makes
that visible in under a minute.

Run:
    python check_labels.py --dataset-root dataset --n 8

Look at the output images in dataset/label_check/:
  - Boxes should sit tightly around the actual text field (e.g. the MRP
    number, the barcode).
  - If boxes are wildly off-position, way too small/large, or all
    clustered in one corner regardless of what class they claim to be,
    that confirms a bug in how coordinates were exported/written.
  - If boxes look correct, the problem really is dataset size --
    proceed with reducing classes / gathering more data.
"""

import argparse
import random
from pathlib import Path

import cv2

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def load_class_names(data_yaml_path: Path):
    import yaml
    with open(data_yaml_path, "r") as f:
        data = yaml.safe_load(f)
    names = data["names"]
    if isinstance(names, dict):
        # {0: 'x', 1: 'y', ...} -> ordered list
        return [names[i] for i in sorted(names.keys())]
    return names


def draw_labels(img_path: Path, label_path: Path, class_names, out_path: Path):
    img = cv2.imread(str(img_path))
    if img is None:
        print(f"  [skip] could not read {img_path.name}")
        return
    h, w = img.shape[:2]

    if not label_path.exists():
        print(f"  [warn] no label file for {img_path.name}")
        return

    lines = label_path.read_text().strip().splitlines()
    if not lines:
        print(f"  [warn] empty label file for {img_path.name}")
        return

    for line in lines:
        parts = line.strip().split()
        if len(parts) != 5:
            print(f"  [warn] malformed line in {label_path.name}: {line!r}")
            continue
        cls_id, x, y, bw, bh = parts
        cls_id = int(cls_id)
        x, y, bw, bh = map(float, (x, y, bw, bh))

        # flag obviously-wrong normalized coords (should all be 0-1)
        if not (0 <= x <= 1 and 0 <= y <= 1 and 0 <= bw <= 1 and 0 <= bh <= 1):
            print(f"  [SUSPECT] {label_path.name}: coords out of 0-1 range "
                  f"(x={x}, y={y}, w={bw}, h={bh}) -- likely pixel coords, not normalized!")

        x1 = int((x - bw / 2) * w)
        y1 = int((y - bh / 2) * h)
        x2 = int((x + bw / 2) * w)
        y2 = int((y + bh / 2) * h)

        label_text = class_names[cls_id] if cls_id < len(class_names) else f"UNKNOWN_{cls_id}"
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
        cv2.putText(img, label_text, (x1, max(0, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)

    cv2.imwrite(str(out_path), img)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", default="dataset")
    parser.add_argument("--n", type=int, default=8, help="number of random train images to check")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    root = Path(args.dataset_root)
    images_train = root / "images" / "train"
    labels_train = root / "labels" / "train"
    out_dir = root / "label_check"
    out_dir.mkdir(exist_ok=True)

    class_names = load_class_names(root / "data.yaml")

    all_images = [p for p in images_train.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    random.seed(args.seed)
    sample = random.sample(all_images, min(args.n, len(all_images)))

    print(f"Checking {len(sample)} random train images against their labels...\n")
    for img_path in sample:
        label_path = labels_train / f"{img_path.stem}.txt"
        out_path = out_dir / f"CHECK_{img_path.stem}.jpg"
        draw_labels(img_path, label_path, class_names, out_path)
        print(f"  wrote {out_path}")

    print(f"\nOpen the images in {out_dir} and check: do the red boxes sit on the "
          f"correct field, roughly the right size? If yes, it's a data-volume "
          f"problem. If boxes are off/tiny/huge/misplaced, it's a format bug.")


if __name__ == "__main__":
    main()