// ui-starter/src/types/mission.ts
// AstroApex — 2D görev planı JSON sözleşmesi (C11 + CSPICE + Lua backend).
//
// KURAL: Bu dosyadaki alanlar backend çıktısından gelir; frontend'te fizik veya
// yeni alan uydurulmaz. 3B sahne ayrı bir modeldir; şeması src/3b_moon.h içindedir.
//
// Canlı data/output.json notları:
//   - status: "SUCCESS" (eski "OK" varsayımı yapma)
//   - meta, decision, telemetry, optimizations, rover_traverse alanları vardır.
//   - Çevrimdışı sample_output.json bazı alanlarda eksik olabilir; opsiyonel kabul et.
// Ayrıntı: AGENTS.md ve docs/FRONTEND_GUIDE.md.

/**
 * 2D istek modeli. Mevcut C sunucusu GET'te yalnızca site_name, latitude_deg,
 * longitude_deg, start_utc ve days karşılığını kullanır; diğer alanlar ileride
 * backend desteği eklenmek üzere tutulur.
 */
export interface SimulationRequest {
  site_name: string;
  latitude_deg: number;
  longitude_deg: number;
  altitude_m: number;
  use_custom_coords?: boolean;
  start_utc: string; // ISO-8601 UTC: "2026-10-18T00:00:00"
  end_utc: string;   // ISO-8601 UTC: "2026-11-01T00:00:00"
  step_seconds: number;
  use_dem_horizon: boolean;
  min_sun_el_deg: number;
  min_earth_el_deg: number;
  include_earth_disk: boolean;
}

export interface SiteSummary {
  /** Canlı çıktıda alan adı `meta` içinde olabilir; örnekte burada da bulunur. */
  site_name?: string;
  latitude_deg?: number;
  longitude_deg?: number;
  altitude_m?: number;

  total_sun_hours: number;
  illumination_percent: number;
  longest_sun_hours: number;

  total_earth_hours: number;
  earth_visibility_percent: number;
  longest_earth_hours: number;
  dte_window_count: number;

  overlap_hours: number;
  longest_dark_hours: number;

  /** Örnek veride vardır; canlı özet çıktısında bulunmayabilir. */
  avg_sun_elevation_deg?: number;
  avg_earth_elevation_deg?: number;
  mission_score: number; // 0 - 100
}

export interface VisibilityWindow {
  start_utc: string;
  end_utc: string;
  duration_hours: number;
}

export interface TimeSample {
  step_index: number;
  utc: string;
  /** Örnek veride vardır; canlı çıktıda eksik olabilir. */
  duration_seconds?: number;
  sun_azimuth_deg: number;
  sun_elevation_deg: number;
  earth_azimuth_deg: number;
  earth_elevation_deg: number;
  /** Örnek veride vardır; canlı çıktıda eksik olabilir. */
  sun_terrain_horizon_deg?: number;
  earth_terrain_horizon_deg?: number;
  is_sun_visible: boolean;
  is_earth_visible: boolean;
  /** Canlı çıktıda bulunur. */
  sun_frac?: number;
  /** Canlı çıktıda bulunur. */
  soc_pct?: number;
}

export interface SimulationMetadata {
  site_name?: string;
  latitude_deg?: number;
  longitude_deg?: number;
  altitude_m?: number;
  start_utc?: string;
  end_utc?: string;
  step_seconds?: number;
  total_steps?: number;
  using_real_dem?: boolean;
  dem_out_of_bounds?: boolean;
  dem_source?: string;
  warning?: string;
}

export interface SiteComparison {
  site_name: string;
  latitude_deg: number;
  longitude_deg: number;
  illumination_percent: number;
  total_earth_hours: number;
  overlap_hours: number;
  longest_dark_hours: number;
  mission_score: number;
  verdict?: GoNoGoStatus;
  /** Aşağıdaki alanlar bazı çıktılarda bulunmayabilir. */
  total_sun_hours?: number;
  longest_sun_hours?: number;
  earth_visibility_percent?: number;
  longest_earth_hours?: number;
  dte_window_count?: number;
  altitude_m?: number;
  avg_sun_elevation_deg?: number;
  avg_earth_elevation_deg?: number;
}

export interface MissionDecision {
  verdict: GoNoGoStatus;
  mission_score: number;
  primary_blocker_code?: string;
  human_reason_tr?: string;
  qwen_05b_prompt_facts?: string;
  blocker_wall?: {
    azimuth_deg: number;
    distance_km: number;
    elevation_deg: number;
  };
}

export interface MissionTelemetry {
  slope_deg: number;
  aspect_deg: number;
  surface_temp_k: number;
  ice_probability_pct: number;
  terrain_loss_pct: number;
  min_battery_soc_pct: number;
}

export interface SimulationResponse {
  /** Canlı çıktı "SUCCESS" döner; eski örneklerde "OK" görülebilir. */
  status: "SUCCESS" | "OK" | "ERROR";
  message?: string;
  /** Canlı çıktıda meta; eski istemciler için metadata opsiyonel. */
  meta?: SimulationMetadata;
  metadata?: SimulationMetadata;
  using_real_dem?: boolean;
  dem_out_of_bounds?: boolean;
  warning_msg?: string;
  warning?: string;

  summary: SiteSummary;
  decision?: MissionDecision;
  telemetry?: MissionTelemetry;
  optimizations?: Record<string, unknown>;
  rover_traverse?: Record<string, unknown>;
  windows: {
    sun: VisibilityWindow[];
    earth: VisibilityWindow[];
  };
  /** 0° (Kuzey) ile 359° arası 1° adımlı arazi engel açıları (derece) */
  terrain_horizon_mask: number[];
  samples: TimeSample[];
  site_comparison: SiteComparison[];
}

export type GoNoGoStatus = "GO" | "CAUTION" | "NO-GO";

export interface MissionRiskFlag {
  code: "POWER_STARVATION" | "EXTENDED_DARKNESS" | "DTE_BLACKOUT" | "LOW_OPS_OVERLAP" | "NOMINAL";
  severity: GoNoGoStatus;
  title: string;
  detail: string;
}

export interface MissionRiskReport {
  overall: GoNoGoStatus;
  flags: MissionRiskFlag[];
}

export const DEFAULT_SIMULATION_REQUEST: SimulationRequest = {
  site_name: "Shackleton Rim",
  latitude_deg: -89.9,
  longitude_deg: 0.0,
  altitude_m: 120,
  use_custom_coords: false,
  start_utc: "2026-10-18T00:00:00",
  end_utc: "2026-11-01T00:00:00",
  step_seconds: 3600,
  use_dem_horizon: true,
  min_sun_el_deg: 1.5,
  min_earth_el_deg: 2.0,
  include_earth_disk: true,
};

export const CANDIDATE_LANDING_SITES: Array<{
  name: string;
  latitude_deg: number;
  longitude_deg: number;
  altitude_m: number;
}> = [
  { name: "Shackleton Rim", latitude_deg: -89.9, longitude_deg: 0.0, altitude_m: 120 },
  { name: "Connecting Ridge", latitude_deg: -89.45, longitude_deg: 222.5, altitude_m: 1850 },
  { name: "Malapert Massif", latitude_deg: -85.95, longitude_deg: 357.5, altitude_m: 4800 },
  { name: "Nobile Rim 1", latitude_deg: -85.2, longitude_deg: 55.0, altitude_m: 2100 },
  { name: "Haworth", latitude_deg: -87.45, longitude_deg: 354.8, altitude_m: 1650 },
];