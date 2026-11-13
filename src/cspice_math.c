#include "cspice_math.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <math.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include "SpiceUsr.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct {
    const char *name;
    double lat;
    double lon;
    double alt_m;
} CandidateSite;

static const CandidateSite CANDIDATE_SITES[] = {
    {"Shackleton Rim",   -89.90,   0.00, 120.0},
    {"Connecting Ridge", -89.45, 222.60, 180.0},
    {"Malapert Massif",  -86.00,  -2.90, 450.0},
    {"Nobile Rim 1",     -85.20,  55.40, 210.0},
    {"Haworth",          -87.50, 355.00,  90.0}
};
static const int NUM_CANDIDATE_SITES = 5;
static bool is_spice_initialized = false;

static bool path_exists(const char *path) {
    return (access(path, F_OK) == 0);
}

int init_spice_engine(const char *custom_kernel_dir) {
    if (is_spice_initialized) return 0;

    erract_c("SET", 0, "RETURN");

    const char *base_dir = NULL;
    if (custom_kernel_dir && path_exists(custom_kernel_dir)) {
        base_dir = custom_kernel_dir;
    } else if (path_exists("data/kernels/naif0012.tls")) {
        base_dir = "data/kernels";
    } else if (path_exists("../data/kernels/naif0012.tls")) {
        base_dir = "../data/kernels";
    } else {
        return -1;
    }

    char path_tls[512], path_pck[512], path_bsp[512];
    snprintf(path_tls, sizeof(path_tls), "%s/naif0012.tls", base_dir);
    snprintf(path_pck, sizeof(path_pck), "%s/pck00010.tpc", base_dir);
    snprintf(path_bsp, sizeof(path_bsp), "%s/de440s.bsp", base_dir);

    furnsh_c(path_tls);
    furnsh_c(path_pck);
    furnsh_c(path_bsp);

    if (failed_c()) {
        reset_c();
        return -1;
    }

    is_spice_initialized = true;
    return 0;
}

// Gerçek LOLA DEM okunduysa true, sentetik yedek üretildiyse false döndürür
static bool load_or_generate_horizon_mask(double lat, double lon, bool use_dem, double mask[HORIZON_BINS]) {
    if (!use_dem) {
        for (int i = 0; i < HORIZON_BINS; i++) mask[i] = 0.0;
        return false;
    }

    const char *dem_path = NULL;
    if (path_exists("data/lola_southpole.bin")) {
        dem_path = "data/lola_southpole.bin";
    } else if (path_exists("../data/lola_southpole.bin")) {
        dem_path = "../data/lola_southpole.bin";
    }

    if (dem_path) {
        int fd = open(dem_path, O_RDONLY);
        if (fd >= 0) {
            struct stat st;
            if (fstat(fd, &st) == 0 && st.st_size >= (off_t)(HORIZON_BINS * sizeof(float))) {
                size_t file_size = (size_t)st.st_size;
                float *mapped = (float *)mmap(NULL, file_size, PROT_READ, MAP_PRIVATE, fd, 0);
                if (mapped != MAP_FAILED) {
                    size_t total_records = file_size / (HORIZON_BINS * sizeof(float));
                    size_t record_idx = 0;

                    if (total_records > 1) {
                        size_t grid_dim = (size_t)sqrt((double)total_records);
                        if (grid_dim > 0) {
                            double norm_lat = (lat + 90.0) / 10.0;
                            if (norm_lat < 0.0) norm_lat = 0.0;
                            if (norm_lat > 0.999) norm_lat = 0.999;

                            double norm_lon = fmod(lon < 0.0 ? lon + 360.0 : lon, 360.0) / 360.0;
                            size_t row = (size_t)(norm_lat * grid_dim);
                            size_t col = (size_t)(norm_lon * grid_dim);
                            record_idx = (row * grid_dim + col) % total_records;
                        }
                    }

                    const float *cell_ptr = mapped + (record_idx * HORIZON_BINS);
                    for (int i = 0; i < HORIZON_BINS; i++) {
                        mask[i] = (double)cell_ptr[i];
                    }

                    munmap(mapped, file_size);
                    close(fd);
                    return true; // Gerçek DEM yüklendi
                }
            }
            close(fd);
        }
    }

    // DEM dosyası yoksa sentetik krater profili üret
    double site_phase = (fabs(lat) * 1.7 + fabs(lon) * 0.05);
    double base_ridge = (fabs(lat) > 89.0) ? 1.8 : 2.6;

    for (int az = 0; az < HORIZON_BINS; az++) {
        double rad = az * (M_PI / 180.0);
        double crater_wall = 1.6 * sin(rad + site_phase) + 0.9 * cos(2.0 * rad - site_phase);
        double micro_relief = 0.4 * sin(5.0 * rad + lon);
        double val = base_ridge + crater_wall + micro_relief;
        mask[az] = (val < 0.2) ? 0.2 : val;
    }

    return false; // Sentetik fallback kullanıldı
}

