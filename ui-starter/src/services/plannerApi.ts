// ui-starter/src/services/plannerApi.ts
// AstroApex HTTP API İstemcisi & Çevrimdışı Yedekleme Katmanı
//
// KURAL: Fizik burada hesaplanmaz. Backend'in döndürdüğü alanlar olduğu gibi kullanılır.
// Mevcut C sunucusu yalnızca GET query parametrelerini okur; POST gövdesini parse etmez.
// Bu yüzden canlı istek GET ile yapılır. Backend POST desteği eklenirse burası güncellenir.
// Sözleşme: AGENTS.md, docs/FRONTEND_GUIDE.md.

import {
  DEFAULT_SIMULATION_REQUEST,
  SimulationRequest,
  SimulationResponse,
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

/*
 * KARAR ÜRETİMİ YOKTUR. GO/CAUTION/NO-GO, skor ve risk bayrakları yalnızca backend
 * (data.output.json -> decision.*) alanlarından okunur. Frontend'te eşik/karar
 * hesaplanmaz; bkz. AGENTS.md ve docs/FRONTEND_GUIDE.md.
 */