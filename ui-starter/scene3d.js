/*
 * AstroApex 3B universe renderer (display-only).
 *
 * Renders the backend 3B scene schema (src/3b_moon.h / data/3b_scene.json):
 *   - 13 SPICE bodies with Kepler orbit rings/trails, shaded spheres, and labels
 *   - focus modes: Moon (1:1), Earth–Moon (1:1), Sun & asteroids (1:1)
 *   - spacecraft attitude sphere (target/qibla, prograde, nadir, solar, Earth DTE)
 *   - descent replay from the backend trajectory[] and landing_seconds[]
 *   - right-click custom target selection on the Moon
 *
 * NO physics is recomputed here. Body positions come from spice_bodies[].pos_km
 * (IAU_MOON) and .helio_km; orbit geometry from .a_km/.ecc/.inc_deg/.phase_deg;
 * the descent path comes from the backend trajectory[] array. Advancing the clock
 * replays that trajectory; planetary positions remain at the snapshot epoch.
 */

const TAU = Math.PI * 2;
const R_MOON_KM = 1737.4;
const R_EARTH_KM = 6371.0;
const R_SUN_KM = 696340.0;
const DIST_EARTH_MOON = 384400.0;
const AU_KM = 149597870.7;

const MODE_ORBIT = 0;
const MODE_DESCENT = 1;
const MODE_LANDED = 2;

const WARP_STEPS = [0, 1, 10, 60, 300, 3600, 86400];

function finite(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function vec(v) {
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(finite)) return v.slice(0, 3);
  return null;
}

function mag(v) {
  return Math.hypot(v[0], v[1], v[2]) || 0;
}

function norm(v) {
  const m = mag(v);
  return m > 1e-12 ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 0];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function latLonToVec(latDeg, lonDeg, r = 1.0) {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
}

/* Draws the conic (orbit ellipse) in the orbital plane from given Kepler elements.
   Pure geometry — no dynamics. */
function evalKeplerRelKm(aKm, ecc, incDeg, meanAnomDeg) {
  const M = (meanAnomDeg * Math.PI) / 180;
  let E = M;
  for (let it = 0; it < 5; it++) E = M + ecc * Math.sin(E);
  const inc = (incDeg * Math.PI) / 180;
  const xo = aKm * (Math.cos(E) - ecc);
  const yo = aKm * Math.sqrt(Math.max(0, 1 - ecc * ecc)) * Math.sin(E);
  return [xo, yo * Math.cos(inc), yo * Math.sin(inc)];
}

