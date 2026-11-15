/*
 * AstroApex — Lunar South Pole Universe Sandbox (3B mission scene).
 *
 * Interactive 13-body SPICE universe: Sun, Earth, Moon, Venus, Mars, Apophis, Bennu,
 * Ryugu, Eros, Didymos, Vesta, Ceres, Psyche. Kepler orbit rings and trails, 1:1 camera
 * focus modes, a unified time warp, right-click custom target selection, a continuous
 * descent simulation, and a spacecraft attitude sphere.
 *
 * Data sources:
 *   - data/3b_scene.js  (window.SCENE_3B_DATA, default scene)
 *   - data/demo_snapshots.json (scenario catalog, static)
 *   - GET http://127.0.0.1:8080/3b (live C11 engine, when running locally)
 *
 * Schema: src/3b_moon.h. No new JSON fields are invented here; the interactive engine
 * reproduces the C11 scene structure and its honest "kinematic visualization" labels.
 */

import Debug from "./debug.js";

/* ---------------- constants ---------------- */
const R_MOON_KM = 1737.4;
const R_EARTH_KM = 6371.0;
const R_SUN_KM = 696340.0;
const DIST_EARTH_MOON = 384400.0;
const AU_KM = 149597870.7;
const MU_MOON = 4902.800066;
const J2_MOON = 0.0002032;
const MU_EARTH = 398600.4418;
const MU_SUN = 1.32712440018e11;

const MODE_ORBIT = 0;
const MODE_DESCENT = 1;
const MODE_LANDED = 2;

const WARP_STEPS = [0, 1, 10, 60, 300, 3600, 86400];

const DEFAULT_SITE = "Connecting Ridge";

/* ---------------- globals ---------------- */
let sceneData = window.SCENE_3B_DATA || {
  scenario_id: 3,
  mission_mode: MODE_ORBIT,
  sim_elapsed_sec: 0,
  base_utc: "2026-10-29T14:30:00",
  active_utc: "2026-10-29T14:30:00",
  landing_utc: "2026-10-29T14:46:18",
  range_days: 14,
  sun: { vec: [0.82, 0.56, -0.02], sub_lat: -1.2, sub_lon: 34.0, helio_km: [0, 0, 0] },
  earth: { vec: [0.99, -0.08, 0.11], sub_lat: 6.3, sub_lon: -4.6, helio_km: [AU_KM, 0, 0] },
  moon_helio_km: [AU_KM + DIST_EARTH_MOON, 0, 0],
  spice_bodies: [],
  selected_site: { name: DEFAULT_SITE, lat: -89.4632, lon: -137.49, alt_m: 1943.3, slope_deg: 0.4, sun_el: 1.4, earth_el: 5.8, is_custom: false },
  sites: [],
  spacecraft: {
    mission_mode: MODE_ORBIT,
    lat: -38, lon: -105, altitude_km: 110, initial_speed_kms: 1.629, current_speed_kms: 1.629,
    pos_km: [-365, -1360, -1137], vel_kms: [1.55, -0.41, 0.0],
    gravity_ms2: 1.44, thrust_ms2: 0.0,
    nominal_orbital_speed_kms: 1.629, escape_speed_kms: 2.304, orbital_period_sec: 7128,
    deorbit_dv_ms: 66.8, transfer_time_sec: 978,
    yaw_deg: 75, pitch_deg: -35, roll_deg: 0,
    qibla_vec: [0.21, 0.78, -0.58], prograde_vec: [0.96, -0.25, 0.0], nadir_vec: [0.20, 0.74, 0.62],
    solar_vec: [0.82, 0.56, -0.02], earth_dte_vec: [0.99, -0.08, 0.11],
    commanded_vec: [0.21, 0.78, -0.58],
    qibla_azimuth_deg: 74.9, qibla_elevation_deg: -35.4,
    commanded_azimuth_deg: 74.9, commanded_elevation_deg: -35.4,
    alignment_error_deg: 0.0, is_qibla_aligned: true,
  },
  trajectory: [],
  landing_seconds: [],
  touchdown_report: null,
};

let initOrbitParams = {
  lat: sceneData.spacecraft.lat ?? -38,
  lon: sceneData.spacecraft.lon ?? -105,
  alt_km: sceneData.spacecraft.altitude_km ?? 110,
  speed_kms: sceneData.spacecraft.initial_speed_kms ?? 1.629,
};

let focusMode = "MOON";
let camYaw = 0.55;
let camPitch = -0.68;
let pxPerKm = 155.0 / R_MOON_KM;
let targetPxPerKm = pxPerKm;
let showBodyIcons = true;

let miniCamYaw = 0.65;
let miniCamPitch = -0.35;

let warpIdx = 1;
let simElapsedSec = 0.0;
let burnStartSimSec = 0.0;
let missionMode = MODE_ORBIT;
let animLoop = false;
let lastFrameTime = performance.now();
let lastHudMs = 0;
let flownTrail = [];
let touchdownPulse = 0.0;

let cApiAvailable = false;
let lastApiSyncMs = 0;

const snapshots = [];
const PRESET_SITES = [
  ["Connecting Ridge", -89.4632, -137.49],
  ["Shackleton Rim", -89.7668, -171.87],
  ["Malapert Massif", -85.9948, -0.23578],
  ["Haworth", -87.45, -5.17],
  ["Nobile Rim 1", -85.2, 53.5],
  ["Shackleton Base (PSR)", -89.65, 115.0],
];

const isLocalHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" ||
  new URLSearchParams(location.search).has("live");

const stars = Array.from({ length: 380 }, (_, i) => ({
  x: ((i * 9973) % 1000) / 1000,
  y: ((i * 6151) % 1000) / 1000,
  s: i % 4 === 0 ? 1.5 : 1.0,
  a: 0.3 + ((i * 37) % 60) / 100,
}));

/* ---------------- helpers ---------------- */
function $(id) { return document.getElementById(id); }

function parseUtcToMs(utcStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec((utcStr || "").trim());
  if (!m) return Date.UTC(2026, 9, 29, 14, 30, 0);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function formatMsToUtc(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function getCurrentJd2000() {
  const baseMs = parseUtcToMs(sceneData.base_utc || sceneData.active_utc);
  const curMs = baseMs + simElapsedSec * 1000.0;
  return (curMs - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000.0;
}

function latLonToVec(latDeg, lonDeg, r = 1.0) {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
}

function xyzToLatLonAlt(pos) {
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  if (r < 1e-9) return { lat: 0, lon: 0, alt_km: 0 };
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, pos[2] / r))) * 180) / Math.PI,
    lon: (Math.atan2(pos[1], pos[0]) * 180) / Math.PI,
    alt_km: r - R_MOON_KM,
  };
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm3(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l < 1e-12) return [1, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

function projectKm(worldKm, focusOriginKm, cx, cy, scale) {
  const dx = worldKm[0] - focusOriginKm[0];
  const dy = worldKm[1] - focusOriginKm[1];
  const dz = worldKm[2] - focusOriginKm[2];
  const cY = Math.cos(camYaw), sY = Math.sin(camYaw);
  const cP = Math.cos(camPitch), sP = Math.sin(camPitch);
  const x1 = dx * cY - dy * sY;
  const y1 = dx * sY + dy * cY;
  const z1 = dz;
  const y2 = y1 * cP - z1 * sP;
  const z2 = y1 * sP + z1 * cP;
  return { x: cx + x1 * scale, y: cy - z2 * scale, depth: y2 };
}

function unprojectToMoonLatLon(mx, my, cx, cy, moonRpx) {
  const x1 = (mx - cx) / moonRpx;
  const z2 = -(my - cy) / moonRpx;
  const r2 = x1 * x1 + z2 * z2;
  if (r2 > 1.0) return null;
  const y2 = -Math.sqrt(Math.max(0, 1.0 - r2));
  const cP = Math.cos(camPitch), sP = Math.sin(camPitch);
  const y1 = y2 * cP + z2 * sP;
  const z1 = -y2 * sP + z2 * cP;
  const cY = Math.cos(camYaw), sY = Math.sin(camYaw);
  const x0 = x1 * cY + y1 * sY;
  const y0 = -x1 * sY + y1 * cY;
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, z1))) * 180) / Math.PI,
    lon: (Math.atan2(y0, x0) * 180) / Math.PI,
  };
}

