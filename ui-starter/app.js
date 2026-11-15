/*
 * AstroApex — Mission Control (frontend).
 *
 * DISPLAY-ONLY. Orbital motion, illumination, visibility, horizon masks, mission
 * scores and decisions are never recomputed in the browser. Every value shown on
 * this page is copied directly from the backend 2D JSON (data/output.json) or the
 * 3B scene (data/3b_scene.json), or from a pre-generated static snapshot catalog.
 *
 * Data sources (priority):
 *   1. Live C11 + SPICE backend on http://127.0.0.1:8080 (only when running locally
 *      or with ?live=1).
 *   2. Static snapshot catalog: /data/demo_snapshots.json (exact request match).
 *   3. Static sample: /sample_output.json (2D mission data only).
 */

import { drawHorizon, drawTimeline } from "./plots.js";
import { SceneView } from "./scene3d.js";

const API_BASE = "http://127.0.0.1:8080";
const CUSTOM_SITE_VALUE = "__custom";

const PRESET_SITES = [
  { name: "Shackleton Rim", latitude_deg: -89.7668, longitude_deg: -171.87 },
  { name: "Connecting Ridge", latitude_deg: -89.4632, longitude_deg: -137.49 },
  { name: "Malapert Massif", latitude_deg: -85.9948, longitude_deg: -0.23578 },
  { name: "Nobile Rim 1", latitude_deg: -85.2, longitude_deg: 53.5 },
  { name: "Haworth", latitude_deg: -87.45, longitude_deg: -5.17 },
];

const $ = (id) => document.getElementById(id);
const els = {};

function cacheElements() {
  const ids = [
    "sourceBadge", "headerTime", "footerSource", "notice", "noticeTitle", "noticeText",
    "dismissNotice", "missionForm", "scenarioSelect", "siteSelect", "startInput",
    "daysSelect", "customCoordinates", "latitudeInput", "longitudeInput", "runButton",
    "slipButton", "loadingTrack", "missionSite", "missionContext", "sourceBadges",
    "backendWarning", "verdictPill", "decisionTitle", "decisionDetail", "blockerCode",
    "scoreRing", "scoreValue", "sunsetCountdown", "sunsetNote", "earthsetCountdown",
    "earthsetNote", "kpiIllumination", "kpiIlluminationDetail", "kpiDte", "kpiDteDetail",
    "kpiOverlap", "kpiOverlapDetail", "kpiDark", "kpiDarkDetail", "horizonCanvas",
    "horizonSampleLabel", "sampleSlider", "sampleOutput", "sampleStart", "sampleEnd",
    "sampleIndex", "sampleUtc", "sampleSunAz", "sampleSunEl", "sampleSunVisible",
    "sampleEarthAz", "sampleEarthEl", "sampleEarthVisible", "sampleSoc", "timelineCanvas",
    "timelineRange", "sunWindowList", "earthWindowList", "comparisonBody", "comparisonSort",
    "comparisonCaption", "sceneBadges", "sceneWarning", "sceneEmpty", "sceneContent",
    "sceneCanvas", "resetSceneView", "sceneScaleLabel", "sceneSiteName", "sceneActiveUtc",
    "sceneFrame", "scenePhase", "sceneModel", "scenePhysics", "sceneAltitude", "sceneSpeed",
    "trajectorySlider", "trajectoryOutput", "trajectoryTime", "trajectoryAltitude",
    "trajectorySpeed", "sceneSiteBody", "sceneSiteCount", "modelBadges", "provenance2d",
    "provenance3d", "requestDetails", "snapshotDetails", "modelWarnings",
    "tab-overview", "tab-scene", "tab-model", "panel-overview", "panel-scene", "panel-model",
  ];
  ids.forEach((id) => { els[id] = $(id); });
}

const state = {
  snapshots: null,
  data: null,
  scene: null,
  source: null,
  scenarioId: null,
  sampleIndex: 0,
  trajectoryIndex: 0,
  sceneView: null,
};

