/*
 * 2D GÖREV PLANI ŞEMASI — SADECE BACKEND
 *
 * data/output.json dosyasının C tarafındaki yapıları. Frontend bu header'ı kopyalayıp
 * kendi fizik modelini kurmaz; TypeScript sözleşmesi ui-starter/src/types/mission.ts dosyasıdır.
 *
 * Birimler alan adlarında belirtilir: _deg, _hours, _m, _km, _ms2, _sec.
 * Yeni alan ekleme/çıkarma backend + frontend birlikte yapılır.
 * Kurallar: AGENTS.md, docs/FRONTEND_GUIDE.md.
 */
#ifndef CSPICE_MATH_H
#define CSPICE_MATH_H

#include <stdbool.h>
#include <stddef.h>

#define CSPICE_HORIZON_RAYS      360
#define CSPICE_MAX_TIMELINE_HRS  720   // Maksimum 30 gün (720 saat)
#define CSPICE_GRID_N            21    // 21x21 = 441 nokta (5 km x 5 km, 250 m adım)
#define CSPICE_MAX_WAYPOINTS     48
#define CSPICE_MAX_WINDOWS       64
#define CSPICE_MAX_CANDIDATES    8

typedef struct {
    char start_utc[32];
    char end_utc[32];
    double duration_hours;
} VisibilityWindow;

typedef struct {
    char site_name[64];
    double latitude_deg;
    double longitude_deg;
    double altitude_m;
    double slope_deg;
    double illumination_percent;
    double earth_visibility_percent;
    double total_sun_hours;
    double longest_sun_hours;
    double total_earth_hours;
    double longest_earth_hours;
    int dte_window_count;
    double overlap_hours;
    double longest_dark_hours;
    double min_battery_soc_pct;
    int mission_score;
    char verdict[16];
} CandidateComparison;

typedef struct {
    // 1. Girdi & Meta Parametreleri
    char site_name[64];
    char utc_start[32];
    char utc_end[32];
    int step_seconds;
    double lat_deg;
    double lon_deg;
    int duration_days;
    bool dem_out_of_bounds;
    char dem_name[64];
    char horizon_source[32];      // "LOLA_80M_SKYLINE" veya "SYNTHETIC_ANALYTIC"
    bool ephemeris_from_spice;    // false ise analitik (Meeus) yedek efemeris kullanildi
    char warning_msg[192];

    // 2. Temel Fizik & Arazi Metrikleri
    double altitude_m;
    double slope_deg;
    double aspect_deg;
    double surface_temp_k;
    double ice_probability_pct;

    // 3. Güneş Diski, DTE & Enerji Simülasyonu (Summary KPI)
    double total_sun_hours;
    double sun_illumination_pct;
    double longest_sun_hours;
    double total_earth_hours;
    double earth_dte_pct;
    double longest_earth_hours;
    double sun_earth_overlap_hours;
    double terrain_loss_pct;
    double longest_dark_hours;
    double min_battery_soc_pct;

    // 4. Kesintisiz Pencereler (Güneş & Dünya DTE)
    int sun_window_count;
    VisibilityWindow sun_windows[CSPICE_MAX_WINDOWS];
    int earth_window_count;
    VisibilityWindow earth_windows[CSPICE_MAX_WINDOWS];

    // 5. 360° Ufuk Maskesi & Engel Kimliği
    double horizon_mask_deg[CSPICE_HORIZON_RAYS];
    double blocker_azimuth_deg;
    double blocker_distance_km;
    bool blocker_distance_known;   // LOLA profilinde mesafe yoktur; JSON'da null yazilir
    double blocker_elevation_deg;

    // 6. 5x5 km Mikro-Konum Optimizasyonu ("İki Adım Yana Kay")
    bool has_micro_fix;
    double fix_lat_deg;
    double fix_lon_deg;
    double fix_shift_km;
    char fix_direction_tr[32];
    double fix_sun_pct;
    double fix_dark_hours;
    char fix_verdict[16];

    // 7. ±30 Gün En İyi Tarih Penceresi
    int best_date_offset_days;
    double best_date_dark_hours;
    double darkness_saved_hours;

    // 8. A* Gezgin (Rover) Su Buzu (PSR) Rotası
    bool rover_ice_reachable;
    double rover_target_lat;
    double rover_target_lon;
    double rover_distance_km;
    double rover_max_slope_deg;
    double rover_energy_wh;
    int rover_waypoint_count;
    double rover_waypoints_lat[CSPICE_MAX_WAYPOINTS];
    double rover_waypoints_lon[CSPICE_MAX_WAYPOINTS];

    // 9. Kök-Neden Karar Motoru & Qwen3-0.5B Fişi
    int mission_score;
    char verdict[16];
    char primary_blocker_code[48];
    char human_reason_tr[384];
    char qwen_05b_prompt_facts[1536];

    // 10. Aday Saha Karşılaştırma Tablosu
    int candidate_count;
    CandidateComparison candidates[CSPICE_MAX_CANDIDATES];

    // 11. Dinamik Zaman Serileri
    int timeline_count;
    double *timeline_sun_az;
    double *timeline_sun_el;
    double *timeline_sun_frac;
    double *timeline_earth_az;
    double *timeline_earth_el;
    double *timeline_dte_vis;
    double *timeline_soc_pct;

    // 12. Gunes/Dunya Ufuk Gecisleri (sunset/earthset, sunrise/earthrise)
    bool sun_visible_now;
    bool earth_visible_now;
    char next_sunset_utc[32];
    char next_sunrise_utc[32];
    double hours_to_sunset;    // -1 ise aralikta olay yok
    double hours_to_sunrise;   // -1 ise aralikta olay yok
    char next_earthset_utc[32];
    char next_earthrise_utc[32];
    double hours_to_earthset;  // -1 ise aralikta olay yok
    double hours_to_earthrise; // -1 ise aralikta olay yok
    bool event_search_exhausted;
} SimulationResult;

