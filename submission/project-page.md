# AstroApex — Lunar South Pole Mission Planner

> Copy the sections below into the NASA Space Apps 2026 Project Submission page.

## Project name

AstroApex — Lunar South Pole Mission Planner

## High-level project summary

AstroApex turns three separate NASA tools (Quickmap, Moon Trek, JPL Horizons) into a
30-second site/date trade study for the lunar south pole. Mission planners pick a
landing site and date and instantly see the Sun and Earth positions against the real
LOLA terrain horizon, the solar power and direct-to-Earth (DTE) communication windows,
and how a 21-day schedule slip reshapes mission feasibility. Every number is computed
by a C11 physics core from real NASA ephemerides, and every number is labeled with its
data source — so "synthetic terrain" or "kinematic 3D" can never be mistaken for
validated physics.

## Link to Project Demo

<!-- 30-second video or 7-slide deck, publicly accessible, no login required. -->

## Link to Final Project

<!-- Public URL of the static demo (GitHub Pages) and/or the source repository. -->

## Detailed project description

**What it does.** AstroApex compares candidate lunar south-pole landing sites and
dates. For any chosen site/date it reports, from the backend, the 360° terrain horizon,
the Sun and Earth azimuth/elevation relative to that horizon, illumination percentage,
DTE visibility percentage, sun+DTE overlap, longest continuous darkness, the next
sunset/sunrise and earthset/earthrise, a five-site comparison table, and a
GO / CAUTION / NO-GO mission decision with the primary blocker.

**How it works.** A C11 physics core loads NAIF CSPICE SPICE kernels (de440s.bsp,
pck00010.tpc, naif0012.tls) and computes Sun/Earth positions in the IAU_MOON frame with
light-time + stellar aberration (LT+S). It builds a 360° horizon mask from real LOLA
80 m skyline profiles for three sites and from a synthetic analytic terrain elsewhere
(everywhere labeled). It then simulates hourly illumination/DTE, derives visibility
windows and the next rise/set events, and writes a 2D mission JSON plus a kinematic 3B
scene. A Lua scoring layer ranks the five candidate sites. A static, display-only web
frontend renders the data — it never recomputes physics in JavaScript.

**Why it is important.** South-pole missions are defined by extreme, rapidly changing
lighting and communication. A launch slip or a hardware delay forces planners to
re-evaluate sites and dates under time pressure. AstroApex closes the gap between the
raw data tools and an accessible, comparable view, for mission planners, educators, and
the public.

**Tools, languages, data.** C11 + CSPICE (NAIF), Lua 5.4, Python (validation and
snapshot generation), vanilla HTML/CSS/JavaScript (display-only frontend). NASA data:
SPICE kernels, LOLA PGDA 90 south-pole DEMs (Barker et al. 2023), site coordinates from
the NASA Lunar Surface Data Book, and JPL Horizons as a cross-check reference.

## Use of Super Intelligence (SI)

Yes. Super Intelligence tools (large language models) were used as coding assistants to
accelerate implementation, review, and documentation. SI was not used to invent the
solution concept. All physics, ephemeris, horizon, and decision logic is implemented by
the team in C11 and is verifiable in the source repository. No AI-generated media or
NASA branding is included.

## NASA Data

- NAIF CSPICE toolkit and SPICE kernels (de440s.bsp, pck00010.tpc, naif0012.tls)
- LOLA south-pole DEMs — NASA GSFC PGDA 90, Barker et al. 2023, DOI 10.60903/gsfcpgda-lola-spole
- JPL Horizons System (reference/cross-check)
- NASA Lunar Surface Data Book (site coordinates)

## Space Agency Partner Data and Other References

See `submission/references.md` for the full list of data, tools, and code used.