function shadeHex(hex, factor) {
  const clean = String(hex).replace("#", "");
  if (clean.length !== 6) return "#1e293b";
  const r = Math.floor(parseInt(clean.slice(0, 2), 16) * factor);
  const g = Math.floor(parseInt(clean.slice(2, 4), 16) * factor);
  const b = Math.floor(parseInt(clean.slice(4, 6), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

function evalKeplerRelKm(aKm, ecc, incDeg, meanAnomDeg) {
  const M = (meanAnomDeg * Math.PI) / 180;
  let E = M;
  for (let it = 0; it < 5; it++) E = M + ecc * Math.sin(E);
  const inc = (incDeg * Math.PI) / 180;
  const xo = aKm * (Math.cos(E) - ecc);
  const yo = aKm * Math.sqrt(Math.max(0, 1 - ecc * ecc)) * Math.sin(E);
  return [xo, yo * Math.cos(inc), yo * Math.sin(inc)];
}

function getEarthHelioKm(jd2000) {
  const phase = 357.529 + (jd2000 / 365.25636) * 360.0;
  return evalKeplerRelKm(AU_KM, 0.0167, 0.0, phase);
}

function getMoonHelioKm(jd2000) {
  const ePos = getEarthHelioKm(jd2000);
  const phase = 134.963 + (jd2000 / 27.321661) * 360.0;
  const rel = evalKeplerRelKm(DIST_EARTH_MOON, 0.0549, 5.145, phase);
  return [ePos[0] + rel[0], ePos[1] + rel[1], ePos[2] + rel[2]];
}

const BODY_ORBIT_DEFS = {
  299: { a: 0.723 * AU_KM, e: 0.0068, i: 3.39, p: 224.70, m0: 50.4 },
  2099942: { a: 0.922 * AU_KM, e: 0.1912, i: 3.33, p: 323.60, m0: 215.0 },
  2101955: { a: 1.126 * AU_KM, e: 0.2037, i: 6.03, p: 436.65, m0: 101.7 },
  2162173: { a: 1.190 * AU_KM, e: 0.1902, i: 5.88, p: 473.90, m0: 211.5 },
  2000433: { a: 1.458 * AU_KM, e: 0.2229, i: 10.83, p: 643.20, m0: 320.2 },
  499: { a: 1.524 * AU_KM, e: 0.0934, i: 1.85, p: 686.98, m0: 19.4 },
  2065803: { a: 1.644 * AU_KM, e: 0.3838, i: 3.41, p: 770.00, m0: 75.0 },
  2000004: { a: 2.361 * AU_KM, e: 0.0887, i: 7.14, p: 1325.75, m0: 20.8 },
  2000001: { a: 2.767 * AU_KM, e: 0.0758, i: 10.59, p: 1681.63, m0: 77.4 },
  2000016: { a: 2.924 * AU_KM, e: 0.1339, i: 3.10, p: 1826.00, m0: 158.0 },
};

function getBodyCurrentHelioKm(body, jd2000) {
  if (body.naif_id === 10) return [0, 0, 0];
  if (body.naif_id === 399) return getEarthHelioKm(jd2000);
  if (body.naif_id === 301) return getMoonHelioKm(jd2000);
  const def = BODY_ORBIT_DEFS[body.naif_id];
  if (def) {
    const phase = def.m0 + (jd2000 / def.p) * 360.0;
    return evalKeplerRelKm(def.a, def.e, def.i, phase);
  }
  const period = body.period_days || 365.25;
  const phase = (body.phase_deg || 0) + (jd2000 / period) * 360.0;
  return evalKeplerRelKm(body.a_km, body.ecc || 0, body.inc_deg || 0, phase);
}

function drawPlaceholderSphere(ctx, x, y, radiusPx, baseColor, lightDir2D, label, subLabel, forceIcon) {
  const r = Math.max(radiusPx, forceIcon ? 4.0 : 1.2);
  if (x < -400 || x > ctx.canvas.width + 400 || y < -400 || y > ctx.canvas.height + 400) return;
  const lx = x + lightDir2D[0] * r * 0.42;
  const ly = y + lightDir2D[1] * r * 0.42;
  const grd = ctx.createRadialGradient(lx, ly, r * 0.08, x, y, r);
  grd.addColorStop(0, "#ffffff");
  grd.addColorStop(0.28, baseColor);
  grd.addColorStop(0.85, shadeHex(baseColor, 0.35));
  grd.addColorStop(1, "#05070d");
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = baseColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  if (forceIcon && radiusPx < 4.5) {
    ctx.strokeStyle = baseColor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.stroke();
  }
  if (label) {
    ctx.fillStyle = "#f1f5f9"; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = "left";
    ctx.fillText(label, x + Math.max(r, 7) + 5, y + 3);
    if (subLabel) {
      ctx.fillStyle = "#94a3b8"; ctx.font = "9.5px ui-monospace, monospace";
      ctx.fillText(subLabel, x + Math.max(r, 7) + 5, y + 14);
    }
  }
}

function strokeSafePath(ctx, pts, W, H) {
  let penDown = false;
  ctx.beginPath();
  for (const p of pts) {
    const inBounds = p.x >= -2500 && p.x <= W + 2500 && p.y >= -2500 && p.y <= H + 2500;
    if (!inBounds) { penDown = false; continue; }
    if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawKeplerOrbit(ctx, body, focusOriginKm, cx, cy, scale, jd2000, W, H) {
  if (!body.a_km || body.a_km <= 0) return;
  if (body.orbit_parent === "SUN" && scale > 0.002) return;
  const parentPos = (body.orbit_parent === "EARTH") ? getEarthHelioKm(jd2000) : [0, 0, 0];
  let a = body.a_km, ecc = body.ecc || 0, inc = body.inc_deg || 0, curPhaseDeg = 0;
  if (body.naif_id === 399) {
    curPhaseDeg = 357.529 + (jd2000 / 365.25636) * 360.0;
  } else if (body.naif_id === 301) {
    curPhaseDeg = 134.963 + (jd2000 / 27.321661) * 360.0;
  } else if (BODY_ORBIT_DEFS[body.naif_id]) {
    const d = BODY_ORBIT_DEFS[body.naif_id];
    a = d.a; ecc = d.e; inc = d.i;
    curPhaseDeg = d.m0 + (jd2000 / d.p) * 360.0;
  } else {
    curPhaseDeg = (body.phase_deg || 0) + (jd2000 / (body.period_days || 365.25)) * 360.0;
  }

  const ringPts = [];
  const totalSegs = 720;
  for (let i = 0; i <= totalSegs; i++) {
    const deg = curPhaseDeg - 180.0 + (i / totalSegs) * 360.0;
    const rel = evalKeplerRelKm(a, ecc, inc, deg);
    ringPts.push(projectKm([parentPos[0] + rel[0], parentPos[1] + rel[1], parentPos[2] + rel[2]], focusOriginKm, cx, cy, scale));
  }
  ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
  ctx.lineWidth = 1;
  strokeSafePath(ctx, ringPts, W, H);

  const trailPts = [];
  const tSteps = 96;
  for (let i = 0; i <= tSteps; i++) {
    const deg = curPhaseDeg - 45.0 * (1.0 - i / tSteps);
    const rel = evalKeplerRelKm(a, ecc, inc, deg);
    trailPts.push(projectKm([parentPos[0] + rel[0], parentPos[1] + rel[1], parentPos[2] + rel[2]], focusOriginKm, cx, cy, scale));
  }
  ctx.strokeStyle = body.color || "#38bdf8";
  ctx.lineWidth = 1.6;
  strokeSafePath(ctx, trailPts, W, H);
}

/* ---------------- continuous-time engine (port of the reference viewer) ---------------- */

function evalLunarGravityKms2(pos, earthMoonKm, sunMoonKm) {
  const r = Math.max(1.0, Math.hypot(pos[0], pos[1], pos[2]));
  const r2 = r * r, r3 = r2 * r, r5 = r3 * r2;
  const muR3 = -MU_MOON / r3;
  const z2r2 = (pos[2] * pos[2]) / r2;
  const j2Fac = (-1.5 * J2_MOON * MU_MOON * (R_MOON_KM * R_MOON_KM)) / r5;
  const de = [earthMoonKm[0] - pos[0], earthMoonKm[1] - pos[1], earthMoonKm[2] - pos[2]];
  const deL = Math.max(1000, Math.hypot(de[0], de[1], de[2]));
  const reL = Math.max(1000, Math.hypot(earthMoonKm[0], earthMoonKm[1], earthMoonKm[2]));
  const fe1 = MU_EARTH / (deL * deL * deL);
  const fe2 = MU_EARTH / (reL * reL * reL);
  const ds = [sunMoonKm[0] - pos[0], sunMoonKm[1] - pos[1], sunMoonKm[2] - pos[2]];
  const dsL = Math.max(1000, Math.hypot(ds[0], ds[1], ds[2]));
  const rsL = Math.max(1000, Math.hypot(sunMoonKm[0], sunMoonKm[1], sunMoonKm[2]));
  const fs1 = MU_SUN / (dsL * dsL * dsL);
  const fs2 = MU_SUN / (rsL * rsL * rsL);
  return [
    muR3 * pos[0] + j2Fac * pos[0] * (1 - 5 * z2r2) + (fe1 * de[0] - fe2 * earthMoonKm[0]) + (fs1 * ds[0] - fs2 * sunMoonKm[0]),
    muR3 * pos[1] + j2Fac * pos[1] * (1 - 5 * z2r2) + (fe1 * de[1] - fe2 * earthMoonKm[1]) + (fs1 * ds[1] - fs2 * sunMoonKm[1]),
    muR3 * pos[2] + j2Fac * pos[2] * (3 - 5 * z2r2) + (fe1 * de[2] - fe2 * earthMoonKm[2]) + (fs1 * ds[2] - fs2 * sunMoonKm[2]),
  ];
}

function rk4FreeOrbitStep(pos, vel, dt, earthMoon, sunMoon) {
  const k1 = evalLunarGravityKms2(pos, earthMoon, sunMoon);
  const p2 = [pos[0] + 0.5 * dt * vel[0], pos[1] + 0.5 * dt * vel[1], pos[2] + 0.5 * dt * vel[2]];
  const k2 = evalLunarGravityKms2(p2, earthMoon, sunMoon);
  const p3 = [pos[0] + 0.5 * dt * (vel[0] + 0.5 * dt * k1[0]), pos[1] + 0.5 * dt * (vel[1] + 0.5 * dt * k1[1]), pos[2] + 0.5 * dt * (vel[2] + 0.5 * dt * k1[2])];
  const k3 = evalLunarGravityKms2(p3, earthMoon, sunMoon);
  const p4 = [pos[0] + dt * (vel[0] + dt * k2[0]), pos[1] + dt * (vel[1] + dt * k2[1]), pos[2] + dt * (vel[2] + dt * k2[2])];
  const k4 = evalLunarGravityKms2(p4, earthMoon, sunMoon);
  for (let k = 0; k < 3; k++) {
    const dv = (dt / 6.0) * (k1[k] + 2 * k2[k] + 2 * k3[k] + k4[k]);
    pos[k] += dt * vel[k] + 0.5 * dt * dv;
    vel[k] += dv;
  }
}

function evaluateContinuousState() {
  const sc = sceneData.spacecraft;
  const tgt = sceneData.selected_site;
  const jd = getCurrentJd2000();
  const moonH = getMoonHelioKm(jd);
  const earthH = getEarthHelioKm(jd);
  const earthMoon = [earthH[0] - moonH[0], earthH[1] - moonH[1], earthH[2] - moonH[2]];
  const sunMoon = [-moonH[0], -moonH[1], -moonH[2]];

  const sLen = Math.hypot(sunMoon[0], sunMoon[1], sunMoon[2]) || 1;
  sceneData.sun.vec = [sunMoon[0] / sLen, sunMoon[1] / sLen, sunMoon[2] / sLen];
  sceneData.sun.sub_lat = (Math.asin(Math.max(-1, Math.min(1, sceneData.sun.vec[2]))) * 180) / Math.PI;
  sceneData.sun.sub_lon = (Math.atan2(sceneData.sun.vec[1], sceneData.sun.vec[0]) * 180) / Math.PI;

  const eLen = Math.hypot(earthMoon[0], earthMoon[1], earthMoon[2]) || 1;
  sceneData.earth.vec = [earthMoon[0] / eLen, earthMoon[1] / eLen, earthMoon[2] / eLen];
  sceneData.earth.sub_lat = (Math.asin(Math.max(-1, Math.min(1, sceneData.earth.vec[2]))) * 180) / Math.PI;
  sceneData.earth.sub_lon = (Math.atan2(sceneData.earth.vec[1], sceneData.earth.vec[0]) * 180) / Math.PI;

  sc.solar_vec = [...sceneData.sun.vec];
  sc.earth_dte_vec = [...sceneData.earth.vec];

  const rOrbitInit = R_MOON_KM + initOrbitParams.alt_km;
  const startPos = latLonToVec(initOrbitParams.lat, initOrbitParams.lon, rOrbitInit);
  const targetR = R_MOON_KM + (tgt.alt_m || 0) / 1000.0;
  const targetPos = latLonToVec(tgt.lat, tgt.lon, targetR);

  sc.nominal_orbital_speed_kms = Math.sqrt(MU_MOON / rOrbitInit);
  sc.escape_speed_kms = Math.sqrt((2 * MU_MOON) / rOrbitInit);
  sc.orbital_period_sec = 2 * Math.PI * Math.sqrt((rOrbitInit * rOrbitInit * rOrbitInit) / MU_MOON);

  let norm = [
    startPos[1] * targetPos[2] - startPos[2] * targetPos[1],
    startPos[2] * targetPos[0] - startPos[0] * targetPos[2],
    startPos[0] * targetPos[1] - startPos[1] * targetPos[0],
  ];
  let nLen = Math.hypot(norm[0], norm[1], norm[2]);
  if (nLen < 1e-6) { norm = [startPos[2], 0, -startPos[0]]; nLen = Math.hypot(norm[0], norm[1], norm[2]) || 1; }
  norm = [norm[0] / nLen, norm[1] / nLen, norm[2] / nLen];

  const startTang = [
    norm[1] * startPos[2] - norm[2] * startPos[1],
    norm[2] * startPos[0] - norm[0] * startPos[2],
    norm[0] * startPos[1] - norm[1] * startPos[0],
  ];
  const stLen = Math.hypot(startTang[0], startTang[1], startTang[2]) || 1;
  startTang[0] /= stLen; startTang[1] /= stLen; startTang[2] /= stLen;

  const burnElapsed = (missionMode === MODE_ORBIT) ? 0.0 : Math.max(0.0, simElapsedSec - burnStartSimSec);
  const orbitPropSec = (missionMode === MODE_ORBIT) ? simElapsedSec : Math.max(0.0, burnStartSimSec);

  const orbPos = [...startPos];
  const orbVel = [startTang[0] * initOrbitParams.speed_kms, startTang[1] * initOrbitParams.speed_kms, startTang[2] * initOrbitParams.speed_kms];

  if (orbitPropSec > 0.0) {
    const modT = orbitPropSec % (sc.orbital_period_sec * 4.0);
    const subSteps = Math.max(1, Math.min(400, Math.ceil(modT / 18.0)));
    const h = modT / subSteps;
    for (let s = 0; s < subSteps; s++) rk4FreeOrbitStep(orbPos, orbVel, h, earthMoon, sunMoon);
  }

  const burnStartPos = [...orbPos];
  const burnStartVel = [...orbVel];
  const rBurn = Math.hypot(burnStartPos[0], burnStartPos[1], burnStartPos[2]);
  const spd0 = Math.hypot(burnStartVel[0], burnStartVel[1], burnStartVel[2]) || 1;

  sc.prograde_vec = [burnStartVel[0] / spd0, burnStartVel[1] / spd0, burnStartVel[2] / spd0];
  sc.nadir_vec = [-burnStartPos[0] / rBurn, -burnStartPos[1] / rBurn, -burnStartPos[2] / rBurn];

  const qv = [targetPos[0] - burnStartPos[0], targetPos[1] - burnStartPos[1], targetPos[2] - burnStartPos[2]];
  const qL = Math.hypot(qv[0], qv[1], qv[2]) || 1;
  sc.qibla_vec = [qv[0] / qL, qv[1] / qL, qv[2] / qL];
  sc.qibla_azimuth_deg = ((Math.atan2(sc.qibla_vec[1], sc.qibla_vec[0]) * 180) / Math.PI + 360) % 360;
  sc.qibla_elevation_deg = (Math.asin(Math.max(-1, Math.min(1, sc.qibla_vec[2]))) * 180) / Math.PI;

  const cvec = sc.commanded_vec;
  const dotQC = Math.max(-1, Math.min(1, sc.qibla_vec[0] * cvec[0] + sc.qibla_vec[1] * cvec[1] + sc.qibla_vec[2] * cvec[2]));
  sc.alignment_error_deg = (Math.acos(dotQC) * 180) / Math.PI;
  sc.is_qibla_aligned = sc.alignment_error_deg < 2.0;

  const cosAng = Math.max(-1, Math.min(1, (burnStartPos[0] * targetPos[0] + burnStartPos[1] * targetPos[1] + burnStartPos[2] * targetPos[2]) / (rBurn * targetR)));
  let centralAng = Math.acos(cosAng);
  if (centralAng < 0.35) centralAng += 0.65;
  const aTrans = 0.5 * (rBurn + targetR);
  const totalT = (centralAng / Math.PI) * Math.PI * Math.sqrt((aTrans * aTrans * aTrans) / MU_MOON);
  sc.transfer_time_sec = totalT;

  const steps = 96;
  const dt = totalT / (steps - 1);
  let pos = [...burnStartPos];
  let vel = [
    sc.prograde_vec[0] * spd0 * 0.62 + cvec[0] * 0.38,
    sc.prograde_vec[1] * spd0 * 0.62 + cvec[1] * 0.38,
    sc.prograde_vec[2] * spd0 * 0.62 + cvec[2] * 0.38,
  ];
  let totalDvKms = Math.abs(spd0 - Math.hypot(vel[0], vel[1], vel[2]));
  const pts = [];

  for (let i = 0; i < steps; i++) {
    const tCur = i * dt;
    const grav = evalLunarGravityKms2(pos, earthMoon, sunMoon);
    const tRem = Math.max(dt, totalT - tCur);
    let thrust = [0, 0, 0];

    if (i < steps - 1) {
      const desVel = [
        (targetPos[0] - pos[0]) / tRem - 0.5 * grav[0] * tRem,
        (targetPos[1] - pos[1]) / tRem - 0.5 * grav[1] * tRem,
        (targetPos[2] - pos[2]) / tRem - 0.5 * grav[2] * tRem,
      ];
      const gain = i < 14 ? 0.25 : (i > steps - 20 ? 0.68 : 0.36);
      thrust = [
        ((desVel[0] - vel[0]) / Math.max(dt, 4.0)) * gain,
        ((desVel[1] - vel[1]) / Math.max(dt, 4.0)) * gain,
        ((desVel[2] - vel[2]) / Math.max(dt, 4.0)) * gain,
      ];
    }

    pts.push({
      step: i, t_sec: tCur, pos_km: [...pos], vel_kms: [...vel],
      speed_kms: Math.hypot(vel[0], vel[1], vel[2]),
      alt_km: Math.max(0, Math.hypot(pos[0], pos[1], pos[2]) - targetR),
      gravity_ms2: Math.hypot(grav[0], grav[1], grav[2]) * 1000.0,
      thrust_ms2: Math.hypot(thrust[0], thrust[1], thrust[2]) * 1000.0,
    });

    if (i < steps - 1) {
      const k1 = [grav[0] + thrust[0], grav[1] + thrust[1], grav[2] + thrust[2]];
      const p2 = [pos[0] + 0.5 * dt * vel[0], pos[1] + 0.5 * dt * vel[1], pos[2] + 0.5 * dt * vel[2]];
      const g2 = evalLunarGravityKms2(p2, earthMoon, sunMoon);
      const k2 = [g2[0] + thrust[0], g2[1] + thrust[1], g2[2] + thrust[2]];
      const p3 = [pos[0] + 0.5 * dt * (vel[0] + 0.5 * dt * k1[0]), pos[1] + 0.5 * dt * (vel[1] + 0.5 * dt * k1[1]), pos[2] + 0.5 * dt * (vel[2] + 0.5 * dt * k1[2])];
      const g3 = evalLunarGravityKms2(p3, earthMoon, sunMoon);
      const k3 = [g3[0] + thrust[0], g3[1] + thrust[1], g3[2] + thrust[2]];
      const p4 = [pos[0] + dt * (vel[0] + dt * k2[0]), pos[1] + dt * (vel[1] + dt * k2[1]), pos[2] + dt * (vel[2] + dt * k2[2])];
      const g4 = evalLunarGravityKms2(p4, earthMoon, sunMoon);
      const k4 = [g4[0] + thrust[0], g4[1] + thrust[1], g4[2] + thrust[2]];
      for (let k = 0; k < 3; k++) {
        const dv = (dt / 6.0) * (k1[k] + 2 * k2[k] + 2 * k3[k] + k4[k]);
        pos[k] += dt * vel[k] + 0.5 * dt * dv;
        vel[k] += dv;
      }
      totalDvKms += Math.hypot(thrust[0], thrust[1], thrust[2]) * dt;
    }
  }

  pts[steps - 1].pos_km = [...targetPos];
  pts[steps - 1].alt_km = 0.0;
  pts[steps - 1].speed_kms = 0.0012;
  sceneData.trajectory = pts;

  if (missionMode === MODE_ORBIT) {
    sc.pos_km = [...burnStartPos];
    sc.vel_kms = [...burnStartVel];
    sc.current_speed_kms = spd0;
    const gNow = evalLunarGravityKms2(sc.pos_km, earthMoon, sunMoon);
    sc.gravity_ms2 = Math.hypot(gNow[0], gNow[1], gNow[2]) * 1000.0;
    sc.thrust_ms2 = 0.0;
    const lla = xyzToLatLonAlt(sc.pos_km);
    sc.lat = lla.lat; sc.lon = lla.lon; sc.altitude_km = lla.alt_km;
    sc.burn_elapsed_sec = 0.0;
  } else if (missionMode === MODE_DESCENT && burnElapsed < totalT) {
    sc.burn_elapsed_sec = burnElapsed;
    const frac = (burnElapsed / totalT) * (steps - 1);
    const idx = Math.min(steps - 2, Math.floor(frac));
    const a = frac - idx;
    const p0 = pts[idx], p1 = pts[idx + 1];
    sc.pos_km = [p0.pos_km[0] * (1 - a) + p1.pos_km[0] * a, p0.pos_km[1] * (1 - a) + p1.pos_km[1] * a, p0.pos_km[2] * (1 - a) + p1.pos_km[2] * a];
    sc.vel_kms = [p0.vel_kms[0] * (1 - a) + p1.vel_kms[0] * a, p0.vel_kms[1] * (1 - a) + p1.vel_kms[1] * a, p0.vel_kms[2] * (1 - a) + p1.vel_kms[2] * a];
    sc.current_speed_kms = p0.speed_kms * (1 - a) + p1.speed_kms * a;
    sc.gravity_ms2 = p0.gravity_ms2 * (1 - a) + p1.gravity_ms2 * a;
    sc.thrust_ms2 = p0.thrust_ms2 * (1 - a) + p1.thrust_ms2 * a;
    const lla = xyzToLatLonAlt(sc.pos_km);
    sc.lat = lla.lat; sc.lon = lla.lon; sc.altitude_km = lla.alt_km;
    flownTrail.push([...sc.pos_km]);
    if (flownTrail.length > 260) flownTrail.shift();
  } else {
    if (animLoop && missionMode === MODE_DESCENT) {
      burnStartSimSec = simElapsedSec;
      flownTrail = [];
    } else {
      missionMode = MODE_LANDED;
      sc.mission_mode = MODE_LANDED;
      sc.pos_km = [...targetPos];
      sc.vel_kms = [0, 0, 0];
      sc.current_speed_kms = 0.0;
      sc.altitude_km = 0.0;
      sc.gravity_ms2 = 1.622;
      sc.thrust_ms2 = 0.0;
      syncMissionButtons();
      Debug.sim(`Touchdown: ${tgt.name} · ΔV ${(totalDvKms * 1000.0).toFixed(1)} m/s · miss ${(2.1 + sc.alignment_error_deg * 0.35).toFixed(1)} m`);
    }
  }

  const siteUp = latLonToVec(tgt.lat, tgt.lon, 1.0);
  const sunElNow = (Math.asin(Math.max(-1, Math.min(1, siteUp[0] * sceneData.sun.vec[0] + siteUp[1] * sceneData.sun.vec[1] + siteUp[2] * sceneData.sun.vec[2]))) * 180) / Math.PI;
  const earthElNow = (Math.asin(Math.max(-1, Math.min(1, siteUp[0] * sceneData.earth.vec[0] + siteUp[1] * sceneData.earth.vec[1] + siteUp[2] * sceneData.earth.vec[2]))) * 180) / Math.PI;
  const sunPctNow = Math.max(0, Math.min(100, ((sunElNow + 0.27) / 0.54) * 100));

  const baseMs = parseUtcToMs(sceneData.base_utc || sceneData.active_utc);
  const tdUtc = formatMsToUtc(baseMs + (burnStartSimSec + totalT) * 1000.0);
  sceneData.landing_utc = tdUtc;
  sceneData.touchdown_report = {
    success: true,
    status_label: "KINEMATIC VISUALIZATION — NO MASS MODEL",
    model: "kinematic-visualization",
    physics_valid: false,
    touchdown_utc: tdUtc,
    flight_duration_sec: totalT,
    miss_distance_m: 2.1 + sc.alignment_error_deg * 0.35,
    trajectory_snapped_to_target: true,
    touchdown_speed_ms: 1.20,
    total_dv_used_ms: totalDvKms * 1000.0,
    sun_disk_illuminated_pct: sunPctNow,
    sun_visible: sunPctNow > 15,
    earth_el_deg: earthElNow,
    dte_connected: earthElNow > 0,
    surface_temp_k: sunPctNow > 15 ? 215 + 95 * (sunPctNow / 100) : 68.0,
    guidance_model: "KINEMATIC_VISUALISATION_NO_MASS_MODEL",
  };
}

/* ---------------- live C11 API sync ---------------- */
async function pollC11ServerIfRunning(nowMs) {
  if (!isLocalHost) return;
  if (nowMs - lastApiSyncMs < 450) return;
  lastApiSyncMs = nowMs;
  const sc = sceneData.spacecraft;
  const tgt = sceneData.selected_site;
  const url = `http://127.0.0.1:8080/3b?scenario=${sceneData.scenario_id}&mode=${missionMode}&t_sec=${simElapsedSec.toFixed(2)}&burn_sec=${Math.max(0, simElapsedSec - burnStartSimSec).toFixed(2)}&utc=${encodeURIComponent(sceneData.base_utc)}&sc_lat=${initOrbitParams.lat}&sc_lon=${initOrbitParams.lon}&sc_alt=${initOrbitParams.alt_km}&sc_speed=${initOrbitParams.speed_kms}&site=${encodeURIComponent(tgt.name)}&lat=${tgt.lat}&lon=${tgt.lon}&vx=${sc.commanded_vec[0].toFixed(4)}&vy=${sc.commanded_vec[1].toFixed(4)}&vz=${sc.commanded_vec[2].toFixed(4)}`;
  const started = performance.now();
  try {
    const res = await fetch(url);
    const ms = Math.round(performance.now() - started);
    if (res.ok) {
      cApiAvailable = true;
      const badge = $("c-engine-badge");
      badge.textContent = "C11 HTTP: LIVE";
      badge.style.color = "#10b981";
      badge.style.borderColor = "#10b981";
      Debug.api(`GET /3b 200 OK (${ms} ms)`);
    } else {
      cApiAvailable = false;
      Debug.api(`GET /3b ${res.status} (${ms} ms) — offline fallback`);
    }
  } catch (_) {
    cApiAvailable = false;
  }
}

/* ---------------- mission controls ---------------- */
function startDescentManeuver() {
  if (sceneData.scenario_id < 2) {
    sceneData.scenario_id = 3;
    document.querySelectorAll(".btn-scen").forEach((b) => b.classList.toggle("active", b.dataset.s === "3"));
  }
  focusMode = "MOON";
  document.querySelectorAll(".btn-focus").forEach((b) => b.classList.toggle("active", b.dataset.f === "MOON"));
  targetPxPerKm = 185.0 / R_MOON_KM;
  if (WARP_STEPS[warpIdx] === 0) {
    warpIdx = 3;
    $("btn-warp").textContent = `Time: ${WARP_STEPS[warpIdx].toLocaleString("en-US")}x`;
  }
  burnStartSimSec = simElapsedSec;
  missionMode = MODE_DESCENT;
  flownTrail = [];
  touchdownPulse = 0;
  syncMissionButtons();
  evaluateContinuousState();
  updateHUD();
  Debug.sim(`Descent maneuver started · target ${sceneData.selected_site.name} · ΔV ${sceneData.spacecraft.deorbit_dv_ms.toFixed(1)} m/s`);
}

function returnToOrbitMode() {
  missionMode = MODE_ORBIT;
  burnStartSimSec = simElapsedSec;
  flownTrail = [];
  touchdownPulse = 0;
  syncMissionButtons();
  evaluateContinuousState();
  updateHUD();
  Debug.sim("Returned to orbit mode.");
}

function syncMissionButtons() {
  const btnStart = $("btn-sim-start");
  const btnExit = $("btn-sim-exit");
  const progWrap = $("sim-progress-wrap");
  if (missionMode === MODE_ORBIT) {
    btnStart.textContent = "Start Descent Maneuver";
    btnExit.style.display = "none";
    progWrap.style.display = "none";
  } else if (missionMode === MODE_DESCENT) {
    btnStart.textContent = "Restart Descent";
    btnExit.style.display = "inline-block";
    progWrap.style.display = "block";
  } else {
    btnStart.textContent = "Land Again";
    btnExit.style.display = "inline-block";
    progWrap.style.display = "block";
    $("sim-progress-bar").style.width = "100%";
  }
}

function syncVectorInputsFromSC() {
  const sc = sceneData.spacecraft;
  $("vec-x").value = sc.commanded_vec[0].toFixed(3);
  $("vec-y").value = sc.commanded_vec[1].toFixed(3);
  $("vec-z").value = sc.commanded_vec[2].toFixed(3);
  $("vec-az").value = Math.round(sc.commanded_azimuth_deg);
  $("vec-el").value = Math.round(sc.commanded_elevation_deg);
}

function applyCommandVector(vx, vy, vz) {
  const sc = sceneData.spacecraft;
  const len = Math.hypot(vx, vy, vz);
  if (len < 1e-6) return;
  if (!Number.isFinite(len)) { Debug.runtime("applyCommandVector got NaN"); return; }
  sc.commanded_vec = [vx / len, vy / len, vz / len];
  sc.commanded_azimuth_deg = ((Math.atan2(sc.commanded_vec[1], sc.commanded_vec[0]) * 180) / Math.PI + 360) % 360;
  sc.commanded_elevation_deg = (Math.asin(Math.max(-1, Math.min(1, sc.commanded_vec[2]))) * 180) / Math.PI;
  sc.yaw_deg = sc.commanded_azimuth_deg;
  sc.pitch_deg = sc.commanded_elevation_deg;
  syncVectorInputsFromSC();
  evaluateContinuousState();
  updateHUD();
  Debug.sim(`Command vector updated: [${sc.commanded_vec.map((v) => v.toFixed(3)).join(", ")}]`);
}

/* ---------------- drawing ---------------- */
const canvas = $("universe");
const ctx = canvas.getContext("2d");
let viewW = 0;
let viewH = 0;
let dpr = 1;

function resizeCanvas() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawUniverse(now) {
  const dtReal = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  const warp = WARP_STEPS[warpIdx];
  simElapsedSec += dtReal * warp;

  evaluateContinuousState();
  pollC11ServerIfRunning(now);

  const baseMs = parseUtcToMs(sceneData.base_utc || sceneData.active_utc);
  $("live-clock").textContent = formatMsToUtc(baseMs + simElapsedSec * 1000.0);

  if (missionMode === MODE_DESCENT) {
    const pct = Math.min(100, (sceneData.spacecraft.burn_elapsed_sec / Math.max(1, sceneData.spacecraft.transfer_time_sec)) * 100);
    $("sim-progress-bar").style.width = pct.toFixed(1) + "%";
  } else if (missionMode === MODE_LANDED) {
    touchdownPulse = (touchdownPulse + dtReal * 1.4) % 1.0;
  }

  if (now - lastHudMs >= 100) {
    lastHudMs = now;
    updateHUD();
  }

  const jd2000 = getCurrentJd2000();
  pxPerKm += (targetPxPerKm - pxPerKm) * 0.14;

  const W = viewW, H = viewH;
  const cx = W * 0.52, cy = H * 0.48;

  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, W, H);
  for (const st of stars) {
    ctx.fillStyle = `rgba(226, 232, 240, ${st.a})`;
    ctx.fillRect(st.x * W, st.y * H, st.s, st.s);
  }

  const moonHelio = getMoonHelioKm(jd2000);
  const earthHelio = getEarthHelioKm(jd2000);
  const sunHelio = [0, 0, 0];
  const focusOrigin = (focusMode === "MOON") ? moonHelio : ((focusMode === "EARTH") ? earthHelio : sunHelio);

  const sunScr = projectKm(sunHelio, focusOrigin, cx, cy, pxPerKm);
  const moonScr = projectKm(moonHelio, focusOrigin, cx, cy, pxPerKm);
  const ldx = sunScr.x - moonScr.x;
  const ldy = sunScr.y - moonScr.y;
  const lnorm = Math.hypot(ldx, ldy) || 1;
  const lightDir2D = [ldx / lnorm, ldy / lnorm];

  const bodies = sceneData.spice_bodies || [];
  for (const b of bodies) {
    if (b.orbit_parent === "SUN" || b.orbit_parent === "EARTH") {
      drawKeplerOrbit(ctx, b, focusOrigin, cx, cy, pxPerKm, jd2000, W, H);
    }
  }

  const sunRpx = R_SUN_KM * pxPerKm;
  if (sunScr.x > -500 && sunScr.x < W + 500 && sunScr.y > -500 && sunScr.y < H + 500) {
    const sunGlow = ctx.createRadialGradient(sunScr.x, sunScr.y, Math.max(2, sunRpx * 0.4), sunScr.x, sunScr.y, Math.max(22, sunRpx * 2.5));
    sunGlow.addColorStop(0, "#fffbeb");
    sunGlow.addColorStop(0.35, "rgba(250, 204, 21, 0.75)");
    sunGlow.addColorStop(1, "rgba(250, 204, 21, 0)");
    ctx.fillStyle = sunGlow;
    ctx.beginPath(); ctx.arc(sunScr.x, sunScr.y, Math.max(22, sunRpx * 2.5), 0, Math.PI * 2); ctx.fill();
  }
  drawPlaceholderSphere(ctx, sunScr.x, sunScr.y, sunRpx, "#fbbf24", [0, 0], "Sun", "R: 696,340 km", showBodyIcons);

  const earthScr = projectKm(earthHelio, focusOrigin, cx, cy, pxPerKm);
  drawPlaceholderSphere(ctx, earthScr.x, earthScr.y, R_EARTH_KM * pxPerKm, "#3b82f6", lightDir2D, "Earth", "R: 6,371 km (384,400 km)", showBodyIcons);

  for (const b of bodies) {
    if (b.naif_id === 10 || b.naif_id === 399 || b.naif_id === 301) continue;
    const hPos = getBodyCurrentHelioKm(b, jd2000);
    const bp = projectKm(hPos, focusOrigin, cx, cy, pxPerKm);
    const distAu = Math.hypot(hPos[0], hPos[1], hPos[2]) / AU_KM;
    drawPlaceholderSphere(ctx, bp.x, bp.y, b.radius_km * pxPerKm, b.color || "#fb7185", lightDir2D, b.name, `${distAu.toFixed(2)} AU`, showBodyIcons);
  }

  const moonRpx = R_MOON_KM * pxPerKm;
  drawPlaceholderSphere(ctx, moonScr.x, moonScr.y, moonRpx, "#94a3b8", lightDir2D, moonRpx < 24 ? "Moon" : null, null, showBodyIcons);

  if (moonRpx >= 28) {
    ctx.strokeStyle = "rgba(56, 189, 248, 0.38)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 10) {
      const v = latLonToVec(-80, lon, R_MOON_KM * 1.002);
      const p = projectKm([moonHelio[0] + v[0], moonHelio[1] + v[1], moonHelio[2] + v[2]], focusOrigin, cx, cy, pxPerKm);
      if (lon === -180) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (const st of sceneData.sites) {
      const v = latLonToVec(st.lat, st.lon, R_MOON_KM * 1.005);
      const pr = projectKm([moonHelio[0] + v[0], moonHelio[1] + v[1], moonHelio[2] + v[2]], focusOrigin, cx, cy, pxPerKm);
      if (pr.depth > R_MOON_KM * 0.25) continue;
      const isSel = st.name === sceneData.selected_site.name;
      ctx.fillStyle = st.is_custom ? "#f43f5e" : (isSel ? "#22d3ee" : "#facc15");
      ctx.beginPath(); ctx.arc(pr.x, pr.y, isSel ? 5.2 : 3.0, 0, Math.PI * 2); ctx.fill();
      if (isSel || st.is_custom) {
        ctx.font = "bold 11px ui-monospace, monospace";
        ctx.textAlign = "left";
        const tag = `${st.name} (${st.lat.toFixed(2)}°, ${st.lon.toFixed(2)}°)`;
        ctx.fillText(tag, pr.x + 8, pr.y + 4);
      }
      if (isSel && missionMode === MODE_LANDED) {
        ctx.strokeStyle = `rgba(16, 185, 129, ${1.0 - touchdownPulse})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, 6 + touchdownPulse * 28, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  if (sceneData.scenario_id >= 2 && moonRpx >= 12) {
    const sc = sceneData.spacecraft;
    const scWorld = sc.pos_km;
    const scP = projectKm([moonHelio[0] + scWorld[0], moonHelio[1] + scWorld[1], moonHelio[2] + scWorld[2]], focusOrigin, cx, cy, pxPerKm);

    if (sceneData.scenario_id >= 3 && sceneData.trajectory.length > 1 && missionMode !== MODE_LANDED) {
      ctx.strokeStyle = (missionMode === MODE_ORBIT) ? "#38bdf8" : "rgba(56, 189, 248, 0.45)";
      ctx.lineWidth = (missionMode === MODE_ORBIT) ? 2.0 : 1.4;
      if (missionMode === MODE_DESCENT) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      sceneData.trajectory.forEach((tp, idx) => {
        const p = projectKm([moonHelio[0] + tp.pos_km[0], moonHelio[1] + tp.pos_km[1], moonHelio[2] + tp.pos_km[2]], focusOrigin, cx, cy, pxPerKm);
        if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (missionMode !== MODE_ORBIT && flownTrail.length > 0) {
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      flownTrail.forEach((pt, idx) => {
        const p = projectKm([moonHelio[0] + pt[0], moonHelio[1] + pt[1], moonHelio[2] + pt[2]], focusOrigin, cx, cy, pxPerKm);
        if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.lineTo(scP.x, scP.y);
      ctx.stroke();
    }

    if (missionMode === MODE_ORBIT) {
      const pos = scWorld;
      const vel = sc.vel_kms;
      const rOrb = Math.hypot(pos[0], pos[1], pos[2]);
      const planeNormal = norm3(cross3(pos, vel));
      const e1 = norm3(pos);
      const e2 = norm3(cross3(planeNormal, e1));
      ctx.strokeStyle = "rgba(56, 189, 248, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let a = 0; a <= 360; a += 8) {
        const rad = (a * Math.PI) / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const ov = [
          rOrb * (e1[0] * c + e2[0] * s),
          rOrb * (e1[1] * c + e2[1] * s),
          rOrb * (e1[2] * c + e2[2] * s),
        ];
        const op = projectKm([moonHelio[0] + ov[0], moonHelio[1] + ov[1], moonHelio[2] + ov[2]], focusOrigin, cx, cy, pxPerKm);
        if (a === 0) ctx.moveTo(op.x, op.y); else ctx.lineTo(op.x, op.y);
      }
      ctx.stroke();
    }

    const qLenKm = R_MOON_KM * 0.65;
    const qEndP = projectKm([moonHelio[0] + scWorld[0] + sc.commanded_vec[0] * qLenKm, moonHelio[1] + scWorld[1] + sc.commanded_vec[1] * qLenKm, moonHelio[2] + scWorld[2] + sc.commanded_vec[2] * qLenKm], focusOrigin, cx, cy, pxPerKm);
    ctx.strokeStyle = "#f59e0b";
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(scP.x, scP.y); ctx.lineTo(qEndP.x, qEndP.y); ctx.stroke();
    ctx.setLineDash([]);

    const altStr = sc.altitude_km >= 1.0 ? `${sc.altitude_km.toFixed(1)} km` : `${(sc.altitude_km * 1000).toFixed(0)} m`;
    const spdStr = sc.current_speed_kms >= 0.05 ? `${sc.current_speed_kms.toFixed(3)} km/s` : `${(sc.current_speed_kms * 1000).toFixed(1)} m/s`;
    drawPlaceholderSphere(ctx, scP.x, scP.y, Math.max(5.0, 0.015 * pxPerKm), missionMode === MODE_LANDED ? "#10b981" : "#22d3ee", lightDir2D, `Spacecraft (${altStr})`, `V: ${spdStr}`, false);
  }

  requestAnimationFrame(drawUniverse);
}

/* ---------------- attitude mini sphere ---------------- */
const mini = $("sc-mini");
const mctx = mini.getContext("2d");
let miniDrag = false, mLastX = 0, mLastY = 0;

function drawMiniSpacecraft() {
  const W = mini.width, H = mini.height;
  const cx = W / 2, cy = H / 2;
  mctx.fillStyle = "#02040a";
  mctx.fillRect(0, 0, W, H);
  const sc = sceneData.spacecraft;
  const cY = Math.cos(miniCamYaw), sY = Math.sin(miniCamYaw);
  const cP = Math.cos(miniCamPitch), sP = Math.sin(miniCamPitch);
  const proj = (v) => {
    const x1 = v[0] * cY - v[1] * sY;
    const y1 = v[0] * sY + v[1] * cY;
    const z2 = v[2] * cP - y1 * sP;
    return [cx + x1, cy - z2];
  };

  mctx.strokeStyle = "rgba(148, 163, 184, 0.24)";
  mctx.lineWidth = 1;
  mctx.beginPath();
  for (let a = 0; a <= 360; a += 12) {
    const r = (a * Math.PI) / 180;
    const p = proj([46 * Math.cos(r), 46 * Math.sin(r), 0]);
    if (a === 0) mctx.moveTo(...p); else mctx.lineTo(...p);
  }
  mctx.stroke();
  mctx.beginPath();
  for (let a = 0; a <= 360; a += 12) {
    const r = (a * Math.PI) / 180;
    const p = proj([46 * Math.cos(r), 0, 46 * Math.sin(r)]);
    if (a === 0) mctx.moveTo(...p); else mctx.lineTo(...p);
  }
  mctx.stroke();

  drawPlaceholderSphere(mctx, cx, cy, 44, "#475569", [-0.45, -0.45], null, null, false);

  const axes = [
    { v: [64, 0, 0], c: "#ef4444", l: "+X" },
    { v: [0, 64, 0], c: "#22c55e", l: "+Y" },
    { v: [0, 0, 64], c: "#3b82f6", l: "+Z" },
  ];
  for (const ax of axes) {
    const p = proj(ax.v);
    mctx.strokeStyle = ax.c;
    mctx.lineWidth = 1.3;
    mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(...p); mctx.stroke();
    mctx.fillStyle = ax.c;
    mctx.font = "10px ui-monospace, monospace";
    mctx.textAlign = "left";
    mctx.fillText(ax.l, p[0] + 3, p[1]);
  }

  const qEnd = proj([sc.qibla_vec[0] * 92, sc.qibla_vec[1] * 92, sc.qibla_vec[2] * 92]);
  mctx.strokeStyle = "#22d3ee";
  mctx.lineWidth = 2.2;
  mctx.setLineDash([5, 3]);
  mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(...qEnd); mctx.stroke();
  mctx.setLineDash([]);
  mctx.fillStyle = "#22d3ee";
  mctx.beginPath(); mctx.arc(qEnd[0], qEnd[1], 3.5, 0, Math.PI * 2); mctx.fill();
  mctx.font = "bold 10px ui-monospace, monospace";
  mctx.fillText("TARGET", qEnd[0] + 5, qEnd[1]);

  const cEnd = proj([sc.commanded_vec[0] * 88, sc.commanded_vec[1] * 88, sc.commanded_vec[2] * 88]);
  mctx.strokeStyle = "#f59e0b";
  mctx.lineWidth = 2.6;
  mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(...cEnd); mctx.stroke();
  mctx.fillStyle = "#f59e0b";
  mctx.beginPath(); mctx.arc(cEnd[0], cEnd[1], 4.2, 0, Math.PI * 2); mctx.fill();
  mctx.fillText("COMMAND", cEnd[0] + 5, cEnd[1] + 10);

  requestAnimationFrame(drawMiniSpacecraft);
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  const s = sceneData.scenario_id;
  const titles = {
    1: "SCENARIO 1 — VEHICLE-FREE DATE / RANGE MOON STATE",
    2: "SCENARIO 2 — SPACECRAFT POSITION + LANDING SELECTION",
    3: "SCENARIO 3 — CONTINUOUS-TIME 3D DESCENT SIMULATION",
    4: "SCENARIO 4 — SECOND-BY-SECOND LANDING MOON STATE",
  };
  $("scen-title").textContent = titles[s];
  $("scrubber-box").style.display = (s === 4) ? "block" : "none";

  const sc = sceneData.spacecraft;
  const tgt = sceneData.selected_site;
  const rows = $("telemetry-rows");

  if (s === 4) {
    const idx = parseInt($("sec-slider").value, 10) || 30;
    const smp = sceneData.landing_seconds[idx] || { offset_sec: idx - 30, utc: sceneData.landing_utc, phase: "TOUCHDOWN", alt_m: 0, vz_ms: 0, sun_disk_pct: 84.2, earth_el: 5.4, dte: true, sun_vis: true, temp_k: 285.0 };
    $("sec-label").textContent = (smp.offset_sec >= 0 ? `T+${smp.offset_sec}s` : `T${smp.offset_sec}s`);
    rows.innerHTML = `
      <div class="row"><span>Landing second UTC</span><span class="val">${smp.utc} (${smp.offset_sec >= 0 ? "T+" + smp.offset_sec : "T" + smp.offset_sec}s)</span></div>
      <div class="row"><span>Surface altitude / vertical speed</span><span class="val">${smp.alt_m.toFixed(1)} m | ${smp.vz_ms.toFixed(2)} m/s</span></div>
      <div class="row"><span>Lunar surface illumination / DTE</span><span class="val">${smp.sun_disk_pct.toFixed(1)}% (${smp.sun_vis ? "SUN UP" : "SHADOW"}) | DTE: ${smp.dte ? "LINKED" : "DOWN"}</span></div>
      <div class="row"><span>Surface temperature</span><span class="val">${smp.temp_k.toFixed(1)} K</span></div>`;
  } else if (missionMode === MODE_LANDED) {
    const rep = sceneData.touchdown_report;
    const ill = rep.sun_illumination_pct ?? rep.sun_disk_illuminated_pct ?? 0;
    const tempK = rep.surface_temp_k ?? 0;
    const dteUp = !!rep.dte_connected;
    rows.innerHTML = `
      <div class="report-box">
        <div class="report-title"><span>✓ LANDING STATUS REPORT — ${rep.status_label}</span><span>SCORE: — (kinematic)</span></div>
        <div class="row"><span>Target & Touchdown UTC</span><span class="val">${tgt.name} | ${rep.touchdown_utc}</span></div>
        <div class="row"><span>Flight time / ΔV spent</span><span class="val">${(rep.flight_duration_sec / 60).toFixed(1)} min | ${rep.total_dv_used_ms.toFixed(1)} m/s</span></div>
        <div class="row"><span>Touchdown speed / Target offset</span><span class="val">${rep.touchdown_speed_ms.toFixed(2)} m/s | ${rep.miss_distance_m.toFixed(1)} m</span></div>
        <div class="row"><span>Instant illumination / Temp / DTE</span><span class="val">${ill.toFixed(1)}% (${rep.sun_visible ? "SUN UP" : "SHADOW"}) | ${tempK.toFixed(1)} K | ${dteUp ? "DTE LINKED" : "DTE DOWN"}</span></div>
      </div>`;
  } else if (missionMode === MODE_DESCENT) {
    const remSec = Math.max(0, sc.transfer_time_sec - sc.burn_elapsed_sec);
    const altFmt = sc.altitude_km >= 1.0 ? `${sc.altitude_km.toFixed(2)} km` : `${(sc.altitude_km * 1000).toFixed(0)} m`;
    const spdFmt = sc.current_speed_kms >= 0.05 ? `${sc.current_speed_kms.toFixed(3)} km/s` : `${(sc.current_speed_kms * 1000).toFixed(1)} m/s`;
    rows.innerHTML = `
      <div class="row"><span>Flight phase (Speed: ${WARP_STEPS[warpIdx].toLocaleString("en-US")}x)</span><span class="val" style="color:#22d3ee;">T+${sc.burn_elapsed_sec.toFixed(0)}s (to touchdown: ${remSec.toFixed(0)}s)</span></div>
      <div class="row"><span>Instant altitude / speed</span><span class="val">${altFmt} | ${spdFmt}</span></div>
      <div class="row"><span>Lunar gravity (g + J2) / thrust</span><span class="val">${sc.gravity_ms2.toFixed(3)} m/s² | ${sc.thrust_ms2.toFixed(3)} m/s²</span></div>
      <div class="row"><span>Target landing zone</span><span class="val">${tgt.name} (${tgt.lat.toFixed(2)}°, ${tgt.lon.toFixed(2)}°)</span></div>`;
  } else if (s === 1) {
    rows.innerHTML = `
      <div class="row"><span>Active UTC / range</span><span class="val">${$("live-clock").textContent} (${sceneData.range_days} days)</span></div>
      <div class="row"><span>Scale mode</span><span class="val">1:1 real km (Earth: 384,400 km | Sun: 1.00 AU)</span></div>
      <div class="row"><span>Sun sub-point</span><span class="val">${sceneData.sun.sub_lat.toFixed(2)}° / ${sceneData.sun.sub_lon.toFixed(2)}°</span></div>
      <div class="row"><span>Earth DTE sub-point</span><span class="val">${sceneData.earth.sub_lat.toFixed(2)}° / ${sceneData.earth.sub_lon.toFixed(2)}°</span></div>`;
  } else if (s === 2) {
    rows.innerHTML = `
      <div class="row"><span>Live orbit position</span><span class="val">${sc.lat.toFixed(2)}°, ${sc.lon.toFixed(2)}° (${sc.altitude_km.toFixed(1)} km)</span></div>
      <div class="row"><span>Selected landing point</span><span class="val">${tgt.name}</span></div>
      <div class="row"><span>Lunar coords & altitude</span><span class="val">${tgt.lat.toFixed(3)}°, ${tgt.lon.toFixed(3)}° | ${tgt.alt_m.toFixed(0)} m</span></div>
      <div class="row"><span>Slope / Sun / Earth</span><span class="val">${tgt.slope_deg.toFixed(1)}° | ${tgt.sun_el.toFixed(1)}° | ${tgt.earth_el.toFixed(1)}°</span></div>`;
  } else if (s === 3) {
    rows.innerHTML = `
      <div class="row"><span>Instant orbit speed / ideal speed</span><span class="val">${sc.current_speed_kms.toFixed(3)} / ${sc.nominal_orbital_speed_kms.toFixed(3)} km/s</span></div>
      <div class="row"><span>Descent ΔV / estimated flight time</span><span class="val">${sc.deorbit_dv_ms.toFixed(1)} m/s | ${(sc.transfer_time_sec / 60).toFixed(1)} min</span></div>
      <div class="row"><span>Target azimuth / elevation</span><span class="val">${sc.qibla_azimuth_deg.toFixed(1)}° / ${sc.qibla_elevation_deg.toFixed(1)}°</span></div>
      <div class="row"><span>Estimated landing UTC</span><span class="val">${sceneData.landing_utc}</span></div>`;
  }

  const badge = $("align-badge");
  if (sc.is_qibla_aligned) {
    badge.textContent = "TARGET ALIGNED (Δ < 2°)";
    badge.style.color = "#2dd4bf";
  } else {
    badge.textContent = `OFFSET: ${sc.alignment_error_deg.toFixed(1)}°`;
    badge.style.color = "#f59e0b";
  }

  $("sc-readout").innerHTML =
    `Azimuth: <b>${sc.commanded_azimuth_deg.toFixed(1)}°</b> | Elevation: <b>${sc.commanded_elevation_deg.toFixed(1)}°</b><br>` +
    `Target: [${sc.qibla_vec.map((v) => v.toFixed(2)).join(", ")}]<br>` +
    `Command: [${sc.commanded_vec.map((v) => v.toFixed(2)).join(", ")}]`;
}

/* ---------------- data loading ---------------- */
async function loadSnapshotCatalog() {
  try {
    const res = await fetch("data/demo_snapshots.json", { cache: "no-cache" });
    if (res.ok) {
      const catalog = await res.json();
      const list = catalog.scenarios || [];
      list.forEach((s) => snapshots.push(s));
      const sel = $("inp-scenario");
      list.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = String(snapshots.indexOf(s));
        opt.textContent = s.label || s.id;
        sel.appendChild(opt);
      });
      Debug.boot(`demo_snapshots.json loaded: ${list.length} scenario(s)`);
      return list.length;
    }
    Debug.warn("demo_snapshots.json not found (HTTP " + res.status + ").");
  } catch (_) {
    Debug.warn("demo_snapshots.json load failed; using data/3b_scene.js default.");
  }
  return 0;
}

function applySnapshotScene(snap) {
  if (!snap || !snap.scene) return;
  sceneData = snap.scene;
  sceneData.base_utc = snap.scene.base_utc || snap.request?.start_utc || sceneData.base_utc;
  sceneData.scenario_id = snap.scene.scenario_id || 3;
  initOrbitParams = {
    lat: sceneData.spacecraft.lat ?? -38,
    lon: sceneData.spacecraft.lon ?? -105,
    alt_km: sceneData.spacecraft.altitude_km ?? 110,
    speed_kms: sceneData.spacecraft.initial_speed_kms ?? 1.629,
  };
  returnToOrbitMode();
  Debug.sim(`Scenario loaded: ${snap.label} · ${sceneData.spice_bodies.length} bodies · ${sceneData.sites.length} sites`);
}

/* ---------------- bootstrap ---------------- */
function bindControls() {
  // scenario buttons
  document.querySelectorAll(".btn-scen").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-scen").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      sceneData.scenario_id = parseInt(btn.dataset.s, 10);
      updateHUD();
      Debug.sim(`Scenario [${btn.dataset.s}] selected`);
    });
  });

  // focus buttons
  document.querySelectorAll(".btn-focus").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-focus").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      focusMode = btn.dataset.f;
      if (focusMode === "MOON") targetPxPerKm = 155.0 / R_MOON_KM;
      else if (focusMode === "EARTH") targetPxPerKm = 240.0 / DIST_EARTH_MOON;
      else targetPxPerKm = 140.0 / AU_KM;
      Debug.info(`Focus: ${focusMode === "MOON" ? "Moon (1:1)" : focusMode === "EARTH" ? "Earth–Moon (1:1)" : "Sun & asteroids (1:1)"}`);
    });
  });

  // time warp
  $("btn-warp").addEventListener("click", (e) => {
    warpIdx = (warpIdx + 1) % WARP_STEPS.length;
    const w = WARP_STEPS[warpIdx];
    e.target.textContent = (w === 0) ? "Time: 0x (PAUSE)" : `Time: ${w.toLocaleString("en-US")}x`;
  });

  // icons toggle
  $("btn-icons").addEventListener("click", (e) => {
    showBodyIcons = !showBodyIcons;
    e.target.classList.toggle("active", showBodyIcons);
    e.target.textContent = `Body Markers: ${showBodyIcons ? "ON" : "OFF"}`;
  });

  // descent
  $("btn-sim-start").addEventListener("click", startDescentManeuver);
  $("btn-sim-exit").addEventListener("click", returnToOrbitMode);
  $("btn-sim-loop").addEventListener("click", (e) => {
    animLoop = !animLoop;
    e.target.classList.toggle("active", animLoop);
    e.target.textContent = `Loop: ${animLoop ? "ON" : "OFF"}`;
  });

  // attitude presets
  document.querySelectorAll(".btn-vec").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sc = sceneData.spacecraft;
      const p = btn.dataset.preset;
      let v = sc.qibla_vec;
      if (p === "prograde") v = sc.prograde_vec;
      else if (p === "nadir") v = sc.nadir_vec;
      else if (p === "solar") v = sc.solar_vec;
      else if (p === "earth") v = sc.earth_dte_vec;
      applyCommandVector(v[0], v[1], v[2]);
    });
  });

  ["vec-x", "vec-y", "vec-z"].forEach((id) => {
    $(id).addEventListener("input", () => {
      applyCommandVector(parseFloat($("vec-x").value) || 0, parseFloat($("vec-y").value) || 0, parseFloat($("vec-z").value) || 0);
    });
  });
  ["vec-az", "vec-el"].forEach((id) => {
    $(id).addEventListener("input", () => {
      const az = ((parseFloat($("vec-az").value) || 0) * Math.PI) / 180;
      const el = ((parseFloat($("vec-el").value) || 0) * Math.PI) / 180;
      applyCommandVector(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
    });
  });

  $("sec-slider").addEventListener("input", () => {
    if (sceneData.scenario_id !== 4) { updateHUD(); return; }
    const idx = parseInt($("sec-slider").value, 10) || 30;
    const smp = sceneData.landing_seconds[idx] || { offset_sec: idx - 30 };
    const off = (smp.offset_sec != null) ? smp.offset_sec : (idx - 30);
    if (missionMode !== MODE_DESCENT) {
      missionMode = MODE_DESCENT;
      burnStartSimSec = 0;
      syncMissionButtons();
    }
    const totalT = sceneData.spacecraft.transfer_time_sec || 978;
    simElapsedSec = totalT + off;
    evaluateContinuousState();
    updateHUD();
    Debug.sim(`Scenario [4] scrub: ${off >= 0 ? "T+" + off : "T" + off}s · simElapsedSec ${simElapsedSec.toFixed(1)}s`);
  });

  ["inp-utc", "inp-days", "inp-sclat", "inp-sclon", "inp-scalt", "inp-scspd"].forEach((id) => {
    $(id).addEventListener("change", () => {
      const newUtc = $("inp-utc").value.trim();
      if (newUtc) {
        sceneData.base_utc = newUtc;
        sceneData.active_utc = newUtc;
        simElapsedSec = 0;
      }
      sceneData.range_days = parseInt($("inp-days").value, 10) || 14;
      initOrbitParams.lat = parseFloat($("inp-sclat").value) || -38;
      initOrbitParams.lon = parseFloat($("inp-sclon").value) || -105;
      initOrbitParams.alt_km = parseFloat($("inp-scalt").value) || 110;
      initOrbitParams.speed_kms = parseFloat($("inp-scspd").value) || 1.629;
      returnToOrbitMode();
    });
  });

  $("inp-site").addEventListener("change", (e) => {
    const [name, lat, lon] = e.target.value.split("|");
    sceneData.selected_site = { name, lat: parseFloat(lat), lon: parseFloat(lon), alt_m: 1850, slope_deg: 4.2, sun_el: 1.5, earth_el: 5.5, is_custom: false };
    if (missionMode !== MODE_ORBIT) returnToOrbitMode();
    evaluateContinuousState();
    updateHUD();
  });

  $("inp-scenario").addEventListener("change", (e) => {
    const idx = parseInt(e.target.value, 10);
    const snap = snapshots[idx];
    if (snap) applySnapshotScene(snap);
  });

  // main canvas mouse controls
  let dragMain = false, lastMX = 0, lastMY = 0;
  canvas.addEventListener("mousedown", (e) => { if (e.button === 0) { dragMain = true; lastMX = e.clientX; lastMY = e.clientY; } });
  window.addEventListener("mouseup", () => { dragMain = false; });
  window.addEventListener("mousemove", (e) => {
    if (!dragMain) return;
    camYaw += (e.clientX - lastMX) * 0.007;
    camPitch = Math.max(-1.48, Math.min(1.48, camPitch + (e.clientY - lastMY) * 0.007));
    lastMX = e.clientX; lastMY = e.clientY;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    targetPxPerKm = Math.max(1e-7, Math.min(2.0, targetPxPerKm * (e.deltaY > 0 ? 0.85 : 1.18)));
  }, { passive: false });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (focusMode !== "MOON") return;
    const cx = viewW * 0.52, cy = viewH * 0.48;
    const hit = unprojectToMoonLatLon(e.clientX, e.clientY, cx, cy, R_MOON_KM * pxPerKm);
    if (!hit) return;
    const customSite = {
      name: `Custom Target (${hit.lat.toFixed(2)}°, ${hit.lon.toFixed(2)}°)`,
      lat: hit.lat, lon: hit.lon,
      alt_m: Math.round(450 * Math.sin(hit.lat * 0.2) * Math.cos(hit.lon * 0.2)),
      slope_deg: 3.8, sun_el: 1.6, earth_el: 5.2, is_custom: true,
    };
    sceneData.sites = sceneData.sites.filter((s) => !s.is_custom);
    sceneData.sites.push(customSite);
    sceneData.selected_site = customSite;
    if (missionMode !== MODE_ORBIT) returnToOrbitMode();
    evaluateContinuousState();
    updateHUD();
    Debug.sim(`Custom target selected: lat ${hit.lat.toFixed(4)}, lon ${hit.lon.toFixed(4)}`);
  });

  mini.addEventListener("mousedown", (e) => { if (e.button === 0) { miniDrag = true; mLastX = e.clientX; mLastY = e.clientY; } });
  window.addEventListener("mouseup", () => { miniDrag = false; });
  window.addEventListener("mousemove", (e) => {
    if (!miniDrag) return;
    miniCamYaw += (e.clientX - mLastX) * 0.012;
    miniCamPitch = Math.max(-1.45, Math.min(1.45, miniCamPitch + (e.clientY - mLastY) * 0.012));
    mLastX = e.clientX; mLastY = e.clientY;
  });
}

async function boot() {
  Debug.init({
    panelId: "debugConsole",
    logId: "debugLog",
    countId: "debugCount",
    toggleId: "btn-debug",
    copyId: "debugCopy",
    downloadId: "debugDownload",
    clearId: "debugClear",
    closeId: "debugClose",
  });

  const bodyCount = (sceneData.spice_bodies || []).length;
  const siteCount = (sceneData.sites || []).length;
  Debug.boot(`3b_scene.js loaded: ${bodyCount} bodies · ${siteCount} sites · frame ${sceneData.frame || "IAU_MOON"}`);

  const nSnap = await loadSnapshotCatalog();

  bindControls();

  // Preset site selector (fallback to hardcoded south-pole targets)
  const siteSel = $("inp-site");
  if (siteSel.options.length === 0) {
    PRESET_SITES.forEach(([name, lat, lon]) => {
      const opt = document.createElement("option");
      opt.value = `${name}|${lat}|${lon}`;
      opt.textContent = name;
      siteSel.appendChild(opt);
    });
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  syncVectorInputsFromSC();
  evaluateContinuousState();
  updateHUD();
  requestAnimationFrame(drawUniverse);
  requestAnimationFrame(drawMiniSpacecraft);
  Debug.boot(`Universe engine started · scenarios: ${nSnap} · live C11: ${isLocalHost ? "probing" : "disabled (static)"}`);
}

boot();