const fmt = {
  hours: (h) => (Number.isFinite(h) ? `${h.toFixed(1)} h` : "Not available"),
  pct: (p) => (Number.isFinite(p) ? `${p.toFixed(1)}%` : "—"),
};

function isLocal() {
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "" ||
    new URLSearchParams(location.search).has("live");
}

function buildUrl(params) {
  const url = new URL(API_BASE);
  url.searchParams.set("site", params.site_name);
  url.searchParams.set("lat", String(params.latitude_deg));
  url.searchParams.set("lon", String(params.longitude_deg));
  url.searchParams.set("utc", params.start_utc);
  url.searchParams.set("days", String(params.days));
  return url.toString();
}

/* datetime-local input is interpreted as UTC by contract; never let the browser
   apply the local timezone. "2026-10-18T00:00" -> "2026-10-18T00:00:00". */
function normalizeUtcInput(value) {
  if (!value) return "";
  return value.length === 16 ? `${value}:00` : value;
}

function addDaysUtc(value, days) {
  // Append Z so the arithmetic is UTC, independent of the viewer's timezone.
  const d = new Date(`${normalizeUtcInput(value)}Z`);
  if (!Number.isFinite(d.getTime())) return value;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 16);
}

function currentRequest() {
  const custom = els.siteSelect.value === CUSTOM_SITE_VALUE;
  const preset = PRESET_SITES.find((s) => s.name === els.siteSelect.value);
  const lat = custom ? Number(els.latitudeInput.value) : (preset ? preset.latitude_deg : NaN);
  const lon = custom ? Number(els.longitudeInput.value) : (preset ? preset.longitude_deg : NaN);
  return {
    site_name: custom ? "Custom" : els.siteSelect.value,
    latitude_deg: lat,
    longitude_deg: lon,
    start_utc: normalizeUtcInput(els.startInput.value),
    days: Number(els.daysSelect.value),
  };
}

function matchSnapshot(request) {
  const list = (state.snapshots && state.snapshots.scenarios) || [];
  return list.find((s) => {
    const r = s.request || {};
    return r.site_name === request.site_name &&
      Math.abs((r.latitude_deg || 0) - request.latitude_deg) < 1e-4 &&
      Math.abs((r.longitude_deg || 0) - request.longitude_deg) < 1e-4 &&
      r.start_utc === request.start_utc &&
      Number(r.days) === request.days;
  }) || null;
}

async function loadSnapshotCatalog() {
  try {
    const res = await fetch("data/demo_snapshots.json", { cache: "no-cache" });
    if (res.ok) {
      state.snapshots = await res.json();
      return true;
    }
  } catch { /* catalog optional */ }
  return false;
}

