# Technical Review & Handoff Report (`lunar-south-pole-planner`)

## 1. Executive Verdict
Remote commit `8bdb137` ("fable 5.2") is **not a complete fix**:
- **2D Pipeline (Fixed):** Properly labels `ephemeris_source`, `dem_info.horizon_source`, and `terrain_is_synthetic`, with `IAU_MOON` and topocentric geometry.
- **3B Pipeline (Broken / Misleading):** `touchdown_report` still hardcodes `success: true`, `mission_score: 96`, and `sun_illumination_pct: 100` while ignoring terrain/horizon masks—contradicting 2D `NO-GO (59/100)` results.
- **Data & Merge State:** LOLA horizon arrays cover only 3 sites without provenance/checksums, and local uncommitted P0 fixes (fail-closed kernels + honest simulation flags) diverge from remote `8bdb137`.

---

## 2. Current State Comparison

| Component | Local Working Tree (Uncommitted P0) | Remote `HEAD` (`8bdb137`) |
| :--- | :--- | :--- |
| **CSPICE Kernels** | **Fail-closed** (`src/cspice_math.c`, `src/main.c` exit on missing kernels). | **Fallback** (`ANALYTIC_MEEUS_FALLBACK`, ≈0.03° deviation). |
| **2D Output (`--once`)** | Labels `ephemeris_source`, `dem_info.horizon_source`, `dem_info.is_synthetic=true`. | `CSPICE_DE440S_IAU_MOON`, `LOLA_80M_SKYLINE`, `terrain_is_synthetic=true`. Sample: Sun 1.42°/91.76°, Earth 5.22°, Illum 69%, **NO-GO (59/100)** (`CONTINUOUS_DARKNESS_EXCEEDED`). |
| **3B Output (`--once`)** | Body-fixed Sun/Earth, `scene_model="kinematic-visualization"`, `physics_valid=false`. | `guidance_model="KINEMATIC_VISUALISATION_NO_MASS_MODEL"`, but **hardcoded** `success:true`, `mission_score:96`, `sun_illumination_pct:100` (ignores horizon). |
| **LOLA Horizons** | `sample_synthetic_dem_elevation_m` synthetic DEM. | `src/lola_horizons.h` added (3 sites only, smooth arrays, no generator/checksum). |
| **HTTP Server & Parser** | Localhost binding, exact query-key match, URL decode, 1–30d clamp, `/` viewer + `/3b` JSON. | Same parser & `INADDR_LOOPBACK` server; `0 -> 14`, `>30 -> 30` clamping verified. |
| **Lua & Frontend TS** | `lua/main.lua` (`source=synthetic-demo`); `ui-starter` types include `scene_model` & `physics_valid`. | `plannerApi.ts` uses `GET` only; `mission.ts` has `terrain_is_synthetic` & `slope_deg`, lacks `scene_model`/`physics_valid`. |
| **Build & Tests** | `Makefile` (`make`, `make test`, `make serve`, `make asan`) + `test_3b_viewer.html` ready. | `make clean && make && ./build/lunar_sim --once` passes (with `cspice` symlink). |

---

## 3. Open Concerns to Resolve
1. **3B vs. 2D Inconsistency:** `src/3b_moon.c` outputs a guaranteed 100% sun / 96 score touchdown even when 2D flags `NO-GO` due to horizon blockage.
2. **Merge Strategy Divergence:** Decide between keeping local **fail-closed** kernel behavior vs. adopting remote **analytic Meeus fallback**, and unify JSON field names (`is_synthetic` vs. `terrain_is_synthetic`).
3. **LOLA Profile Plausibility:** Only 3 hard-coded `mask_deg[360]` arrays exist (`Shackleton Rim` 1% sun, `Connecting Ridge` 69% sun / 80h darkness) with no generator script or PGDA DEM verification.
4. **Client-Server Contract:** `ui-starter/src/services/plannerApi.ts` only sends `GET` requests; any `POST` backend extension requires matching client updates.

---

## 4. Prioritized Next Steps
1. **Reconcile Local P0 & Remote `8bdb137`:** Cherry-pick/merge local honest labels (`scene_model`, `physics_valid`) onto `8bdb137` and finalize kernel policy (fail-closed vs. explicit `ANALYTIC_MEEUS_FALLBACK`).
2. **Fix 3B Touchdown Consistency (`src/3b_moon.c`):** Replace hardcoded `sun_illumination_pct=100` / `mission_score=96` / `success=true` with actual horizon-aware calculations or explicit `physics_valid=false` / `null` metric flags matching 2D.
3. **Audit LOLA Profiles (`src/lola_horizons.h`):** Cross-check the 3 `mask_deg[360]` arrays against real LOLA DEM data (or document provenance/limitations clearly in `README.md`).
4. **Verify Full Stack:**
   - Run `make clean && make && make test`
   - Run `cd ui-starter && npx tsc --noEmit` to ensure TypeScript interfaces match final C11 JSON output.
   - Commit clean changes (ensuring `build/`, `cspice/`, and `*.bsp` remain in `.gitignore`).
