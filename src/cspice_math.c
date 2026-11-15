/*
 * 2D FİZİK / EFEMERİS ÇEKİRDEĞİ — SADECE BACKEND
 *
 * CSPICE kernel yükleme, Güneş/Dünya görünürlüğü, arazi ufku, pencereler ve
 * 2D görev JSON'unun (data/output.json) üretimi burada yapılır.
 *
 * KURAL:
 *   - JavaScript/TypeScript'te bu hesapların kopyasını yazma.
 *   - UI hatası için fizik sabiti, kernel yolu veya skor eşiği değiştirme.
 *   - Yeni 2D alanı gerekiyorsa ui-starter/src/types/mission.ts ile birlikte güncelle.
 * Ayrıntı: AGENTS.md ve docs/FRONTEND_GUIDE.md.
 */
#define _POSIX_C_SOURCE 200809L
#include "cspice_math.h"
#include "lola_horizons.h"
#include <dirent.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#if defined(__has_include) && __has_include("SpiceUsr.h")
#define HAS_NAIF_CSPICE 1
#include "SpiceUsr.h"
#else
#define HAS_NAIF_CSPICE 0
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define R_MOON_KM         1737.4
#define SOLAR_RADIUS_DEG  0.2666   // Güneş açısal yarıçapı (~0.533° disk çapı)
#define METERS_PER_DEG    30323.35 // Ay yüzeyinde 1 derece yay (metre)

static bool g_spice_loaded = false;

#if HAS_NAIF_CSPICE
static bool has_spice_ext(const char *name) {
    const char *dot = strrchr(name, '.');
    if (!dot) return false;
    return (strcmp(dot, ".tls") == 0 ||
            strcmp(dot, ".bsp") == 0 ||
            strcmp(dot, ".tpc") == 0 ||
            strcmp(dot, ".tf")  == 0 ||
            strcmp(dot, ".bpc") == 0);
}

static int autoload_kernels_dir(const char *dir_path, int depth) {
    DIR *dir = opendir(dir_path);
    if (!dir) return 0;

    int loaded = 0;
    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL) {
        if (ent->d_name[0] == '.') continue;
        char full[512];
        snprintf(full, sizeof(full), "%s/%s", dir_path, ent->d_name);

        struct stat st;
        if (stat(full, &st) != 0) continue;

        if (S_ISDIR(st.st_mode) && depth < 2) {
            loaded += autoload_kernels_dir(full, depth + 1);
        } else if (S_ISREG(st.st_mode) && has_spice_ext(ent->d_name)) {
            furnsh_c(full);
            if (!failed_c()) {
                loaded++;
            } else {
                reset_c();
            }
        }
    }
    closedir(dir);
    return loaded;
}

#endif

static bool g_ephem_from_spice = false;

/* UTC (ISO-8601) -> J2000'den itibaren ET/TDB saniyesi. Leapsecond kernel'i yukluyse SPICE,
   degilse takvim donusumu (TT - UTC = 69.184 s, 2017'den beri gecerli) kullanilir. */
double lunar_utc_to_et(const char *utc) {
#if HAS_NAIF_CSPICE
    if (g_spice_loaded && utc && utc[0] != '\0') {
        SpiceBoolean has_lsk = SPICEFALSE;
        SpiceInt n = 0;
        SpiceChar dtype[4];
        dtpool_c("DELTET/DELTA_AT", &has_lsk, &n, dtype);
        if (failed_c()) {
            reset_c();
            has_lsk = SPICEFALSE;
        }
        if (has_lsk) {
            double et = 0.0;
            str2et_c(utc, &et);
            if (!failed_c()) return et;
            reset_c();
        }
    }
#endif
    int y = 2026, mo = 10, d = 29, h = 14, mi = 30, s = 0;
    if (utc) sscanf(utc, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s);
    int a = (14 - mo) / 12;
    int y2 = y + 4800 - a;
    int m2 = mo + 12 * a - 3;
    long jdn = d + (153 * m2 + 2) / 5 + 365L * y2 + y2 / 4 - y2 / 100 + y2 / 400 - 32045;
    double jd = (double)jdn + (h - 12.0) / 24.0 + mi / 1440.0 + s / 86400.0;
    return (jd - 2451545.0) * 86400.0 + 69.184;
}

static inline double wrap_lon_deg(double lon) {
    double x = fmod(lon + 180.0, 360.0);
    if (x < 0.0) x += 360.0;
    return x - 180.0;
}

