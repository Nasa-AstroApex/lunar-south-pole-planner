# AstroApex — 7-slide demo deck

Limit: 7 slides including title and intro. English only.

---

## Slide 1 — Title

**AstroApex — Lunar South Pole Mission Planner**

Real JPL ephemerides · terrain-aware horizons · 30-second site/date trade studies

Team: AstroApex · Challenge: Lunar Landing Site Navigator (NASA Space Apps 2026)

---

## Slide 2 — Problem

- South-pole missions are defined by extreme, fast-changing lighting and communication.
- Choosing a landing site and date means juggling Quickmap, Moon Trek, and JPL Horizons.
- A launch slip or hardware delay forces a rapid re-evaluation that today takes hours.

---

## Slide 3 — Solution

- One mission-control view: pick a site and date, see Sun/Earth against the real horizon.
- A C11 physics core computes illumination, DTE windows, darkness, and rise/set events.
- A static, display-only frontend renders the result — no physics in the browser.

---

## Slide 4 — Demo

- Site/date selection; 360° horizon with Sun and Earth.
- Schedule Slip +21 days: the same site, a new reality.
- Five-site comparison table with backend scores and verdicts.

---

## Slide 5 — Science & data

- NAIF CSPICE (de440s, IAU_MOON, LT+S) for Sun/Earth.
- Real LOLA 80 m skyline horizons (Barker et al. 2023, PGDA 90).
- Every value labeled by source; synthetic/kinematic clearly marked.

---

## Slide 6 — Impact

- Accelerates CLPS/Artemis site-date trade studies for mission planners.
- Explains "why small location/date changes matter" for educators and the public.
- Open, reproducible, login-free demo.

---

## Slide 7 — Roadmap & links

- Next: full LOLA DEM for arbitrary coordinates; physical descent model.
- Live demo, source repository, and references.
- Built with NASA data.
