"""
Change-detection engine for the TheCraftSync web app.

Methods:
  - "tinycd"    : pretrained TinyCD (LEVIR-CD), Siamese CNN, ~0.28M params
  - "classical" : histogram-matched RGB differencing + Otsu threshold + sieve

run(before_bytes, after_bytes, method, aoi_bytes=None) -> dict of base64 PNGs + stats
"""
from __future__ import annotations

import base64
import io
import sys
import time
import warnings
from pathlib import Path

import numpy as np

# vendored TinyCD inits a torchvision backbone with the legacy ``pretrained=`` kw
warnings.filterwarnings("ignore", message=".*pretrained.*", category=UserWarning)
warnings.filterwarnings("ignore", message=".*weight enum.*", category=UserWarning)
from PIL import Image
import torch
import torchvision.transforms.functional as TF
from skimage.exposure import match_histograms
from skimage.filters import threshold_otsu
from skimage.measure import label as cc_label
from skimage.morphology import binary_erosion, disk, opening

_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_DIR))  # make the vendored ``tinycd`` package importable

from tinycd.change_classifier import ChangeClassifier  # noqa: E402

TCD_CKPT = _DIR / "tinycd" / "weights" / "levir_best.pth"
TILE = 256
MAX_SIDE = 2048                 # downscale anything larger before inference
CLASSICAL_MAX_SIDE = 1280       # classical gains nothing above this
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

METHODS = {
    "tinycd": "TinyCD (LEVIR-CD pretrained)",
    "classical": "Classical RGB differencing + Otsu",
}


class EngineError(ValueError):
    """User-facing problem with the request (bad image, empty mask, ...)."""


# ---- model (loaded once, cached) -------------------------------------------
_model: ChangeClassifier | None = None


def _get_model() -> ChangeClassifier:
    global _model
    if _model is None:
        net = ChangeClassifier(pretrained=False)  # weights come from the ckpt
        try:
            state = torch.load(TCD_CKPT, map_location="cpu", weights_only=True)
        except Exception:  # noqa: BLE001  (older checkpoint pickling)
            state = torch.load(TCD_CKPT, map_location="cpu", weights_only=False)
        net.load_state_dict(state, strict=False)
        net.eval()
        _model = net
    return _model


def warmup() -> None:
    """Run one dummy inference at server start so the first request isn't slow."""
    net = _get_model()
    with torch.no_grad():
        z = torch.zeros(1, 3, TILE, TILE)
        net(z, z)


# ---- image helpers -------------------------------------------------------
def _load_rgb(img_bytes: bytes, name: str) -> Image.Image:
    try:
        im = Image.open(io.BytesIO(img_bytes))
        im.load()
    except Exception as exc:  # noqa: BLE001
        raise EngineError(f"{name}: not a readable image") from exc
    return im.convert("RGB")


def _fit(before: Image.Image, after: Image.Image) -> tuple[Image.Image, Image.Image]:
    if after.size != before.size:
        after = after.resize(before.size, Image.BILINEAR)
    w, h = before.size
    if max(w, h) > MAX_SIDE:
        s = MAX_SIDE / max(w, h)
        sz = (round(w * s), round(h * s))
        before, after = before.resize(sz, Image.BILINEAR), after.resize(sz, Image.BILINEAR)
    return before, after


def _norm(pil: Image.Image) -> torch.Tensor:
    return TF.normalize(TF.to_tensor(pil), IMAGENET_MEAN, IMAGENET_STD)


def _load_aoi(mask_bytes: bytes, size: tuple[int, int]) -> np.ndarray:
    try:
        im = Image.open(io.BytesIO(mask_bytes)).convert("L")
        im.load()
    except Exception as exc:  # noqa: BLE001
        raise EngineError("AOI mask: not a readable image") from exc
    if im.size != size:
        im = im.resize(size, Image.NEAREST)
    aoi = np.asarray(im) > 127
    if not aoi.any():
        raise EngineError("AOI mask is empty (no white pixels)")
    return aoi


def _png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# ---- detection ---------------------------------------------------------
@torch.no_grad()
def _infer_tinycd(before: Image.Image, after: Image.Image) -> np.ndarray:
    net = _get_model()
    w, h = before.size
    pad_w, pad_h = (-w) % TILE, (-h) % TILE
    b = Image.new("RGB", (w + pad_w, h + pad_h)); b.paste(before)
    a = Image.new("RGB", (w + pad_w, h + pad_h)); a.paste(after)
    out = np.zeros((h + pad_h, w + pad_w), bool)
    for y in range(0, h + pad_h, TILE):
        for x in range(0, w + pad_w, TILE):
            box = (x, y, x + TILE, y + TILE)
            pred = net(_norm(b.crop(box)).unsqueeze(0), _norm(a.crop(box)).unsqueeze(0))
            out[y:y + TILE, x:x + TILE] = pred.squeeze().numpy() > 0.5
    return out[:h, :w]