async function loadLive(request) {
  const url = buildUrl(request);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    let scene = null;
    try {
      const sceneUrl = `${API_BASE}/3b?mode=0&t_sec=0&site=${encodeURIComponent(request.site_name)}&lat=${request.latitude_deg}&lon=${request.longitude_deg}&utc=${encodeURIComponent(request.start_utc)}`;
      const sres = await fetch(sceneUrl, { signal: ctrl.signal });
      if (sres.ok) scene = await sres.json();
    } catch { scene = null; }
    return { data, scene, source: "live-backend" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function setNotice(title, text, kind) {
  els.notice.hidden = false;
  els.noticeTitle.textContent = title;
  els.noticeText.textContent = text;
  els.notice.className = kind === "error" ? "notice is-error" : "notice";
}

function clearNotice() {
  els.notice.hidden = true;
}

async function runStudy({ slip = false } = {}) {
  clearNotice();
  if (slip) {
    els.startInput.value = addDaysUtc(els.startInput.value, 21);
  }

  els.loadingTrack.hidden = false;
  const request = currentRequest();
  if (!Number.isFinite(request.latitude_deg) || !Number.isFinite(request.longitude_deg) ||
      !Number.isFinite(request.days) || !request.start_utc) {
    els.loadingTrack.hidden = true;
    setNotice("Invalid request", "Enter a valid site (or custom latitude/longitude), a start time, and a duration.", "error");
    return;
  }
  if (request.latitude_deg < -90 || request.latitude_deg > 90 ||
      request.longitude_deg < -180 || request.longitude_deg > 180) {
    els.loadingTrack.hidden = true;
    setNotice("Coordinates out of range", "Latitude must be -90..90 and longitude -180..180.", "error");
    return;
  }

  let result = null;
  let scenario = null;

  if (isLocal()) {
    result = await loadLive(request);
    if (result) {
      state.scenarioId = null;
    }
  }

  if (!result) {
    scenario = matchSnapshot(request);
    if (scenario) {
      result = { data: scenario.data, scene: scenario.scene, source: "static-snapshot" };
      state.scenarioId = scenario.id;
    }
  }

  if (!result) {
    try {
      const res = await fetch("sample_output.json", { cache: "no-cache" });
      if (res.ok) {
        result = { data: await res.json(), scene: null, source: "offline-sample" };
        state.scenarioId = null;
        setNotice("Static sample shown", "No live backend or matching snapshot found for this request. Showing the bundled sample output.", "warn");
      }
    } catch { /* fall through */ }
  }

  if (!result) {
    els.loadingTrack.hidden = true;
    setNotice("No data available", "Neither the live backend, a matching snapshot, nor the sample output could be loaded.", "error");
    return;
  }

  state.data = result.data;
  state.scene = result.scene;
  state.source = result.source;
  state.sampleIndex = 0;
  state.trajectoryIndex = 0;
  render();
  els.loadingTrack.hidden = true;
}

function applyScenario(scenario) {
  const r = scenario.request;
  if (!r) return;
  const preset = PRESET_SITES.find((s) => s.name === r.site_name);
  if (preset) {
    els.siteSelect.value = preset.name;
    els.customCoordinates.hidden = true;
  } else {
    els.siteSelect.value = CUSTOM_SITE_VALUE;
    els.latitudeInput.value = r.latitude_deg;
    els.longitudeInput.value = r.longitude_deg;
    els.customCoordinates.hidden = false;
  }
  els.startInput.value = r.start_utc.slice(0, 16);
  els.daysSelect.value = String(r.days);
  state.data = scenario.data;
  state.scene = scenario.scene;
  state.source = "static-snapshot";
  state.scenarioId = scenario.id;
  state.sampleIndex = 0;
  state.trajectoryIndex = 0;
  render();
}

function populateScenarios() {
  const list = (state.snapshots && state.snapshots.scenarios) || [];
  els.scenarioSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length ? "Choose a stored scenario" : "No snapshots available";
  els.scenarioSelect.appendChild(placeholder);
  list.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label || s.id;
    els.scenarioSelect.appendChild(opt);
  });
}

/* ---------- rendering ---------- */

function sourceBadge(text, kind) {
  const span = document.createElement("span");
  span.className = `source-badge is-${kind || "neutral"}`;
  span.textContent = text;
  return span;
}

function renderSourceBadge() {
  const b = els.sourceBadge;
  const label = state.source === "live-backend" ? "LIVE C11 BACKEND" :
    state.source === "static-snapshot" ? "STATIC SNAPSHOT" : "OFFLINE SAMPLE";
  b.textContent = label;
  b.className = `source-badge is-${state.source === "live-backend" ? "live" : "static"}`;
  els.footerSource.textContent = state.source === "live-backend"
    ? "Live backend on 127.0.0.1:8080" : "Pre-generated static data";
}

function renderHeaderTime() {
  const meta = state.data?.meta || state.data?.metadata || {};
  els.headerTime.textContent = meta.start_utc ? `${meta.start_utc} → ${meta.end_utc}` : "Mission data loaded";
}