static int simulate_single_site(
    const char *site_name,
    double lat,
    double lon,
    double altitude_m,
    SpiceDouble start_et,
    int total_steps,
    int step_seconds,
    bool use_dem_horizon,
    double min_sun_el_deg,
    double min_earth_el_deg,
    bool include_earth_disk,
    SiteSummary *out_summary,
    double out_mask[HORIZON_BINS],
    bool *out_used_real_dem,
    TimeSample *out_samples,
    VisibilityWindow **out_sun_windows,
    int *out_sun_win_count,
    VisibilityWindow **out_earth_windows,
    int *out_earth_win_count
) {
    strncpy(out_summary->site_name, site_name, sizeof(out_summary->site_name) - 1);
    out_summary->site_name[sizeof(out_summary->site_name) - 1] = '\0';
    out_summary->latitude_deg = lat;
    out_summary->longitude_deg = lon;
    out_summary->altitude_m = altitude_m;

    double local_mask[HORIZON_BINS];
    bool real_dem = load_or_generate_horizon_mask(lat, lon, use_dem_horizon, local_mask);
    if (out_used_real_dem) *out_used_real_dem = real_dem;
    if (out_mask) {
        memcpy(out_mask, local_mask, sizeof(local_mask));
    }

    double radius_km = 1737.4 + (altitude_m / 1000.0);
    SpiceDouble site_pos[3];
    latrec_c(radius_km, lon * rpd_c(), lat * rpd_c(), site_pos);

    double step_hours = (double)step_seconds / 3600.0;
    double total_duration_hours = total_steps * step_hours;

    int sun_vis_steps = 0;
    int earth_vis_steps = 0;
    int overlap_steps = 0;

    int cur_sun_streak = 0, max_sun_streak = 0;
    int cur_earth_streak = 0, max_earth_streak = 0;
    int cur_dark_streak = 0, max_dark_streak = 0;

    double sun_el_sum = 0.0;
    double earth_el_sum = 0.0;

    bool prev_sun_vis = false;
    bool prev_earth_vis = false;
    int sun_win_count = 0;
    int earth_win_count = 0;

    VisibilityWindow *sun_wins = NULL;
    VisibilityWindow *earth_wins = NULL;
    if (out_sun_windows && out_earth_windows) {
        size_t max_wins = (size_t)(total_steps / 2 + 2);
        sun_wins = (VisibilityWindow *)calloc(max_wins, sizeof(VisibilityWindow));
        earth_wins = (VisibilityWindow *)calloc(max_wins, sizeof(VisibilityWindow));
    }

    SpiceDouble sun_win_start_et = 0.0;
    SpiceDouble earth_win_start_et = 0.0;

    // [start_et, end_et) yarı-açık aralık: tam olarak total_steps adet dilim işlenir
    for (int s = 0; s < total_steps; s++) {
        SpiceDouble current_et = start_et + (s * (double)step_seconds);
        SpiceDouble azlsta[6], lt;

        azlcpo_c("ELLIPSOID", "SUN", current_et, "LT+S", SPICEFALSE, SPICETRUE,
                 site_pos, "MOON", "IAU_MOON", azlsta, &lt);
        double sun_az = azlsta[1] * dpr_c();
        double sun_el = azlsta[2] * dpr_c();
        if (sun_az < 0.0) sun_az += 360.0;

        azlcpo_c("ELLIPSOID", "EARTH", current_et, "LT+S", SPICEFALSE, SPICETRUE,
                 site_pos, "MOON", "IAU_MOON", azlsta, &lt);
        double earth_range_km = azlsta[0];
        double earth_az = azlsta[1] * dpr_c();
        double earth_el = azlsta[2] * dpr_c();
        if (earth_az < 0.0) earth_az += 360.0;

        if (failed_c()) {
            reset_c();
            free(sun_wins);
            free(earth_wins);
            return -1;
        }

        double earth_disk_bonus_deg = 0.0;
        if (include_earth_disk && earth_range_km > 6378.137) {
            earth_disk_bonus_deg = asin(6378.137 / earth_range_km) * dpr_c();
        }

        int sun_bin = ((int)floor(sun_az)) % HORIZON_BINS;
        if (sun_bin < 0) sun_bin += HORIZON_BINS;

        int earth_bin = ((int)floor(earth_az)) % HORIZON_BINS;
        if (earth_bin < 0) earth_bin += HORIZON_BINS;

        double sun_terrain_deg = local_mask[sun_bin];
        double earth_terrain_deg = local_mask[earth_bin];

        double effective_sun_limit = fmax(sun_terrain_deg, min_sun_el_deg);
        double effective_earth_limit = fmax(earth_terrain_deg, min_earth_el_deg);

        bool is_sun_vis = (sun_el > effective_sun_limit);
        bool is_earth_vis = ((earth_el + earth_disk_bonus_deg) > effective_earth_limit);

        if (is_sun_vis) {
            sun_vis_steps++;
            cur_sun_streak++;
            if (cur_sun_streak > max_sun_streak) max_sun_streak = cur_sun_streak;
            cur_dark_streak = 0;

            if (!prev_sun_vis) {
                sun_win_start_et = current_et;
            }
        } else {
            cur_dark_streak++;
            if (cur_dark_streak > max_dark_streak) max_dark_streak = cur_dark_streak;
            cur_sun_streak = 0;

            if (prev_sun_vis && sun_wins) {
                et2utc_c(sun_win_start_et, "ISOC", 0, sizeof(sun_wins[sun_win_count].start_utc), sun_wins[sun_win_count].start_utc);
                et2utc_c(current_et, "ISOC", 0, sizeof(sun_wins[sun_win_count].end_utc), sun_wins[sun_win_count].end_utc);
                sun_wins[sun_win_count].duration_hours = (current_et - sun_win_start_et) / 3600.0;
                sun_win_count++;
            }
        }
        prev_sun_vis = is_sun_vis;

        if (is_earth_vis) {
            earth_vis_steps++;
            cur_earth_streak++;
            if (cur_earth_streak > max_earth_streak) max_earth_streak = cur_earth_streak;

            if (!prev_earth_vis) {
                earth_win_start_et = current_et;
            }
        } else {
            cur_earth_streak = 0;
            if (prev_earth_vis && earth_wins) {
                et2utc_c(earth_win_start_et, "ISOC", 0, sizeof(earth_wins[earth_win_count].start_utc), earth_wins[earth_win_count].start_utc);
                et2utc_c(current_et, "ISOC", 0, sizeof(earth_wins[earth_win_count].end_utc), earth_wins[earth_win_count].end_utc);
                earth_wins[earth_win_count].duration_hours = (current_et - earth_win_start_et) / 3600.0;
                earth_win_count++;
            } else if (prev_earth_vis) {
                earth_win_count++;
            }
        }
        prev_earth_vis = is_earth_vis;

        if (is_sun_vis && is_earth_vis) {
            overlap_steps++;
        }

        sun_el_sum += sun_el;
        earth_el_sum += earth_el;

        if (out_samples != NULL) {
            out_samples[s].step_index = s;
            et2utc_c(current_et, "ISOC", 0, sizeof(out_samples[s].utc), out_samples[s].utc);
            out_samples[s].et_seconds = current_et;
            out_samples[s].sun_azimuth_deg = sun_az;
            out_samples[s].sun_elevation_deg = sun_el;
            out_samples[s].earth_azimuth_deg = earth_az;
            out_samples[s].earth_elevation_deg = earth_el;
            out_samples[s].sun_terrain_horizon_deg = sun_terrain_deg;
            out_samples[s].earth_terrain_horizon_deg = earth_terrain_deg;
            out_samples[s].is_sun_visible = is_sun_vis;
            out_samples[s].is_earth_visible = is_earth_vis;
        }
    }

    // Tam bitiş anı (end_utc) pencereyi asla aşmaz
    SpiceDouble exact_end_et = start_et + (total_steps * (double)step_seconds);
    if (prev_sun_vis && sun_wins) {
        et2utc_c(sun_win_start_et, "ISOC", 0, sizeof(sun_wins[sun_win_count].start_utc), sun_wins[sun_win_count].start_utc);
        et2utc_c(exact_end_et, "ISOC", 0, sizeof(sun_wins[sun_win_count].end_utc), sun_wins[sun_win_count].end_utc);
        sun_wins[sun_win_count].duration_hours = (exact_end_et - sun_win_start_et) / 3600.0;
        sun_win_count++;
    }
    if (prev_earth_vis) {
        if (earth_wins) {
            et2utc_c(earth_win_start_et, "ISOC", 0, sizeof(earth_wins[earth_win_count].start_utc), earth_wins[earth_win_count].start_utc);
            et2utc_c(exact_end_et, "ISOC", 0, sizeof(earth_wins[earth_win_count].end_utc), earth_wins[earth_win_count].end_utc);
            earth_wins[earth_win_count].duration_hours = (exact_end_et - earth_win_start_et) / 3600.0;
        }
        earth_win_count++;
    }

    if (out_sun_windows && out_sun_win_count) {
        *out_sun_windows = sun_wins;
        *out_sun_win_count = sun_win_count;
    }
    if (out_earth_windows && out_earth_win_count) {
        *out_earth_windows = earth_wins;
        *out_earth_win_count = earth_win_count;
    }

    out_summary->total_sun_hours = sun_vis_steps * step_hours;
    out_summary->illumination_percent = ((double)sun_vis_steps / total_steps) * 100.0;
    out_summary->longest_sun_hours = max_sun_streak * step_hours;

    out_summary->total_earth_hours = earth_vis_steps * step_hours;
    out_summary->earth_visibility_percent = ((double)earth_vis_steps / total_steps) * 100.0;
    out_summary->longest_earth_hours = max_earth_streak * step_hours;
    out_summary->dte_window_count = earth_win_count;

    out_summary->overlap_hours = overlap_steps * step_hours;
    out_summary->longest_dark_hours = max_dark_streak * step_hours;
    out_summary->avg_sun_elevation_deg = sun_el_sum / total_steps;
    out_summary->avg_earth_elevation_deg = earth_el_sum / total_steps;

    double illum_score = out_summary->illumination_percent * 0.50;
    double earth_score = out_summary->earth_visibility_percent * 0.30;
    double dark_ratio = (total_duration_hours > 0.0) ? (out_summary->longest_dark_hours / total_duration_hours) : 0.0;
    double dark_score = (1.0 - dark_ratio) * 20.0;

    int raw_score = (int)round(illum_score + earth_score + dark_score);
    if (raw_score > 100) raw_score = 100;
    if (raw_score < 0) raw_score = 0;
    out_summary->mission_score = raw_score;

    return 0;
}