bool init_spice_engine(const char *meta_kernel_path);
/* DIKKAT: Adina ragmen bu fonksiyon gercek LOLA verisi OKUMAZ; sentetik analitik arazi dondurur.
   Gercek LOLA ufuk profilleri yalnizca src/lola_horizons.h icindeki uc saha merkezi icin vardir. */
double sample_synthetic_dem_elevation_m(double lat_deg, double lon_deg);

/* Saha merkezi gercek LOLA profilinde ise LOLA zemin yuksekligini (m) yazar ve true doner.
   Aksi halde false doner; cagiran taraf sentetik DEM'e duser. */
bool lunar_lola_ground_altitude_m(double lat_deg, double lon_deg, double *alt_m);

/* 360 derecelik ufuk maskesini hesaplar (her derece icin ufuk yukseklik acisi).
   Gercek LOLA profili varsa onu, yoksa sentetik arazi kullanir. 2D ve 3B ortak fonksiyonudur. */
void lunar_compute_horizon_mask(double lat_deg, double lon_deg, double alt_m,
                                double mask_out[CSPICE_HORIZON_RAYS], char *horizon_source, size_t src_sz);

/* UTC (ISO-8601) -> J2000'den itibaren ET/TDB saniyesi. */
double lunar_utc_to_et(const char *utc);
/* Gunes ve Dunya'nin Ay merkezli, Ay'a sabit (govde) cercevedeki konumu (km).
   Kernel yukluyse CSPICE (IAU_MOON, LT+S) kullanir ve true doner; degilse tarihe bagli
   analitik Meeus serisine duser ve false doner. */
bool lunar_moonfixed_sun_earth_km(double et, double sun_km[3], double earth_km[3]);
SimulationResult *run_lunar_simulation(
    const char *site_name,
    double lat_deg,
    double lon_deg,
    const char *utc_start,
    int duration_days
);
void free_simulation_result(SimulationResult *res);
bool export_simulation_json(const char *filepath, const SimulationResult *res);
/* JSON'u bellek tamponuna yazar; cagiran free() ile serbest birakir. NULL ise hata. */
char *export_simulation_json_string(const SimulationResult *res);

#endif // CSPICE_MATH_H