function renderBadges() {
  const meta = state.data?.meta || {};
  const wrap = els.sourceBadges;
  wrap.innerHTML = "";
  const ephem = meta.ephemeris_source;
  const horizon = meta.dem_info?.horizon_source;
  if (ephem) wrap.appendChild(sourceBadge(ephem === "CSPICE_DE440S_IAU_MOON" ? "CSPICE DE440s" : "Analytic ephemeris", ephem === "CSPICE_DE440S_IAU_MOON" ? "good" : "warn"));
  if (horizon) wrap.appendChild(sourceBadge(horizon === "LOLA_80M_SKYLINE" ? "LOLA 80 m horizon" : "Synthetic horizon", horizon === "LOLA_80M_SKYLINE" ? "good" : "warn"));
  wrap.appendChild(sourceBadge("Synthetic terrain (slope/rover)", "warn"));
  wrap.appendChild(sourceBadge("Heuristic thermal/battery", "warn"));
}

function renderDecision() {
  const d = state.data?.decision;
  const s = state.data?.summary;
  const pill = els.verdictPill;
  if (!d) {
    pill.className = "verdict-pill is-unavailable";
    pill.textContent = "NOT AVAILABLE";
    els.decisionTitle.textContent = "No decision loaded";
    els.decisionDetail.textContent = "Verdict and score are read only from the response decision object.";
    els.scoreValue.textContent = "—";
    return;
  }
  const verdict = d.verdict || "—";
  pill.className = `verdict-pill is-${verdict.toLowerCase()}`;
  pill.textContent = verdict;
  els.decisionTitle.textContent = d.human_reason_tr || "Backend decision";
  els.decisionDetail.textContent = d.primary_blocker_code ? `Primary blocker: ${d.primary_blocker_code}` : "";
  els.blockerCode.hidden = !d.primary_blocker_code;
  if (d.primary_blocker_code) els.blockerCode.textContent = d.primary_blocker_code;
  const score = Number.isFinite(d.mission_score) ? d.mission_score : (Number.isFinite(s?.mission_score) ? s.mission_score : null);
  els.scoreValue.textContent = score === null ? "—" : String(score);
  els.scoreRing.setAttribute("aria-label", `Mission score ${score === null ? "not available" : `${score} out of 100`}`);
}

function renderCountdowns() {
  const ev = state.data?.events;
  if (!ev) {
    els.sunsetCountdown.textContent = "Not available";
    els.sunsetNote.textContent = "No events object in response";
    els.earthsetCountdown.textContent = "Not available";
    els.earthsetNote.textContent = "No events object in response";
    return;
  }
  const sun = ev.sun || {};
  const earth = ev.earth || {};
  if (sun.visible_now && Number.isFinite(sun.hours_to_sunset)) {
    els.sunsetCountdown.textContent = fmt.hours(sun.hours_to_sunset);
    els.sunsetNote.textContent = `Next sunset at ${sun.next_sunset_utc || "—"}`;
  } else if (!sun.visible_now && Number.isFinite(sun.hours_to_sunrise)) {
    els.sunsetCountdown.textContent = fmt.hours(sun.hours_to_sunrise);
    els.sunsetNote.textContent = `Currently dark · sunrise at ${sun.next_sunrise_utc || "—"}`;
  } else {
    els.sunsetCountdown.textContent = "No transition";
    els.sunsetNote.textContent = "No sun event within the searched window";
  }
  if (earth.visible_now && Number.isFinite(earth.hours_to_earthset)) {
    els.earthsetCountdown.textContent = fmt.hours(earth.hours_to_earthset);
    els.earthsetNote.textContent = `Next earthset at ${earth.next_earthset_utc || "—"}`;
  } else if (!earth.visible_now && Number.isFinite(earth.hours_to_earthrise)) {
    els.earthsetCountdown.textContent = fmt.hours(earth.hours_to_earthrise);
    els.earthsetNote.textContent = `Currently below horizon · earthrise at ${earth.next_earthrise_utc || "—"}`;
  } else {
    els.earthsetCountdown.textContent = "No transition";
    els.earthsetNote.textContent = "No earth event within the searched window";
  }
}

