# AstroApex Backend & UI Integration Specification

## 1. API Endpoint & Transport
- **URL:** `POST http://localhost:8080`
- **Headers:** `Content-Type: application/json` (CORS `Access-Control-Allow-Origin: *` enabled)
- **CLI Equivalent:** `./MissionPlanner --once` reads `data/input.json` and writes `data/output.json`.

## 2. Scientific Methodology (NASA & CSA Alignment)
- **JPL Horizons / NAIF CSPICE Parity:** Ephemeris states are computed locally in microseconds using JPL `de440s.bsp` planetary ephemerides, `pck00010.tpc` lunar orientation constants, and `naif0012.tls` leap-second kernels in the `MOON_ME` body-fixed frame.
- **LRO Quickmap / LOLA Terrain Occlusion:** For any target `(latitude_deg, longitude_deg, altitude_m)`, the engine casts 360 azimuthal rays (`0°` = North, clockwise to `359°`) to build `terrain_horizon_mask`. At every time step, solar/Earth visibility requires `elevation_deg >= max(min_elevation_deg, terrain_horizon_deg)`.
- **Earth Angular Disk:** When `include_earth_disk` is `true`, Earth's apparent angular radius (~0.95° from the Moon) is factored into line-of-sight DTE calculations.
- **Artemis / CSA Operational Constraints:** Continuous darkness (`longest_dark_hours`), solar power availability (`illumination_percent`), direct Earth telemetry (`dte_window_count`), and simultaneous Sun+Earth windows (`overlap_hours`) drive the 0–100 `mission_score`.

## 3. UI Component Mapping Guide
Frontend components should map directly to the JSON payload without transforming physical values:
- **3D Lunar South Pole Viewport (Three.js / R3F):** Use `samples[i].sun_azimuth_deg` and `samples[i].sun_elevation_deg` to orient the directional sunlight vector, and `earth_azimuth_deg` / `earth_elevation_deg` for the Earth marker in the lunar sky.
- **360° Horizon Panorama / Polar Radar:** Plot `terrain_horizon_mask` (360 floats) as the crater rim silhouette, overlaid with the Sun trajectory and Earth's figure-eight libration path from `samples`.
- **Timeline & Scrubber:** Render `windows.sun` and `windows.earth` as continuous interval bars, synchronized with a time scrubber indexing into `samples[0 .. N-1]`.
- **Candidate Site Matrix:** Render `site_comparison` directly as a sortable engineering table comparing `Shackleton Rim`, `Connecting Ridge`, `Malapert Massif`, `Nobile Rim 1`, and `Haworth`.
