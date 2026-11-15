/*
 * 3B SAHNE ŞEMASI — TEK KAYNAK
 *
 * Bu header, data/3b_scene.json ve data/3b_scene.js dosyalarının şemasıdır.
 * Frontend yeni 3B alanı uyduramaz; alan eklenecekse burası + backend + UI birlikte güncellenir.
 *
 * Birimler:
 *   pos_km / pos_moon_km               : km, IAU_MOON çerçevesi
 *   helio_pos_km                       : km, analitik Kepler yaklaşımı
 *   vel_kms                            : km/s, IAU_MOON
 *   altitude_km                        : km, yerel sentetik zemine göre AGL
 *   altitude_m                         : metre, AGL
 *   gravity_ms2 / thrust_ms2           : m/s²
 *   açı alanları                       : derece
 *
 * 2D görev planı ayrı modeldir: data/output.json ve ui-starter/src/types/mission.ts.
 * Kurallar: AGENTS.md, docs/FRONTEND_GUIDE.md.
 */
#ifndef MOON_3B_H
#define MOON_3B_H

#include <stdbool.h>
#include <stddef.h>

#define MOON3B_MAX_SITES       8
#define MOON3B_TRAJ_POINTS     96
#define MOON3B_LANDING_SECONDS 60
#define MOON3B_MAX_BODIES      48

// Sürekli Zaman Durum Makinesi Modları
#define MISSION_MODE_ORBIT     0
#define MISSION_MODE_DESCENT   1
#define MISSION_MODE_LANDED    2

typedef struct {
    char name[64];
    double lat_deg;
    double lon_deg;
    double altitude_m;          // ortalama Ay yarıçapına göre mutlak zemin yüksekliği
    bool altitude_is_lola;      // true: LOLA 80 m zemin; false: sentetik DEM
    double slope_deg;           // her zaman sentetik DEM'den
    double sun_el_deg;
    double earth_el_deg;
    bool is_custom;
} LunarSite3B;

typedef struct {
    int naif_id;
    char name[48];
    char category[24];          // "STAR", "PLANET", "MOON", "ASTEROID", "NEO"
    char orbit_parent[16];      // "NONE", "SUN", "EARTH"
    bool from_spice_kernel;
    double pos_moon_km[3];      // Ay merkezli konum (km, IAU_MOON)
    double helio_pos_km[3];     // Güneş merkezli analitik Kepler konumu (km)
    double distance_km;         // Ay'a uzaklık (km)
    double radius_km;           // Gerçek fiziksel yarıçap (km)
    double semi_major_axis_km;  // Yörünge yarı-büyük ekseni (km)
    double eccentricity;        // Yörünge basıklığı
    double inclination_deg;     // Yörünge eğikliği (°)
    double phase_deg;           // Ortalama anomali / faz açısı (°)
    double period_days;         // Yörünge periyodu (gün)
    double orbital_speed_kms;   // Anlık yörünge hızı (km/s)
    char color_hex[12];
} SpiceBody3B;

typedef struct {
    int mission_mode;                 // 0: ORBIT, 1: DESCENT, 2: LANDED
    double sim_elapsed_sec;           // Başlangıç UTC'den itibaren geçen sürekli zaman (sn)
    double burn_elapsed_sec;          // İniş manevrası başladıysa geçen uçuş süresi (sn)
    double lat_deg;
    double lon_deg;
    double altitude_km;               // yerel sentetik zemine göre AGL (km)
    double initial_speed_kms;         // Seçilen başlangıç hızı (km/s)
    double current_speed_kms;         // O anki anlık hız büyüklüğü (km/s)
    double pos_km[3];                 // O anki Ay merkezli X, Y, Z (km)
    double vel_kms[3];                // O anki hız vektörü (km/s)
    double gravity_ms2;               // O anki toplam Ay+J2+Dünya+Güneş çekim ivmesi (m/s^2)
    double thrust_ms2;                // O anki motor itki ivmesi (m/s^2)
    double nominal_orbital_speed_kms; // O irtifada ideal dairesel yörünge hızı (km/s)
    double escape_speed_kms;          // Ay'dan kaçış hızı (km/s)
    double orbital_period_sec;        // Yörünge periyodu (sn)
    double deorbit_dv_ms;             // İniş rotasına girmek için gereken Delta-V (m/s)
    double transfer_time_sec;         // İniş noktasına toplam uçuş süresi (sn)

    // 3B Küre Yönelim & Ferman'ın UI'ı İçin Hazır Referans Vektörleri (Birim Vektörler)
    double yaw_deg;
    double pitch_deg;
    double roll_deg;
    double qibla_vec[3];
    double prograde_vec[3];
    double nadir_vec[3];
    double solar_vec[3];
    double earth_dte_vec[3];
    double commanded_vec[3];
    double qibla_azimuth_deg;
    double qibla_elevation_deg;
    double commanded_azimuth_deg;
    double commanded_elevation_deg;
    double alignment_error_deg;
    bool is_qibla_aligned;
} Spacecraft3B;