SimulationResult run_lunar_simulation(
    const char *site_name,
    double lat_deg,
    double lon_deg,
    double altitude_m,
    bool use_custom_coords,
    const char *start_utc,
    const char *end_utc,
    int step_seconds,
    bool use_dem_horizon,
    double min_sun_el_deg,
    double min_earth_el_deg,
    bool include_earth_disk
) {
    SimulationResult res;
    memset(&res, 0, sizeof(SimulationResult));

    if (init_spice_engine(NULL) != 0) {
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg), "NASA SPICE kernelleri yüklenemedi.");
        return res;
    }

    if (step_seconds < 60) step_seconds = 3600;
    res.step_seconds = step_seconds;

    SpiceDouble start_et, end_et;
    str2et_c(start_utc, &start_et);
    if (failed_c()) {
        getmsg_c("SHORT", sizeof(res.error_msg), res.error_msg);
        reset_c();
        res.status = -1;
        return res;
    }

    if (end_utc && strlen(end_utc) > 0) {
        str2et_c(end_utc, &end_et);
        if (failed_c() || end_et <= start_et) {
            reset_c();
            end_et = start_et + (14.0 * 86400.0);
        }
    } else {
        end_et = start_et + (14.0 * 86400.0);
    }

    // DÜZELTME: +1 kaldırıldı; 336 saat / 1 saat = tam 336 adım
    int total_steps = (int)floor((end_et - start_et) / (double)step_seconds);
    if (total_steps < 1) total_steps = 1;
    if (total_steps > MAX_SIMULATION_STEPS) {
        total_steps = MAX_SIMULATION_STEPS;
        snprintf(res.warning_msg, sizeof(res.warning_msg),
                 "Zaman aralığı maksimum adım sınırına (%d örnek) kırpıldı.", MAX_SIMULATION_STEPS);
    }

    double target_lat = lat_deg;
    double target_lon = lon_deg;
    double target_alt = altitude_m;
    const char *resolved_name = (site_name && strlen(site_name) > 0) ? site_name : "Custom Site";

    // Yalnızca özel koordinat verilmemişse aday saha tablosundan koordinat çek
    if (!use_custom_coords) {
        for (int i = 0; i < NUM_CANDIDATE_SITES; i++) {
            if (strcasecmp(resolved_name, CANDIDATE_SITES[i].name) == 0) {
                target_lat = CANDIDATE_SITES[i].lat;
                target_lon = CANDIDATE_SITES[i].lon;
                if (target_alt == 0.0) target_alt = CANDIDATE_SITES[i].alt_m;
                break;
            }
        }
    }

    if (use_dem_horizon && (target_lat < -90.0 || target_lat > -80.0)) {
        res.dem_out_of_bounds = true;
        snprintf(res.warning_msg, sizeof(res.warning_msg),
                 "UYARI: Seçilen koordinat (%.2f°) Güney Kutbu DEM kapsama alanı (-80°..-90°) dışında.",
                 target_lat);
    }

    res.samples = (TimeSample *)calloc((size_t)total_steps, sizeof(TimeSample));
    if (!res.samples) {
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg), "Bellek tahsis hatası.");
        return res;
    }
    res.total_steps = total_steps;

    if (simulate_single_site(
            resolved_name, target_lat, target_lon, target_alt,
            start_et, total_steps, step_seconds,
            use_dem_horizon, min_sun_el_deg, min_earth_el_deg, include_earth_disk,
            &res.summary, res.terrain_horizon_mask, &res.using_real_dem, res.samples,
            &res.sun_windows, &res.sun_window_count,
            &res.earth_windows, &res.earth_window_count) != 0) {
        free_simulation_result(&res);
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg), "SPICE hesaplama hatası.");
        return res;
    }

    if (use_dem_horizon && !res.using_real_dem && strlen(res.warning_msg) == 0) {
        snprintf(res.warning_msg, sizeof(res.warning_msg),
                 "BİLGİ: data/lola_southpole.bin bulunamadı; analitik sentetik ufuk profili kullanıldı.");
    }

    res.comparison_count = NUM_CANDIDATE_SITES;
    for (int i = 0; i < NUM_CANDIDATE_SITES; i++) {
        simulate_single_site(
            CANDIDATE_SITES[i].name, CANDIDATE_SITES[i].lat, CANDIDATE_SITES[i].lon, CANDIDATE_SITES[i].alt_m,
            start_et, total_steps, step_seconds,
            use_dem_horizon, min_sun_el_deg, min_earth_el_deg, include_earth_disk,
            &res.comparisons[i], NULL, NULL, NULL, NULL, NULL, NULL, NULL
        );
    }

    res.status = 0;
    return res;
}

void free_simulation_result(SimulationResult *res) {
    if (!res) return;
    free(res->samples);
    free(res->sun_windows);
    free(res->earth_windows);
    res->samples = NULL;
    res->sun_windows = NULL;
    res->earth_windows = NULL;
    res->total_steps = 0;
}