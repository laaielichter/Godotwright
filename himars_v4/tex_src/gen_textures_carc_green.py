#!/usr/bin/env python3
"""Tileable PBR texture sets for the M142 HIMARS v3 (Godot 4.7).

numpy + PIL only, one fixed seed. Every texture is periodic by construction:
noise is band-limited in the FFT domain, slopes use wrapped differences and
all patterns use modular coordinates, so row/column 0 meets row/column N-1
without a seam.

Per set this writes <set>_albedo.png (sRGB), <set>_normal.png (OpenGL
convention: tangent space, +Y up, RGB 0..255) and <set>_orm.png (R = ambient
occlusion, G = roughness, B = metallic), plus manifest.json. Output goes to
the directory this script lives in.
"""
import json
import math
import os

import numpy as np
from PIL import Image

SEED = 20261028
OUT = os.path.dirname(os.path.abspath(__file__))
F32 = np.float32


def rng_for(set_id, stream):
    """Reproducible, independent random stream per (set, use)."""
    return np.random.default_rng([SEED, set_id, stream])


# ------------------------------------------------------------ spectra

_GRID = {}


def _grid(h, w):
    """Frequencies in cycles per tile on an (h, w) rfft2 half-spectrum."""
    if (h, w) not in _GRID:
        fy = np.fft.fftfreq(h) * h
        fx = np.fft.rfftfreq(w) * w
        FY, FX = np.meshgrid(fy, fx, indexing="ij")
        _GRID[(h, w)] = (FX, FY)
    return _GRID[(h, w)]


def noise(h, w, rng, amp):
    """White noise shaped in frequency by amp(FX, FY), then inverse FFT.
    Periodic by construction. Returns float32 with mean 0 and std 1."""
    FX, FY = _grid(h, w)
    a = amp(FX, FY)
    shape = a.shape
    spec = (rng.standard_normal(shape) + 1j * rng.standard_normal(shape)) * a
    f = np.fft.irfft2(spec, s=(h, w))
    f = (f - f.mean()) / (f.std() + 1e-12)
    return f.astype(F32)


def octave(kc, bw=0.5):
    """Log-Gaussian band centred on kc cycles per tile, bw in octaves."""
    lc = math.log2(kc)

    def amp(FX, FY):
        k = np.hypot(FX, FY)
        out = np.exp(-0.5 * ((np.log2(np.maximum(k, 1e-6)) - lc) / bw) ** 2)
        out[k < 0.5] = 0.0  # no DC
        return out

    return amp


def streaks(along, kc, bw=0.6, sig=1.0):
    """Noise nearly constant along one axis ('x' or 'y'), so it reads as
    streaks or fibres running that way. kc is the across-axis band centre,
    sig the bandwidth along the streak (cycles per tile)."""
    lc = math.log2(kc)

    def amp(FX, FY):
        long_, across = (FX, FY) if along == "x" else (FY, FX)
        acr = np.abs(across)
        band = np.exp(-0.5 * ((np.log2(np.maximum(acr, 1e-6)) - lc) / bw) ** 2)
        band[acr < 1.0] = 0.0
        return np.exp(-0.5 * (long_ / sig) ** 2) * band

    return amp


