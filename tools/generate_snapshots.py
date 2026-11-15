#!/usr/bin/env python3
"""Generate the static demo snapshot catalog for the AstroApex frontend.

Runs the compiled backend once per scenario, captures the 2D mission JSON
(data/output.json) and 3B scene JSON (data/3b_scene.json), and assembles a single
ui-starter/data/demo_snapshots.json catalog that the UI loads when no live
backend is reachable. Also refreshes the offline sample file.

Usage: python3 tools/generate_snapshots.py
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "build" / "lunar_sim"
OUT = ROOT / "ui-starter" / "data" / "demo_snapshots.json"
SAMPLE_SRC = ROOT / "data" / "output.json"
SAMPLE_DST_PUBLIC = ROOT / "ui-starter" / "public" / "sample_output.json"
SAMPLE_DST_ROOT = ROOT / "ui-starter" / "sample_output.json"

SCENARIOS = [
    {"label": "Shackleton Rim · 2026-10-18", "site": "Shackleton Rim", "lat": -89.7668, "lon": -171.87, "utc": "2026-10-18T00:00:00", "days": 14},
    {"label": "Shackleton Rim · +21 days (schedule slip)", "site": "Shackleton Rim", "lat": -89.7668, "lon": -171.87, "utc": "2026-11-08T00:00:00", "days": 14},
    {"label": "Connecting Ridge · 2026-10-29", "site": "Connecting Ridge", "lat": -89.4632, "lon": -137.49, "utc": "2026-10-29T14:30:00", "days": 14},
    {"label": "Malapert Massif · 2026-10-18", "site": "Malapert Massif", "lat": -85.9948, "lon": -0.23578, "utc": "2026-10-18T00:00:00", "days": 14},
    {"label": "Nobile Rim 1 · 2026-10-18", "site": "Nobile Rim 1", "lat": -85.2, "lon": 53.5, "utc": "2026-10-18T00:00:00", "days": 14},
    {"label": "Haworth · 2026-10-18", "site": "Haworth", "lat": -87.45, "lon": -5.17, "utc": "2026-10-18T00:00:00", "days": 14},
    {"label": "Custom site · 2026-10-18", "site": "Custom", "lat": -89.5, "lon": 0.0, "utc": "2026-10-18T00:00:00", "days": 14},
    {"label": "Connecting Ridge · 2026-10-18", "site": "Connecting Ridge", "lat": -89.4632, "lon": -137.49, "utc": "2026-10-18T00:00:00", "days": 14},
]


def run_backend(site: str, lat: float, lon: float, utc: str, days: int) -> None:
    cmd = [str(BIN), "--once", site, str(lat), str(lon), utc, str(days)]
    subprocess.run(cmd, check=True, cwd=str(ROOT), capture_output=True, text=True)


def main() -> int:
    if not BIN.exists():
        print(f"Binary not found: {BIN}. Run `make` first.", file=sys.stderr)
        return 1

    scenarios = []
    for s in SCENARIOS:
        run_backend(s["site"], s["lat"], s["lon"], s["utc"], s["days"])
        data = json.loads((ROOT / "data" / "output.json").read_text(encoding="utf-8"))
        scene = json.loads((ROOT / "data" / "3b_scene.json").read_text(encoding="utf-8"))
        request = {
            "site_name": s["site"],
            "latitude_deg": s["lat"],
            "longitude_deg": s["lon"],
            "start_utc": s["utc"],
            "days": s["days"],
        }
        scenarios.append({
            "id": f"{s['site'].lower().replace(' ', '-')}-{s['utc'][:10]}",
            "label": s["label"],
            "request": request,
            "data": data,
            "scene": scene,
        })

    catalog = {
        "version": 1,
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "scenarios": scenarios,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalog, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} with {len(scenarios)} scenarios")

    # Regenerate the offline sample (last scenario: Shackleton 2026-10-18 is first; use it)
    run_backend("Shackleton Rim", -89.7668, -171.87, "2026-10-18T00:00:00", 14)
    sample = (ROOT / "data" / "output.json").read_text(encoding="utf-8")
    SAMPLE_DST_PUBLIC.write_text(sample, encoding="utf-8")
    SAMPLE_DST_ROOT.write_text(sample, encoding="utf-8")
    print(f"Wrote {SAMPLE_DST_PUBLIC} and {SAMPLE_DST_ROOT}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
