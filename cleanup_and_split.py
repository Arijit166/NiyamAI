"""
cleanup_and_split.py
---------------------
Fixes stale/contaminated dataset folders, then produces a clean, verified
80/20 train/val split.

What it does, in order:
1. RESET: moves any files sitting in images/val and labels/val back into
   images/train and labels/train, so we start from one single pool of
   files. This undoes any previous (possibly broken) split.
2. CLEANUP: deletes stale cache files (train.cache, val.cache) and any
   stray "vals" (typo) folder under labels/.
3. MATCH: finds every image in images/train that has a same-stem .txt
   file in labels/train (extension of the image doesn't matter --
   .jpg/.jpeg/.png/.bmp/.webp all match against name.txt). Images with
   no matching label are deleted (these are your unannotated / no-field
   images). Labels with no matching image are also deleted (orphans) and
   reported.
4. SPLIT: shuffles the matched pairs deterministically (fixed seed) and
   moves exactly val_ratio of them into images/val + labels/val. The
   rest stay in images/train + labels/train.
5. VERIFY: asserts images/train count == labels/train count, and
   images/val count == labels/val count, and their sum equals the
   number of matched pairs found in step 3. Hard-fails (raises) if any
   of these don't hold, instead of silently printing wrong numbers.

Run:
    python cleanup_and_split.py --dataset-root dataset
"""

import argparse
import random
import shutil
from collections import defaultdict
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def find_and_quarantine_duplicate_images(images_dir: Path, quarantine_dir: Path):
    """Some images share the exact same filename stem but different
    extensions (e.g. the same shot saved as both .jpg and .jpeg). If we
    naively build a {stem: path} dict, one silently overwrites the other
    and the loser is never matched, never deleted, never moved -- it just
    sits there forever, inflating counts later. This groups by stem
    first, and if a stem has more than one file, keeps the first
    (alphabetically) and moves the rest to quarantine_dir so nothing is
    silently lost or silently kept."""
    groups = defaultdict(list)
    for p in images_dir.iterdir():
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            groups[p.stem].append(p)

    duplicates_found = {stem: paths for stem, paths in groups.items() if len(paths) > 1}
    if duplicates_found:
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        print(f"  [WARNING] {len(duplicates_found)} filename stem(s) have more than one image file:")
        for stem, paths in duplicates_found.items():
            paths_sorted = sorted(paths, key=lambda p: p.name)
            keep, extras = paths_sorted[0], paths_sorted[1:]
            print(f"      {stem}: keeping {keep.name}, quarantining {[p.name for p in extras]}")
            for extra in extras:
                shutil.move(str(extra), str(quarantine_dir / extra.name))
    else:
        print("  No duplicate-stem images found.")


def merge_back(src_dir: Path, dst_dir: Path, label: str):
    """Move every file from src_dir into dst_dir. Warns (does not overwrite)
    on filename collisions so nothing is silently lost."""
    if not src_dir.exists():
        return 0
    moved = 0
    skipped = []
    for f in list(src_dir.iterdir()):
        if not f.is_file():
            continue
        target = dst_dir / f.name
        if target.exists():
            skipped.append(f.name)
            continue
        shutil.move(str(f), str(target))
        moved += 1
    if skipped:
        print(f"  [WARNING] {len(skipped)} {label} file(s) already existed in destination "
              f"and were NOT moved (left in place, please check for duplicates):")
        for name in skipped:
            print(f"      {name}")
    return moved


def delete_stale_artifacts(root: Path):
    removed = []
    for stale in [root / "labels" / "vals", root / "images" / "vals"]:
        if stale.exists():
            shutil.rmtree(stale)
            removed.append(str(stale))
    for cache in [root / "train.cache", root / "val.cache",
                  root / "labels" / "train.cache", root / "labels" / "val.cache"]:
        if cache.exists():
            cache.unlink()
            removed.append(str(cache))
    if removed:
        print("  Removed stale artifacts:")
        for r in removed:
            print(f"      {r}")
    else:
        print("  No stale artifacts found.")