def blur(a, sigma_px):
    """Periodic Gaussian blur, sigma in pixels."""
    h, w = a.shape
    FX, FY = _grid(h, w)
    resp = np.exp(-2 * np.pi ** 2 * sigma_px ** 2 * ((FX / w) ** 2 + (FY / h) ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * resp, s=(h, w)).astype(F32)


# ------------------------------------------------------------ helpers

def u8(x01):
    return np.clip(np.round(x01 * 255.0), 0, 255).astype(np.uint8)


def std(x):
    return ((x - x.mean()) / x.std()).astype(F32)


def soft_mask(f, thr, e):
    """Smooth threshold. Returns (mask 0..1, edge 0..1 peaking on the border)."""
    s = np.clip((f - (thr - e)) / (2 * e), 0, 1)
    return s * s * (3 - 2 * s), 4 * s * (1 - s)


def wrapped(v, centre, period):
    """Signed distance from v to the nearest of centre + k * period."""
    return (v - centre + period / 2) % period - period / 2


def tint(base, factor, add=None):
    """sRGB colour base * factor (+ add), factor is an HxW field."""
    col = np.asarray(base, F32) * factor[..., None].astype(F32)
    if add is not None:
        col = col + add[..., None].astype(F32)
    return u8(col / 255.0)


def normal_from_height(H, strength):
    """Tangent-space normal, OpenGL convention (+X right, +Y up, +Z out).
    Image rows run downward, so +Y up is -row: n_y = +dH/drow, n_x = -dH/dcol.
    Wrapped central differences keep the map periodic."""
    gx = 0.5 * (np.roll(H, -1, 1) - np.roll(H, 1, 1))
    gy = 0.5 * (np.roll(H, -1, 0) - np.roll(H, 1, 0))
    nx = -strength * gx
    ny = strength * gy
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
    n = np.stack([nx * inv, ny * inv, inv], axis=-1)
    return u8(n * 0.5 + 0.5)


def orm_pack(ao, rough, metal):
    return u8(np.stack([np.clip(ao, 0, 1), np.clip(rough, 0, 1),
                        np.clip(metal, 0, 1)], axis=-1))


def blob_stats(mask, tile_m):
    """Connected components of a boolean grid (periodic), by min-label
    propagation. Returns count and equivalent-diameter quartiles in metres."""
    h, w = mask.shape
    inf = h * w
    idx = np.arange(h * w, dtype=np.int64).reshape(h, w)
    lab = np.where(mask, idx, inf)
    for _ in range(20000):
        new = lab
        for ax in (0, 1):
            for sh in (1, -1):
                new = np.minimum(new, np.roll(lab, sh, ax))
        new = np.where(mask, new, inf)
        if np.array_equal(new, lab):
            break
        lab = new
    _, cnt = np.unique(lab[mask], return_counts=True)
    diam = 2 * np.sqrt(cnt / np.pi) * tile_m / h
    q1, med, q3 = np.percentile(diam, [25, 50, 75])
    return {"blobs": int(len(cnt)), "diam_q1_m": round(float(q1), 2),
            "diam_med_m": round(float(med), 2), "diam_q3_m": round(float(q3), 2)}


# ------------------------------------------------------------ sets

def camo_od():
    N, sid = 4096, 1
    R = lambda k: rng_for(sid, k)  # noqa: E731

    # Blotch shapes: low-frequency noise (0.7 cycles per 1.6 m tile for tan,
    # 0.8 for dark green) with a light mid-frequency term for ragged edges.
    # At 24 % tan cover this gives 1 to 4 blobs per tile, equivalent diameter
    # about 0.4 to 0.9 m (about 0.6 to 1.1 m across for the ragged outlines).
    t = std(noise(N, N, R(0), octave(0.7, 1.0))
            + 0.06 * noise(N, N, R(1), octave(4.0, 0.5)))
    g = std(noise(N, N, R(2), octave(0.8, 0.9))
            + 0.06 * noise(N, N, R(3), octave(5.0, 0.5)))
    low = noise(N, N, R(4), octave(6.0, 0.8))         # low ground: dust settles
    mottle = noise(N, N, R(5), octave(60.0, 0.8))     # pigment variation
    grain = noise(N, N, R(6), octave(900.0, 0.45))    # 4 to 5 px grain
    grain2 = noise(N, N, R(7), octave(2000.0, 0.45))  # 2 px grain

    thr_t = np.quantile(t, 1 - 0.24)  # 24 % tan
    thr_g = np.quantile(g, 1 - 0.10)  # 10 % dark green
    mt, et = soft_mask(t, thr_t, 0.08)
    mg, eg = soft_mask(g, thr_g, 0.08)
    edge = np.maximum(et, eg).astype(F32)

    # Panel seams every 0.8 m (2048 px), at 0.4 m + k * 0.8 m, slightly wandering
    # with integer-cycle sinusoids so the lines stay periodic.
    yv = np.arange(N, dtype=F32)[:, None]
    xv = np.arange(N, dtype=F32)[None, :]
    wob_v = 4 * np.sin(2 * np.pi * 3 * yv / N) + 2 * np.sin(2 * np.pi * 7 * yv / N + 1.0)
    wob_h = 4 * np.sin(2 * np.pi * 5 * xv / N + 0.3) + 2 * np.sin(2 * np.pi * 2 * xv / N + 2.0)
    d_v = np.abs(wrapped(xv - wob_v, 1024.0, 2048.0))
    d_h = np.abs(wrapped(yv - wob_h, 1024.0, 2048.0))
    dseam = np.minimum(d_v, d_h).astype(F32)
    seam = np.exp(-(dseam / 2.2) ** 2).astype(F32)  # groove core, about 2 px

    base = np.array([74, 80, 52], F32)     # FS 34088 olive drab
    tan = np.array([150, 136, 98], F32)    # FS 33446 CARC tan 686A
    dgc = np.array([42, 48, 30], F32)      # dark green
    dust_c = np.array([112, 108, 86], F32)

    mot = (1 + 0.035 * mottle)[..., None].astype(F32)
    col = base * mot
    col = col * (1 - mt[..., None]) + tan * mot * mt[..., None]
    col = col * (1 - mg[..., None]) + dgc * mot * mg[..., None]
    col = col * (1 + 0.12 * edge[..., None])  # weathered, lighter blotch borders
    dust = np.clip(np.clip(-low - 0.2, 0, 1) * 0.4 + 0.3 * seam, 0, 0.5) * (1 - mg)
    col = col * (1 - dust[..., None]) + dust_c * dust[..., None]  # dust in low areas
    col = col * (1 - 0.10 * seam[..., None])                       # faint seams
    col = col * (1 + 0.045 * grain + 0.025 * grain2)[..., None]    # fine grain
    alb = u8(col / 255.0)
    del col, mot, dust

    H = 0.8 * grain + 0.4 * grain2 - 2.0 * seam  # fine grain plus seam grooves
    nrm = normal_from_height(H, 0.16)

    seam_wide = np.exp(-(dseam / 3.0) ** 2).astype(F32)
    ao = 0.95 + 0.03 * np.tanh(low) - 0.08 * seam_wide
    rough = 0.60 + 0.06 * np.tanh(mottle + 0.5 * grain) + 0.03 * edge
    orm = orm_pack(np.clip(ao, 0.85, 1.0), np.clip(rough, 0.5, 0.7), np.zeros_like(ao))

    # Diagnostics: region colours and blotch sizes (on a 512 grid, 1.6 m tile).
    olive_m = (mt < 0.02) & (mg < 0.02)
    tan_m = (mt > 0.98) & (mg < 0.02)
    dg_m = mg > 0.98
    down = lambda m: m.reshape(512, 8, 512, 8).mean(axis=(1, 3))  # noqa: E731
    info = {
        "olive_mean": [round(float(v), 1) for v in alb[olive_m].mean(0)],
        "tan_mean": [round(float(v), 1) for v in alb[tan_m].mean(0)],
        "dg_mean": [round(float(v), 1) for v in alb[dg_m].mean(0)],
        "tan_area": round(float((mt > 0.5).mean()), 3),
        "dg_area": round(float((mg > 0.5).mean()), 3),
        "tan_blobs": blob_stats(down(mt) > 0.5, 1.6),
        "dg_blobs": blob_stats(down(mg) > 0.5, 1.6),
    }
    return alb, nrm, orm, info


def steel():
    N, sid = 2048, 2
    R = lambda k: rng_for(sid, k)  # noqa: E731
    streak = noise(N, N, R(0), streaks("x", kc=300.0, bw=0.9, sig=1.0))  # brushed along x
    mot = noise(N, N, R(1), octave(10.0, 0.7))
    grain = noise(N, N, R(2), octave(500.0, 0.6))
    alb = tint([96, 98, 100], 1 + 0.05 * streak + 0.012 * mot + 0.01 * grain)
    nrm = normal_from_height(0.6 * streak + 0.3 * grain, 0.05)
    ao = 0.98 + 0.02 * np.tanh(mot)
    rough = 0.45 + 0.06 * np.tanh(0.8 * streak + 0.4 * mot)
    metal = 0.90 + 0.012 * np.tanh(mot)
    return alb, nrm, orm_pack(ao, rough, metal), {}


def steel_dark():
    N, sid = 2048, 3
    R = lambda k: rng_for(sid, k)  # noqa: E731
    mot = noise(N, N, R(0), octave(25.0, 0.7))
    grain = noise(N, N, R(1), octave(600.0, 0.6))
    streak = noise(N, N, R(2), streaks("x", kc=250.0, bw=0.9, sig=1.0))
    alb = tint([30, 30, 32], 1 + 0.10 * mot + 0.03 * grain + 0.02 * streak)
    nrm = normal_from_height(0.5 * grain + 0.3 * mot + 0.2 * streak, 0.10)
    ao = 0.97 + 0.03 * np.tanh(mot)
    rough = 0.62 + 0.05 * np.tanh(0.8 * mot + 0.3 * grain)
    metal = 0.80 + 0.012 * np.tanh(mot)
    return alb, nrm, orm_pack(ao, rough, metal), {}


def rubber():
    N, sid = 2048, 4
    R = lambda k: rng_for(sid, k)  # noqa: E731
    grain = noise(N, N, R(0), octave(1000.0, 0.5))
    mot = noise(N, N, R(1), octave(20.0, 0.8))
    u = R(2).random((N, N))
    sp = blur((u > 0.9975).astype(F32), 1.1)            # sparse fine speckle
    sp = np.clip(sp / np.quantile(sp, 0.999), 0, 1).astype(F32)
    alb = tint([18, 18, 18], 1 + 0.04 * grain + 0.03 * mot, add=16.0 * sp)
    xx = np.arange(N, dtype=F32)[None, :]
    yy = np.arange(N, dtype=F32)[:, None]
    tread = np.sin(2 * np.pi * (xx + yy) / 32.0).astype(F32)  # diagonal tread ridges, 32 px
    nrm = normal_from_height(0.6 * tread + 0.4 * grain + 0.3 * sp, 0.12)
    ao = 0.97 + 0.03 * np.tanh(grain)
    rough = 0.90 + 0.03 * np.tanh(mot)
    return alb, nrm, orm_pack(ao, rough, np.zeros_like(ao)), {}


def canvas():
    N, sid = 2048, 5
    R = lambda k: rng_for(sid, k)  # noqa: E731
    # 2048 is not a multiple of 6, so a true 6 px weave cannot tile it. 341 cycles
    # per tile give a 6.006 px period that still wraps exactly.
    cycles = 341
    p = np.arange(N, dtype=np.float64) * (2 * cycles) / N   # half-cells across the tile
    cell = np.floor(p).astype(np.int64)
    bulge = np.sin(np.pi * (p - cell)).astype(F32)           # 0 at crossings, 1 mid-thread
    par = ((cell[None, :] + cell[:, None]) & 1) == 0          # True: warp (runs along y) on top
    H = np.where(par, bulge[None, :], bulge[:, None]).astype(F32)
    warp_f = noise(N, N, R(0), streaks("y", kc=680.0, bw=0.7, sig=1.0))
    weft_f = noise(N, N, R(1), streaks("x", kc=680.0, bw=0.7, sig=1.0))
    fib = np.where(par, warp_f, weft_f)
    mot = noise(N, N, R(2), octave(40.0, 0.8))
    alb = tint([44, 48, 30], (0.82 + 0.30 * H) * (1 + 0.06 * fib + 0.02 * mot))
    nrm = normal_from_height(H + 0.12 * fib, 0.35)
    ao = 0.72 + 0.28 * H
    rough = 0.90 + 0.02 * np.tanh(fib)
    return alb, nrm, orm_pack(ao, rough, np.zeros_like(ao)), {}


def interior_grey():
    N, sid = 2048, 6
    R = lambda k: rng_for(sid, k)  # noqa: E731
    grain = noise(N, N, R(0), octave(1100.0, 0.6))
    mould = noise(N, N, R(1), octave(35.0, 0.8))
    alb = tint([84, 88, 88], 1 + 0.02 * grain + 0.03 * mould)
    nrm = normal_from_height(0.5 * grain + 0.8 * mould, 0.12)
    ao = 0.98 + 0.02 * np.tanh(grain + mould)
    rough = 0.70 + 0.03 * np.tanh(mould)
    return alb, nrm, orm_pack(ao, rough, np.zeros_like(ao)), {}


def carc_green():
    """Solid CARC Green 383 (FS 34094), as on US M142s in the reference photos: no
    camouflage pattern. Variation comes from pigment mottle, faint panel seams, grime in
    the low areas, light dust, and fine edge scratches."""
    N, sid = 4096, 7
    R = lambda k: rng_for(sid, k)  # noqa: E731
    low = noise(N, N, R(0), octave(3.0, 0.8))        # broad grime / dust zones
    mottle = noise(N, N, R(1), octave(40.0, 0.8))     # pigment variation
    grain = noise(N, N, R(2), octave(900.0, 0.45))
    grain2 = noise(N, N, R(3), octave(2000.0, 0.45))
    scr = noise(N, N, R(4), streaks("x", 260.0, 0.5, 1.0))  # fine horizontal scratches
    scr = np.clip(std(scr) - 2.4, 0, 1).astype(F32)

    yv = np.arange(N, dtype=F32)[:, None]
    xv = np.arange(N, dtype=F32)[None, :]
    d_v = np.abs(wrapped(xv, 1024.0, 2048.0))
    d_h = np.abs(wrapped(yv, 1024.0, 2048.0))
    seam = np.exp(-(np.minimum(d_v, d_h) / 2.0) ** 2).astype(F32)

    base = np.array([66, 72, 50], F32)       # CARC Green 383, FS 34094 (sRGB approx)
    grime_c = np.array([40, 42, 32], F32)
    dust_c = np.array([118, 112, 92], F32)
    col = base * (1 + 0.025 * mottle)[..., None]
    grime = np.clip(0.10 * np.clip(low - 0.8, 0, 2) + 0.35 * seam, 0, 0.40)
    col = col * (1 - grime[..., None]) + grime_c * grime[..., None]
    dust = np.clip(0.07 * np.clip(-low - 0.9, 0, 2), 0, 0.10)
    col = col * (1 - dust[..., None]) + dust_c * dust[..., None]
    col = col + 38.0 * scr[..., None]                 # bare-ish scratches, lighter
    col = col * (1 + 0.04 * grain + 0.02 * grain2)[..., None]
    alb = u8(col / 255.0)

    H = 0.7 * grain + 0.35 * grain2 - 1.6 * seam - 0.6 * scr
    nrm = normal_from_height(H, 0.22)
    ao = 0.96 - 0.10 * seam - 0.03 * np.clip(low, 0, 2)
    rough = 0.62 + 0.05 * np.tanh(mottle) - 0.15 * scr + 0.06 * dust / 0.10
    orm = orm_pack(np.clip(ao, 0.8, 1.0), np.clip(rough, 0.4, 0.75), np.zeros_like(ao))
    return alb, nrm, orm, {"mean": [round(float(v), 1) for v in alb.reshape(-1, 3).mean(0)]}


SETS = [
    ("carc_green", carc_green, 1.6),
    # v4: only the new set is generated here; the others are reused from v3/tex.
]


# ------------------------------------------------------------ checks

def check_file(path, size):
    im = Image.open(path)
    mode, sz = im.mode, im.size
    # float64 throughout: float32 sums over millions of pixels are inaccurate.
    a = np.asarray(im.convert("RGB")).astype(np.float64)
    adj_r = float(np.abs(np.diff(a, axis=0)).mean())
    adj_c = float(np.abs(np.diff(a, axis=1)).mean())
    wrap_r = float(np.abs(a[0] - a[-1]).mean())
    wrap_c = float(np.abs(a[:, 0] - a[:, -1]).mean())
    res = {
        "size_ok": sz == (size, size),
        "mode": mode,
        "mean": [round(float(v), 1) for v in a.reshape(-1, 3).mean(0)],
        "min": [int(v) for v in a.reshape(-1, 3).min(0)],
        "max": [int(v) for v in a.reshape(-1, 3).max(0)],
        "seam_ratio_row": round(wrap_r / adj_r, 3),
        "seam_ratio_col": round(wrap_c / adj_c, 3),
        "file_kb": round(os.path.getsize(path) / 1024),
    }
    return res, a


def canvas_phase_check(a):
    """The 6 px weave is not an integer count in 2048 px, so the generic
    adjacent-pair ratio is biased. Compare the wrap pair with adjacent pairs
    at the same weave phase instead (phase in half-cells, 682 per tile)."""
    N = a.shape[0]
    out = []
    for axis in (0, 1):
        b = a if axis == 0 else np.swapaxes(a, 0, 1)
        p = (np.arange(N) * 682.0 / N) % 1.0
        sel = np.where(np.abs(p[:-1] - p[-1]) < 0.01)[0]
        same = np.abs(b[sel + 1] - b[sel]).mean()
        wrap = np.abs(b[-1] - b[0]).mean()
        out.append(round(float(wrap / same), 3))
    return out


def verify(manifest):
    for s in manifest["sets"]:
        size = s["size"]
        print(f"== {s['name']} ({size} px, {s['metres_per_tile']} m/tile)")
        for kind in ("albedo", "normal", "orm"):
            res, a = check_file(os.path.join(OUT, s[kind]), size)
            print(f"  {kind:7s} {s[kind]}: size_ok={res['size_ok']} mode={res['mode']} "
                  f"mean={res['mean']} min={res['min']} max={res['max']} "
                  f"seam_row={res['seam_ratio_row']} seam_col={res['seam_ratio_col']} "
                  f"{res['file_kb']} KB")
            if kind == "normal":
                n = a / 255.0 * 2 - 1
                length = np.sqrt((n * n).sum(-1))
                print(f"          normal |n| mean={length.mean():.4f} "
                      f"(max dev {np.abs(length - 1).max():.3f}) "
                      f"nz mean={n[..., 2].mean():.3f} "
                      f"tilt mean={np.sqrt(n[..., 0] ** 2 + n[..., 1] ** 2).mean():.3f}")
            if s["name"] == "canvas" and kind == "albedo":
                print(f"          canvas phase-matched wrap ratio (col, row): {canvas_phase_check(a)}")
            del a


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {"seed": SEED, "generator": "gen_textures.py", "sets": []}
    for name, fn, tile in SETS:
        alb, nrm, orm, info = fn()
        size = alb.shape[0]
        files = {}
        for kind, arr in (("albedo", alb), ("normal", nrm), ("orm", orm)):
            fname = f"{name}_{kind}.png"
            Image.fromarray(arr).save(os.path.join(OUT, fname))
            files[kind] = fname
        manifest["sets"].append({"name": name, "size": size, "metres_per_tile": tile,
                                 **files})
        if info:
            print(f"[{name}] {json.dumps(info)}")
        print(f"wrote {name}: {size}x{size}")
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    verify(manifest)


if __name__ == "__main__":
    main()