function renderKpis() {
  const s = state.data?.summary || {};
  els.kpiIllumination.textContent = fmt.pct(s.illumination_percent);
  els.kpiIlluminationDetail.textContent = `${Number.isFinite(s.total_sun_hours) ? s.total_sun_hours.toFixed(1) : "—"} h of sunlight`;
  els.kpiDte.textContent = fmt.pct(s.earth_visibility_percent);
  els.kpiDteDetail.textContent = `${Number.isFinite(s.dte_window_count) ? s.dte_window_count : "—"} DTE window(s)`;
  els.kpiOverlap.textContent = fmt.hours(s.overlap_hours);
  els.kpiOverlapDetail.textContent = "Simultaneous sun + DTE";
  els.kpiDark.textContent = fmt.hours(s.longest_dark_hours);
  els.kpiDarkDetail.textContent = "Longest continuous dark";
}

function renderMissionHeading() {
  const meta = state.data?.meta || {};
  const name = meta.site_name || "Unknown site";
  els.missionSite.textContent = name;
  const lat = meta.latitude_deg, lon = meta.longitude_deg;
  els.missionContext.textContent = Number.isFinite(lat) && Number.isFinite(lon)
    ? `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E · ${meta.altitude_m ? `${meta.altitude_m.toFixed(0)} m` : "—"}`
    : "Coordinates not available";
  const warning = state.data?.warning_msg;
  els.backendWarning.hidden = !warning;
  if (warning) els.backendWarning.textContent = warning;
}

function renderSamples() {
  const samples = state.data?.samples || [];
  const n = samples.length;
  els.sampleSlider.disabled = n === 0;
  els.sampleSlider.max = Math.max(0, n - 1);
  els.sampleSlider.value = state.sampleIndex;
  const s = samples[state.sampleIndex];
  if (!s) {
    els.horizonSampleLabel.textContent = "No sample selected";
    els.sampleOutput.textContent = "Not available";
    els.sampleStart.textContent = "Start";
    els.sampleEnd.textContent = "End";
    return;
  }
  els.horizonSampleLabel.textContent = s.utc || "";
  els.sampleOutput.textContent = `${state.sampleIndex + 1} / ${n}`;
  els.sampleStart.textContent = samples[0]?.utc || "Start";
  els.sampleEnd.textContent = samples[n - 1]?.utc || "End";
  els.sampleIndex.textContent = String(s.step_index ?? state.sampleIndex);
  els.sampleUtc.textContent = s.utc || "—";
  els.sampleSunAz.textContent = `${s.sun_azimuth_deg.toFixed(2)}°`;
  els.sampleSunEl.textContent = `${s.sun_elevation_deg.toFixed(2)}°`;
  els.sampleSunVisible.textContent = s.is_sun_visible ? "Yes" : "No";
  els.sampleEarthAz.textContent = `${s.earth_azimuth_deg.toFixed(2)}°`;
  els.sampleEarthEl.textContent = `${s.earth_elevation_deg.toFixed(2)}°`;
  els.sampleEarthVisible.textContent = s.is_earth_visible ? "Yes" : "No";
  els.sampleSoc.textContent = `${s.soc_pct.toFixed(1)}%`;
}

