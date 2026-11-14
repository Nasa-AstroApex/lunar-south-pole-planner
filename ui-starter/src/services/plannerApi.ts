// ui-starter/src/services/plannerApi.ts
// AstroApex HTTP API İstemcisi & Çevrimdışı Yedekleme Katmanı
//
// KURAL: Fizik burada hesaplanmaz. Backend'in döndürdüğü alanlar olduğu gibi kullanılır.
// Mevcut C sunucusu yalnızca GET query parametrelerini okur; POST gövdesini parse etmez.
// Bu yüzden canlı istek GET ile yapılır. Backend POST desteği eklenirse burası güncellenir.
// Sözleşme: AGENTS.md, docs/FRONTEND_GUIDE.md.

import {
  DEFAULT_SIMULATION_REQUEST,
  MissionRiskFlag,
  MissionRiskReport,
  SimulationRequest,
  SimulationResponse,
  SiteSummary,
} from "../types/mission";

const DEFAULT_API_URL = "http://localhost:8080";
const OFFLINE_SAMPLE_PATH = "/sample_output.json";

export interface PlannerFetchResult {
  data: SimulationResponse;
  source: "live-backend" | "offline-sample";
  latencyMs: number;
}

function resolveApiUrl(): string {
  const envUrl = (import.meta as unknown as { env?: Record<string, string> })?.env
    ?.VITE_PLANNER_API_URL;
  return envUrl && envUrl.trim().length > 0 ? envUrl.trim() : DEFAULT_API_URL;
}

/**
 * C11 + CSPICE + Lua sunucusuna simülasyon isteği gönderir.
 * Sunucu kapalıysa veya ağ erişimi yoksa otomatik olarak /sample_output.json verisini yükler.
 */
export async function runMissionSimulation(
  partialRequest: Partial<SimulationRequest> = {},
  timeoutMs = 5000
): Promise<PlannerFetchResult> {
  const payload: SimulationRequest = {
    ...DEFAULT_SIMULATION_REQUEST,
    ...partialRequest,
  };

  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Backend sözleşmesi: GET /?site=&lat=&lon=&utc=&days=
    // Diğer SimulationRequest alanları şu an C sunucusunda kullanılmıyor.
    const url = new URL(resolveApiUrl());
    url.searchParams.set("site", payload.site_name);
    url.searchParams.set("lat", String(payload.latitude_deg));
    url.searchParams.set("lon", String(payload.longitude_deg));
    url.searchParams.set("utc", payload.start_utc);

    const startMs = Date.parse(payload.start_utc);
    const endMs = Date.parse(payload.end_utc);
    const days = Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(1, Math.min(30, Math.round((endMs - startMs) / 86_400_000)))
      : 14;
    url.searchParams.set("days", String(days));

    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Backend HTTP ${response.status}`);
    }

    const data = (await response.json()) as SimulationResponse;
    if (data.status === "ERROR") {
      throw new Error(data.message || "CSPICE/Lua simülasyon hatası");
    }

    return {
      data,
      source: "live-backend",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    const fallbackRes = await fetch(OFFLINE_SAMPLE_PATH);
    if (!fallbackRes.ok) {
      throw new Error(
        "Hem canlı C-SPICE sunucusu (:8080) hem de /sample_output.json erişilemez durumda."
      );
    }

    const data = (await fallbackRes.json()) as SimulationResponse;
    return {
      data,
      source: "offline-sample",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Backend'den gelen SiteSummary KPI değerlerini Artemis/CSA görev kriterlerine göre
 * GO / CAUTION / NO-GO karar bayraklarına dönüştürür (sıfır fizik hesabı, saf eşik kontrolü).
 */
export function evaluateMissionRisks(summary: SiteSummary): MissionRiskReport {
  const flags: MissionRiskFlag[] = [];

  if (summary.illumination_percent < 15 || summary.total_sun_hours <= 0) {
    flags.push({
      code: "POWER_STARVATION",
      severity: "NO-GO",
      title: "Kritik Güneş Enerjisi Yetersizliği",
      detail: `Aydınlanma oranı %${summary.illumination_percent.toFixed(1)} (${summary.total_sun_hours.toFixed(1)} sa). Solar şarj penceresi yetersiz.`,
    });
  } else if (summary.longest_dark_hours > 120) {
    flags.push({
      code: "EXTENDED_DARKNESS",
      severity: "CAUTION",
      title: "Uzun Kesintisiz Karanlık Süresi",
      detail: `Kesintisiz ${summary.longest_dark_hours.toFixed(1)} saat gölge periyodu; kriyojenik/termal batarya rezervi kritik.`,
    });
  }

  if (summary.dte_window_count === 0 || summary.total_earth_hours <= 0) {
    flags.push({
      code: "DTE_BLACKOUT",
      severity: "NO-GO",
      title: "Dünya Doğrudan İletişim (DTE) Kesintisi",
      detail: "Seçilen aralıkta Dünya ufkun üzerine çıkmıyor; röle uydusu olmadan telemetri kurulamaz.",
    });
  } else if (summary.overlap_hours < 24) {
    flags.push({
      code: "LOW_OPS_OVERLAP",
      severity: "CAUTION",
      title: "Düşük Güneş + DTE Eşzamanlı Operasyon Penceresi",
      detail: `Aynı anda hem güneş enerjisi hem Dünya görüşü bulunan süre yalnızca ${summary.overlap_hours.toFixed(1)} saat.`,
    });
  }

  if (flags.length === 0) {
    flags.push({
      code: "NOMINAL",
      severity: "GO",
      title: "Tüm Görev Parametreleri Nominal",
      detail: `Skor ${summary.mission_score}/100 — Güneş aydınlanması ve DTE iletişim pencereleri operasyon limitleri içinde.`,
    });
  }

  const overall = flags.some((f) => f.severity === "NO-GO")
    ? "NO-GO"
    : flags.some((f) => f.severity === "CAUTION")
      ? "CAUTION"
      : "GO";

  return { overall, flags };
}