static inline double clamp_d(double v, double lo, double hi) {
    if (!isfinite(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
}

static inline double deg2rad(double d) { return d * (M_PI / 180.0); }
static inline double rad2deg(double r) { return r * (180.0 / M_PI); }

/* ---- Analitik yedek efemeris (CSPICE yoksa) -------------------------------------------------
   Meeus, "Astronomical Algorithms" 2. baski: Bolum 25 (Gunes), 47 (Ay, ana terimler) ve
   53 (optik librasyon / selenografik alt-Gunes noktasi). Fiziksel librasyon ihmal edilir.
   JPL Horizons ile dogrulanmis degerlerden sapma ~0.03 derece mertebesindedir. */
typedef struct { signed char d, m, mp, f; double c; } MoonTerm;

static const MoonTerm MOON_LON_TERMS[] = {
    {0, 0, 1, 0, 6.288774}, {2, 0, -1, 0, 1.274027}, {2, 0, 0, 0, 0.658314}, {0, 0, 2, 0, 0.213618},
    {0, 1, 0, 0, -0.185116}, {0, 0, 0, 2, -0.114332}, {2, 0, -2, 0, 0.058793}, {2, -1, -1, 0, 0.057066},
    {2, 0, 1, 0, 0.053322}, {2, -1, 0, 0, 0.045758}, {0, 1, -1, 0, -0.040923}, {1, 0, 0, 0, -0.034720},
    {0, 1, 1, 0, -0.030383}, {2, 0, 0, -2, 0.015327}, {0, 0, 1, 2, -0.012528}, {0, 0, 1, -2, 0.010980},
    {4, 0, -1, 0, 0.010675}, {0, 0, 3, 0, 0.010034}, {4, 0, -2, 0, 0.008548}, {2, 1, -1, 0, -0.007888},
    {2, 1, 0, 0, -0.006766}, {1, 0, -1, 0, -0.005163}, {1, 1, 0, 0, 0.004987}, {2, -1, 1, 0, 0.004036},
    {2, 0, 2, 0, 0.003994}
};
static const MoonTerm MOON_LAT_TERMS[] = {
    {0, 0, 0, 1, 5.128122}, {0, 0, 1, 1, 0.280602}, {0, 0, 1, -1, 0.277693}, {2, 0, 0, -1, 0.173237},
    {2, 0, -1, 1, 0.055413}, {2, 0, -1, -1, 0.046271}, {2, 0, 0, 1, 0.032573}, {0, 0, 2, 1, 0.017198},
    {2, 0, 1, -1, 0.009266}, {0, 0, 2, -1, 0.008822}, {2, -1, 0, -1, 0.008216}, {2, 0, -2, -1, 0.004324},
    {2, 0, 1, 1, 0.004200}
};
static const MoonTerm MOON_DIST_TERMS[] = {
    {0, 0, 1, 0, -20905.355}, {2, 0, -1, 0, -3699.111}, {2, 0, 0, 0, -2955.968}, {0, 0, 2, 0, -569.925},
    {0, 1, 0, 0, 48.888}, {0, 0, 0, 2, -3.149}, {2, 0, -2, 0, 246.158}, {2, -1, -1, 0, -152.138},
    {2, 0, 1, 0, -170.733}, {2, -1, 0, 0, -204.586}, {0, 1, -1, 0, -129.620}, {1, 0, 0, 0, 108.743},
    {0, 1, 1, 0, 104.755}
};

static double moon_series(const MoonTerm *t, int n, double D, double M, double Mp, double F, double E, bool use_cos) {
    double sum = 0.0;
    for (int i = 0; i < n; i++) {
        double arg = deg2rad(t[i].d * D + t[i].m * M + t[i].mp * Mp + t[i].f * F);
        double c = t[i].c * (t[i].m != 0 ? E : 1.0);
        sum += c * (use_cos ? cos(arg) : sin(arg));
    }
    return sum;
}

/* Ekliptik boylam/enlem (derece) -> selenografik boylam/enlem (radyan). */
static void optical_libration(double lam_deg, double bet_deg, double node_deg, double F_deg, double *l_rad, double *b_rad) {
    const double I = deg2rad(1.54242);
    double W = deg2rad(lam_deg - node_deg);
    double b = deg2rad(bet_deg);
    double A = atan2(sin(W) * cos(b) * cos(I) - sin(b) * sin(I), cos(W) * cos(b));
    *l_rad = A - deg2rad(F_deg);
    *b_rad = asin(clamp_d(-sin(W) * cos(b) * sin(I) - sin(b) * cos(I), -1.0, 1.0));
}

static void analytic_moonfixed_km(double et, double sun_km[3], double earth_km[3]) {
    double T = et / (36525.0 * 86400.0);
    double Lp = 218.3164477 + 481267.88123421 * T;
    double D  = 297.8501921 + 445267.1114034 * T;
    double M  = 357.5291092 + 35999.0502909 * T;
    double Mp = 134.9633964 + 477198.8675055 * T;
    double F  = 93.2720950 + 483202.0175233 * T;
    double Om = 125.0445479 - 1934.1362891 * T;
    double E  = 1.0 - 0.002516 * T;

    int n_lon = (int)(sizeof(MOON_LON_TERMS) / sizeof(MOON_LON_TERMS[0]));
    int n_lat = (int)(sizeof(MOON_LAT_TERMS) / sizeof(MOON_LAT_TERMS[0]));
    int n_dst = (int)(sizeof(MOON_DIST_TERMS) / sizeof(MOON_DIST_TERMS[0]));
    double lam  = Lp + moon_series(MOON_LON_TERMS, n_lon, D, M, Mp, F, E, false);
    double bet  = moon_series(MOON_LAT_TERMS, n_lat, D, M, Mp, F, E, false);
    double dist = 385000.56 + moon_series(MOON_DIST_TERMS, n_dst, D, M, Mp, F, E, true);

    double Mr = deg2rad(M);
    double C = (1.914602 - 0.004817 * T) * sin(Mr) + 0.019993 * sin(2.0 * Mr) + 0.000289 * sin(3.0 * Mr);
    double lam0 = 280.46646 + 36000.76983 * T + C;
    double ecc = 0.016708634 - 0.000042037 * T;
    double sun_dist = 1.000001018 * (1.0 - ecc * ecc) / (1.0 + ecc * cos(deg2rad(M + C))) * 149597870.7;

    double le, be, ls, bs;
    optical_libration(lam, bet, Om, F, &le, &be);
    double lam_h = lam0 + 180.0 + (dist / sun_dist) * 57.29578 * cos(deg2rad(bet)) * sin(deg2rad(lam0 - lam));
    double bet_h = (dist / sun_dist) * bet;
    optical_libration(lam_h, bet_h, Om, F, &ls, &bs);

    earth_km[0] = dist * cos(be) * cos(le);
    earth_km[1] = dist * cos(be) * sin(le);
    earth_km[2] = dist * sin(be);
    sun_km[0] = sun_dist * cos(bs) * cos(ls);
    sun_km[1] = sun_dist * cos(bs) * sin(ls);
    sun_km[2] = sun_dist * sin(bs);
}

bool lunar_moonfixed_sun_earth_km(double et, double sun_km[3], double earth_km[3]) {
#if HAS_NAIF_CSPICE
    if (g_spice_loaded) {
        double lt = 0.0;
        /* IAU_MOON: data/kernels/pck00010.tpc ile gelir (MOON_ME icin ek kernel gerekir). */
        spkpos_c("SUN", et, "IAU_MOON", "LT+S", "MOON", sun_km, &lt);
        spkpos_c("EARTH", et, "IAU_MOON", "LT+S", "MOON", earth_km, &lt);
        if (!failed_c()) {
            g_ephem_from_spice = true;
            return true;
        }
        reset_c();
    }
#endif
    analytic_moonfixed_km(et, sun_km, earth_km);
    g_ephem_from_spice = false;
    return false;
}

/* Yuzeydeki gozlemciden (toposentrik) bir cismin azimut/yukseklik acisi. Ay yaricapi kadar
   paralaks Dunya icin ~0.27 dereceye ulasir; kutupta bu fark gorunurlugu degistirir. */
static void topo_az_el(
    const double body_km[3], const double up[3], const double east[3], const double north[3],
    double *az_deg, double *el_deg
) {
    double v[3];
    for (int k = 0; k < 3; k++) v[k] = body_km[k] - R_MOON_KM * up[k];
    double len = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len < 1e-9) len = 1e-9;
    double vu = (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / len;
    double ve = (v[0] * east[0] + v[1] * east[1] + v[2] * east[2]) / len;
    double vn = (v[0] * north[0] + v[1] * north[1] + v[2] * north[2]) / len;
    *el_deg = rad2deg(asin(clamp_d(vu, -1.0, 1.0)));
    *az_deg = fmod(rad2deg(atan2(ve, vn)) + 360.0, 360.0);
}

static bool is_leap_year(int y) {
    return (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
}

static int days_in_month(int y, int m) {
    static const int mdays[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (m == 2 && is_leap_year(y)) return 29;
    return mdays[(m >= 1 && m <= 12) ? (m - 1) : 0];
}

static void utc_add_hours(const char *base_utc, int add_hours, char *out, size_t out_sz) {
    int y = 2026, mo = 10, d = 18, h = 0, mi = 0, s = 0;
    if (base_utc) {
        sscanf(base_utc, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s);
    }
    h += add_hours;
    while (h >= 24) {
        h -= 24;
        d++;
        if (d > days_in_month(y, mo)) {
            d = 1;
            mo++;
            if (mo > 12) {
                mo = 1;
                y++;
            }
        }
    }
    while (h < 0) {
        h += 24;
        d--;
        if (d < 1) {
            mo--;
            if (mo < 1) {
                mo = 12;
                y--;
            }
            d = days_in_month(y, mo);
        }
    }
    snprintf(out, out_sz, "%04d-%02d-%02dT%02d:%02d:%02d", y, mo, d, h, mi, s);
}

typedef struct {
    const char *name;
    double lat, lon, alt_m, radius_deg;
} TopoFeature;

static const TopoFeature TOPO_FEATURES[] = {
    {"Haworth",               -87.45,   -5.17,  1640.0, 0.65},
    {"Malapert Massif",       -85.9948, -0.23578, 4784.8, 0.85},
    {"Nobile Rim 1",          -85.20,   53.50,  2150.0, 0.65},
    {"Connecting Ridge",      -89.4632, -137.49000, 1943.3, 0.45},
    {"Shackleton Rim",        -89.7668, -171.87000, 770.5, 0.35},
    {"Shackleton Base (PSR)", -89.65,  115.00, -4150.0, 0.32},
    {"De Gerlache Rim",       -88.50,  -88.30,  1480.0, 0.55},
    {"Cabeus (LCROSS)",       -84.90,  -35.50, -3100.0, 0.95},
    {"Tycho",                 -43.31,  -11.36, -1850.0, 1.40},
    {"Copernicus",              9.62,  -20.08, -1420.0, 1.50}
};
#define TOPO_FEATURE_COUNT (int)(sizeof(TOPO_FEATURES) / sizeof(TOPO_FEATURES[0]))
#define COMPARISON_SITE_COUNT 5

bool init_spice_engine(const char *meta_kernel_path) {
#if HAS_NAIF_CSPICE
    erract_c("SET", 0, "RETURN");
    errprt_c("SET", 0, "NONE");

    int loaded_count = 0;
    if (meta_kernel_path && meta_kernel_path[0] != '\0') {
        FILE *f = fopen(meta_kernel_path, "r");
        if (f) {
            fclose(f);
            furnsh_c(meta_kernel_path);
            if (!failed_c()) {
                loaded_count++;
            } else {
                reset_c();
            }
        }
    }
    /* Depodaki kernel'ler data/kernels altindadir; eski "kernels/" yolu da desteklenir. */
    int dir_loaded = autoload_kernels_dir("data/kernels", 0);
    if (dir_loaded == 0) dir_loaded = autoload_kernels_dir("kernels", 0);
    loaded_count += dir_loaded;

    SpiceInt spk_count = 0;
    ktotal_c("SPK", &spk_count);
    if (failed_c()) reset_c();

    SpiceInt radii_dim = 3;
    SpiceDouble moon_radii[3];
    bodvcd_c(301, "RADII", 3, &radii_dim, moon_radii);
    bool has_pck = !failed_c();
    if (!has_pck) reset_c();

    SpiceBoolean has_lsk = SPICEFALSE;
    SpiceInt lsk_count = 0;
    SpiceChar dtype[4];
    dtpool_c("DELTET/DELTA_AT", &has_lsk, &lsk_count, dtype);
    if (failed_c()) {
        reset_c();
        has_lsk = SPICEFALSE;
    }

    g_spice_loaded = (loaded_count > 0 && spk_count > 0 &&
                      has_pck && has_lsk == SPICETRUE);
    if (!g_spice_loaded) {
        fprintf(stderr,
                "[HATA] CSPICE kernel seti eksik (SPK=%d, PCK=%s, LSK=%s). "
                "data/kernels/ altinda de440s.bsp, pck00010.tpc ve naif0012.tls bulunmali.\n",
                (int)spk_count, has_pck ? "var" : "yok",
                has_lsk == SPICETRUE ? "var" : "yok");
    }
#else
    (void)meta_kernel_path;
    fprintf(stderr,
            "[HATA] CSPICE destegi derlenmedi. cspice/ dizinini kurup yeniden derleyin.\n");
    g_spice_loaded = false;
#endif
    return g_spice_loaded;
}

/* SENTETIK ARAZI: sinus harmonikleri + elle girilmis tepe/cukur noktalari. Gercek LOLA DEM degildir;
   egim, rover rotasi ve LOLA profili olmayan noktalarin ufku bu modele dayanir. */
double sample_synthetic_dem_elevation_m(double lat_deg, double lon_deg) {
    double lat_r = deg2rad(lat_deg);
    double lon_r = deg2rad(lon_deg);

    double h = 1120.0 * sin(3.0 * lat_r) * cos(2.0 * lon_r)
             +  790.0 * cos(5.0 * lat_r + 0.4) * sin(4.0 * lon_r)
             +  410.0 * sin(12.0 * lat_r) * cos(10.0 * lon_r)
             +  165.0 * cos(27.0 * lat_r) * sin(23.0 * lon_r);

    double cos_lat = fmax(0.05, cos(lat_r));
    for (int i = 0; i < TOPO_FEATURE_COUNT; i++) {
        double dlat = lat_deg - TOPO_FEATURES[i].lat;
        double dlon = (lon_deg - TOPO_FEATURES[i].lon) * cos_lat;
        double dist = sqrt(dlat * dlat + dlon * dlon);
        if (dist < TOPO_FEATURES[i].radius_deg * 2.2) {
            double r_norm = dist / (TOPO_FEATURES[i].radius_deg * 2.2);
            double w = cos(r_norm * (M_PI * 0.5));
            w = w * w * 0.85;
            h = h * (1.0 - w) + TOPO_FEATURES[i].alt_m * w;
        }
    }
    return h;
}

static void compute_local_slope_aspect(double lat_deg, double lon_deg, double *out_slope, double *out_aspect) {
    const double d = 0.04;
    double cos_lat = fmax(0.05, cos(deg2rad(lat_deg)));
    double h_n = sample_synthetic_dem_elevation_m(clamp_d(lat_deg + d, -90.0, 90.0), lon_deg);
    double h_s = sample_synthetic_dem_elevation_m(clamp_d(lat_deg - d, -90.0, 90.0), lon_deg);
    double h_e = sample_synthetic_dem_elevation_m(lat_deg, lon_deg + d / cos_lat);
    double h_w = sample_synthetic_dem_elevation_m(lat_deg, lon_deg - d / cos_lat);

    double dz_dy = (h_n - h_s) / (2.0 * d * METERS_PER_DEG);
    double dz_dx = (h_e - h_w) / (2.0 * d * METERS_PER_DEG);

    double grad = sqrt(dz_dx * dz_dx + dz_dy * dz_dy);
    *out_slope = rad2deg(atan(grad));
    *out_aspect = fmod(rad2deg(atan2(dz_dx, dz_dy)) + 360.0, 360.0);
}

static void compute_360_horizon_and_blocker(
    double lat_deg, double lon_deg, double obs_alt_m,
    double horizon_out[CSPICE_HORIZON_RAYS],
    double *blocker_az, double *blocker_dist_km, double *blocker_el
) {
    double lat_r = deg2rad(lat_deg);
    double lon_r = deg2rad(lon_deg);
    double max_obstacle_el = -10.0;
    double best_az = 0.0;
    double best_dist = 0.0;

    for (int az = 0; az < CSPICE_HORIZON_RAYS; az++) {
        double az_r = deg2rad((double)az);
        double ray_max_el = -5.0;
        double ray_peak_dist = 5.0;

        for (int step = 1; step <= 26; step++) {
            double dist_km = step * 2.5;
            double ang_dist = dist_km / R_MOON_KM;
            double sin_d = sin(ang_dist), cos_d = cos(ang_dist);

            double sin_lat2 = sin(lat_r) * cos_d + cos(lat_r) * sin_d * cos(az_r);
            double lat2 = asin(clamp_d(sin_lat2, -1.0, 1.0));
            double lon2 = lon_r + atan2(sin(az_r) * sin_d * cos(lat_r), cos_d - sin(lat_r) * sin_lat2);

            double target_h = sample_synthetic_dem_elevation_m(rad2deg(lat2), rad2deg(lon2));
            double curvature_drop_m = (dist_km * dist_km * 1000.0) / (2.0 * R_MOON_KM);
            double el_deg = rad2deg(atan2((target_h - curvature_drop_m) - (obs_alt_m + 2.5), dist_km * 1000.0));

            if (el_deg > ray_max_el) {
                ray_max_el = el_deg;
                ray_peak_dist = dist_km;
            }
        }
        horizon_out[az] = ray_max_el;
        if (ray_max_el > max_obstacle_el) {
            max_obstacle_el = ray_max_el;
            best_az = (double)az;
            best_dist = ray_peak_dist;
        }
    }

    *blocker_az = best_az;
    *blocker_dist_km = best_dist;
    *blocker_el = fmax(0.0, max_obstacle_el);
}

static void get_sun_earth_angles(
    double lat_deg, double lon_deg, double t_hours, double base_et,
    double *sun_az, double *sun_el, double *earth_az, double *earth_el
) {
    double lat_r = deg2rad(lat_deg);
    double lon_r = deg2rad(lon_deg);
    double et = base_et + t_hours * 3600.0;
    double sun_km[3], earth_km[3];
    lunar_moonfixed_sun_earth_km(et, sun_km, earth_km);

    double up[3] = {cos(lat_r) * cos(lon_r), cos(lat_r) * sin(lon_r), sin(lat_r)};
    double east[3] = {-sin(lon_r), cos(lon_r), 0.0};
    double north[3] = {-sin(lat_r) * cos(lon_r), -sin(lat_r) * sin(lon_r), cos(lat_r)};
    topo_az_el(sun_km, up, east, north, sun_az, sun_el);
    topo_az_el(earth_km, up, east, north, earth_az, earth_el);
}

/* Gercek LOLA ufuk profili olan saha merkezini bulur (0.5 km icinde), yoksa NULL. */
static const LolaHorizonProfile *find_lola_profile(double lat_deg, double lon_deg) {
    double la = deg2rad(lat_deg), lo = deg2rad(lon_deg);
    for (int i = 0; i < LOLA_HORIZON_PROFILE_COUNT; i++) {
        double pa = deg2rad(LOLA_HORIZON_PROFILES[i].lat_deg);
        double po = deg2rad(LOLA_HORIZON_PROFILES[i].lon_deg);
        double c = sin(la) * sin(pa) + cos(la) * cos(pa) * cos(lo - po);
        double dist_km = acos(clamp_d(c, -1.0, 1.0)) * R_MOON_KM;
        if (dist_km < 0.5) return &LOLA_HORIZON_PROFILES[i];
    }
    return NULL;
}

bool lunar_lola_ground_altitude_m(double lat_deg, double lon_deg, double *alt_m) {
    const LolaHorizonProfile *lp = find_lola_profile(lat_deg, lon_deg);
    if (!lp) return false;
    if (alt_m) *alt_m = lp->ground_m;
    return true;
}

/* Ufuk maskesi: varsa gercek LOLA profili (true doner, *alt_m LOLA zemin yuksekligi olur),
   yoksa sentetik arazi uzerinde isin izleme (false doner). */
static bool site_horizon(
    double lat_deg, double lon_deg, double *alt_m,
    double horizon_out[CSPICE_HORIZON_RAYS],
    double *blocker_az, double *blocker_dist_km, double *blocker_el
) {
    const LolaHorizonProfile *lp = find_lola_profile(lat_deg, lon_deg);
    if (!lp) {
        compute_360_horizon_and_blocker(lat_deg, lon_deg, *alt_m, horizon_out, blocker_az, blocker_dist_km, blocker_el);
        return false;
    }
    double best_el = -90.0;
    int best_az = 0;
    for (int az = 0; az < CSPICE_HORIZON_RAYS; az++) {
        horizon_out[az] = lp->mask_deg[az];
        if (lp->mask_deg[az] > best_el) {
            best_el = lp->mask_deg[az];
            best_az = az;
        }
    }
    *alt_m = lp->ground_m;
    *blocker_az = (double)best_az;
    *blocker_dist_km = 0.0;   /* LOLA profili engel mesafesini icermez */
    *blocker_el = fmax(0.0, best_el);
    return true;
}

/* 360 derecelik ufuk maskesini (her derece icin ufuk yukseklik acisi, derece) hesaplar.
   Gercek LOLA profili varsa onu kullanir; yoksa sentetik arazi uzerinde isin izleme yapar.
   horizon_source cagiranin tamponuna yazilir. 2D ve 3B ayni fonksiyonu paylasir. */
void lunar_compute_horizon_mask(double lat_deg, double lon_deg, double alt_m,
                                double mask_out[CSPICE_HORIZON_RAYS], char *horizon_source, size_t src_sz) {
    double alt = alt_m;
    double b_az = 0.0, b_d = 0.0, b_el = 0.0;
    bool is_lola = site_horizon(lat_deg, lon_deg, &alt, mask_out, &b_az, &b_d, &b_el);
    if (horizon_source) {
        snprintf(horizon_source, src_sz, "%s", is_lola ? "LOLA_80M_SKYLINE" : "SYNTHETIC_ANALYTIC");
    }
}

typedef struct {
    double total_sun_h;
    double sun_pct;
    double longest_sun_h;
    int sun_window_count;
    double total_earth_h;
    double earth_pct;
    double longest_earth_h;
    int earth_window_count;
    double overlap_h;
    double loss_pct;
    double longest_dark_h;
    double min_soc;
} WindowStats;

static void simulate_window_metrics(
    double lat_deg, double lon_deg, double start_offset_hours, int total_hours,
    const double horizon_mask[CSPICE_HORIZON_RAYS], double base_et,
    WindowStats *st, SimulationResult *full_target
) {
    int raw_sun_hours = 0;
    int dte_vis_hours = 0;
    double overlap_h = 0.0;
    double cur_sun = 0.0, max_sun = 0.0;
    double cur_earth = 0.0, max_earth = 0.0;
    double cur_dark = 0.0, max_dark = 0.0;
    double soc = 82.0, min_soc = 82.0;
    double sun_frac_sum = 0.0;

    int sun_win_start = -1;
    int earth_win_start = -1;
    int sun_win_count = 0;
    int earth_win_count = 0;
    if (full_target) {
        full_target->sun_window_count = 0;
        full_target->earth_window_count = 0;
    }

    for (int h = 0; h < total_hours; h++) {
        double s_az, s_el, e_az, e_el;
        get_sun_earth_angles(lat_deg, lon_deg, start_offset_hours + (double)h, base_et, &s_az, &s_el, &e_az, &e_el);

        int s_idx = ((int)round(s_az)) % CSPICE_HORIZON_RAYS;
        if (s_idx < 0) s_idx += CSPICE_HORIZON_RAYS;
        int e_idx = ((int)round(e_az)) % CSPICE_HORIZON_RAYS;
        if (e_idx < 0) e_idx += CSPICE_HORIZON_RAYS;

        double terr_s = horizon_mask[s_idx];
        double terr_e = horizon_mask[e_idx];

        double margin = s_el - terr_s;
        double sun_frac = clamp_d((margin + SOLAR_RADIUS_DEG) / (2.0 * SOLAR_RADIUS_DEG), 0.0, 1.0);
        bool sun_ok = (sun_frac > 0.25);
        bool dte_ok = (e_el > terr_e);

        if (s_el > -SOLAR_RADIUS_DEG) raw_sun_hours++;
        sun_frac_sum += sun_frac;
        if (dte_ok) dte_vis_hours++;
        if (sun_ok && dte_ok) overlap_h += 1.0;
        /* SoC saat basindaki degeriyle raporlanir; ilk sample baslangic bataryasini gosterir. */
        if (full_target) full_target->timeline_soc_pct[h] = soc;

        if (sun_ok) {
            cur_sun += 1.0;
            if (cur_sun > max_sun) max_sun = cur_sun;
            cur_dark = 0.0;
            soc = clamp_d(soc + 1.65 * sun_frac, 0.0, 100.0);
            if (sun_win_start < 0) {
                sun_win_start = h;
                sun_win_count++;
            }
        } else {
            cur_sun = 0.0;
            cur_dark += 1.0;
            if (cur_dark > max_dark) max_dark = cur_dark;
            soc = clamp_d(soc - 0.95, 5.0, 100.0);
            if (sun_win_start >= 0 && full_target && full_target->sun_window_count < CSPICE_MAX_WINDOWS) {
                VisibilityWindow *w = &full_target->sun_windows[full_target->sun_window_count++];
                utc_add_hours(full_target->utc_start, sun_win_start, w->start_utc, sizeof(w->start_utc));
                utc_add_hours(full_target->utc_start, h, w->end_utc, sizeof(w->end_utc));
                w->duration_hours = (double)(h - sun_win_start);
            }
            sun_win_start = -1;
        }

        if (dte_ok) {
            cur_earth += 1.0;
            if (cur_earth > max_earth) max_earth = cur_earth;
            if (earth_win_start < 0) {
                earth_win_start = h;
                earth_win_count++;
            }
        } else {
            cur_earth = 0.0;
            if (earth_win_start >= 0 && full_target && full_target->earth_window_count < CSPICE_MAX_WINDOWS) {
                VisibilityWindow *w = &full_target->earth_windows[full_target->earth_window_count++];
                utc_add_hours(full_target->utc_start, earth_win_start, w->start_utc, sizeof(w->start_utc));
                utc_add_hours(full_target->utc_start, h, w->end_utc, sizeof(w->end_utc));
                w->duration_hours = (double)(h - earth_win_start);
            }
            earth_win_start = -1;
        }

        if (soc < min_soc) min_soc = soc;

        if (full_target) {
            full_target->timeline_sun_az[h]   = s_az;
            full_target->timeline_sun_el[h]   = s_el;
            full_target->timeline_sun_frac[h] = sun_frac;
            full_target->timeline_earth_az[h] = e_az;
            full_target->timeline_earth_el[h] = e_el;
            full_target->timeline_dte_vis[h]  = dte_ok ? 1.0 : 0.0;
        }
    }

    if (sun_win_start >= 0 && full_target && full_target->sun_window_count < CSPICE_MAX_WINDOWS) {
        VisibilityWindow *w = &full_target->sun_windows[full_target->sun_window_count++];
        utc_add_hours(full_target->utc_start, sun_win_start, w->start_utc, sizeof(w->start_utc));
        utc_add_hours(full_target->utc_start, total_hours, w->end_utc, sizeof(w->end_utc));
        w->duration_hours = (double)(total_hours - sun_win_start);
    }
    if (earth_win_start >= 0 && full_target && full_target->earth_window_count < CSPICE_MAX_WINDOWS) {
        VisibilityWindow *w = &full_target->earth_windows[full_target->earth_window_count++];
        utc_add_hours(full_target->utc_start, earth_win_start, w->start_utc, sizeof(w->start_utc));
        utc_add_hours(full_target->utc_start, total_hours, w->end_utc, sizeof(w->end_utc));
        w->duration_hours = (double)(total_hours - earth_win_start);
    }

    st->total_sun_h = sun_frac_sum;
    st->sun_pct = (100.0 * sun_frac_sum) / (double)total_hours;
    st->longest_sun_h = max_sun;
    st->sun_window_count = sun_win_count;
    st->total_earth_h = (double)dte_vis_hours;
    st->earth_pct = (100.0 * dte_vis_hours) / (double)total_hours;
    st->longest_earth_h = max_earth;
    st->earth_window_count = earth_win_count;
    st->overlap_h = overlap_h;
    double raw_pct = (100.0 * raw_sun_hours) / (double)total_hours;
    st->loss_pct = fmax(0.0, raw_pct - st->sun_pct);
    st->longest_dark_h = max_dark;
    st->min_soc = min_soc;
}

static const char *azimuth_to_tr_direction(double az_deg) {
    int sector = ((int)round(az_deg / 45.0)) % 8;
    const char *dirs[8] = {
        "Kuzey (N)", "Kuzeydogu (NE)", "Dogu (E)", "Guneydogu (SE)",
        "Guney (S)", "Guneybati (SW)", "Bati (W)", "Kuzeybati (NW)"
    };
    return dirs[sector < 0 ? sector + 8 : sector];
}

static int compute_site_score(double sun_pct, double earth_pct, double slope_deg, double longest_dark_h) {
    double score = sun_pct * 0.45
                 + earth_pct * 0.30
                 - slope_deg * 1.8
                 - (longest_dark_h > 96.0 ? (longest_dark_h - 96.0) * 0.15 : 0.0)
                 + 22.0;
    return (int)clamp_d(round(score), 0.0, 100.0);
}

/* Ana saha ve aday sahalar ayni esikleri kullanmali. Aksi halde 0% gunesli bir saha
   "GO" gorunebilir. min_soc her iki yolda da batarya simülasyonundan gelir. */
static const char *classify_site_verdict(
    double sun_pct, double earth_pct, double slope_deg,
    double longest_dark_h, double min_soc_pct
) {
    if (sun_pct < 40.0 || longest_dark_h > 120.0 ||
        slope_deg > 12.0 || min_soc_pct < 15.0) {
        return "NO-GO";
    }
    if (earth_pct < 35.0 || slope_deg > 8.0 || longest_dark_h > 72.0) {
        return "CAUTION";
    }
    return "GO";
}

/* Skor ile verdict celismesin: NO-GO <= 39, CAUTION <= 69. */
static int cap_score_to_verdict(int score, const char *verdict) {
    if (strcmp(verdict, "NO-GO") == 0 && score > 39) return 39;
    if (strcmp(verdict, "CAUTION") == 0 && score > 69) return 69;
    return score;
}

static void solve_rover_astar_ice_route(
    double center_lat, double center_lon, SimulationResult *out
) {
    const int N = CSPICE_GRID_N;
    const int mid = N / 2;
    const double step_m = 250.0;
    double cos_lat = fmax(0.05, cos(deg2rad(center_lat)));
    double dlat_step = step_m / METERS_PER_DEG;
    double dlon_step = step_m / (METERS_PER_DEG * cos_lat);

    double grid_lat[CSPICE_GRID_N][CSPICE_GRID_N];
    double grid_lon[CSPICE_GRID_N][CSPICE_GRID_N];
    double grid_slope[CSPICE_GRID_N][CSPICE_GRID_N];

    int goal_r = -1, goal_c = -1;
    double best_goal_dist = 1e9;

    for (int r = 0; r < N; r++) {
        for (int c = 0; c < N; c++) {
            double la = clamp_d(center_lat + (mid - r) * dlat_step, -90.0, 90.0);
            double lo = center_lon + (c - mid) * dlon_step;
            double slp = 0.0, asp = 0.0;
            compute_local_slope_aspect(la, lo, &slp, &asp);
            double elev = sample_synthetic_dem_elevation_m(la, lo);

            grid_lat[r][c] = la;
            grid_lon[r][c] = lo;
            grid_slope[r][c] = slp;

            bool ice = (fabs(la) > 80.0 && elev < -1200.0 && slp < 15.0);
            if (ice && !(r == mid && c == mid)) {
                double d = hypot((r - mid) * step_m, (c - mid) * step_m);
                if (d < best_goal_dist) {
                    best_goal_dist = d;
                    goal_r = r;
                    goal_c = c;
                }
            }
        }
    }

    out->rover_ice_reachable = false;
    out->rover_waypoint_count = 0;
    if (goal_r < 0) return;

    double g_cost[CSPICE_GRID_N][CSPICE_GRID_N];
    bool closed[CSPICE_GRID_N][CSPICE_GRID_N];
    int parent_r[CSPICE_GRID_N][CSPICE_GRID_N];
    int parent_c[CSPICE_GRID_N][CSPICE_GRID_N];

    for (int r = 0; r < N; r++) {
        for (int c = 0; c < N; c++) {
            g_cost[r][c] = 1e12;
            closed[r][c] = false;
            parent_r[r][c] = -1;
            parent_c[r][c] = -1;
        }
    }
    g_cost[mid][mid] = 0.0;

    while (true) {
        int cur_r = -1, cur_c = -1;
        double best_f = 1e12;
        for (int r = 0; r < N; r++) {
            for (int c = 0; c < N; c++) {
                if (!closed[r][c] && g_cost[r][c] < 1e11) {
                    double h = hypot((r - goal_r) * step_m, (c - goal_c) * step_m);
                    if (g_cost[r][c] + h < best_f) {
                        best_f = g_cost[r][c] + h;
                        cur_r = r;
                        cur_c = c;
                    }
                }
            }
        }
        if (cur_r < 0 || (cur_r == goal_r && cur_c == goal_c)) break;
        closed[cur_r][cur_c] = true;

        for (int dr = -1; dr <= 1; dr++) {
            for (int dc = -1; dc <= 1; dc++) {
                if (dr == 0 && dc == 0) continue;
                int nr = cur_r + dr, nc = cur_c + dc;
                if (nr < 0 || nr >= N || nc < 0 || nc >= N || closed[nr][nc]) continue;
                if (grid_slope[nr][nc] > 15.0) continue;

                double dist = (dr != 0 && dc != 0) ? (step_m * 1.41421356) : step_m;
                double step_cost = dist * (1.0 + grid_slope[nr][nc] * 0.12);
                if (g_cost[cur_r][cur_c] + step_cost < g_cost[nr][nc]) {
                    g_cost[nr][nc] = g_cost[cur_r][cur_c] + step_cost;
                    parent_r[nr][nc] = cur_r;
                    parent_c[nr][nc] = cur_c;
                }
            }
        }
    }

    if (g_cost[goal_r][goal_c] > 1e11) return;

    int path_r[CSPICE_MAX_WAYPOINTS], path_c[CSPICE_MAX_WAYPOINTS];
    int count = 0;
    int cr = goal_r, cc = goal_c;
    double total_dist_m = 0.0;
    double max_slp = 0.0;

    while (cr >= 0 && cc >= 0 && count < CSPICE_MAX_WAYPOINTS) {
        path_r[count] = cr;
        path_c[count] = cc;
        if (grid_slope[cr][cc] > max_slp) max_slp = grid_slope[cr][cc];
        int pr = parent_r[cr][cc], pc = parent_c[cr][cc];
        if (pr >= 0 && pc >= 0) {
            total_dist_m += hypot((cr - pr) * step_m, (cc - pc) * step_m);
        }
        count++;
        cr = pr;
        cc = pc;
    }

    out->rover_ice_reachable = true;
    out->rover_target_lat = grid_lat[goal_r][goal_c];
    out->rover_target_lon = grid_lon[goal_r][goal_c];
    out->rover_distance_km = total_dist_m / 1000.0;
    out->rover_max_slope_deg = max_slp;
    out->rover_energy_wh = (total_dist_m / 1000.0) * 68.0 * (1.0 + max_slp * 0.05);
    out->rover_waypoint_count = count;

    for (int i = 0; i < count; i++) {
        int rev = count - 1 - i;
        out->rover_waypoints_lat[i] = grid_lat[path_r[rev]][path_c[rev]];
        out->rover_waypoints_lon[i] = grid_lon[path_r[rev]][path_c[rev]];
    }
}

SimulationResult *run_lunar_simulation(
    const char *site_name,
    double lat_deg,
    double lon_deg,
    const char *utc_start,
    int duration_days
) {
    SimulationResult *out = (SimulationResult *)calloc(1, sizeof(SimulationResult));
    if (!out) return NULL;

    snprintf(out->site_name, sizeof(out->site_name), "%s", site_name ? site_name : "Shackleton Rim");
    snprintf(out->utc_start, sizeof(out->utc_start), "%s", utc_start ? utc_start : "2026-10-18T00:00:00");
    out->lat_deg = clamp_d(lat_deg, -90.0, 90.0);
    out->lon_deg = wrap_lon_deg(lon_deg);
    out->duration_days = (duration_days < 1) ? 1 : (duration_days > 30 ? 30 : duration_days);
    out->step_seconds = 3600;
    out->dem_out_of_bounds = (out->lat_deg > -60.0);
    if (out->dem_out_of_bounds) {
        snprintf(out->warning_msg, sizeof(out->warning_msg),
                 "Secili nokta yuksek cozunurluklu Guney Kutbu (-60 deg) kapsami disinda; sentetik analitik arazi kullanildi.");
    }

    int total_hours = out->duration_days * 24;
    out->timeline_count = total_hours;
    utc_add_hours(out->utc_start, total_hours, out->utc_end, sizeof(out->utc_end));

    out->timeline_sun_az   = (double *)calloc((size_t)total_hours, sizeof(double));
    out->timeline_sun_el   = (double *)calloc((size_t)total_hours, sizeof(double));
    out->timeline_sun_frac = (double *)calloc((size_t)total_hours, sizeof(double));
    out->timeline_earth_az = (double *)calloc((size_t)total_hours, sizeof(double));
    out->timeline_earth_el = (double *)calloc((size_t)total_hours, sizeof(double));
    out->timeline_dte_vis  = (double *)calloc((size_t)total_hours, sizeof(double));
    out->timeline_soc_pct  = (double *)calloc((size_t)total_hours, sizeof(double));

    if (!out->timeline_sun_az || !out->timeline_sun_el || !out->timeline_sun_frac ||
        !out->timeline_earth_az || !out->timeline_earth_el || !out->timeline_dte_vis ||
        !out->timeline_soc_pct) {
        free_simulation_result(out);
        return NULL;
    }

    double base_et = lunar_utc_to_et(out->utc_start);

    // 1. Rakım & Eğim
    out->altitude_m = sample_synthetic_dem_elevation_m(out->lat_deg, out->lon_deg);
    compute_local_slope_aspect(out->lat_deg, out->lon_deg, &out->slope_deg, &out->aspect_deg);

    // 2. 360° Ray-Casting Ufuk Maskesi
    bool main_is_lola = site_horizon(
        out->lat_deg, out->lon_deg, &out->altitude_m,
        out->horizon_mask_deg, &out->blocker_azimuth_deg,
        &out->blocker_distance_km, &out->blocker_elevation_deg
    );
    out->blocker_distance_known = !main_is_lola;
    snprintf(out->horizon_source, sizeof(out->horizon_source), "%s",
             main_is_lola ? "LOLA_80M_SKYLINE" : "SYNTHETIC_ANALYTIC");
    snprintf(out->dem_name, sizeof(out->dem_name), "%s",
             main_is_lola ? "LOLA 80 m DEM skyline (Barker et al. 2023)"
                          : "SYNTHETIC analytic terrain (not LOLA data)");

    // 3. Ana Görev Enerji & Görünürlük Simülasyonu
    WindowStats main_st;
    simulate_window_metrics(out->lat_deg, out->lon_deg, 0.0, total_hours, out->horizon_mask_deg, base_et, &main_st, out);
    out->total_sun_hours         = main_st.total_sun_h;
    out->sun_illumination_pct    = main_st.sun_pct;
    out->longest_sun_hours       = main_st.longest_sun_h;
    out->total_earth_hours       = main_st.total_earth_h;
    out->earth_dte_pct           = main_st.earth_pct;
    out->longest_earth_hours     = main_st.longest_earth_h;
    out->sun_earth_overlap_hours = main_st.overlap_h;
    out->terrain_loss_pct        = main_st.loss_pct;
    out->longest_dark_hours      = main_st.longest_dark_h;
    out->min_battery_soc_pct     = main_st.min_soc;
    out->ephemeris_from_spice    = g_ephem_from_spice;

    // 3b. Güneş/Dünya ufuk geçişleri (sunset/earthset, sunrise/earthrise)
    out->sun_visible_now = (out->timeline_sun_frac[0] > 0.25);
    out->earth_visible_now = (out->timeline_dte_vis[0] > 0.5);
    out->hours_to_sunset = -1.0;
    out->hours_to_sunrise = -1.0;
    out->hours_to_earthset = -1.0;
    out->hours_to_earthrise = -1.0;
    out->event_search_exhausted = false;
    int n = out->timeline_count;
    if (out->sun_visible_now) {
        for (int h = 1; h < n; h++) {
            if (out->timeline_sun_frac[h] <= 0.25) {
                out->hours_to_sunset = (double)h;
                utc_add_hours(out->utc_start, h, out->next_sunset_utc, sizeof(out->next_sunset_utc));
                break;
            }
        }
        if (out->hours_to_sunset < 0.0) out->event_search_exhausted = true;
    } else {
        for (int h = 1; h < n; h++) {
            if (out->timeline_sun_frac[h] > 0.25) {
                out->hours_to_sunrise = (double)h;
                utc_add_hours(out->utc_start, h, out->next_sunrise_utc, sizeof(out->next_sunrise_utc));
                break;
            }
        }
        if (out->hours_to_sunrise < 0.0) out->event_search_exhausted = true;
    }
    if (out->earth_visible_now) {
        for (int h = 1; h < n; h++) {
            if (out->timeline_dte_vis[h] <= 0.5) {
                out->hours_to_earthset = (double)h;
                utc_add_hours(out->utc_start, h, out->next_earthset_utc, sizeof(out->next_earthset_utc));
                break;
            }
        }
        if (out->hours_to_earthset < 0.0) out->event_search_exhausted = true;
    } else {
        for (int h = 1; h < n; h++) {
            if (out->timeline_dte_vis[h] > 0.5) {
                out->hours_to_earthrise = (double)h;
                utc_add_hours(out->utc_start, h, out->next_earthrise_utc, sizeof(out->next_earthrise_utc));
                break;
            }
        }
        if (out->hours_to_earthrise < 0.0) out->event_search_exhausted = true;
    }

    // 4. Termal Denge (Kelvin) & H2O Buz Olasılığı
    double illum_frac = out->sun_illumination_pct / 100.0;
    double abs_lat = fabs(out->lat_deg);
    out->surface_temp_k = 38.0 + 345.0 * pow(clamp_d(illum_frac * 1.15 + (90.0 - abs_lat) / 95.0, 0.0, 1.0), 0.36);
    out->ice_probability_pct = clamp_d((115.0 - out->surface_temp_k) * (abs_lat > 78.0 ? 1.35 : 0.05), 0.0, 98.0);

    // 5. Kök-Neden & Go/No-Go Karar Motoru
    out->mission_score = compute_site_score(out->sun_illumination_pct, out->earth_dte_pct, out->slope_deg, out->longest_dark_hours);

    if (out->slope_deg > 12.0) {
        snprintf(out->verdict, sizeof(out->verdict), "NO-GO");
        snprintf(out->primary_blocker_code, sizeof(out->primary_blocker_code), "EXCESSIVE_LANDING_SLOPE");
        snprintf(out->human_reason_tr, sizeof(out->human_reason_tr),
                 "Yerel egim %.1f deg oldugu icin (guvenli sinir < 8.0 deg) inis araci devrilme riski tasiyor.", out->slope_deg);
    } else if (out->longest_dark_hours > 120.0 || out->min_battery_soc_pct < 15.0) {
        snprintf(out->verdict, sizeof(out->verdict), "NO-GO");
        snprintf(out->primary_blocker_code, sizeof(out->primary_blocker_code), "%s",
                 out->longest_dark_hours > 120.0
                     ? "CONTINUOUS_DARKNESS_EXCEEDED"
                     : "INSUFFICIENT_BATTERY");
        if (main_is_lola) {
            snprintf(out->human_reason_tr, sizeof(out->human_reason_tr),
                     "LOLA 80 m ufuk profilindeki %.1f deg yuksek engel nedeniyle %.0f saat kesintisiz karanlik olusuyor; min batarya %%%.1f (esik >= %%15).",
                     out->blocker_elevation_deg, out->longest_dark_hours, out->min_battery_soc_pct);
        } else {
            snprintf(out->human_reason_tr, sizeof(out->human_reason_tr),
                     "%s yonunde %.1f km uzaktaki krater duvari Gunes'i %.1f deg kestigi icin %.0f saat kesintisiz karanlik olusuyor; min batarya %%%.1f (esik >= %%15).",
                     azimuth_to_tr_direction(out->blocker_azimuth_deg), out->blocker_distance_km,
                     out->blocker_elevation_deg, out->longest_dark_hours, out->min_battery_soc_pct);
        }
    } else if (out->sun_illumination_pct < 40.0) {
        snprintf(out->verdict, sizeof(out->verdict), "NO-GO");
        snprintf(out->primary_blocker_code, sizeof(out->primary_blocker_code), "INSUFFICIENT_SOLAR_ILLUMINATION");
        snprintf(out->human_reason_tr, sizeof(out->human_reason_tr),
                 "Gunes aydinlanmasi %%%.1f ile Artemis enerji ihtiyaci icin yetersiz (esik >= %%40).",
                 out->sun_illumination_pct);
    } else if (out->earth_dte_pct < 35.0 || out->slope_deg > 8.0 || out->longest_dark_hours > 72.0) {
        snprintf(out->verdict, sizeof(out->verdict), "CAUTION");
        snprintf(out->primary_blocker_code, sizeof(out->primary_blocker_code), "MARGINAL_DTE_OR_SLOPE");
        snprintf(out->human_reason_tr, sizeof(out->human_reason_tr),
                 "Bolge inilebilir ancak Dunya DTE iletisimi %%%.1f ve egim %.1f deg sinir degerlere yakin.",
                 out->earth_dte_pct, out->slope_deg);
    } else {
        snprintf(out->verdict, sizeof(out->verdict), "GO");
        snprintf(out->primary_blocker_code, sizeof(out->primary_blocker_code), "OPTIMAL_NOMINAL");
        snprintf(out->human_reason_tr, sizeof(out->human_reason_tr),
                 "%%%.1f guneslenme, %%%.1f Dunya DTE gorusu ve %.1f deg guvenli egim ile Artemis inisine tam uygun.",
                 out->sun_illumination_pct, out->earth_dte_pct, out->slope_deg);
    }
    out->mission_score = cap_score_to_verdict(out->mission_score, out->verdict);

    // 6. 5x5 km Mikro-Kaydırma Optimizasyonu
    double cos_lat = fmax(0.05, cos(deg2rad(out->lat_deg)));
    double best_fix_dist = 1e9;
    /* Ana saha gercek LOLA ufku kullaniyorsa komsu noktalar icin gercek veri yoktur;
       sentetik komsularla karsilastirmak yaniltici olacagi icin kaydirma aramasi atlanir. */
    for (int dr = -4; dr <= 4 && !main_is_lola; dr++) {
        for (int dc = -4; dc <= 4; dc++) {
            if (dr == 0 && dc == 0) continue;
            double dx_km = dc * 0.6;
            double dy_km = dr * 0.6;
            double dist_km = hypot(dx_km, dy_km);
            if (dist_km > 2.5 || dist_km >= best_fix_dist) continue;

            double cand_lat = clamp_d(out->lat_deg + (dy_km * 1000.0) / METERS_PER_DEG, -90.0, 90.0);
            double cand_lon = out->lon_deg + (dx_km * 1000.0) / (METERS_PER_DEG * cos_lat);
            double c_slp = 0.0, c_asp = 0.0;
            compute_local_slope_aspect(cand_lat, cand_lon, &c_slp, &c_asp);
            if (c_slp > 8.0) continue;

            double c_alt = sample_synthetic_dem_elevation_m(cand_lat, cand_lon);
            double c_hor[CSPICE_HORIZON_RAYS], b_az, b_d, b_el;
            site_horizon(cand_lat, cand_lon, &c_alt, c_hor, &b_az, &b_d, &b_el);

            WindowStats cst;
            simulate_window_metrics(cand_lat, cand_lon, 0.0, total_hours, c_hor, base_et, &cst, NULL);

            if (cst.sun_pct > out->sun_illumination_pct + 12.0 && cst.longest_dark_h <= 96.0 && cst.earth_pct >= 40.0) {
                best_fix_dist = dist_km;
                out->has_micro_fix = true;
                out->fix_lat_deg = cand_lat;
                out->fix_lon_deg = cand_lon;
                out->fix_shift_km = dist_km;
                double shift_az = fmod(rad2deg(atan2(dx_km, dy_km)) + 360.0, 360.0);
                snprintf(out->fix_direction_tr, sizeof(out->fix_direction_tr), "%s", azimuth_to_tr_direction(shift_az));
                out->fix_sun_pct = cst.sun_pct;
                out->fix_dark_hours = cst.longest_dark_h;
                snprintf(out->fix_verdict, sizeof(out->fix_verdict), "GO");
            }
        }
    }

    // 7. ±30 Gün En İyi Tarih Penceresi Taraması
    double min_window_dark = out->longest_dark_hours;
    out->best_date_offset_days = 0;
    out->best_date_dark_hours = out->longest_dark_hours;
    for (int d_off = -30; d_off <= 30; d_off += 3) {
        if (d_off == 0) continue;
        WindowStats wst;
        simulate_window_metrics(out->lat_deg, out->lon_deg, d_off * 24.0, total_hours, out->horizon_mask_deg, base_et, &wst, NULL);
        if (wst.longest_dark_h < min_window_dark - 12.0) {
            min_window_dark = wst.longest_dark_h;
            out->best_date_offset_days = d_off;
            out->best_date_dark_hours = wst.longest_dark_h;
            out->darkness_saved_hours = out->longest_dark_hours - wst.longest_dark_h;
        }
    }

    // 8. A* Gezgin (Rover) Su Buzu (PSR) Rotası
    solve_rover_astar_ice_route(out->lat_deg, out->lon_deg, out);

    // 9. Toplu Aday Saha Karşılaştırması (İlk 5 Artemis Adayı)
    out->candidate_count = COMPARISON_SITE_COUNT;
    for (int i = 0; i < COMPARISON_SITE_COUNT; i++) {
        CandidateComparison *cc = &out->candidates[i];
        snprintf(cc->site_name, sizeof(cc->site_name), "%s", TOPO_FEATURES[i].name);
        cc->latitude_deg = TOPO_FEATURES[i].lat;
        cc->longitude_deg = TOPO_FEATURES[i].lon;
        cc->altitude_m = sample_synthetic_dem_elevation_m(cc->latitude_deg, cc->longitude_deg);
        double asp_tmp = 0.0;
        compute_local_slope_aspect(cc->latitude_deg, cc->longitude_deg, &cc->slope_deg, &asp_tmp);

        double c_hor[CSPICE_HORIZON_RAYS], b_az, b_d, b_el;
        site_horizon(cc->latitude_deg, cc->longitude_deg, &cc->altitude_m, c_hor, &b_az, &b_d, &b_el);

        WindowStats cst;
        simulate_window_metrics(cc->latitude_deg, cc->longitude_deg, 0.0, total_hours, c_hor, base_et, &cst, NULL);
        cc->illumination_percent = cst.sun_pct;
        cc->earth_visibility_percent = cst.earth_pct;
        cc->total_sun_hours = cst.total_sun_h;
        cc->longest_sun_hours = cst.longest_sun_h;
        cc->total_earth_hours = cst.total_earth_h;
        cc->longest_earth_hours = cst.longest_earth_h;
        cc->dte_window_count = cst.earth_window_count;
        cc->overlap_hours = cst.overlap_h;
        cc->longest_dark_hours = cst.longest_dark_h;
        cc->min_battery_soc_pct = cst.min_soc;
        snprintf(cc->verdict, sizeof(cc->verdict), "%s",
                 classify_site_verdict(cst.sun_pct, cst.earth_pct, cc->slope_deg,
                                       cst.longest_dark_h, cst.min_soc));
        cc->mission_score = cap_score_to_verdict(
            compute_site_score(cst.sun_pct, cst.earth_pct, cc->slope_deg, cst.longest_dark_h),
            cc->verdict);
    }

    // 10. Qwen3-0.5B RAM Modeli İçin 6 Satırlık Sıfır-Yorum Olgu Fişi
    char fix_line[160];
    if (out->has_micro_fix) {
        snprintf(fix_line, sizeof(fix_line), "%.2f km %s yonune kay -> Gunes %%%.1f (GO)",
                 out->fix_shift_km, out->fix_direction_tr, out->fix_sun_pct);
    } else if (strcmp(out->verdict, "GO") == 0) {
        snprintf(fix_line, sizeof(fix_line), "Mevcut konum korunabilir (en iyi tarih farki: %+d gun)",
                 out->best_date_offset_days);
    } else {
        snprintf(fix_line, sizeof(fix_line),
                 "Mevcut konum uygun degil (karar %s); alternatif saha/tarih degerlendirilmeli (en iyi tarih farki: %+d gun)",
                 out->verdict, out->best_date_offset_days);
    }

    char rover_line[160];
    if (out->rover_ice_reachable) {
        snprintf(rover_line, sizeof(rover_line), "En yakin PSR buzu %.2f km (max egim %.1f deg, %.0f Wh)",
                 out->rover_distance_km, out->rover_max_slope_deg, out->rover_energy_wh);
    } else {
        snprintf(rover_line, sizeof(rover_line), "5 km yaricapta guvenli egimli PSR buzu yok");
    }

    snprintf(out->qwen_05b_prompt_facts, sizeof(out->qwen_05b_prompt_facts),
             "BOLGE=%s (%.2f, %.2f)\n"
             "KARAR=%s (SKOR=%d/100)\n"
             "NEDEN=%s\n"
             "FIZIK=Gunes %%%.1f | DTE %%%.1f | Egim %.1f deg | Sicaklik %.0f K | Karanlik %.0f saat\n"
             "COZUM=%s\n"
             "ROVER_BUZ=%s",
             out->site_name, out->lat_deg, out->lon_deg,
             out->verdict, out->mission_score,
             out->human_reason_tr,
             out->sun_illumination_pct, out->earth_dte_pct, out->slope_deg, out->surface_temp_k, out->longest_dark_hours,
             fix_line, rover_line);

    return out;
}

void free_simulation_result(SimulationResult *res) {
    if (!res) return;
    free(res->timeline_sun_az);
    free(res->timeline_sun_el);
    free(res->timeline_sun_frac);
    free(res->timeline_earth_az);
    free(res->timeline_earth_el);
    free(res->timeline_dte_vis);
    free(res->timeline_soc_pct);
    free(res);
}

static void json_write_escaped(FILE *fp, const char *s) {
    fputc('"', fp);
    for (const char *p = s; p && *p; p++) {
        unsigned char c = (unsigned char)*p;
        switch (c) {
            case '"':  fputs("\\\"", fp); break;
            case '\\': fputs("\\\\", fp); break;
            case '\n': fputs("\\n", fp);  break;
            case '\r': fputs("\\r", fp);  break;
            case '\t': fputs("\\t", fp);  break;
            default:
                if (c < 0x20) fprintf(fp, "\\u%04x", (unsigned)c);
                else fputc(c, fp);
                break;
        }
    }
    fputc('"', fp);
}

static double az_json(double a) {
    a = fmod(a, 360.0);
    if (a < 0.0) a += 360.0;
    if (a > 359.9995) a = 0.0;
    return a;
}

static void write_simulation_json(FILE *fp, const SimulationResult *r) {
    fprintf(fp, "{\n");
    fprintf(fp, "  \"status\": \"SUCCESS\",\n");
    fprintf(fp, "  \"dem_out_of_bounds\": %s,\n", r->dem_out_of_bounds ? "true" : "false");
    fprintf(fp, "  \"warning_msg\": "); json_write_escaped(fp, r->warning_msg); fprintf(fp, ",\n");

    fprintf(fp, "  \"meta\": {\n");
    fprintf(fp, "    \"site_name\": "); json_write_escaped(fp, r->site_name); fprintf(fp, ",\n");
    fprintf(fp, "    \"latitude_deg\": %.4f,\n", r->lat_deg);
    fprintf(fp, "    \"longitude_deg\": %.4f,\n", r->lon_deg);
    fprintf(fp, "    \"altitude_m\": %.1f,\n", r->altitude_m);
    fprintf(fp, "    \"start_utc\": "); json_write_escaped(fp, r->utc_start); fprintf(fp, ",\n");
    fprintf(fp, "    \"end_utc\": "); json_write_escaped(fp, r->utc_end); fprintf(fp, ",\n");
    fprintf(fp, "    \"step_seconds\": %d,\n", r->step_seconds);
    fprintf(fp, "    \"ephemeris_source\": \"%s\",\n",
            r->ephemeris_from_spice ? "CSPICE_DE440S_IAU_MOON" : "ANALYTIC_MEEUS_FALLBACK");
    fprintf(fp, "    \"dem_info\": { \"name\": "); json_write_escaped(fp, r->dem_name);
    fprintf(fp, ", \"horizon_source\": \"%s\", \"terrain_is_synthetic\": true }\n", r->horizon_source);
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"summary\": {\n");
    fprintf(fp, "    \"total_sun_hours\": %.2f,\n", r->total_sun_hours);
    fprintf(fp, "    \"illumination_percent\": %.2f,\n", r->sun_illumination_pct);
    fprintf(fp, "    \"longest_sun_hours\": %.2f,\n", r->longest_sun_hours);
    fprintf(fp, "    \"total_earth_hours\": %.2f,\n", r->total_earth_hours);
    fprintf(fp, "    \"earth_visibility_percent\": %.2f,\n", r->earth_dte_pct);
    fprintf(fp, "    \"dte_window_count\": %d,\n", r->earth_window_count);
    fprintf(fp, "    \"longest_earth_hours\": %.2f,\n", r->longest_earth_hours);
    fprintf(fp, "    \"overlap_hours\": %.2f,\n", r->sun_earth_overlap_hours);
    fprintf(fp, "    \"longest_dark_hours\": %.2f,\n", r->longest_dark_hours);
    fprintf(fp, "    \"mission_score\": %d\n", r->mission_score);
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"decision\": {\n");
    fprintf(fp, "    \"verdict\": "); json_write_escaped(fp, r->verdict); fprintf(fp, ",\n");
    fprintf(fp, "    \"mission_score\": %d,\n", r->mission_score);
    fprintf(fp, "    \"primary_blocker_code\": "); json_write_escaped(fp, r->primary_blocker_code); fprintf(fp, ",\n");
    fprintf(fp, "    \"human_reason_tr\": "); json_write_escaped(fp, r->human_reason_tr); fprintf(fp, ",\n");
    fprintf(fp, "    \"qwen_05b_prompt_facts\": "); json_write_escaped(fp, r->qwen_05b_prompt_facts); fprintf(fp, ",\n");
    fprintf(fp, "    \"blocker_wall\": { \"azimuth_deg\": %.1f, \"distance_km\": ", r->blocker_azimuth_deg);
    if (r->blocker_distance_known) fprintf(fp, "%.1f", r->blocker_distance_km);
    else fprintf(fp, "null");
    fprintf(fp, ", \"distance_known\": %s, \"elevation_deg\": %.2f }\n",
            r->blocker_distance_known ? "true" : "false", r->blocker_elevation_deg);
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"telemetry\": {\n");
    fprintf(fp, "    \"slope_deg\": %.2f,\n", r->slope_deg);
    fprintf(fp, "    \"aspect_deg\": %.1f,\n", r->aspect_deg);
    fprintf(fp, "    \"surface_temp_k\": %.1f,\n", r->surface_temp_k);
    fprintf(fp, "    \"ice_probability_pct\": %.1f,\n", r->ice_probability_pct);
    fprintf(fp, "    \"terrain_loss_pct\": %.2f,\n", r->terrain_loss_pct);
    fprintf(fp, "    \"min_battery_soc_pct\": %.1f\n", r->min_battery_soc_pct);
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"optimizations\": {\n");
    fprintf(fp, "    \"micro_shift\": {\n");
    fprintf(fp, "      \"available\": %s,\n", r->has_micro_fix ? "true" : "false");
    fprintf(fp, "      \"shift_km\": %.2f,\n", r->fix_shift_km);
    fprintf(fp, "      \"direction_tr\": "); json_write_escaped(fp, r->fix_direction_tr); fprintf(fp, ",\n");
    fprintf(fp, "      \"target_lat\": %.4f,\n", r->fix_lat_deg);
    fprintf(fp, "      \"target_lon\": %.4f,\n", r->fix_lon_deg);
    fprintf(fp, "      \"new_sun_pct\": %.1f,\n", r->fix_sun_pct);
    fprintf(fp, "      \"new_verdict\": "); json_write_escaped(fp, r->fix_verdict); fprintf(fp, "\n");
    fprintf(fp, "    },\n");
    fprintf(fp, "    \"date_window\": {\n");
    fprintf(fp, "      \"best_offset_days\": %d,\n", r->best_date_offset_days);
    fprintf(fp, "      \"darkness_saved_hours\": %.1f\n", r->darkness_saved_hours);
    fprintf(fp, "    }\n");
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"rover_traverse\": {\n");
    fprintf(fp, "    \"ice_reachable\": %s,\n", r->rover_ice_reachable ? "true" : "false");
    fprintf(fp, "    \"distance_km\": %.2f,\n", r->rover_distance_km);
    fprintf(fp, "    \"max_slope_deg\": %.1f,\n", r->rover_max_slope_deg);
    fprintf(fp, "    \"energy_wh\": %.1f,\n", r->rover_energy_wh);
    fprintf(fp, "    \"waypoints\": [");
    for (int i = 0; i < r->rover_waypoint_count; i++) {
        fprintf(fp, "[%.4f, %.4f]%s", r->rover_waypoints_lat[i], r->rover_waypoints_lon[i],
                (i + 1 < r->rover_waypoint_count) ? ", " : "");
    }
    fprintf(fp, "]\n");
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"windows\": {\n");
    fprintf(fp, "    \"sun\": [");
    for (int i = 0; i < r->sun_window_count; i++) {
        fprintf(fp, "{\"start_utc\": \"%s\", \"end_utc\": \"%s\", \"duration_hours\": %.2f}%s",
                r->sun_windows[i].start_utc, r->sun_windows[i].end_utc, r->sun_windows[i].duration_hours,
                (i + 1 < r->sun_window_count) ? ", " : "");
    }
    fprintf(fp, "],\n    \"earth\": [");
    for (int i = 0; i < r->earth_window_count; i++) {
        fprintf(fp, "{\"start_utc\": \"%s\", \"end_utc\": \"%s\", \"duration_hours\": %.2f}%s",
                r->earth_windows[i].start_utc, r->earth_windows[i].end_utc, r->earth_windows[i].duration_hours,
                (i + 1 < r->earth_window_count) ? ", " : "");
    }
    fprintf(fp, "]\n  },\n");

    fprintf(fp, "  \"terrain_horizon_mask\": [");
    for (int i = 0; i < CSPICE_HORIZON_RAYS; i++) {
        fprintf(fp, "%.2f%s", r->horizon_mask_deg[i], (i + 1 < CSPICE_HORIZON_RAYS) ? ", " : "");
    }
    fprintf(fp, "],\n");

    fprintf(fp, "  \"site_comparison\": [\n");
    for (int i = 0; i < r->candidate_count; i++) {
        const CandidateComparison *c = &r->candidates[i];
        fprintf(fp, "    {\"site_name\": \"%s\", \"latitude_deg\": %.4f, \"longitude_deg\": %.4f, \"altitude_m\": %.1f, \"illumination_percent\": %.1f, \"earth_visibility_percent\": %.1f, \"slope_deg\": %.1f, \"total_sun_hours\": %.1f, \"longest_sun_hours\": %.1f, \"total_earth_hours\": %.1f, \"longest_earth_hours\": %.1f, \"dte_window_count\": %d, \"overlap_hours\": %.1f, \"longest_dark_hours\": %.1f, \"min_battery_soc_pct\": %.1f, \"mission_score\": %d, \"verdict\": \"%s\"}%s\n",
                c->site_name, c->latitude_deg, c->longitude_deg, c->altitude_m, c->illumination_percent,
                c->earth_visibility_percent, c->slope_deg, c->total_sun_hours, c->longest_sun_hours,
                c->total_earth_hours, c->longest_earth_hours, c->dte_window_count,
                c->overlap_hours, c->longest_dark_hours, c->min_battery_soc_pct,
                c->mission_score, c->verdict,
                (i + 1 < r->candidate_count) ? "," : "");
    }
    fprintf(fp, "  ],\n");

    fprintf(fp, "  \"events\": {\n");
    fprintf(fp, "    \"search_exhausted\": %s,\n", r->event_search_exhausted ? "true" : "false");
    fprintf(fp, "    \"sun\": { \"visible_now\": %s", r->sun_visible_now ? "true" : "false");
    if (r->sun_visible_now && r->hours_to_sunset >= 0.0) {
        fprintf(fp, ", \"next_sunset_utc\": \"%s\", \"hours_to_sunset\": %.2f", r->next_sunset_utc, r->hours_to_sunset);
    } else if (!r->sun_visible_now && r->hours_to_sunrise >= 0.0) {
        fprintf(fp, ", \"next_sunrise_utc\": \"%s\", \"hours_to_sunrise\": %.2f", r->next_sunrise_utc, r->hours_to_sunrise);
    }
    fprintf(fp, " },\n");
    fprintf(fp, "    \"earth\": { \"visible_now\": %s", r->earth_visible_now ? "true" : "false");
    if (r->earth_visible_now && r->hours_to_earthset >= 0.0) {
        fprintf(fp, ", \"next_earthset_utc\": \"%s\", \"hours_to_earthset\": %.2f", r->next_earthset_utc, r->hours_to_earthset);
    } else if (!r->earth_visible_now && r->hours_to_earthrise >= 0.0) {
        fprintf(fp, ", \"next_earthrise_utc\": \"%s\", \"hours_to_earthrise\": %.2f", r->next_earthrise_utc, r->hours_to_earthrise);
    }
    fprintf(fp, " }\n");
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"samples\": [\n");
    for (int i = 0; i < r->timeline_count; i++) {
        char step_utc[32];
        utc_add_hours(r->utc_start, i, step_utc, sizeof(step_utc));
        fprintf(fp, "    {\"step_index\": %d, \"utc\": \"%s\", \"sun_azimuth_deg\": %.3f, \"sun_elevation_deg\": %.3f, \"sun_frac\": %.6f, \"is_sun_visible\": %s, \"earth_azimuth_deg\": %.3f, \"earth_elevation_deg\": %.3f, \"is_earth_visible\": %s, \"soc_pct\": %.1f}%s\n",
                i, step_utc, az_json(r->timeline_sun_az[i]), r->timeline_sun_el[i], r->timeline_sun_frac[i],
                (r->timeline_sun_frac[i] > 0.25) ? "true" : "false",
                az_json(r->timeline_earth_az[i]), r->timeline_earth_el[i],
                (r->timeline_dte_vis[i] > 0.5) ? "true" : "false",
                r->timeline_soc_pct[i],
                (i + 1 < r->timeline_count) ? "," : "");
    }
    fprintf(fp, "  ]\n");
    fprintf(fp, "}\n");
}

bool export_simulation_json(const char *filepath, const SimulationResult *r) {
    if (!r) return false;
    FILE *fp = fopen(filepath, "w");
    if (!fp) return false;
    write_simulation_json(fp, r);
    fprintf(fp, "\n");
    fclose(fp);
    return true;
}

char *export_simulation_json_string(const SimulationResult *r) {
    if (!r) return NULL;
    char *buf = NULL;
    size_t sz = 0;
    FILE *fp = open_memstream(&buf, &sz);
    if (!fp) return NULL;
    write_simulation_json(fp, r);
    fclose(fp);
    return buf;
}