function renderTimelineWindows() {
  const w = state.data?.windows || {};
  els.sunWindowList.innerHTML = "";
  els.earthWindowList.innerHTML = "";
  const meta = state.data?.meta || {};
  const totalH = ((meta.end_utc && meta.start_utc)
    ? (new Date(`${meta.end_utc}Z`) - new Date(`${meta.start_utc}Z`)) / 3_600_000 : null);
  els.timelineRange.textContent = Number.isFinite(totalH) ? `${totalH.toFixed(0)} h window` : "Not available";
  (w.sun || []).forEach((win) => {
    const li = document.createElement("li");
    li.textContent = `${win.start_utc} → ${win.end_utc} (${win.duration_hours.toFixed(1)} h)`;
    els.sunWindowList.appendChild(li);
  });
  (w.earth || []).forEach((win) => {
    const li = document.createElement("li");
    li.textContent = `${win.start_utc} → ${win.end_utc} (${win.duration_hours.toFixed(1)} h)`;
    els.earthWindowList.appendChild(li);
  });
  if (!(w.sun || []).length) els.sunWindowList.innerHTML = "<li>No sun windows</li>";
  if (!(w.earth || []).length) els.earthWindowList.innerHTML = "<li>No earth windows</li>";
}

function renderComparison() {
  const comp = state.data?.site_comparison || [];
  const sort = els.comparisonSort.value;
  const rows = [...comp];
  if (sort === "score") rows.sort((a, b) => b.mission_score - a.mission_score);
  els.comparisonBody.innerHTML = "";
  if (!rows.length) {
    els.comparisonBody.innerHTML = '<tr><td colspan="8" class="empty-cell">No comparison data loaded.</td></tr>';
    return;
  }
  rows.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.site_name}</td>
      <td>${c.mission_score}</td>
      <td><span class="verdict-inline is-${(c.verdict || "").toLowerCase()}">${c.verdict}</span></td>
      <td>${c.illumination_percent.toFixed(1)}%</td>
      <td>${c.earth_visibility_percent.toFixed(1)}%</td>
      <td>${c.overlap_hours.toFixed(1)} h</td>
      <td>${c.longest_dark_hours.toFixed(1)} h</td>
      <td>${c.min_battery_soc_pct.toFixed(1)}%</td>`;
    els.comparisonBody.appendChild(tr);
  });
}

function renderScene() {
  const scene = state.scene;
  if (!scene) {
    els.sceneEmpty.hidden = false;
    els.sceneContent.hidden = true;
    els.sceneBadges.innerHTML = "";
    return;
  }
  els.sceneEmpty.hidden = true;
  els.sceneContent.hidden = false;
  els.sceneBadges.innerHTML = "";
  els.sceneBadges.appendChild(sourceBadge(scene.frame || "IAU_MOON", "good"));
  els.sceneBadges.appendChild(sourceBadge(scene.trajectory_phase || "—", "neutral"));
  els.sceneBadges.appendChild(sourceBadge(scene.physics_valid ? "Physics validated" : "Kinematic (not validated)", scene.physics_valid ? "good" : "warn"));

  els.sceneWarning.hidden = scene.physics_valid;
  els.sceneWarning.textContent = scene.physics_valid ? "" : "3B scene is a kinematic visualization: trajectory and touchdown are not validated by a mass/fuel/thrust physics model.";

  const site = scene.selected_site || {};
  els.sceneSiteName.textContent = site.name || "Selected site";
  els.sceneActiveUtc.textContent = scene.active_utc || "—";
  els.sceneFrame.textContent = scene.frame || "—";
  els.scenePhase.textContent = scene.trajectory_phase || "—";
  els.sceneModel.textContent = scene.scene_model || "—";
  els.scenePhysics.textContent = scene.physics_valid ? "Yes" : "No";
  const sc = scene.spacecraft || {};
  els.sceneAltitude.textContent = `${sc.altitude_km.toFixed(2)} km`;
  els.sceneSpeed.textContent = `${sc.current_speed_kms.toFixed(4)} km/s`;

  const traj = scene.trajectory || [];
  els.trajectorySlider.disabled = traj.length === 0;
  els.trajectorySlider.max = Math.max(0, traj.length - 1);
  els.trajectorySlider.value = state.trajectoryIndex;
  if (traj.length) {
    els.trajectoryOutput.textContent = `${state.trajectoryIndex + 1} / ${traj.length}`;
  }

  const sites = scene.sites || [];
  els.sceneSiteCount.textContent = `${sites.length} sites`;
  els.sceneSiteBody.innerHTML = "";
  sites.forEach((st) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${st.name}</td>
      <td>${st.lat.toFixed(4)}°</td>
      <td>${st.lon.toFixed(4)}°</td>
      <td>${st.alt_m.toFixed(0)} m</td>
      <td>${st.alt_source}</td>
      <td>${st.sun_el.toFixed(2)}°</td>
      <td>${st.earth_el.toFixed(2)}°</td>`;
    els.sceneSiteBody.appendChild(tr);
  });

  if (!state.sceneView) state.sceneView = new SceneView(els.sceneCanvas);
  state.sceneView.setScene(scene, state.trajectoryIndex);
}

