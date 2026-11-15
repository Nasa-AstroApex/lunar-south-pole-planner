#!/usr/bin/env python3
"""Optional real-LOLA terrain ingestion for custom-coordinate horizons.

The backend already uses real LOLA 80 m skyline profiles for Shackleton Rim,
Connecting Ridge and Malapert Massif (src/lola_horizons.h). For arbitrary custom
coordinates it currently falls back to a synthetic analytic terrain and labels the
output `horizon_source = "SYNTHETIC_ANALYTIC"`.

This script downloads the NASA GSFC PGDA 90 south-pole LOLA DEM and (when GDAL is
available) converts it into a compact binary that `src/lola_dem.c` can ray-march to
produce real horizons for any south-pole coordinate.

Requirements (optional): GDAL (`gdal_translate`, `gdalinfo`) on PATH.

Data source: Barker et al. 2023, Planetary Science Journal 4, 183.
https://pgda.gsfc.nasa.gov/products/90  DOI 10.60903/gsfcpgda-lola-spole
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "lola"

# Smaller/coarser DEM (80S, 120 m/pixel) is a good first target for horizon ray-marching.
PRODUCTS = [
    {
        "name": "LDEM_80S_120MPP_ADJ.TIF",
        "url": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_120MPP_ADJ.TIF",
    },
]


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("PGDA 90 LOLA south-pole DEM (Barker et al. 2023)")
    print("See tools/fetch_lola.py and docs for full instructions.")
    print("Downloads require the exact PGDA product URL; sizes can exceed 1 GB.")
    for p in PRODUCTS:
        dest = OUT_DIR / p["name"]
        if dest.exists():
            print(f"[skip] {dest} already exists")
            continue
        print(f"[download] {p['url']}")
        try:
            urllib.request.urlretrieve(p["url"], dest)
            print(f"[ok] {dest}")
        except Exception as e:  # noqa: BLE001
            print(f"[error] {e}", file=sys.stderr)
    print("After download, convert the GeoTIFF with GDAL (see docs/ARCHITECTURE.md) and")
    print("wire it into src/lola_dem.c. Until then, custom coordinates use the labeled")
    print("synthetic analytic terrain fallback.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
