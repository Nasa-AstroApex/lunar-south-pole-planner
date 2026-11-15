# References & AI disclosure

## NASA data & resources

- NAIF CSPICE C Toolkit — <https://naif.jpl.nasa.gov/naif/toolkit_C.html>
- SPICE kernels:
  - `de440s.bsp` (planetary ephemeris)
  - `pck00010.tpc` (planetary constants / Moon frame)
  - `naif0012.tls` (leap seconds)
- LOLA south-pole DEMs — NASA GSFC PGDA 90, Barker et al. 2023,
  Planetary Science Journal 4, 183, <https://pgda.gsfc.nasa.gov/products/90>,
  DOI 10.60903/gsfcpgda-lola-spole
- JPL Horizons System — <https://ssd.jpl.nasa.gov/horizons/>
- NASA Quickmap — <https://quickmap.lroc.asu.edu/>
- NASA Moon Trek — <https://trek.nasa.gov/moon/>
- NASA Lunar Surface Data Book (Table A2-2) — NTRS 20230007818

## Tools and libraries

- C11 (gcc), Lua 5.4, Python 3 (validation/snapshot generation)
- Vanilla HTML / CSS / ES-module JavaScript (display-only frontend, no framework)
- LOLA 80 m skyline profiles embedded in `src/lola_horizons.h` (Barker et al. 2023)

## Third-party assets

- No third-party images, fonts, music, or media are used. All UI assets are original.

## Super Intelligence (SI) disclosure

- Large language models were used as coding assistants to accelerate implementation,
  review, and documentation.
- SI was not used to invent the solution concept.
- All physics, ephemeris, horizon, and mission-decision logic is implemented by the
  team in C11 and is verifiable in the source repository.
- No AI-generated media or NASA branding is included.