function renderProvenance() {
  const meta = state.data?.meta || {};
  const d = state.data?.decision;
  const p2d = els.provenance2d;
  p2d.innerHTML = "";
  const add = (term, val) => {
    const div = document.createElement("div");
    div.innerHTML = `<dt>${term}</dt><dd>${val}</dd>`;
    p2d.appendChild(div);
  };
  add("Ephemeris", meta.ephemeris_source || "—");
  add("Horizon source", meta.dem_info?.horizon_source || "—");
  add("Terrain synthetic", meta.dem_info?.terrain_is_synthetic === true ? "Yes (slope/rover)" : "—");
  add("Site", meta.site_name || "—");
  add("Verdict", d?.verdict || "—");
  add("Score", String(d?.mission_score ?? "—"));

  const p3d = els.provenance3d;
  p3d.innerHTML = "";
  const s3 = state.scene;
  if (s3) {
    const add3 = (term, val) => {
      const div = document.createElement("div");
      div.innerHTML = `<dt>${term}</dt><dd>${val}</dd>`;
      p3d.appendChild(div);
    };
    add3("Frame", s3.frame || "—");
    add3("Scene model", s3.scene_model || "—");
    add3("Physics validated", s3.physics_valid ? "Yes" : "No");
    add3("Horizon source", s3.horizon_source || "—");
    add3("Sun visible", s3.sun_visible ? "Yes" : "No");
    add3("Earth visible", s3.earth_visible ? "Yes" : "No");
  } else {
    p3d.innerHTML = '<div class="provenance-empty">No 3B scene in this response.</div>';
  }

  const req = currentRequest();
  const rd = els.requestDetails;
  rd.innerHTML = "";
  Object.entries(req).forEach(([k, v]) => {
    const div = document.createElement("div");
    div.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
    rd.appendChild(div);
  });

  const sd = els.snapshotDetails;
  sd.innerHTML = "";
  if (state.snapshots) {
    const div = document.createElement("div");
    div.innerHTML = `<dt>Generated</dt><dd>${state.snapshots.generated_at_utc || "—"}</dd>`;
    sd.appendChild(div);
    const div2 = document.createElement("div");
    div2.innerHTML = `<dt>Scenarios</dt><dd>${(state.snapshots.scenarios || []).length}</dd>`;
    sd.appendChild(div2);
  } else {
    sd.innerHTML = '<div class="provenance-empty">Snapshot catalog not found.</div>';
  }
}

function renderModelWarnings() {
  const wrap = els.modelWarnings;
  wrap.innerHTML = "";
  const warn = (text) => {
    const div = document.createElement("div");
    div.className = "model-warning";
    div.textContent = text;
    wrap.appendChild(div);
  };
  warn("2D terrain slope, rover route, thermal and battery values are heuristic or synthetic, not validated physics.");
  if (state.scene && !state.scene.physics_valid) {
    warn("3B trajectory and touchdown are a kinematic visualization with no mass/fuel/thrust model (physics_valid=false).");
  }
  const ephem = state.data?.meta?.ephemeris_source;
  if (ephem && ephem !== "CSPICE_DE440S_IAU_MOON") {
    warn("Sun/Earth positions are computed with the analytic (non-CSPICE) ephemeris fallback.");
  }
}

