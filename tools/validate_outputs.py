#!/usr/bin/env python3
"""Validate data/output.json, data/3b_scene.json, data/3b_scene.js and data/artemis_ranking.json."""
from __future__ import annotations

import datetime as dt
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
R_MOON_KM = 1737.4
TOL = 1e-3

errors: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def close(a: float, b: float, tol: float = TOL) -> bool:
    return math.isfinite(a) and math.isfinite(b) and abs(a - b) <= tol


def finite(v) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(float(v))


def load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def parse_utc(s: str) -> dt.datetime:
    return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")


def verdict(sun: float, earth: float, slope: float, dark: float, min_soc: float) -> str:
    if sun < 40.0 or dark > 120.0 or slope > 12.0 or min_soc < 15.0:
        return "NO-GO"
    if earth < 35.0 or slope > 8.0 or dark > 72.0:
        return "CAUTION"
    return "GO"


def valid_score(score: float, v: str) -> bool:
    if not (0 <= score <= 100):
        return False
    if v == "NO-GO" and score > 39:
        return False
    if v == "CAUTION" and score > 69:
        return False
    return True


def validate_output(o: dict) -> None:
    check(o.get("status") == "SUCCESS", "output.status SUCCESS degil")
    meta = o.get("meta") or {}
    check(meta.get("ephemeris_source") in {"CSPICE_DE440S_IAU_MOON", "ANALYTIC_MEEUS_FALLBACK"},
          "output.meta.ephemeris_source gecersiz")
    check(meta.get("dem_info", {}).get("horizon_source") in {"LOLA_80M_SKYLINE", "SYNTHETIC_ANALYTIC"},
          "output.meta.dem_info.horizon_source gecersiz")
    check(meta.get("dem_info", {}).get("terrain_is_synthetic") is True,
          "output.meta.dem_info.terrain_is_synthetic true olmali")

    samples = o.get("samples") or []
    check(len(samples) > 0, "output.samples bos")
    n = len(samples)
    start = parse_utc(meta["start_utc"])
    end = parse_utc(meta["end_utc"])
    check((end - start).total_seconds() == n * 3600, "output end_utc - start_utc samples ile uyusmuyor")

    sun_sum = 0.0
    earth_count = 0
    min_soc = 100.0
    max_sun_run = 0
    max_dark_run = 0
    cur_sun_run = 0
    cur_dark_run = 0
    overlap = 0
    for i, s in enumerate(samples):
        check(s.get("step_index") == i, f"samples[{i}].step_index hatali")
        check(close(parse_utc(s["utc"]).timestamp(), (start + dt.timedelta(hours=i)).timestamp()),
              f"samples[{i}].utc hatali")
        sf = s.get("sun_frac")
        check(finite(sf) and 0.0 <= sf <= 1.0, f"samples[{i}].sun_frac gecersiz")
        sun_sum += sf
        check(s.get("is_sun_visible") == (sf > 0.25), f"samples[{i}].is_sun_visible sun_frac ile uyusmuyor")
        check(finite(s.get("sun_azimuth_deg")) and 0.0 <= s["sun_azimuth_deg"] < 360.0,
              f"samples[{i}].sun_azimuth_deg gecersiz")
        check(finite(s.get("sun_elevation_deg")) and -90.0 <= s["sun_elevation_deg"] <= 90.0,
              f"samples[{i}].sun_elevation_deg gecersiz")
        check(finite(s.get("earth_azimuth_deg")) and 0.0 <= s["earth_azimuth_deg"] < 360.0,
              f"samples[{i}].earth_azimuth_deg gecersiz")
        check(finite(s.get("earth_elevation_deg")) and -90.0 <= s["earth_elevation_deg"] <= 90.0,
              f"samples[{i}].earth_elevation_deg gecersiz")
        check(finite(s.get("soc_pct")) and 0.0 <= s["soc_pct"] <= 100.0, f"samples[{i}].soc_pct gecersiz")
        min_soc = min(min_soc, s["soc_pct"])
        if s.get("is_earth_visible"):
            earth_count += 1
        if sf > 0.25:
            cur_sun_run += 1
            cur_dark_run = 0
            max_sun_run = max(max_sun_run, cur_sun_run)
            if s.get("is_earth_visible"):
                overlap += 1
        else:
            cur_dark_run += 1
            cur_sun_run = 0
            max_dark_run = max(max_dark_run, cur_dark_run)

    summary = o.get("summary") or {}
    check(close(summary.get("total_sun_hours", -1), sun_sum, 0.11), "summary.total_sun_hours samples ile uyusmuyor")
    check(close(summary.get("illumination_percent", -1), 100.0 * sun_sum / n, 0.06),
          "summary.illumination_percent samples ile uyusmuyor")
    check(close(summary.get("total_earth_hours", -1), float(earth_count), 0.01),
          "summary.total_earth_hours samples ile uyusmuyor")
    check(close(summary.get("earth_visibility_percent", -1), 100.0 * earth_count / n, 0.06),
          "summary.earth_visibility_percent samples ile uyusmuyor")
    check(close(summary.get("longest_sun_hours", -1), float(max_sun_run), 0.01),
          "summary.longest_sun_hours samples ile uyusmuyor")
    check(close(summary.get("longest_dark_hours", -1), float(max_dark_run), 0.01),
          "summary.longest_dark_hours samples ile uyusmuyor")
    check(close(summary.get("overlap_hours", -1), float(overlap), 0.01),
          "summary.overlap_hours samples ile uyusmuyor")
    check(summary.get("total_sun_hours", 1e9) <= n + 0.11, "summary.total_sun_hours > sure")
    check(summary.get("total_earth_hours", 1e9) <= n + 0.11, "summary.total_earth_hours > sure")
    check(summary.get("longest_sun_hours", 1e9) <= n + 0.11, "summary.longest_sun_hours > sure")
    check(summary.get("longest_dark_hours", 1e9) <= n + 0.11, "summary.longest_dark_hours > sure")
    tel = o.get("telemetry") or {}
    check(close(tel.get("min_battery_soc_pct", -1), min_soc, 0.11),
          "telemetry.min_battery_soc_pct samples ile uyusmuyor")
    check(close(summary.get("mission_score", -1), (o.get("decision") or {}).get("mission_score", -2), 0),
          "summary/decision mission_score farkli")
    check(valid_score(summary.get("mission_score", -1), (o.get("decision") or {}).get("verdict", "")),
          "summary.mission_score/verdict celiskili")

    expected_v = verdict(summary["illumination_percent"], summary["earth_visibility_percent"],
                         tel["slope_deg"], summary["longest_dark_hours"], tel["min_battery_soc_pct"])
    check((o.get("decision") or {}).get("verdict") == expected_v, "decision.verdict esiklerle uyusmuyor")

    mask = o.get("terrain_horizon_mask") or []
    check(len(mask) == 360, "terrain_horizon_mask 360 eleman olmali")
    check(all(finite(v) and -90.0 <= v <= 90.0 for v in mask), "terrain_horizon_mask degerleri gecersiz")

    windows = o.get("windows") or {}
    for kind in ("sun", "earth"):
        for w in windows.get(kind, []):
            check(close(parse_utc(w["end_utc"]).timestamp() - parse_utc(w["start_utc"]).timestamp(),
                        w["duration_hours"] * 3600.0, 1.0),
                  f"windows.{kind} duration_hours ile utc uyusmuyor")
    check(len(windows.get("earth", [])) == summary.get("dte_window_count"),
          "windows.earth sayisi summary.dte_window_count ile uyusmuyor")

    blocker = (o.get("decision") or {}).get("blocker_wall") or {}
    if blocker.get("distance_known"):
        check(finite(blocker.get("distance_km")) and blocker["distance_km"] >= 0,
              "blocker_wall.distance_km known=true iken gecersiz")
    else:
        check(blocker.get("distance_km") is None, "blocker_wall.distance_km unknown iken null olmali")

    ev = o.get("events") or {}
    check(isinstance(ev.get("search_exhausted"), bool), "events.search_exhausted bool olmali")
    for body in ("sun", "earth"):
        e = ev.get(body) or {}
        check(isinstance(e.get("visible_now"), bool), f"events.{body}.visible_now bool olmali")
        vis = e.get("visible_now")
        # events.visible_now, ilk sample ile tutarli olmali
        first_vis = samples[0].get("is_sun_visible" if body == "sun" else "is_earth_visible")
        check(vis == first_vis, f"events.{body}.visible_now ilk sample ile uyusmuyor")
        key_to = "hours_to_sunset" if body == "sun" else "hours_to_earthset"
        key_rise = "hours_to_sunrise" if body == "sun" else "hours_to_earthrise"
        key_utc = "next_sunset_utc" if body == "sun" else "next_earthset_utc"
        key_rise_utc = "next_sunrise_utc" if body == "sun" else "next_earthrise_utc"
        if vis and key_to in e:
            check(finite(e[key_to]) and e[key_to] >= 0, f"events.{body}.{key_to} gecersiz")
            check(close(parse_utc(e[key_utc]).timestamp(),
                        (start + dt.timedelta(hours=e[key_to])).timestamp(), 1.0),
                  f"events.{body}.{key_utc} saatle uyusmuyor")
        if (not vis) and key_rise in e:
            check(finite(e[key_rise]) and e[key_rise] >= 0, f"events.{body}.{key_rise} gecersiz")
            check(close(parse_utc(e[key_rise_utc]).timestamp(),
                        (start + dt.timedelta(hours=e[key_rise])).timestamp(), 1.0),
                  f"events.{body}.{key_rise_utc} saatle uyusmuyor")

    comp = o.get("site_comparison") or []
    check(len(comp) == 5, "site_comparison 5 aday icermeli")
    for c in comp:
        for key in ("illumination_percent", "earth_visibility_percent", "slope_deg",
                    "total_sun_hours", "longest_sun_hours", "total_earth_hours",
                    "longest_earth_hours", "overlap_hours", "longest_dark_hours",
                    "min_battery_soc_pct", "altitude_m"):
            check(finite(c.get(key)), f"{c.get('site_name')}.{key} gecersiz")
        check(0.0 <= c["illumination_percent"] <= 100.0, f"{c['site_name']} illumination araligi")
        check(0.0 <= c["earth_visibility_percent"] <= 100.0, f"{c['site_name']} earth araligi")
        check(close(c["total_sun_hours"], n * c["illumination_percent"] / 100.0, 0.35),
              f"{c['site_name']} total_sun_hours/illumination uyusmuyor")
        check(close(c["total_earth_hours"], n * c["earth_visibility_percent"] / 100.0, 0.35),
              f"{c['site_name']} total_earth_hours/visibility uyusmuyor")
        check(c["total_sun_hours"] <= n + 0.1, f"{c['site_name']} total_sun_hours > sure")
        check(c["total_earth_hours"] <= n + 0.1, f"{c['site_name']} total_earth_hours > sure")
        check(c["longest_dark_hours"] <= n + 0.1, f"{c['site_name']} longest_dark_hours > sure")
        check(c["overlap_hours"] <= c["total_earth_hours"] + 0.1, f"{c['site_name']} overlap > earth")
        check(0.0 <= c["min_battery_soc_pct"] <= 100.0, f"{c['site_name']} min battery araligi")
        check(0.0 <= c["slope_deg"] <= 90.0, f"{c['site_name']} slope araligi")
        check(-6000.0 <= c["altitude_m"] <= 12000.0, f"{c['site_name']} altitude araligi")
        expected = verdict(c["illumination_percent"], c["earth_visibility_percent"],
                           c["slope_deg"], c["longest_dark_hours"], c["min_battery_soc_pct"])
        check(c.get("verdict") == expected, f"{c['site_name']} verdict esiklerle uyusmuyor")
        check(valid_score(c.get("mission_score", -1), c.get("verdict", "")),
              f"{c['site_name']} score/verdict celiskili")