typedef struct {
    int step;
    double t_sec;
    double pos_km[3];
    double vel_kms[3];
    double speed_kms;
    double altitude_km;
    double gravity_ms2;
    double thrust_ms2;
} TrajectoryPoint3B;

typedef struct {
    int offset_sec;
    char utc[32];
    char phase[24];
    double altitude_m;
    double vertical_speed_ms;
    double sun_el_deg;
    double sun_disk_illuminated_pct;  // diskin geometrik aydinlanma orani; ufuk gorunurlugu degildir
    double earth_el_deg;
    bool dte_connected;
    bool sun_visible;                 // ufuk maskesine gore gercek gorunurluk
    double surface_temp_k;
} LandingSecondSample;

typedef struct {
    bool success;              // kinematik hedefe yaklaşma; fiziksel doğrulama değil
    char status_label[48];
    char model[48];
    bool physics_valid;        // her zaman false
    char touchdown_utc[32];
    double flight_duration_sec;
    double miss_distance_m;              // sabitleme oncesi gudum sapmasi
    bool trajectory_snapped_to_target;   // gorsellestirme icin son nokta hedefe sabitlendi
    double touchdown_speed_ms;
    double total_dv_used_ms;
    double sun_disk_illuminated_pct;
    bool sun_visible;
    double earth_el_deg;
    bool dte_connected;
    double surface_temp_k;
} TouchdownReport3B;

typedef struct {
    int scenario_id;
    int mission_mode;
    double sim_elapsed_sec;
    char scene_model[48];
    bool physics_valid;
    char frame[24];             // sun/earth/spacecraft/trajectory/sites: "IAU_MOON"
    char ephemeris_source[32];  // "CSPICE_DE440S_IAU_MOON" veya "ANALYTIC_MEEUS_FALLBACK"
    char helio_model[32];       // helio_km alanlari icin "ANALYTIC_KEPLER"
    char trajectory_phase[32];  // "POST_BURN_DESCENT": trajectory uzay aracinin anlik orbit hizindan farklidir
    bool terrain_is_synthetic;  // zemin yuksekligi ve egim her zaman sentetik
    char base_utc[32];
    char active_utc[32];
    char landing_utc[32];
    int range_days;

    double sun_vec[3];
    double sun_sub_lat_deg;
    double sun_sub_lon_deg;
    double earth_vec[3];
    double earth_sub_lat_deg;
    double earth_sub_lon_deg;

    double sun_helio_km[3];
    double earth_helio_km[3];
    double moon_helio_km[3];

    // Ufuk maskesi (2D cekirdekle ayni kaynak) ve secili sahada anlik gorunurluk
    double horizon_mask_deg[360];
    char horizon_source[32];
    bool sun_visible;
    bool earth_visible;
    double sun_horizon_deg;
    double earth_horizon_deg;

    int body_count;
    SpiceBody3B bodies[MOON3B_MAX_BODIES];

    int site_count;
    LunarSite3B sites[MOON3B_MAX_SITES];
    LunarSite3B selected_site;

    Spacecraft3B spacecraft;
    int traj_count;
    TrajectoryPoint3B trajectory[MOON3B_TRAJ_POINTS];

    int landing_sample_count;
    LandingSecondSample landing_samples[MOON3B_LANDING_SECONDS];

    TouchdownReport3B touchdown_report;
} Moon3BScene;

void compute_3b_moon_scene(
    Moon3BScene *out,
    int scenario_id,
    int mission_mode,
    double sim_elapsed_sec,
    double burn_elapsed_sec,
    const char *base_utc,
    int range_days,
    double sc_lat,
    double sc_lon,
    double sc_alt_km,
    double sc_speed_kms,
    const char *target_name,
    double target_lat,
    double target_lon,
    bool target_is_custom,
    double cmd_vx,
    double cmd_vy,
    double cmd_vz
);

bool export_3b_scene_json(const char *json_path, const char *js_path, const Moon3BScene *scene);
/* 3B sahneyi JSON olarak bellek tamponuna yazar; cagiran free() ile serbest birakir. */
char *export_3b_scene_json_string(const Moon3BScene *scene);

#endif // MOON_3B_H