function render() {
  renderSourceBadge();
  renderHeaderTime();
  renderBadges();
  renderDecision();
  renderCountdowns();
  renderKpis();
  renderMissionHeading();
  renderSamples();
  renderTimelineWindows();
  renderComparison();
  renderScene();
  renderProvenance();
  renderModelWarnings();
  drawHorizon(els.horizonCanvas, state.data, state.sampleIndex);
  drawTimeline(els.timelineCanvas, state.data, state.sampleIndex);
  if (state.sceneView) state.sceneView.setSelectedIndex(state.trajectoryIndex);
}

/* ---------- tab navigation ---------- */

function switchTab(tabId) {
  const panels = { overview: "panel-overview", scene: "panel-scene", model: "panel-model" };
  ["overview", "scene", "model"].forEach((t) => {
    const active = t === tabId;
    els[`tab-${t}`].classList.toggle("is-active", active);
    els[`tab-${t}`].setAttribute("aria-selected", String(active));
    els[`tab-${t}`].tabIndex = active ? 0 : -1;
    els[panels[t]].hidden = !active;
  });
}

/* ---------- events ---------- */

function bindEvents() {
  els.missionForm.addEventListener("submit", (e) => {
    e.preventDefault();
    runStudy();
  });
  els.slipButton.addEventListener("click", () => runStudy({ slip: true }));
  els.siteSelect.addEventListener("change", () => {
    els.customCoordinates.hidden = els.siteSelect.value !== CUSTOM_SITE_VALUE;
  });
  els.scenarioSelect.addEventListener("change", () => {
    const list = (state.snapshots && state.snapshots.scenarios) || [];
    const s = list.find((x) => x.id === els.scenarioSelect.value);
    if (s) applyScenario(s);
  });
  els.sampleSlider.addEventListener("input", () => {
    state.sampleIndex = Number(els.sampleSlider.value);
    renderSamples();
    drawHorizon(els.horizonCanvas, state.data, state.sampleIndex);
    drawTimeline(els.timelineCanvas, state.data, state.sampleIndex);
  });
  els.trajectorySlider.addEventListener("input", () => {
    state.trajectoryIndex = Number(els.trajectorySlider.value);
    const traj = state.scene?.trajectory || [];
    const p = traj[state.trajectoryIndex];
    els.trajectoryOutput.textContent = `${state.trajectoryIndex + 1} / ${traj.length}`;
    if (p) {
      els.trajectoryTime.textContent = `${p.t_sec.toFixed(1)} s`;
      els.trajectoryAltitude.textContent = `${p.alt_km.toFixed(2)} km`;
      els.trajectorySpeed.textContent = `${p.speed_kms.toFixed(4)} km/s`;
    }
    if (state.sceneView) state.sceneView.setSelectedIndex(state.trajectoryIndex);
  });
  els.comparisonSort.addEventListener("change", renderComparison);
  els.resetSceneView.addEventListener("click", () => { if (state.sceneView) state.sceneView.reset(); });
  els.dismissNotice.addEventListener("click", clearNotice);
  ["tab-overview", "tab-scene", "tab-model"].forEach((id) => {
    els[id].addEventListener("click", () => switchTab(id.replace("tab-", "")));
  });
}

async function init() {
  cacheElements();
  els.startInput.value = "2026-10-18T00:00";
  els.daysSelect.value = "14";
  bindEvents();
  await loadSnapshotCatalog();
  populateScenarios();
  const list = (state.snapshots && state.snapshots.scenarios) || [];
  if (list.length) {
    applyScenario(list[0]);
  } else {
    await runStudy();
  }
}

init();
