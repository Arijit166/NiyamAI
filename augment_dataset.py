"""
Dataset Augmentation Script
----------------------------
Generates 10 augmented variants for every original image.
200 originals -> 2000 augmented images.

Augmentations included (one output image per augmentation):
    1. Brightness +
    2. Brightness -
    3. Contrast +
    4. Contrast -
    5. Blur
    6. Motion Blur
    7. Rotation +15deg
    8. Rotation -15deg
    9. Perspective warp
    10. Gaussian Noise

Bonus (optional, commented out below, enable if you want MORE than 2000):
    11. Shadow overlay
    12. Heavy JPEG compression

Every image (regardless of augmentation) is saved as JPEG with a
randomized quality between 75-95, so mild "compression realism" is
baked into ALL outputs automatically, matching your "Compression" item
without needing a separate counted variant.

Usage:
    python augment_dataset.py --input dataset_raw --output dataset_augmented

Input folder structure supported (either works):
    dataset_raw/maggi/front.jpg, dataset_raw/maggi/back.png, ...
    dataset_raw/img1.jpg, dataset_raw/img2.webp, ...   (flat folder also fine)

Output structure mirrors input structure, with augmented images named:
    <original_name>__<augmentation_name>.jpg
"""

import argparse
import os
import random
from pathlib import Path

import cv2
import numpy as np
import albumentations as A
from PIL import Image

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def load_image_as_rgb(path: Path) -> np.ndarray:
    """Load any supported format (incl. webp) and return RGB numpy array."""
    img = Image.open(path).convert("RGB")
    return np.array(img)


def save_image(img_rgb: np.ndarray, path: Path):
    """Save RGB numpy array as JPEG with randomized quality (75-95)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    quality = random.randint(75, 95)
    Image.fromarray(img_rgb).save(path, format="JPEG", quality=quality)


def build_augmentations():
    """Return a dict of {name: albumentations transform}, one entry per variant."""
    return {
        "brightness_up": A.RandomBrightnessContrast(
            brightness_limit=(0.25, 0.4), contrast_limit=0.0, p=1.0
        ),
        "brightness_down": A.RandomBrightnessContrast(
            brightness_limit=(-0.4, -0.25), contrast_limit=0.0, p=1.0
        ),
        "contrast_up": A.RandomBrightnessContrast(
            brightness_limit=0.0, contrast_limit=(0.3, 0.5), p=1.0
        ),
        "contrast_down": A.RandomBrightnessContrast(
            brightness_limit=0.0, contrast_limit=(-0.5, -0.3), p=1.0
        ),
        "blur": A.GaussianBlur(blur_limit=(5, 9), p=1.0),
        "motion_blur": A.MotionBlur(blur_limit=(9, 15), p=1.0),
        "rotate_pos15": A.Rotate(
            limit=(15, 15), border_mode=cv2.BORDER_REPLICATE, p=1.0
        ),
        "rotate_neg15": A.Rotate(
            limit=(-15, -15), border_mode=cv2.BORDER_REPLICATE, p=1.0
        ),
        "perspective": A.Perspective(scale=(0.05, 0.12), p=1.0),
        "noise": A.OneOf(
            [
                A.GaussNoise(std_range=(0.1, 0.25), p=1.0),
                A.ISONoise(color_shift=(0.02, 0.05), intensity=(0.2, 0.5), p=1.0),
            ],
            p=1.0,
        ),
        # ---- Bonus / optional extras (uncomment to add more variants) ----
        # "shadow": A.RandomShadow(
        #     shadow_roi=(0, 0.4, 1, 1), num_shadows_lower=1,
        #     num_shadows_upper=2, shadow_dimension=5, p=1.0
        # ),
        # "heavy_compression": A.ImageCompression(quality_lower=15, quality_upper=30, p=1.0),
    }


def find_images(input_dir: Path):
    """Recursively find every supported image, preserving relative subfolder."""
    for path in input_dir.rglob("*"):
        if path.suffix.lower() in SUPPORTED_EXTS and path.is_file():
            yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Folder with original images")
    parser.add_argument("--output", required=True, help="Folder to save augmented images")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    augmentations = build_augmentations()

    images = list(find_images(input_dir))
    if not images:
        print(f"No supported images found in {input_dir} (looked for {SUPPORTED_EXTS})")
        return

    print(f"Found {len(images)} original images.")
    print(f"Generating {len(augmentations)} variants each -> "
          f"{len(images) * len(augmentations)} augmented images.\n")

    total_saved = 0
    for img_path in images:
        try:
            img_rgb = load_image_as_rgb(img_path)
        except Exception as e:
            print(f"  [skip] Could not read {img_path}: {e}")
            continue

        rel_folder = img_path.parent.relative_to(input_dir)
        stem = img_path.stem

        for aug_name, transform in augmentations.items():
            try:
                augmented = transform(image=img_rgb)["image"]
            except Exception as e:
                print(f"  [warn] {aug_name} failed on {img_path.name}: {e}")
                continue

            out_path = output_dir / rel_folder / f"{stem}__{aug_name}.jpg"
            save_image(augmented, out_path)
            total_saved += 1

        print(f"  [ok] {img_path.name} -> {len(augmentations)} variants")

    print(f"\nDone. {total_saved} augmented images saved to: {output_dir.resolve()}")


if __name__ == "__main__":
    main()