function shadeHex(hex, factor) {
  const clean = String(hex).replace("#", "");
  if (clean.length !== 6) return "#1e293b";
  const r = Math.floor(parseInt(clean.slice(0, 2), 16) * factor);
  const g = Math.floor(parseInt(clean.slice(2, 4), 16) * factor);
  const b = Math.floor(parseInt(clean.slice(4, 6), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

const STARS = Array.from({ length: 380 }, (_, i) => ({
  x: ((i * 9973) % 1000) / 1000,
  y: ((i * 6151) % 1000) / 1000,
  s: i % 4 === 0 ? 1.5 : 1.0,
  a: 0.3 + ((i * 37) % 60) / 100,
}));

export class SceneView {
  constructor(canvas, miniCanvas) {
    this.canvas = canvas;
    this.mini = miniCanvas || null;
    this.scene = null;
    this.focusMode = "MOON"; // MOON | EARTH | SUN
    this.showIcons = true;
    this.yaw = 0.55;
    this.pitch = -0.68;
    this.pxPerKm = 155 / R_MOON_KM;
    this.targetPxPerKm = this.pxPerKm;

    this.missionMode = MODE_ORBIT;
    this.simElapsed = 0.0;
    this.burnStart = 0.0;
    this.transferTime = 0.0;
    this.loop = false;
    this.warpIdx = 1;
    this.touchdownPulse = 0.0;

    this.miniYaw = 0.65;
    this.miniPitch = -0.35;

    this.drag = null;
    this.miniDrag = null;
    this.lastFrame = performance.now();
    this.onCustomTarget = null;
    this.onState = null;

    this.bindControls();
  }

  bindControls() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      this.yaw += dx * 0.007;
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch + dy * 0.007));
    });
    const stopDrag = () => { this.drag = null; };
    c.addEventListener("pointerup", stopDrag);
    c.addEventListener("pointercancel", stopDrag);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.targetPxPerKm = Math.max(1e-7, Math.min(2.0, this.targetPxPerKm * (e.deltaY > 0 ? 0.85 : 1.18)));
    }, { passive: false });
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.handleContextMenu(e);
    });
    c.addEventListener("keydown", (e) => {
      const actions = {
        ArrowLeft: () => { this.yaw -= 0.12; },
        ArrowRight: () => { this.yaw += 0.12; },
        ArrowUp: () => { this.pitch = Math.max(-1.48, this.pitch - 0.12); },
        ArrowDown: () => { this.pitch = Math.min(1.48, this.pitch + 0.12); },
        "+": () => { this.targetPxPerKm = Math.min(2.0, this.targetPxPerKm * 1.15); },
        "=": () => { this.targetPxPerKm = Math.min(2.0, this.targetPxPerKm * 1.15); },
        "-": () => { this.targetPxPerKm = Math.max(1e-7, this.targetPxPerKm / 1.15); },
        Home: () => this.reset(),
      };
      if (!actions[e.key]) return;
      e.preventDefault();
      actions[e.key]();
    });

    if (this.mini) {
      this.mini.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        this.miniDrag = { x: e.clientX, y: e.clientY };
        this.mini.setPointerCapture(e.pointerId);
      });
      this.mini.addEventListener("pointermove", (e) => {
        if (!this.miniDrag) return;
        const dx = e.clientX - this.miniDrag.x;
        const dy = e.clientY - this.miniDrag.y;
        this.miniDrag = { x: e.clientX, y: e.clientY };
        this.miniYaw += dx * 0.012;
        this.miniPitch = Math.max(-1.45, Math.min(1.45, this.miniPitch + dy * 0.012));
      });
      const stopMini = () => { this.miniDrag = null; };
      this.mini.addEventListener("pointerup", stopMini);
      this.mini.addEventListener("pointercancel", stopMini);
    }
  }

  /* ---------- public API ---------- */

  setScene(scene) {
    this.scene = scene;
    this.missionMode = MODE_ORBIT;
    this.simElapsed = 0.0;
    this.burnStart = 0.0;
    this.transferTime = finite(scene?.spacecraft?.transfer_time_sec) ? scene.spacecraft.transfer_time_sec : 0;
    this.setFocusMode("MOON");
    this.reset();
  }

  setFocusMode(mode) {
    this.focusMode = mode;
    if (mode === "MOON") this.targetPxPerKm = 155 / R_MOON_KM;
    else if (mode === "EARTH") this.targetPxPerKm = 240 / DIST_EARTH_MOON;
    else this.targetPxPerKm = 140 / AU_KM;
  }

  setBodyIcons(on) {
    this.showIcons = !!on;
  }

  setWarp(index) {
    this.warpIdx = ((index % WARP_STEPS.length) + WARP_STEPS.length) % WARP_STEPS.length;
  }

  cycleWarp() {
    this.warpIdx = (this.warpIdx + 1) % WARP_STEPS.length;
    return WARP_STEPS[this.warpIdx];
  }

  startDescent() {
    this.setFocusMode("MOON");
    if (WARP_STEPS[this.warpIdx] === 0) this.warpIdx = 3;
    this.burnStart = this.simElapsed;
    this.missionMode = MODE_DESCENT;
    this.touchdownPulse = 0;
  }

  returnToOrbit() {
    this.missionMode = MODE_ORBIT;
    this.burnStart = this.simElapsed;
    this.touchdownPulse = 0;
  }

  toggleLoop() {
    this.loop = !this.loop;
    return this.loop;
  }

  reset() {
    this.yaw = 0.55;
    this.pitch = -0.68;
    this.pxPerKm = this.targetPxPerKm;
  }

  setCommandVector(v) {
    if (!this.scene) return;
    const sc = this.scene.spacecraft || {};
    const m = mag(v);
    if (m < 1e-6) return;
    sc.commanded_vec = [v[0] / m, v[1] / m, v[2] / m];
    sc.commanded_azimuth_deg = ((Math.atan2(sc.commanded_vec[1], sc.commanded_vec[0]) * 180 / Math.PI) + 360) % 360;
    sc.commanded_elevation_deg = Math.asin(Math.max(-1, Math.min(1, sc.commanded_vec[2]))) * 180 / Math.PI;
  }

  getState() {
    const sc = this.scene?.spacecraft || {};
    return {
      missionMode: this.missionMode,
      simElapsed: this.simElapsed,
      warp: WARP_STEPS[this.warpIdx],
      loop: this.loop,
      altitude_km: finite(sc.altitude_km) ? sc.altitude_km : 0,
      current_speed_kms: finite(sc.current_speed_kms) ? sc.current_speed_kms : 0,
      burn_elapsed: this.missionMode === MODE_DESCENT ? Math.max(0, this.simElapsed - this.burnStart) : 0,
      transfer_time_sec: this.transferTime,
      commanded_azimuth_deg: sc.commanded_azimuth_deg,
      commanded_elevation_deg: sc.commanded_elevation_deg,
      is_qibla_aligned: sc.is_qibla_aligned,
      alignment_error_deg: sc.alignment_error_deg,
    };
  }

  handleContextMenu(e) {
    if (this.focusMode !== "MOON" || !this.scene) return;
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width * 0.5;
    const cy = rect.height * 0.5;
    const moonRpx = R_MOON_KM * this.pxPerKm;
    const hit = this.unprojectToMoonLatLon(e.clientX - rect.left, e.clientY - rect.top, cx, cy, moonRpx);
    if (!hit) return;
    if (this.onCustomTarget) this.onCustomTarget(hit.lat, hit.lon);
  }

  projectKm(worldKm, originKm, cx, cy, scale) {
    const dx = worldKm[0] - originKm[0];
    const dy = worldKm[1] - originKm[1];
    const dz = worldKm[2] - originKm[2];
    const cY = Math.cos(this.yaw), sY = Math.sin(this.yaw);
    const cP = Math.cos(this.pitch), sP = Math.sin(this.pitch);
    const x1 = dx * cY - dy * sY;
    const y1 = dx * sY + dy * cY;
    const z1 = dz;
    const y2 = y1 * cP - z1 * sP;
    const z2 = y1 * sP + z1 * cP;
    return { x: cx + x1 * scale, y: cy - z2 * scale, depth: y2 };
  }

  unprojectToMoonLatLon(mx, my, cx, cy, moonRpx) {
    const x1 = (mx - cx) / moonRpx;
    const z2 = -(my - cy) / moonRpx;
    const r2 = x1 * x1 + z2 * z2;
    if (r2 > 1.0) return null;
    const y2 = -Math.sqrt(Math.max(0, 1.0 - r2));
    const cP = Math.cos(this.pitch), sP = Math.sin(this.pitch);
    const y1 = y2 * cP + z2 * sP;
    const z1 = -y2 * sP + z2 * cP;
    const cY = Math.cos(this.yaw), sY = Math.sin(this.yaw);
    const x0 = x1 * cY + y1 * sY;
    const y0 = -x1 * sY + y1 * cY;
    return {
      lat: Math.asin(Math.max(-1, Math.min(1, z1))) * 180 / Math.PI,
      lon: Math.atan2(y0, x0) * 180 / Math.PI,
    };
  }

  /* ---------- frame helpers ---------- */

  frameOrigin() {
    if (this.focusMode === "SUN") return [0, 0, 0];
    if (this.focusMode === "EARTH") {
      const e = this.bodyByNaif(399);
      return e && vec(e.pos_km) ? e.pos_km : [0, 0, 0];
    }
    return [0, 0, 0];
  }

  bodyWorld(body) {
    const p = vec(body?.pos_km) || vec(body?.helio_km);
    if (this.focusMode === "SUN") return vec(body?.helio_km) || p || [0, 0, 0];
    return p || [0, 0, 0];
  }

  bodyByNaif(naif) {
    return (this.scene?.spice_bodies || []).find((b) => b.naif_id === naif) || null;
  }

  bodyScreen(body, origin, cx, cy, scale) {
    return this.projectKm(this.bodyWorld(body), origin, cx, cy, scale);
  }

  /* ---------- drawing ---------- */

  drawSphere(ctx, x, y, radiusPx, color, lightDir2D, label, subLabel, forceIcon) {
    const r = Math.max(radiusPx, forceIcon ? 4.0 : 1.2);
    if (x < -400 || x > ctx.canvas.width + 400 || y < -400 || y > ctx.canvas.height + 400) return;
    const lx = x + lightDir2D[0] * r * 0.42;
    const ly = y + lightDir2D[1] * r * 0.42;
    const grd = ctx.createRadialGradient(lx, ly, r * 0.08, x, y, r);
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(0.28, color);
    grd.addColorStop(0.85, shadeHex(color, 0.35));
    grd.addColorStop(1, "#05070d");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    if (forceIcon && radiusPx < 4.5) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 7.5, 0, TAU);
      ctx.stroke();
    }
    if (label) {
      ctx.fillStyle = "#f1f5f9";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(label, x + Math.max(r, 7) + 5, y + 3);
      if (subLabel) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9.5px ui-monospace, monospace";
        ctx.fillText(subLabel, x + Math.max(r, 7) + 5, y + 14);
      }
    }
  }

  drawKeplerOrbit(ctx, body, origin, cx, cy, scale, W, H) {
    const a = body.a_km, ecc = body.ecc || 0, inc = body.inc_deg || 0;
    if (!finite(a) || a <= 0) return;
    const parentPos = body.orbit_parent === "EARTH" ? this.bodyWorld(this.bodyByNaif(399)) : [0, 0, 0];
    const curPhase = finite(body.phase_deg) ? body.phase_deg : 0;

    const ringPts = [];
    const totalSegs = 720;
    for (let i = 0; i <= totalSegs; i++) {
      const deg = curPhase - 180 + (i / totalSegs) * 360;
      const rel = evalKeplerRelKm(a, ecc, inc, deg);
      ringPts.push(this.projectKm(add(parentPos, rel), origin, cx, cy, scale));
    }
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    this.strokeSafePath(ctx, ringPts, W, H);

    const trailPts = [];
    const tSteps = 96;
    for (let i = 0; i <= tSteps; i++) {
      const deg = curPhase - 45 * (1 - i / tSteps);
      const rel = evalKeplerRelKm(a, ecc, inc, deg);
      trailPts.push(this.projectKm(add(parentPos, rel), origin, cx, cy, scale));
    }
    ctx.strokeStyle = body.color || "#38bdf8";
    ctx.lineWidth = 1.6;
    this.strokeSafePath(ctx, trailPts, W, H);
  }

  strokeSafePath(ctx, pts, W, H) {
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

  drawMini() {
    if (!this.mini || !this.scene) return;
    const mctx = this.mini.getContext("2d");
    const rect = this.mini.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(rect.width);
    const H = Math.round(rect.height);
    this.mini.width = Math.round(W * ratio);
    this.mini.height = Math.round(H * ratio);
    mctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = "#02040a";
    mctx.fillRect(0, 0, W, H);

    const sc = this.scene.spacecraft || {};
    const cx = W / 2, cy = H / 2;
    const cY = Math.cos(this.miniYaw), sY = Math.sin(this.miniYaw);
    const cP = Math.cos(this.miniPitch), sP = Math.sin(this.miniPitch);
    const proj = (v) => {
      const x1 = v[0] * cY - v[1] * sY;
      const y1 = v[0] * sY + v[1] * cY;
      const z2 = v[2] * cP - y1 * sP;
      return [cx + x1, cy - z2];
    };

    mctx.strokeStyle = "rgba(148, 163, 184, 0.24)";
    mctx.lineWidth = 1;
    for (const axis of [0, 1]) {
      mctx.beginPath();
      for (let a = 0; a <= 360; a += 12) {
        const r = (a * Math.PI) / 180;
        const p = axis === 0 ? proj([46 * Math.cos(r), 46 * Math.sin(r), 0]) : proj([46 * Math.cos(r), 0, 46 * Math.sin(r)]);
        if (a === 0) mctx.moveTo(...p); else mctx.lineTo(...p);
      }
      mctx.stroke();
    }

    this.drawSphere(mctx, cx, cy, 44, "#475569", [-0.45, -0.45], null, null, false);

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

    const qibla = vec(sc.qibla_vec) || [0, 0, 1];
    const commanded = vec(sc.commanded_vec) || [0, 0, 1];
    const qEnd = proj([qibla[0] * 92, qibla[1] * 92, qibla[2] * 92]);
    mctx.strokeStyle = "#22d3ee";
    mctx.lineWidth = 2.2;
    mctx.setLineDash([5, 3]);
    mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(...qEnd); mctx.stroke();
    mctx.setLineDash([]);
    mctx.fillStyle = "#22d3ee";
    mctx.beginPath(); mctx.arc(qEnd[0], qEnd[1], 3.5, 0, TAU); mctx.fill();
    mctx.fillText("TARGET", qEnd[0] + 5, qEnd[1]);

    const cEnd = proj([commanded[0] * 88, commanded[1] * 88, commanded[2] * 88]);
    mctx.strokeStyle = "#f59e0b";
    mctx.lineWidth = 2.6;
    mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(...cEnd); mctx.stroke();
    mctx.fillStyle = "#f59e0b";
    mctx.beginPath(); mctx.arc(cEnd[0], cEnd[1], 4.2, 0, TAU); mctx.fill();
    mctx.fillText("COMMAND", cEnd[0] + 5, cEnd[1] + 10);
  }

  drawUniverse(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (!this.scene) {
      requestAnimationFrame((t) => this.drawUniverse(t));
      return;
    }

    const warp = WARP_STEPS[this.warpIdx];
    this.simElapsed += dt * warp;

    // Descent completion / loop
    if (this.missionMode === MODE_DESCENT) {
      const burnElapsed = this.simElapsed - this.burnStart;
      if (burnElapsed >= this.transferTime) {
        if (this.loop) {
          this.burnStart = this.simElapsed;
        } else {
          this.missionMode = MODE_LANDED;
        }
      }
    }

    this.pxPerKm += (this.targetPxPerKm - this.pxPerKm) * 0.14;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) {
      requestAnimationFrame((t) => this.drawUniverse(t));
      return;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(rect.width);
    const H = Math.round(rect.height);
    this.canvas.width = Math.round(W * ratio);
    this.canvas.height = Math.round(H * ratio);
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const cx = W * 0.5, cy = H * 0.48;

    ctx.fillStyle = "#030508";
    ctx.fillRect(0, 0, W, H);
    for (const st of STARS) {
      ctx.fillStyle = `rgba(226, 232, 240, ${st.a})`;
      ctx.fillRect(st.x * W, st.y * H, st.s, st.s);
    }

    const origin = this.frameOrigin();
    const bodies = this.scene.spice_bodies || [];
    const sun = this.bodyByNaif(10);
    const earth = this.bodyByNaif(399);
    const moon = this.bodyByNaif(301);

    const sunScr = sun ? this.bodyScreen(sun, origin, cx, cy, this.pxPerKm) : null;
    const moonScr = moon ? this.bodyScreen(moon, origin, cx, cy, this.pxPerKm) : null;
    const earthScr = earth ? this.bodyScreen(earth, origin, cx, cy, this.pxPerKm) : null;

    let lightDir2D = [1, 0];
    if (sunScr && moonScr) {
      const dx = sunScr.x - moonScr.x, dy = sunScr.y - moonScr.y;
      const l = Math.hypot(dx, dy) || 1;
      lightDir2D = [dx / l, dy / l];
    }

    // Orbit rings/trails for heliocentric bodies in SUN focus, Moon ring in EARTH focus
    if (this.focusMode === "SUN") {
      for (const b of bodies) {
        if (b.orbit_parent === "SUN" || b.orbit_parent === "EARTH") {
          this.drawKeplerOrbit(ctx, b, origin, cx, cy, this.pxPerKm, W, H);
        }
      }
    } else if (this.focusMode === "EARTH") {
      const moonBody = moon;
      if (moonBody) this.drawKeplerOrbit(ctx, moonBody, origin, cx, cy, this.pxPerKm, W, H);
    }

    // Sun glow + sphere
    if (sunScr) {
      const sunRpx = R_SUN_KM * this.pxPerKm;
      const glow = ctx.createRadialGradient(sunScr.x, sunScr.y, Math.max(2, sunRpx * 0.4), sunScr.x, sunScr.y, Math.max(22, sunRpx * 2.5));
      glow.addColorStop(0, "#fffbeb");
      glow.addColorStop(0.35, "rgba(250, 204, 21, 0.75)");
      glow.addColorStop(1, "rgba(250, 204, 21, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(sunScr.x, sunScr.y, Math.max(22, sunRpx * 2.5), 0, TAU); ctx.fill();
      this.drawSphere(ctx, sunScr.x, sunScr.y, sunRpx, "#fbbf24", [0, 0], "Sun", "R: 696,340 km", this.showIcons);
    }

    // Earth sphere
    if (earthScr) {
      const eLd = sunScr ? norm([sunScr.x - earthScr.x, sunScr.y - earthScr.y]) : lightDir2D;
      this.drawSphere(ctx, earthScr.x, earthScr.y, R_EARTH_KM * this.pxPerKm, "#3b82f6", eLd, "Earth", "R: 6,371 km (384,400 km)", this.showIcons);
    }

    // Moon sphere + south pole ring + sites (only when close enough)
    if (moonScr) {
      const moonRpx = R_MOON_KM * this.pxPerKm;
      const mLd = sunScr ? norm([sunScr.x - moonScr.x, sunScr.y - moonScr.y]) : lightDir2D;
      this.drawSphere(ctx, moonScr.x, moonScr.y, moonRpx, "#94a3b8", mLd, moonRpx < 24 ? "Moon" : null, null, this.showIcons);

      if (moonRpx >= 28) {
        ctx.strokeStyle = "rgba(56, 189, 248, 0.38)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 10) {
          const v = latLonToVec(-80, lon, R_MOON_KM * 1.002);
          const p = this.projectKm(add(moon.pos_km ? moon.pos_km : [0, 0, 0], v), origin, cx, cy, this.pxPerKm);
          if (lon === -180) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        for (const st of this.scene.sites || []) {
          const v = latLonToVec(st.lat, st.lon, R_MOON_KM * 1.005);
          const base = this.focusMode === "SUN" ? (moon.helio_km || [0, 0, 0]) : (moon.pos_km || [0, 0, 0]);
          const pr = this.projectKm(add(base, v), origin, cx, cy, this.pxPerKm);
          if (pr.depth > R_MOON_KM * 0.25) continue;
          const isSel = st.name === (this.scene.selected_site?.name);
          ctx.fillStyle = st.is_custom ? "#f43f5e" : (isSel ? "#22d3ee" : "#facc15");
          ctx.beginPath(); ctx.arc(pr.x, pr.y, isSel ? 5.2 : 3.0, 0, TAU); ctx.fill();
          if (isSel || st.is_custom) {
            ctx.font = "bold 11px ui-monospace, monospace";
            ctx.textAlign = "left";
            const tag = `${st.name} (${st.lat.toFixed(2)}°, ${st.lon.toFixed(2)}°)`;
            ctx.fillText(tag, pr.x + 8, pr.y + 4);
          }
          if (isSel && this.missionMode === MODE_LANDED) {
            ctx.strokeStyle = `rgba(16, 185, 129, ${1.0 - this.touchdownPulse})`;
            ctx.lineWidth = 2.2;
            ctx.beginPath(); ctx.arc(pr.x, pr.y, 6 + this.touchdownPulse * 28, 0, TAU); ctx.stroke();
          }
        }
      }
    }

    // Other bodies (planets + asteroids)
    for (const b of bodies) {
      if (b.naif_id === 10 || b.naif_id === 399 || b.naif_id === 301) continue;
      const scr = this.bodyScreen(b, origin, cx, cy, this.pxPerKm);
      const distAu = finite(b.a_km) && b.a_km > 0 ? (b.a_km / AU_KM) : 0;
      const ld = sunScr ? norm([sunScr.x - scr.x, sunScr.y - scr.y]) : lightDir2D;
      this.drawSphere(ctx, scr.x, scr.y, (b.radius_km || 10) * this.pxPerKm, b.color || "#fb7185", ld,
        b.name, `${distAu.toFixed(2)} AU`, this.showIcons);
    }

    // Spacecraft + trajectory (Moon focus)
    if (moonScr && this.scene.spacecraft && this.focusMode === "MOON") {
      const sc = this.scene.spacecraft;
      const traj = this.scene.trajectory || [];
      const base = moon.pos_km || [0, 0, 0];

      // trajectory line
      if (traj.length > 1 && this.missionMode !== MODE_LANDED) {
        ctx.strokeStyle = this.missionMode === MODE_ORBIT ? "#38bdf8" : "rgba(56, 189, 248, 0.45)";
        ctx.lineWidth = this.missionMode === MODE_ORBIT ? 2.0 : 1.4;
        if (this.missionMode === MODE_DESCENT) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        traj.forEach((tp, idx) => {
          const p = this.projectKm(add(base, tp.pos_km), origin, cx, cy, this.pxPerKm);
          if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // current spacecraft position
      let scPos = vec(sc.pos_km);
      let scSpeed = finite(sc.current_speed_kms) ? sc.current_speed_kms : 0;
      let scAlt = finite(sc.altitude_km) ? sc.altitude_km : 0;
      if (this.missionMode === MODE_DESCENT && traj.length > 1) {
        const burnElapsed = Math.max(0, this.simElapsed - this.burnStart);
        const frac = this.transferTime > 0 ? Math.min(1, burnElapsed / this.transferTime) : 0;
        const idx = Math.min(traj.length - 2, Math.floor(frac * (traj.length - 1)));
        const t = frac * (traj.length - 1) - idx;
        const p0 = traj[idx], p1 = traj[idx + 1];
        scPos = lerp(vec(p0.pos_km), vec(p1.pos_km), t);
        scSpeed = lerp([p0.speed_kms], [p1.speed_kms], t)[0];
        scAlt = lerp([p0.alt_km], [p1.alt_km], t)[0];
      } else if (this.missionMode === MODE_LANDED && traj.length) {
        scPos = vec(traj[traj.length - 1].pos_km);
        scSpeed = 0;
        scAlt = 0;
      }

      const scP = this.projectKm(add(base, scPos), origin, cx, cy, this.pxPerKm);

      // commanded vector arrow
      const cmd = vec(sc.commanded_vec);
      if (cmd) {
        const qLenKm = R_MOON_KM * 0.65;
        const qEnd = this.projectKm(add(base, add(scPos, [cmd[0] * qLenKm, cmd[1] * qLenKm, cmd[2] * qLenKm])), origin, cx, cy, this.pxPerKm);
        ctx.strokeStyle = "#f59e0b";
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(scP.x, scP.y); ctx.lineTo(qEnd.x, qEnd.y); ctx.stroke();
        ctx.setLineDash([]);
      }

      const altStr = scAlt >= 1.0 ? `${scAlt.toFixed(1)} km` : `${(scAlt * 1000).toFixed(0)} m`;
      const spdStr = scSpeed >= 0.05 ? `${scSpeed.toFixed(3)} km/s` : `${(scSpeed * 1000).toFixed(1)} m/s`;
      this.drawSphere(ctx, scP.x, scP.y, Math.max(5.0, 0.015 * this.pxPerKm),
        this.missionMode === MODE_LANDED ? "#10b981" : "#22d3ee", lightDir2D,
        `Spacecraft (${altStr})`, `V: ${spdStr}`, false);
    }

    ctx.fillStyle = "#60798b";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left";
    const focusLabel = { MOON: "MOON (1:1)", EARTH: "EARTH–MOON (1:1)", SUN: "SUN & ASTEROIDS (1:1)" }[this.focusMode];
    ctx.fillText(`${this.scene.frame || "FRAME"} · ${focusLabel} · snapshot epoch`, 14, H - 14);
    ctx.textAlign = "right";
    ctx.fillText("BACKEND POSITIONS / TRAJECTORY REPLAY — NO PHYSICS RECOMPUTED", W - 14, H - 14);

    if (this.missionMode === MODE_LANDED) {
      this.touchdownPulse = (this.touchdownPulse + dt * 1.4) % 1.0;
    }

    if (this.onState) this.onState(this.getState());

    requestAnimationFrame((t) => this.drawUniverse(t));
  }

  start() {
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.drawUniverse(t));
    if (this.mini) {
      const miniLoop = () => { this.drawMini(); requestAnimationFrame(miniLoop); };
      requestAnimationFrame(miniLoop);
    }
  }
}