def validate_3b(s: dict, js_text: str) -> None:
    check(s.get("scene_model") == "kinematic-visualization", "3b.scene_model gecersiz")
    check(s.get("physics_valid") is False, "3b.physics_valid false olmali")
    check(s.get("frame") == "IAU_MOON", "3b.frame IAU_MOON olmali")
    check(s.get("ephemeris_source") in {"CSPICE_DE440S_IAU_MOON", "ANALYTIC_MEEUS_FALLBACK"},
          "3b.ephemeris_source gecersiz")
    check(s.get("helio_model") == "ANALYTIC_KEPLER", "3b.helio_model gecersiz")
    check(s.get("trajectory_phase") == "POST_BURN_DESCENT", "3b.trajectory_phase gecersiz")
    check(s.get("terrain_is_synthetic") is True, "3b.terrain_is_synthetic true olmali")
    check(1 <= s.get("range_days", 0) <= 30, "3b.range_days 1..30 olmali")
    check(s.get("horizon_source") in {"LOLA_80M_SKYLINE", "SYNTHETIC_ANALYTIC"},
          "3b.horizon_source gecersiz")
    check(isinstance(s.get("sun_visible"), bool), "3b.sun_visible bool olmali")
    check(isinstance(s.get("earth_visible"), bool), "3b.earth_visible bool olmali")
    check(finite(s.get("sun_horizon_deg")) and -90 <= s["sun_horizon_deg"] <= 90, "3b.sun_horizon_deg gecersiz")
    check(finite(s.get("earth_horizon_deg")) and -90 <= s["earth_horizon_deg"] <= 90, "3b.earth_horizon_deg gecersiz")

    for name in ("sun", "earth"):
        v = s.get(name) or {}
        vec = v.get("vec") or []
        check(len(vec) == 3 and all(finite(x) for x in vec), f"3b.{name}.vec gecersiz")
        check(close(math.sqrt(sum(x * x for x in vec)), 1.0, 1e-3), f"3b.{name}.vec birim vektor degil")
        expected_sub_lat = math.degrees(math.asin(max(-1.0, min(1.0, vec[2]))))
        expected_sub_lon = math.degrees(math.atan2(vec[1], vec[0]))
        check(close(v.get("sub_lat", 999), expected_sub_lat, 0.02), f"3b.{name}.sub_lat vec ile uyusmuyor")
        check(close(v.get("sub_lon", 999), expected_sub_lon, 0.02), f"3b.{name}.sub_lon vec ile uyusmuyor")

    bodies = s.get("spice_bodies") or []
    check(len(bodies) > 0, "3b.spice_bodies bos")
    ids = [b.get("naif_id") for b in bodies]
    check(len(ids) == len(set(ids)), "3b.spice_bodies naif_id tekrarli")
    by_id = {b.get("naif_id"): b for b in bodies}
    for naif in (10, 399, 301):
        check(naif in by_id, f"3b.spice_bodies {naif} eksik")
        if naif in by_id:
            check(by_id[naif].get("from_spice_kernel") is True, f"{naif} from_spice_kernel false")
    for b in bodies:
        pos = b.get("pos_km") or []
        check(len(pos) == 3 and all(finite(x) for x in pos), f"{b.get('name')}.pos_km gecersiz")
        check(close(math.sqrt(sum(x * x for x in pos)), b.get("distance_km", -1), 0.2),
              f"{b.get('name')}.distance_km |pos_km| ile uyusmuyor")
        for key in ("helio_km", "radius_km", "a_km", "ecc", "inc_deg", "phase_deg",
                    "period_days", "orbital_speed_kms"):
            val = b.get(key)
            if isinstance(val, list):
                check(len(val) == 3 and all(finite(x) for x in val), f"{b.get('name')}.{key} gecersiz")
            else:
                check(finite(val), f"{b.get('name')}.{key} gecersiz")

    for site in [s.get("selected_site") or {}] + list(s.get("sites") or []):
        check(finite(site.get("lat")) and -90 <= site["lat"] <= 90, f"{site.get('name')}.lat gecersiz")
        check(finite(site.get("lon")) and -360 <= site["lon"] <= 360, f"{site.get('name')}.lon gecersiz")
        check(finite(site.get("alt_m")), f"{site.get('name')}.alt_m gecersiz")
        check(site.get("alt_source") in {"LOLA_80M", "SYNTHETIC_DEM"},
              f"{site.get('name')}.alt_source gecersiz")
        check(finite(site.get("slope_deg")) and site["slope_deg"] >= 0, f"{site.get('name')}.slope_deg gecersiz")
        check(finite(site.get("sun_el")) and finite(site.get("earth_el")),
              f"{site.get('name')}.sun_el/earth_el gecersiz")
        check(isinstance(site.get("is_custom"), bool), f"{site.get('name')}.is_custom bool olmali")

    sc = s.get("spacecraft") or {}
    vnorm = math.sqrt(sum(x * x for x in sc.get("vel_kms", [])))
    check(close(vnorm, sc.get("current_speed_kms", -1), 1e-4),
          "3b.spacecraft.current_speed_kms |vel_kms| ile uyusmuyor")
    pos = sc.get("pos_km") or []
    check(len(pos) == 3 and all(finite(x) for x in pos), "3b.spacecraft.pos_km gecersiz")
    r = math.sqrt(sum(x * x for x in pos))
    lat = math.degrees(math.asin(max(-1.0, min(1.0, pos[2] / r))))
    lon = math.degrees(math.atan2(pos[1], pos[0]))
    check(close(lat, sc.get("lat", 999), 0.05), "3b.spacecraft.lat pos_km ile uyusmuyor")
    check(close(lon, sc.get("lon", 999), 0.05), "3b.spacecraft.lon pos_km ile uyusmuyor")

    traj = s.get("trajectory") or []
    check(len(traj) == 96, "3b.trajectory 96 nokta olmali")
    last_t = -1.0
    for i, p in enumerate(traj):
        check(p.get("step") == i, f"3b.trajectory[{i}].step hatali")
        check(p.get("t_sec", -1) >= last_t, f"3b.trajectory[{i}].t_sec artmiyor")
        last_t = p.get("t_sec", -1)
        check(finite(p.get("speed_kms")) and p["speed_kms"] >= 0, f"3b.trajectory[{i}].speed_kms gecersiz")
        check(finite(p.get("alt_km")) and p["alt_km"] >= -1e-6, f"3b.trajectory[{i}].alt_km gecersiz")
        pv = math.sqrt(sum(x * x for x in p.get("vel_kms", [])))
        check(close(pv, p.get("speed_kms", -1), 1e-4), f"3b.trajectory[{i}] speed/vel uyusmuyor")
    target_lat = s["selected_site"]["lat"]
    target_lon = s["selected_site"]["lon"]
    target_r = R_MOON_KM + s["selected_site"]["alt_m"] / 1000.0
    la, lo = math.radians(target_lat), math.radians(target_lon)
    target = [target_r * math.cos(la) * math.cos(lo),
              target_r * math.cos(la) * math.sin(lo),
              target_r * math.sin(la)]
    last = traj[-1]
    check(math.dist(last.get("pos_km", [0, 0, 0]), target) < 0.05,
          "3b.trajectory son noktasi selected_site hedefinde degil")
    check(close(last.get("alt_km", -1), 0.0, 1e-6), "3b.trajectory son alt_km 0 degil")
    check(close(last.get("speed_kms", -1), 0.0012, 1e-7), "3b.trajectory son speed_kms 0.0012 degil")
    check(close(last_t, sc.get("transfer_time_sec", -1), 0.11), "3b.trajectory son t_sec transfer_time ile uyusmuyor")

    land = s.get("landing_seconds") or []
    check(len(land) == 60, "3b.landing_seconds 60 eleman olmali")
    check([p.get("offset_sec") for p in land] == list(range(-30, 30)), "landing_seconds offset araligi hatali")
    landing_dt = parse_utc(s["landing_utc"])
    for p in land:
        check(parse_utc(p["utc"]) == landing_dt + dt.timedelta(seconds=p["offset_sec"]),
              f"landing_seconds[{p['offset_sec']}].utc landing_utc ile uyusmuyor")
    check(land[30].get("utc") == s.get("landing_utc"), "landing_seconds[30].utc landing_utc ile uyusmuyor")
    for p in land:
        check(finite(p.get("alt_m")) and p["alt_m"] >= 0, "landing_seconds.alt_m gecersiz")
        check(finite(p.get("vz_ms")), "landing_seconds.vz_ms gecersiz")
        check(finite(p.get("sun_disk_pct")) and 0 <= p["sun_disk_pct"] <= 100, "landing_seconds.sun_disk_pct gecersiz")
        check(isinstance(p.get("dte"), bool) and isinstance(p.get("sun_vis"), bool),
              "landing_seconds boolean alanlari gecersiz")

    rep = s.get("touchdown_report") or {}
    check("mission_score" not in rep, "3b.touchdown_report.mission_score kaldirilmali")
    check("sun_illumination_pct" not in rep, "3b.touchdown_report.sun_illumination_pct kaldirilmali")
    check(finite(rep.get("sun_disk_illuminated_pct")) and 0 <= rep["sun_disk_illuminated_pct"] <= 100,
          "3b.touchdown_report.sun_disk_illuminated_pct gecersiz")
    check(isinstance(rep.get("sun_visible"), bool), "3b.touchdown_report.sun_visible bool olmali")
    check(rep.get("model") == "kinematic-visualization", "3b.touchdown_report.model gecersiz")
    check(rep.get("physics_valid") is False, "3b.touchdown_report.physics_valid false olmali")
    check(rep.get("touchdown_utc") == s.get("landing_utc"), "touchdown_report.touchdown_utc uyusmuyor")
    check(close(rep.get("flight_duration_sec", -1), sc.get("transfer_time_sec", -2), 0.11),
          "touchdown_report.flight_duration_sec transfer_time ile uyusmuyor")
    check(close(rep.get("touchdown_speed_ms", -1), last["speed_kms"] * 1000.0, 0.01),
          "touchdown_report.touchdown_speed_ms son hiz ile uyusmuyor")
    check(rep.get("trajectory_snapped_to_target") is True, "touchdown_report.trajectory_snapped_to_target true olmali")
    check(rep.get("success") == (rep.get("miss_distance_m", 1e9) <= 50.0),
          "touchdown_report.success miss_distance ile uyusmuyor")

    m = re.match(r"\s*window\.SCENE_3B_DATA\s*=\s*(.*);\s*$", js_text, re.S)
    check(m is not None, "3b_scene.js SCENE_3B_DATA formati gecersiz")
    if m:
        try:
            js = json.loads(m.group(1))
            check(js == s, "3b_scene.js ile 3b_scene.json ayni degil")
        except json.JSONDecodeError as e:
            errors.append(f"3b_scene.js parse edilemedi: {e}")