def find_matched_and_unmatched(images_dir: Path, labels_dir: Path):
    """Returns (pairs, unmatched_images, orphan_labels)."""
    image_files = {p.stem: p for p in images_dir.iterdir()
                   if p.is_file() and p.suffix.lower() in IMAGE_EXTS}
    label_files = {p.stem: p for p in labels_dir.iterdir()
                   if p.is_file() and p.suffix.lower() == ".txt"}

    matched_stems = set(image_files) & set(label_files)
    unmatched_image_stems = set(image_files) - matched_stems
    orphan_label_stems = set(label_files) - matched_stems

    pairs = [(image_files[s], label_files[s]) for s in matched_stems]
    unmatched_images = [image_files[s] for s in unmatched_image_stems]
    orphan_labels = [label_files[s] for s in orphan_label_stems]

    return pairs, unmatched_images, orphan_labels


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", default="dataset")
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--delete-orphan-labels", action="store_true",
                         help="Also delete .txt label files that have no matching image.")
    args = parser.parse_args()

    root = Path(args.dataset_root)
    images_train = root / "images" / "train"
    labels_train = root / "labels" / "train"
    images_val = root / "images" / "val"
    labels_val = root / "labels" / "val"

    for d in [images_train, labels_train, images_val, labels_val]:
        d.mkdir(parents=True, exist_ok=True)

    # --- Step 1: reset -- merge any existing val files back into train ---
    print("Step 1: resetting -- merging any existing val files back into train")
    merge_back(images_val, images_train, "image")
    merge_back(labels_val, labels_train, "label")

    # --- Step 2: delete stale cache files / stray folders ---
    print("\nStep 2: clearing stale cache files / stray folders")
    delete_stale_artifacts(root)

    # --- Step 3a: find and quarantine duplicate-stem images first ---
    print("\nStep 3a: checking for duplicate-stem images")
    quarantine_dir = root / "images" / "_duplicates_quarantined"
    find_and_quarantine_duplicate_images(images_train, quarantine_dir)

    # --- Step 3b: find matched pairs, delete unmatched images ---
    print("\nStep 3b: matching images to labels")
    pairs, unmatched_images, orphan_labels = find_matched_and_unmatched(images_train, labels_train)

    print(f"  {len(pairs)} matched image+label pairs found.")
    print(f"  {len(unmatched_images)} image(s) with no matching label -- deleting:")
    for img in unmatched_images:
        print(f"      removing: {img.name}")
        img.unlink()

    if orphan_labels:
        orphan_quarantine_dir = root / "labels" / "_orphans_quarantined"
        print(f"  {len(orphan_labels)} label file(s) with no matching image found:")
        for lbl in orphan_labels:
            if args.delete_orphan_labels:
                print(f"      removing: {lbl.name}")
                lbl.unlink()
            else:
                orphan_quarantine_dir.mkdir(parents=True, exist_ok=True)
                print(f"      quarantining (not deleting): {lbl.name} -> labels/_orphans_quarantined/")
                shutil.move(str(lbl), str(orphan_quarantine_dir / lbl.name))

    total_pairs = len(pairs)
    if total_pairs == 0:
        raise RuntimeError("No matched image+label pairs found -- check your paths before continuing.")

    # --- Step 4: shuffle + split ---
    print(f"\nStep 4: splitting {total_pairs} pairs {int((1 - args.val_ratio) * 100)}/{int(args.val_ratio * 100)}")
    random.seed(args.seed)
    shuffled = pairs[:]
    random.shuffle(shuffled)

    val_count = round(total_pairs * args.val_ratio)
    val_pairs = shuffled[:val_count]
    train_pairs = shuffled[val_count:]

    print(f"  -> {len(train_pairs)} train / {len(val_pairs)} val")

    for img_path, label_path in val_pairs:
        shutil.move(str(img_path), str(images_val / img_path.name))
        shutil.move(str(label_path), str(labels_val / label_path.name))

    # --- Step 5: verify ---
    print("\nStep 5: verifying final counts")
    final_train_images = [p for p in images_train.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    final_train_labels = [p for p in labels_train.iterdir() if p.suffix.lower() == ".txt"]
    final_val_images = [p for p in images_val.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    final_val_labels = [p for p in labels_val.iterdir() if p.suffix.lower() == ".txt"]

    print(f"  train: {len(final_train_images)} images, {len(final_train_labels)} labels")
    print(f"  val:   {len(final_val_images)} images, {len(final_val_labels)} labels")

    assert len(final_train_images) == len(final_train_labels) == len(train_pairs), \
        f"MISMATCH in train: {len(final_train_images)} images vs {len(final_train_labels)} labels " \
        f"(expected {len(train_pairs)}). Stop and investigate before training."
    assert len(final_val_images) == len(final_val_labels) == len(val_pairs), \
        f"MISMATCH in val: {len(final_val_images)} images vs {len(final_val_labels)} labels " \
        f"(expected {len(val_pairs)}). Stop and investigate before training."
    assert len(final_train_images) + len(final_val_images) == total_pairs, \
        f"MISMATCH: train+val images ({len(final_train_images) + len(final_val_images)}) " \
        f"!= total matched pairs ({total_pairs})."

    print("\nAll checks passed -- counts are exact and consistent.")


if __name__ == "__main__":
    main()