"""Silhouette IoU between photo masks and model masks (numpy + PIL).

Usage: python3 iou.py <ref_dir> <model_dir> <out_dir>
Aligns each model mask to its photo mask (scale search 0.90-1.10, translation by FFT
cross-correlation) and reports IoU. The side photo shows the launcher raised, so the side
score is also given for the front half of the vehicle only (cab, front axle, intake box).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ref_dir, model_dir, out_dir = sys.argv[1:4]


def load(path):
    return (np.asarray(Image.open(path).convert("L"), dtype=np.float32) > 127).astype(np.float32)


def place(model, shape, scale):
    h, w = model.shape
    im = Image.fromarray((model * 255).astype(np.uint8)).resize(
        (max(1, int(w * scale)), max(1, int(h * scale))), Image.NEAREST)
    m = np.asarray(im, dtype=np.float32) / 255.0
    H, W = shape
    canvas = np.zeros((max(H, m.shape[0]) * 2, max(W, m.shape[1]) * 2), np.float32)
    canvas[: m.shape[0], : m.shape[1]] = m
    return canvas


def best_shift(ref, canvas):
    H, W = canvas.shape
    R = np.zeros_like(canvas)
    R[: ref.shape[0], : ref.shape[1]] = ref
    corr = np.real(np.fft.ifft2(np.fft.fft2(R) * np.conj(np.fft.fft2(canvas))))
    dy, dx = np.unravel_index(np.argmax(corr), corr.shape)
    shifted = np.roll(np.roll(canvas, dy, 0), dx, 1)
    return shifted[: ref.shape[0], : ref.shape[1]]


def iou(a, b):
    inter = np.logical_and(a > 0.5, b > 0.5).sum()
    uni = np.logical_or(a > 0.5, b > 0.5).sum()
    return float(inter) / float(max(uni, 1))


report = {}
for view in ("side", "front"):
    ref = load(os.path.join(ref_dir, f"{view}_mask.png"))
    model = load(os.path.join(model_dir, f"{view}_model.png"))
    best = (-1.0, None, None)
    for s in (np.arange(0.97, 1.031, 0.01) if view == "side" else np.arange(0.90, 1.101, 0.01)):
        aligned = best_shift(ref, place(model, ref.shape, s))
        v = iou(ref, aligned)
        if v > best[0]:
            best = (v, s, aligned)
    score, scale, aligned = best
    entry = {"iou": round(score, 4), "scale": round(float(scale), 3)}
    if view == "side":
        cols = np.where(ref.any(axis=0))[0]
        cut = int(cols[0] + 0.5 * (cols[-1] - cols[0]))  # front half (cab on image right)
        entry["iou_front_half"] = round(iou(ref[:, cut:], aligned[:, cut:]), 4)
    report[view] = entry
    over = np.zeros(ref.shape + (3,), np.uint8)
    over[..., 0] = (ref > 0.5) * 255           # red = photo only
    over[..., 1] = (aligned > 0.5) * 255       # green = model only, yellow = both
    Image.fromarray(over).save(os.path.join(out_dir, f"iou_{view}.png"))
print(json.dumps(report, indent=1))
with open(os.path.join(out_dir, "iou.json"), "w") as f:
    json.dump(report, f, indent=1)