def _infer_classical(before: Image.Image, after: Image.Image, min_blob: int = 40) -> np.ndarray:
    b = np.asarray(before, np.float32) / 255.0
    a = match_histograms(np.asarray(after, np.float32) / 255.0, b, channel_axis=-1)
    mag = np.sqrt(((a - b) ** 2).sum(axis=-1))
    try:
        thr = float(threshold_otsu(mag))
    except Exception:  # noqa: BLE001  (flat image)
        thr = float(mag.mean() + 2.0 * mag.std())
    ch = opening(mag > thr, disk(1))
    lbl = cc_label(ch)
    if lbl.max():
        sizes = np.bincount(lbl.ravel())
        sizes[0] = 0
        ch = np.isin(lbl, np.where(sizes >= min_blob)[0])
    return ch


def _detect(method: str, before: Image.Image, after: Image.Image) -> np.ndarray:
    if method == "tinycd":
        return _infer_tinycd(before, after)

    cb, ca = before, after
    if max(cb.size) > CLASSICAL_MAX_SIDE:
        s = CLASSICAL_MAX_SIDE / max(cb.size)
        sz = (round(cb.size[0] * s), round(cb.size[1] * s))
        cb, ca = cb.resize(sz, Image.BILINEAR), ca.resize(sz, Image.BILINEAR)
    mask = _infer_classical(cb, ca)
    if cb.size != before.size:
        mask = np.asarray(
            Image.fromarray(mask.astype(np.uint8) * 255).resize(before.size, Image.NEAREST)
        ) > 127
    return mask


# ---- public entry point ----------------------------------------------
def run(
    before_bytes: bytes,
    after_bytes: bytes,
    method: str,
    aoi_bytes: bytes | None = None,
) -> dict:
    if method not in METHODS:
        raise EngineError(f"unknown method '{method}'")

    before = _load_rgb(before_bytes, "before")
    after = _load_rgb(after_bytes, "after")
    orig_w, orig_h = before.size
    before, after = _fit(before, after)

    t0 = time.perf_counter()
    mask = _detect(method, before, after)
    ms = int((time.perf_counter() - t0) * 1000)

    # optional Area Of Interest — post-mask the change map
    aoi = _load_aoi(aoi_bytes, before.size) if aoi_bytes else None
    changed_pct_image = round(float(mask.mean()) * 100.0, 2)
    if aoi is not None:
        report_mask = mask & aoi
        aoi_area = int(aoi.sum())
        changed_percent = round(int(report_mask.sum()) / aoi_area * 100.0, 2)
        aoi_coverage = round(aoi_area / aoi.size * 100.0, 2)
    else:
        report_mask, changed_percent, aoi_coverage = mask, changed_pct_image, None

    af = np.asarray(after, np.float32) / 255.0
    overlay = af.copy()
    overlay[report_mask] = 0.35 * overlay[report_mask] + 0.65 * np.array([1.0, 0.15, 0.15])
    if aoi is not None:
        edge = aoi ^ binary_erosion(aoi)
        edge = edge | np.roll(edge, 1, 0) | np.roll(edge, 1, 1)
        overlay[edge] = np.array([0.13, 0.95, 0.92])  # cyan AOI boundary

    overlay_img = Image.fromarray((np.clip(overlay, 0, 1) * 255).astype(np.uint8))
    diff_img = Image.fromarray((report_mask * 255).astype(np.uint8))

    return {
        "method": method,
        "method_label": METHODS[method],
        "changed_percent": changed_percent,
        "changed_percent_image": changed_pct_image,
        "aoi_applied": aoi is not None,
        "aoi_coverage_percent": aoi_coverage,
        "width": before.size[0],
        "height": before.size[1],
        "original_width": orig_w,
        "original_height": orig_h,
        "resized": before.size != (orig_w, orig_h),
        "ms": ms,
        "before_png": _png_b64(before),
        "after_png": _png_b64(after),
        "difference_png": _png_b64(diff_img),
        "overlay_png": _png_b64(overlay_img),
    }