def validate_ranking(r: dict, comp: list[dict]) -> None:
    check("data/output.json" in (r.get("source") or ""), "ranking.source C11 ciktisini gostermiyor")
    rows = r.get("artemis_ranking") or []
    check(len(rows) == len(comp), "ranking aday sayisi site_comparison ile uyusmuyor")
    by_name = {c["site_name"]: c for c in comp}
    last_score = 101
    for i, row in enumerate(rows):
        check(row.get("rank") == i + 1, f"ranking[{i}].rank hatali")
        c = by_name.get(row.get("site_name"))
        check(c is not None, f"ranking[{i}] bilinmeyen saha")
        if c:
            check(close(row.get("score", -1), c["mission_score"], 0.001), f"{c['site_name']} ranking score uyusmuyor")
            check(row.get("verdict") == c["verdict"], f"{c['site_name']} ranking verdict uyusmuyor")
            check(close(row.get("sun_pct", -1), c["illumination_percent"], 0.06), f"{c['site_name']} sun_pct uyusmuyor")
            check(close(row.get("dte_pct", -1), c["earth_visibility_percent"], 0.06), f"{c['site_name']} dte_pct uyusmuyor")
        check(row.get("score", 101) <= last_score, "ranking score sirali degil")
        last_score = row.get("score", 101)


def main() -> int:
    out = load_json(ROOT / "data/output.json")
    s3 = load_json(ROOT / "data/3b_scene.json")
    js_text = (ROOT / "data/3b_scene.js").read_text(encoding="utf-8")
    rank = load_json(ROOT / "data/artemis_ranking.json")

    validate_output(out)
    validate_3b(s3, js_text)
    validate_ranking(rank, out.get("site_comparison") or [])

    # 2D ve 3B ayni base_utc/start_utc aninda ayni ufuk gorunurlugunu bildirmeli.
    if (out.get("samples") or []) and s3.get("base_utc"):
        s0 = out["samples"][0]
        if s3["base_utc"] == out["meta"]["start_utc"]:
            check(s0.get("is_sun_visible") == s3.get("sun_visible"),
                  "2D/3B gunes gorunurlugu tutarsiz (aynı anda)")
            check(s0.get("is_earth_visible") == s3.get("earth_visible"),
                  "2D/3B dunya gorunurlugu tutarsiz (aynı anda)")

    if errors:
        print(f"FAIL: {len(errors)} hata")
        for e in errors:
            print(" -", e)
        return 1
    print("PASS: 2D + 3B + ranking verileri tutarli")
    return 0


if __name__ == "__main__":
    sys.exit(main())
