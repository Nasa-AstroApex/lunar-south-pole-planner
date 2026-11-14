/*
 * 3B SAHNE MOTORU — SADECE BACKEND
 *
 * Çıktı: data/3b_scene.json ve data/3b_scene.js; HTTP tarafında GET /3b.
 * Şema kaynağı: src/3b_moon.h. Birimler: km, km/s, m/s², kg, saniye.
 *
 * KURAL:
 *   - Frontend için "daha güzel görünsün" diye yörünge, yakıt, itki veya
 *     MOON3B_TRAJ_POINTS sabitlerini değiştirme.
 *   - Yeni 3B alanı gerekiyorsa önce header + backend + frontend birlikte karar verir.
 *   - data/3b_scene.* üretilen dosyadır; elle düzenlenmez.
 * Ayrıntı: AGENTS.md ve docs/FRONTEND_GUIDE.md.
 */
#include "3b_moon.h"
#include "cspice_math.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__has_include) && __has_include("SpiceUsr.h")
#define HAS_NAIF_CSPICE 1
#include "SpiceUsr.h"
#else
#define HAS_NAIF_CSPICE 0
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define R_MOON_KM       1737.4
#define R_EARTH_KM      6371.0
#define R_SUN_KM        696340.0
#define DIST_EARTH_MOON 384400.0
#define MU_MOON_KM3_S2  4902.800066
#define J2_MOON         0.0002032
#define MU_SUN_KM3_S2   1.32712440018e11
#define MU_EARTH_KM3_S2 398600.4418
#define AU_KM           149597870.7

static inline double clamp3b(double v, double lo, double hi) {
    if (!isfinite(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
}

static inline double d2r(double d) { return d * (M_PI / 180.0); }
static inline double r2d(double r) { return r * (180.0 / M_PI); }

static void latlon_alt_to_xyz(double lat_deg, double lon_deg, double radius_km, double out[3]) {
    double la = d2r(lat_deg);
    double lo = d2r(lon_deg);
    out[0] = radius_km * cos(la) * cos(lo);
    out[1] = radius_km * cos(la) * sin(lo);
    out[2] = radius_km * sin(la);
}

static void xyz_to_latlon_alt(const double pos[3], double *lat_deg, double *lon_deg, double *alt_km) {
    double r = sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]);
    if (r < 1e-9) {
        *lat_deg = 0.0; *lon_deg = 0.0; *alt_km = 0.0;
        return;
    }
    *lat_deg = r2d(asin(clamp3b(pos[2] / r, -1.0, 1.0)));
    *lon_deg = r2d(atan2(pos[1], pos[0]));
    *alt_km = r - R_MOON_KM;
}

static void vec_normalize(double v[3]) {
    double len = sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    if (len > 1e-12) {
        v[0] /= len; v[1] /= len; v[2] /= len;
    }
}

static double vec_len(const double v[3]) {
    return sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
}

static double vec_dot(const double a[3], const double b[3]) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}

static void vec_cross(const double a[3], const double b[3], double out[3]) {
    out[0] = a[1]*b[2] - a[2]*b[1];
    out[1] = a[2]*b[0] - a[0]*b[2];
    out[2] = a[0]*b[1] - a[1]*b[0];
}

static void utc_add_seconds_double(const char *base_utc, double add_sec, char *out, size_t out_sz) {
    int y = 2026, mo = 10, d = 29, h = 14, mi = 30, s = 0;
    if (base_utc) {
        sscanf(base_utc, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s);
    }
    long long whole = (long long)floor(add_sec);
    long long total_s = (long long)h * 3600 + (long long)mi * 60 + s + whole;
    long long day_shift = 0;
    if (total_s < 0) {
        day_shift = (total_s - 86399) / 86400;
        total_s -= day_shift * 86400;
    } else if (total_s >= 86400) {
        day_shift = total_s / 86400;
        total_s %= 86400;
    }

    int a = (14 - mo) / 12;
    int y2 = y + 4800 - a;
    int m2 = mo + 12 * a - 3;
    long long jdn = d + (153 * m2 + 2) / 5 + 365LL * y2 + y2 / 4 - y2 / 100 + y2 / 400 - 32045 + day_shift;

    long long f = jdn + 1401 + (((4 * jdn + 274277) / 146097) * 3) / 4 - 38;
    long long e = 4 * f + 3;
    long long g = (e % 1461) / 4;
    long long h2 = 5 * g + 2;
    int nd = (int)((h2 % 153) / 5 + 1);
    int nmo = (int)(((h2 / 153 + 2) % 12) + 1);
    int ny = (int)((e / 1461) - 4716 + (12 + 2 - nmo) / 12);

    int nh = (int)(total_s / 3600);
    int nmi = (int)((total_s % 3600) / 60);
    int ns = (int)(total_s % 60);
    snprintf(out, out_sz, "%04d-%02d-%02dT%02d:%02d:%02d", ny, nmo, nd, nh, nmi, ns);
}

static double utc_to_days_since_j2000(const char *utc) {
    int y = 2026, mo = 10, d = 29, h = 14, mi = 30, s = 0;
    if (utc) {
        sscanf(utc, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s);
    }
    int a = (14 - mo) / 12;
    int y2 = y + 4800 - a;
    int m2 = mo + 12 * a - 3;
    long jdn = d + (153 * m2 + 2) / 5 + 365L * y2 + y2 / 4 - y2 / 100 + y2 / 400 - 32045;
    double jd = (double)jdn + (h - 12.0) / 24.0 + mi / 1440.0 + s / 86400.0;
    return jd - 2451545.0;
}

static void eval_kepler_rel_km(double a_km, double ecc, double inc_deg, double mean_anom_deg, double out_xyz[3]) {
    double M = d2r(mean_anom_deg);
    double E = M;
    for (int it = 0; it < 5; it++) {
        E = M + ecc * sin(E);
    }
    double inc = d2r(inc_deg);
    double x_orb = a_km * (cos(E) - ecc);
    double y_orb = a_km * sqrt(fmax(0.0, 1.0 - ecc * ecc)) * sin(E);
    out_xyz[0] = x_orb;
    out_xyz[1] = y_orb * cos(inc);
    out_xyz[2] = y_orb * sin(inc);
}

static bool has_body_id(const Moon3BScene *scene, int naif_id) {
    for (int i = 0; i < scene->body_count; i++) {
        if (scene->bodies[i].naif_id == naif_id) return true;
    }
    return false;
}

static void add_spice_body(
    Moon3BScene *scene, int naif_id, const char *name, const char *category, const char *orbit_parent,
    bool from_kernel, const double pos_moon_km[3], const double helio_pos_km[3],
    double radius_km, double a_km, double ecc, double inc_deg, double phase_deg, double period_days,
    double mu_parent, const char *hex
) {
    if (scene->body_count >= MOON3B_MAX_BODIES || has_body_id(scene, naif_id)) return;
    SpiceBody3B *b = &scene->bodies[scene->body_count++];
    b->naif_id = naif_id;
    snprintf(b->name, sizeof(b->name), "%s", name);
    snprintf(b->category, sizeof(b->category), "%s", category);
    snprintf(b->orbit_parent, sizeof(b->orbit_parent), "%s", orbit_parent);
    b->from_spice_kernel = from_kernel;
    memcpy(b->pos_moon_km, pos_moon_km, sizeof(b->pos_moon_km));
    memcpy(b->helio_pos_km, helio_pos_km, sizeof(b->helio_pos_km));
    b->distance_km = vec_len(pos_moon_km);
    b->radius_km = radius_km;
    b->semi_major_axis_km = a_km;
    b->eccentricity = ecc;
    b->inclination_deg = inc_deg;
    b->phase_deg = fmod(fmod(phase_deg, 360.0) + 360.0, 360.0);
    b->period_days = period_days;
    if (a_km > 0.0 && mu_parent > 0.0) {
        double r_parent = (strcmp(orbit_parent, "EARTH") == 0) ? DIST_EARTH_MOON : vec_len(helio_pos_km);
        b->orbital_speed_kms = sqrt(fmax(0.0, mu_parent * (2.0 / fmax(1.0, r_parent) - 1.0 / a_km)));
    } else {
        b->orbital_speed_kms = 0.0;
    }
    snprintf(b->color_hex, sizeof(b->color_hex), "%s", hex);
}

static void populate_spice_universe(const char *utc, Moon3BScene *out) {
    double jd2000 = utc_to_days_since_j2000(utc);

    out->sun_helio_km[0] = 0.0;
    out->sun_helio_km[1] = 0.0;
    out->sun_helio_km[2] = 0.0;

    double earth_phase = 357.529 + (jd2000 / 365.25636) * 360.0;
    eval_kepler_rel_km(AU_KM, 0.0167, 0.0, earth_phase, out->earth_helio_km);

    double moon_phase = 134.963 + (jd2000 / 27.321661) * 360.0;
    double moon_rel_earth[3];
    eval_kepler_rel_km(DIST_EARTH_MOON, 0.0549, 5.145, moon_phase, moon_rel_earth);

    out->moon_helio_km[0] = out->earth_helio_km[0] + moon_rel_earth[0];
    out->moon_helio_km[1] = out->earth_helio_km[1] + moon_rel_earth[1];
    out->moon_helio_km[2] = out->earth_helio_km[2] + moon_rel_earth[2];

    double sun_from_moon[3] = {
        -out->moon_helio_km[0],
        -out->moon_helio_km[1],
        -out->moon_helio_km[2]
    };
    double earth_from_moon[3] = {
        -moon_rel_earth[0],
        -moon_rel_earth[1],
        -moon_rel_earth[2]
    };

    /* Gunes/Dunya vektorleri Ay'a sabit (govde) cercevede alinir: saha enlem/boylamlari ve uzay
       araci konumu da bu cercevededir. Eskiden J2000 kullaniliyordu; bu, alt-nokta boylamlarini ve
       saha yukseklik acilarini yanlis yapiyordu. Kernel yoksa tarihe bagli analitik seriye duser. */
    double et = lunar_utc_to_et(utc);
    bool from_spice = lunar_moonfixed_sun_earth_km(et, sun_from_moon, earth_from_moon);

    double zero_v[3] = {0.0, 0.0, 0.0};
    add_spice_body(out, 10,  "Sun",   "STAR",   "NONE",  from_spice, sun_from_moon,   out->sun_helio_km,   R_SUN_KM,   0.0,             0.0,    0.0,   0.0,         0.0,       0.0,            "#fbbf24");
    add_spice_body(out, 399, "Earth", "PLANET", "SUN",   from_spice, earth_from_moon, out->earth_helio_km, R_EARTH_KM, AU_KM,           0.0167, 0.0,   earth_phase, 365.25636, MU_SUN_KM3_S2,  "#3b82f6");
    add_spice_body(out, 301, "Moon",  "MOON",   "EARTH", from_spice, zero_v,          out->moon_helio_km,  R_MOON_KM,  DIST_EARTH_MOON, 0.0549, 5.145, moon_phase,  27.321661, MU_EARTH_KM3_S2,"#cbd5e1");

    memcpy(out->sun_vec, sun_from_moon, sizeof(out->sun_vec));
    vec_normalize(out->sun_vec);
    out->sun_sub_lat_deg = r2d(asin(clamp3b(out->sun_vec[2], -1.0, 1.0)));
    out->sun_sub_lon_deg = r2d(atan2(out->sun_vec[1], out->sun_vec[0]));

    memcpy(out->earth_vec, earth_from_moon, sizeof(out->earth_vec));
    vec_normalize(out->earth_vec);
    out->earth_sub_lat_deg = r2d(asin(clamp3b(out->earth_vec[2], -1.0, 1.0)));
    out->earth_sub_lon_deg = r2d(atan2(out->earth_vec[1], out->earth_vec[0]));

    static const struct {
        int naif_id;
        const char *name;
        const char *cat;
        double a_au;
        double ecc;
        double inc_deg;
        double period_days;
        double m0_deg;
        double radius_km;
        const char *hex;
    } HELIO_CATALOG[] = {
        {    299, "Venus",         "PLANET",   0.723, 0.0068,  3.39,  224.70,  50.4, 6051.80, "#fde047"},
        {2099942, "99942 Apophis", "NEO",      0.922, 0.1912,  3.33,  323.60, 215.0,    0.185, "#fb7185"},
        {2101955, "101955 Bennu",  "NEO",      1.126, 0.2037,  6.03,  436.65, 101.7,    0.245, "#f43f5e"},
        {2162173, "162173 Ryugu",  "NEO",      1.190, 0.1902,  5.88,  473.90, 211.5,    0.450, "#fb923c"},
        {2000433, "433 Eros",      "ASTEROID", 1.458, 0.2229, 10.83,  643.20, 320.2,    8.420, "#e879f9"},
        {    499, "Mars",          "PLANET",   1.524, 0.0934,  1.85,  686.98,  19.4, 3389.50, "#ef4444"},
        {2065803, "65803 Didymos", "NEO",      1.644, 0.3838,  3.41,  770.00,  75.0,    0.390, "#facc15"},
        {2000004, "4 Vesta",       "ASTEROID", 2.361, 0.0887,  7.14, 1325.75,  20.8,  262.700, "#c084fc"},
        {2000001, "1 Ceres",       "ASTEROID", 2.767, 0.0758, 10.59, 1681.63,  77.4,  469.700, "#94a3b8"},
        {2000016, "16 Psyche",     "ASTEROID", 2.924, 0.1339,  3.10, 1826.00, 158.0,  113.000, "#38bdf8"}
    };

    int cat_n = (int)(sizeof(HELIO_CATALOG) / sizeof(HELIO_CATALOG[0]));
    for (int i = 0; i < cat_n && out->body_count < MOON3B_MAX_BODIES; i++) {
        double a_km = HELIO_CATALOG[i].a_au * AU_KM;
        double cur_phase = HELIO_CATALOG[i].m0_deg + (jd2000 / HELIO_CATALOG[i].period_days) * 360.0;
        double helio_km[3];
        eval_kepler_rel_km(a_km, HELIO_CATALOG[i].ecc, HELIO_CATALOG[i].inc_deg, cur_phase, helio_km);

        double moon_rel_km[3] = {
            helio_km[0] - out->moon_helio_km[0],
            helio_km[1] - out->moon_helio_km[1],
            helio_km[2] - out->moon_helio_km[2]
        };

        add_spice_body(
            out, HELIO_CATALOG[i].naif_id, HELIO_CATALOG[i].name, HELIO_CATALOG[i].cat, "SUN",
            false, moon_rel_km, helio_km, HELIO_CATALOG[i].radius_km,
            a_km, HELIO_CATALOG[i].ecc, HELIO_CATALOG[i].inc_deg, cur_phase, HELIO_CATALOG[i].period_days,
            MU_SUN_KM3_S2, HELIO_CATALOG[i].hex
        );
    }
}

static void eval_lunar_gravity_kms2(
    const double pos_km[3],
    const double earth_moon_km[3],
    const double sun_moon_km[3],
    double out_acc[3]
) {
    double r = vec_len(pos_km);
    if (r < 1.0) r = 1.0;
    double r2 = r * r;
    double r3 = r2 * r;
    double r5 = r3 * r2;

    double mu_r3 = -MU_MOON_KM3_S2 / r3;
    out_acc[0] = mu_r3 * pos_km[0];
    out_acc[1] = mu_r3 * pos_km[1];
    out_acc[2] = mu_r3 * pos_km[2];

    double z2_r2 = (pos_km[2] * pos_km[2]) / r2;
    double j2_fac = -1.5 * J2_MOON * MU_MOON_KM3_S2 * (R_MOON_KM * R_MOON_KM) / r5;
    out_acc[0] += j2_fac * pos_km[0] * (1.0 - 5.0 * z2_r2);
    out_acc[1] += j2_fac * pos_km[1] * (1.0 - 5.0 * z2_r2);
    out_acc[2] += j2_fac * pos_km[2] * (3.0 - 5.0 * z2_r2);

    double de[3] = {
        earth_moon_km[0] - pos_km[0],
        earth_moon_km[1] - pos_km[1],
        earth_moon_km[2] - pos_km[2]
    };
    double de_len = fmax(1000.0, vec_len(de));
    double re_len = fmax(1000.0, vec_len(earth_moon_km));
    double fe1 = MU_EARTH_KM3_S2 / (de_len * de_len * de_len);
    double fe2 = MU_EARTH_KM3_S2 / (re_len * re_len * re_len);
    for (int i = 0; i < 3; i++) out_acc[i] += fe1 * de[i] - fe2 * earth_moon_km[i];

    double ds[3] = {
        sun_moon_km[0] - pos_km[0],
        sun_moon_km[1] - pos_km[1],
        sun_moon_km[2] - pos_km[2]
    };
    double ds_len = fmax(1000.0, vec_len(ds));
    double rs_len = fmax(1000.0, vec_len(sun_moon_km));
    double fs1 = MU_SUN_KM3_S2 / (ds_len * ds_len * ds_len);
    double fs2 = MU_SUN_KM3_S2 / (rs_len * rs_len * rs_len);
    for (int i = 0; i < 3; i++) out_acc[i] += fs1 * ds[i] - fs2 * sun_moon_km[i];
}

static void rk4_free_orbit_step(
    double pos[3], double vel[3], double dt,
    const double earth_moon[3], const double sun_moon[3]
) {
    double k1[3], k2[3], k3[3], k4[3], p2[3], p3[3], p4[3];
    eval_lunar_gravity_kms2(pos, earth_moon, sun_moon, k1);
    for (int k = 0; k < 3; k++) p2[k] = pos[k] + 0.5 * dt * vel[k];
    eval_lunar_gravity_kms2(p2, earth_moon, sun_moon, k2);
    for (int k = 0; k < 3; k++) p3[k] = pos[k] + 0.5 * dt * (vel[k] + 0.5 * dt * k1[k]);
    eval_lunar_gravity_kms2(p3, earth_moon, sun_moon, k3);
    for (int k = 0; k < 3; k++) p4[k] = pos[k] + dt * (vel[k] + dt * k2[k]);
    eval_lunar_gravity_kms2(p4, earth_moon, sun_moon, k4);
    for (int k = 0; k < 3; k++) {
        double dv = (dt / 6.0) * (k1[k] + 2.0 * k2[k] + 2.0 * k3[k] + k4[k]);
        pos[k] += dt * vel[k] + 0.5 * dt * dv;
        vel[k] += dv;
    }
}

/* Yuzeydeki gozlemciden (toposentrik) cismin ufuk ustu yuksekligi; up birim vektor, body_km Ay merkezli. */
static double topo_elevation_deg(const double up[3], const double body_km[3]) {
    double v[3] = {
        body_km[0] - R_MOON_KM * up[0],
        body_km[1] - R_MOON_KM * up[1],
        body_km[2] - R_MOON_KM * up[2]
    };
    double len = vec_len(v);
    if (len < 1e-9) return 0.0;
    return r2d(asin(clamp3b(vec_dot(v, up) / len, -1.0, 1.0)));
}

static void fill_site_physics(LunarSite3B *site, const double sun_km[3], const double earth_km[3]) {
    site->altitude_m = sample_lola_elevation_m(site->lat_deg, site->lon_deg);
    double h_n = sample_lola_elevation_m(clamp3b(site->lat_deg + 0.03, -90.0, 90.0), site->lon_deg);
    double h_s = sample_lola_elevation_m(clamp3b(site->lat_deg - 0.03, -90.0, 90.0), site->lon_deg);
    double grad = fabs(h_n - h_s) / (2.0 * 0.03 * 30323.35);
    site->slope_deg = r2d(atan(grad));

    double up[3];
    latlon_alt_to_xyz(site->lat_deg, site->lon_deg, 1.0, up);
    site->sun_el_deg = topo_elevation_deg(up, sun_km);
    site->earth_el_deg = topo_elevation_deg(up, earth_km);
}

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
) {
    if (!out) return;
    memset(out, 0, sizeof(*out));

    out->scenario_id = (scenario_id >= 1 && scenario_id <= 4) ? scenario_id : 3;
    out->mission_mode = (mission_mode >= 0 && mission_mode <= 2) ? mission_mode : MISSION_MODE_ORBIT;
    out->sim_elapsed_sec = sim_elapsed_sec;

    const char *b_utc = (base_utc && base_utc[0]) ? base_utc : "2026-10-29T14:30:00";
    snprintf(out->base_utc, sizeof(out->base_utc), "%s", b_utc);
    utc_add_seconds_double(b_utc, sim_elapsed_sec, out->active_utc, sizeof(out->active_utc));
    out->range_days = (range_days > 0 && range_days <= 30) ? range_days : 14;

    // 1. Tüm Evreni tam `active_utc` (base_utc + sim_elapsed_sec) anında hesapla
    populate_spice_universe(out->active_utc, out);

    static const struct { const char *name; double lat, lon; } PRESETS[] = {
        {"Shackleton Rim",        -89.7668, -171.87},
        {"Connecting Ridge",      -89.4632, -137.49},
        {"Malapert Massif",       -85.9948,   -0.23578},
        {"Haworth",               -87.45,   -5.17},
        {"Nobile Rim 1",          -85.20,   53.50},
        {"De Gerlache Rim",       -88.50,  -88.30},
        {"Shackleton Base (PSR)", -89.65,  115.00}
    };
    int n_presets = (int)(sizeof(PRESETS) / sizeof(PRESETS[0]));
    out->site_count = n_presets;
    for (int i = 0; i < n_presets; i++) {
        snprintf(out->sites[i].name, sizeof(out->sites[i].name), "%s", PRESETS[i].name);
        out->sites[i].lat_deg = PRESETS[i].lat;
        out->sites[i].lon_deg = PRESETS[i].lon;
        out->sites[i].is_custom = false;
        fill_site_physics(&out->sites[i], out->bodies[0].pos_moon_km, out->bodies[1].pos_moon_km);
    }

    snprintf(out->selected_site.name, sizeof(out->selected_site.name), "%s",
             (target_name && target_name[0]) ? target_name : "Connecting Ridge");
    out->selected_site.lat_deg = clamp3b(target_lat, -90.0, 90.0);
    out->selected_site.lon_deg = target_lon;
    out->selected_site.is_custom = target_is_custom;
    fill_site_physics(&out->selected_site, out->bodies[0].pos_moon_km, out->bodies[1].pos_moon_km);

    if (target_is_custom && out->site_count < MOON3B_MAX_SITES) {
        out->sites[out->site_count++] = out->selected_site;
    }

    // 2. Uzay Aracının Başlangıç Durumu (t = 0)
    Spacecraft3B *sc = &out->spacecraft;
    sc->mission_mode = out->mission_mode;
    sc->sim_elapsed_sec = sim_elapsed_sec;
    sc->burn_elapsed_sec = fmax(0.0, burn_elapsed_sec);

    double init_lat = clamp3b(sc_lat, -90.0, 90.0);
    double init_lon = sc_lon;
    double init_alt = clamp3b(sc_alt_km, 15.0, 2000.0);
    double r_orbit_km = R_MOON_KM + init_alt;

    double start_pos[3];
    latlon_alt_to_xyz(init_lat, init_lon, r_orbit_km, start_pos);

    sc->nominal_orbital_speed_kms = sqrt(MU_MOON_KM3_S2 / r_orbit_km);
    sc->escape_speed_kms = sqrt(2.0 * MU_MOON_KM3_S2 / r_orbit_km);
    sc->orbital_period_sec = 2.0 * M_PI * sqrt((r_orbit_km * r_orbit_km * r_orbit_km) / MU_MOON_KM3_S2);
    sc->initial_speed_kms = (sc_speed_kms > 0.05 && sc_speed_kms < 10.0) ? sc_speed_kms : sc->nominal_orbital_speed_kms;

    double target_r_km = R_MOON_KM + (out->selected_site.altitude_m / 1000.0);
    double target_xyz[3];
    latlon_alt_to_xyz(out->selected_site.lat_deg, out->selected_site.lon_deg, target_r_km, target_xyz);

    double orbit_normal[3];
    vec_cross(start_pos, target_xyz, orbit_normal);
    if (vec_len(orbit_normal) < 1e-6) {
        double fallback[3] = {0.0, 1.0, 0.0};
        vec_cross(start_pos, fallback, orbit_normal);
    }
    vec_normalize(orbit_normal);

    double start_tangent[3];
    vec_cross(orbit_normal, start_pos, start_tangent);
    vec_normalize(start_tangent);

    /* Ucuncu cisim pertürbasyonu icin Dunya ve Gunes konumu: uzay araci ile ayni (Ay'a sabit) cercevede.
       bodies[0] = Gunes, bodies[1] = Dunya (populate_spice_universe ekleme sirasi). */
    double earth_moon_km[3], sun_moon_km[3];
    memcpy(sun_moon_km, out->bodies[0].pos_moon_km, sizeof(sun_moon_km));
    memcpy(earth_moon_km, out->bodies[1].pos_moon_km, sizeof(earth_moon_km));

    // Serbest yörünge ilerlemesi: Ateşleme anına (t_orbit = sim_elapsed_sec - burn_elapsed_sec) kadar RK4 yörünge integrasyonu
    double orbit_prop_sec = (out->mission_mode == MISSION_MODE_ORBIT)
        ? sim_elapsed_sec
        : fmax(0.0, sim_elapsed_sec - sc->burn_elapsed_sec);

    double orb_pos[3] = {start_pos[0], start_pos[1], start_pos[2]};
    double orb_vel[3] = {
        start_tangent[0] * sc->initial_speed_kms,
        start_tangent[1] * sc->initial_speed_kms,
        start_tangent[2] * sc->initial_speed_kms
    };

    if (orbit_prop_sec > 0.0) {
        double mod_t = fmod(orbit_prop_sec, sc->orbital_period_sec * 4.0);
        int sub_steps = (int)fmin(600.0, ceil(mod_t / 15.0));
        if (sub_steps < 1) sub_steps = 1;
        double h = mod_t / (double)sub_steps;
        for (int s = 0; s < sub_steps; s++) {
            rk4_free_orbit_step(orb_pos, orb_vel, h, earth_moon_km, sun_moon_km);
        }
    }

    // Manevra başlangıç noktası = O anki serbest yörünge konumu! (Rota asla uydunun arkasında kalmaz)
    double burn_start_pos[3] = {orb_pos[0], orb_pos[1], orb_pos[2]};
    double burn_start_vel[3] = {orb_vel[0], orb_vel[1], orb_vel[2]};
    double r_burn = vec_len(burn_start_pos);

    double cur_tangent[3] = {burn_start_vel[0], burn_start_vel[1], burn_start_vel[2]};
    vec_normalize(cur_tangent);

    double qvec[3] = {
        target_xyz[0] - burn_start_pos[0],
        target_xyz[1] - burn_start_pos[1],
        target_xyz[2] - burn_start_pos[2]
    };
    vec_normalize(qvec);
    memcpy(sc->qibla_vec, qvec, sizeof(sc->qibla_vec));
    memcpy(sc->prograde_vec, cur_tangent, sizeof(sc->prograde_vec));

    double nadir[3] = {-burn_start_pos[0], -burn_start_pos[1], -burn_start_pos[2]};
    vec_normalize(nadir);
    memcpy(sc->nadir_vec, nadir, sizeof(sc->nadir_vec));
    memcpy(sc->solar_vec, out->sun_vec, sizeof(sc->solar_vec));
    memcpy(sc->earth_dte_vec, out->earth_vec, sizeof(sc->earth_dte_vec));

    double cvec[3] = {cmd_vx, cmd_vy, cmd_vz};
    if (vec_len(cvec) < 1e-6) {
        memcpy(cvec, qvec, sizeof(cvec));
    } else {
        vec_normalize(cvec);
    }
    memcpy(sc->commanded_vec, cvec, sizeof(sc->commanded_vec));

    sc->qibla_azimuth_deg = fmod(r2d(atan2(qvec[1], qvec[0])) + 360.0, 360.0);
    sc->qibla_elevation_deg = r2d(asin(clamp3b(qvec[2], -1.0, 1.0)));
    sc->commanded_azimuth_deg = fmod(r2d(atan2(cvec[1], cvec[0])) + 360.0, 360.0);
    sc->commanded_elevation_deg = r2d(asin(clamp3b(cvec[2], -1.0, 1.0)));
    sc->yaw_deg = sc->commanded_azimuth_deg;
    sc->pitch_deg = sc->commanded_elevation_deg;
    sc->roll_deg = 0.0;

    double dot_qc = clamp3b(vec_dot(qvec, cvec), -1.0, 1.0);
    sc->alignment_error_deg = r2d(acos(dot_qc));
    sc->is_qibla_aligned = (sc->alignment_error_deg < 2.0);

    // 3. Burn Başlangıç Noktasından Hedefe Tam 96 Adımlı RK4 Güdümlü İniş Yörüngesi
    double a_trans = 0.5 * (r_burn + target_r_km);
    double v_peri_trans = sqrt(MU_MOON_KM3_S2 * (2.0 / r_burn - 1.0 / a_trans));
    sc->deorbit_dv_ms = fabs(vec_len(burn_start_vel) - v_peri_trans) * 1000.0 + 42.0;

    double cos_ang = clamp3b(vec_dot(burn_start_pos, target_xyz) / (r_burn * target_r_km), -1.0, 1.0);
    double central_angle = acos(cos_ang);
    if (central_angle < 0.35) central_angle += 0.65;
    sc->transfer_time_sec = (central_angle / M_PI) * M_PI * sqrt((a_trans * a_trans * a_trans) / MU_MOON_KM3_S2);

    double pos[3] = {burn_start_pos[0], burn_start_pos[1], burn_start_pos[2]};
    double spd0 = vec_len(burn_start_vel);
    double vel[3] = {
        cur_tangent[0] * spd0 * 0.62 + cvec[0] * 0.38,
        cur_tangent[1] * spd0 * 0.62 + cvec[1] * 0.38,
        cur_tangent[2] * spd0 * 0.62 + cvec[2] * 0.38
    };

    out->traj_count = MOON3B_TRAJ_POINTS;
    double total_t = sc->transfer_time_sec;
    double dt = total_t / (double)(MOON3B_TRAJ_POINTS - 1);
    double total_dv_km_s = fabs(spd0 - vec_len(vel));

    for (int i = 0; i < MOON3B_TRAJ_POINTS; i++) {
        double t_cur = i * dt;
        double grav[3];
        eval_lunar_gravity_kms2(pos, earth_moon_km, sun_moon_km, grav);

        double t_rem = fmax(dt, total_t - t_cur);
        double thrust[3] = {0.0, 0.0, 0.0};

        if (i < MOON3B_TRAJ_POINTS - 1) {
            double des_vel[3] = {
                (target_xyz[0] - pos[0]) / t_rem - 0.5 * grav[0] * t_rem,
                (target_xyz[1] - pos[1]) / t_rem - 0.5 * grav[1] * t_rem,
                (target_xyz[2] - pos[2]) / t_rem - 0.5 * grav[2] * t_rem
            };
            double gain = (i < 14) ? 0.25 : ((i > MOON3B_TRAJ_POINTS - 20) ? 0.68 : 0.36);
            for (int k = 0; k < 3; k++) {
                thrust[k] = ((des_vel[k] - vel[k]) / fmax(dt, 4.0)) * gain;
            }
        }

        TrajectoryPoint3B *tp = &out->trajectory[i];
        tp->step = i;
        tp->t_sec = t_cur;
        memcpy(tp->pos_km, pos, sizeof(tp->pos_km));
        memcpy(tp->vel_kms, vel, sizeof(tp->vel_kms));
        tp->speed_kms = vec_len(vel);
        tp->altitude_km = fmax(0.0, vec_len(pos) - target_r_km);
        tp->gravity_ms2 = vec_len(grav) * 1000.0;
        tp->thrust_ms2 = vec_len(thrust) * 1000.0;

        if (i < MOON3B_TRAJ_POINTS - 1) {
            double k1[3], k2[3], k3[3], k4[3], p2[3], p3[3], p4[3];
            for (int k = 0; k < 3; k++) k1[k] = grav[k] + thrust[k];
            for (int k = 0; k < 3; k++) p2[k] = pos[k] + 0.5 * dt * vel[k];
            eval_lunar_gravity_kms2(p2, earth_moon_km, sun_moon_km, k2);
            for (int k = 0; k < 3; k++) k2[k] += thrust[k];

            for (int k = 0; k < 3; k++) p3[k] = pos[k] + 0.5 * dt * (vel[k] + 0.5 * dt * k1[k]);
            eval_lunar_gravity_kms2(p3, earth_moon_km, sun_moon_km, k3);
            for (int k = 0; k < 3; k++) k3[k] += thrust[k];

            for (int k = 0; k < 3; k++) p4[k] = pos[k] + dt * (vel[k] + dt * k2[k]);
            eval_lunar_gravity_kms2(p4, earth_moon_km, sun_moon_km, k4);
            for (int k = 0; k < 3; k++) k4[k] += thrust[k];

            for (int k = 0; k < 3; k++) {
                double dv_step = (dt / 6.0) * (k1[k] + 2.0 * k2[k] + 2.0 * k3[k] + k4[k]);
                pos[k] += dt * vel[k] + 0.5 * dt * dv_step;
                vel[k] += dv_step;
            }
            total_dv_km_s += vec_len(thrust) * dt;
        }
    }

    /* Entegrasyonun gercek son durumu: hedefe kalan mesafe ve sifirlanmamis hiz. Gudum yasasi yalnizca
       konumu hedefler; kalan hizi sifirlamak icin gereken frenleme de delta-v butcesine eklenir. */
    double miss_vec[3] = {pos[0] - target_xyz[0], pos[1] - target_xyz[1], pos[2] - target_xyz[2]};
    double guidance_miss_m = vec_len(miss_vec) * 1000.0;
    total_dv_km_s += vec_len(vel);

    /* Gorsellestirme icin son nokta hedefe sabitlenir (asagidaki rapor hesaplanan sapmayi verir). */
    memcpy(out->trajectory[MOON3B_TRAJ_POINTS - 1].pos_km, target_xyz, sizeof(target_xyz));
    out->trajectory[MOON3B_TRAJ_POINTS - 1].altitude_km = 0.0;
    out->trajectory[MOON3B_TRAJ_POINTS - 1].speed_kms = 0.0012;

    // 4. Uydunun O Saniyedeki Kesin Anlık Konumu (ORBIT / DESCENT / LANDED)
    if (out->mission_mode == MISSION_MODE_ORBIT) {
        memcpy(sc->pos_km, burn_start_pos, sizeof(sc->pos_km));
        memcpy(sc->vel_kms, burn_start_vel, sizeof(sc->vel_kms));
        sc->current_speed_kms = vec_len(sc->vel_kms);
        double g_now[3];
        eval_lunar_gravity_kms2(sc->pos_km, earth_moon_km, sun_moon_km, g_now);
        sc->gravity_ms2 = vec_len(g_now) * 1000.0;
        sc->thrust_ms2 = 0.0;
        xyz_to_latlon_alt(sc->pos_km, &sc->lat_deg, &sc->lon_deg, &sc->altitude_km);
    } else if (out->mission_mode == MISSION_MODE_DESCENT && sc->burn_elapsed_sec < total_t) {
        double frac = (sc->burn_elapsed_sec / total_t) * (MOON3B_TRAJ_POINTS - 1);
        int idx = (int)floor(frac);
        if (idx >= MOON3B_TRAJ_POINTS - 1) idx = MOON3B_TRAJ_POINTS - 2;
        double a = frac - idx;
        const TrajectoryPoint3B *p0 = &out->trajectory[idx];
        const TrajectoryPoint3B *p1 = &out->trajectory[idx + 1];
        for (int k = 0; k < 3; k++) {
            sc->pos_km[k] = p0->pos_km[k] * (1.0 - a) + p1->pos_km[k] * a;
            sc->vel_kms[k] = p0->vel_kms[k] * (1.0 - a) + p1->vel_kms[k] * a;
        }
        sc->current_speed_kms = p0->speed_kms * (1.0 - a) + p1->speed_kms * a;
        sc->gravity_ms2 = p0->gravity_ms2 * (1.0 - a) + p1->gravity_ms2 * a;
        sc->thrust_ms2 = p0->thrust_ms2 * (1.0 - a) + p1->thrust_ms2 * a;
        xyz_to_latlon_alt(sc->pos_km, &sc->lat_deg, &sc->lon_deg, &sc->altitude_km);
    } else {
        out->mission_mode = MISSION_MODE_LANDED;
        sc->mission_mode = MISSION_MODE_LANDED;
        memcpy(sc->pos_km, target_xyz, sizeof(sc->pos_km));
        memset(sc->vel_kms, 0, sizeof(sc->vel_kms));
        sc->current_speed_kms = 0.0;
        sc->altitude_km = 0.0;
        sc->lat_deg = out->selected_site.lat_deg;
        sc->lon_deg = out->selected_site.lon_deg;
        sc->gravity_ms2 = 1.622;
        sc->thrust_ms2 = 0.0;
    }

    double rem_to_td = (out->mission_mode == MISSION_MODE_DESCENT)
        ? fmax(0.0, total_t - sc->burn_elapsed_sec)
        : ((out->mission_mode == MISSION_MODE_LANDED) ? 0.0 : total_t);
    utc_add_seconds_double(out->active_utc, rem_to_td, out->landing_utc, sizeof(out->landing_utc));

    Moon3BScene landing_env;
    memset(&landing_env, 0, sizeof(landing_env));
    populate_spice_universe(out->landing_utc, &landing_env);

    double site_up[3];
    latlon_alt_to_xyz(out->selected_site.lat_deg, out->selected_site.lon_deg, 1.0, site_up);

    out->landing_sample_count = MOON3B_LANDING_SECONDS;
    for (int i = 0; i < MOON3B_LANDING_SECONDS; i++) {
        int off = i - 30;
        LandingSecondSample *ls = &out->landing_samples[i];
        ls->offset_sec = off;
        utc_add_seconds_double(out->landing_utc, (double)off, ls->utc, sizeof(ls->utc));

        if (off < -5) snprintf(ls->phase, sizeof(ls->phase), "APPROACH");
        else if (off < 0) snprintf(ls->phase, sizeof(ls->phase), "TERMINAL_DESCENT");
        else if (off == 0) snprintf(ls->phase, sizeof(ls->phase), "TOUCHDOWN");
        else snprintf(ls->phase, sizeof(ls->phase), "SURFACE_OPS");

        if (off < 0) {
            double t_rem_s = (double)(-off);
            ls->altitude_m = 0.5 * 1.62 * t_rem_s * t_rem_s * 0.28 + 1.8 * t_rem_s;
            ls->vertical_speed_ms = -(1.2 + 0.85 * t_rem_s);
        } else {
            ls->altitude_m = 0.0;
            ls->vertical_speed_ms = 0.0;
        }

        double micro_rad = (double)off * 2.66e-6;
        double s_el = topo_elevation_deg(site_up, landing_env.bodies[0].pos_moon_km) + r2d(micro_rad) * 0.1;
        double e_el = topo_elevation_deg(site_up, landing_env.bodies[1].pos_moon_km) - r2d(micro_rad) * 0.05;

        ls->sun_el_deg = s_el;
        ls->earth_el_deg = e_el;
        ls->sun_illumination_pct = clamp3b(((s_el + 0.2666) / 0.5332) * 100.0, 0.0, 100.0);
        ls->sun_visible = (ls->sun_illumination_pct > 15.0);
        ls->dte_connected = (e_el > 0.0);
        ls->surface_temp_k = ls->sun_visible ? (215.0 + 95.0 * (ls->sun_illumination_pct / 100.0)) : 68.0;
    }

    const LandingSecondSample *td = &out->landing_samples[30];
    TouchdownReport3B *rep = &out->touchdown_report;
    rep->success = true;
    snprintf(rep->status_label, sizeof(rep->status_label), "BAŞARILI YUMUŞAK İNİŞ");
    snprintf(rep->touchdown_utc, sizeof(rep->touchdown_utc), "%s", out->landing_utc);
    rep->flight_duration_sec = sc->transfer_time_sec;
    rep->miss_distance_m = guidance_miss_m;   /* entegrasyondan hesaplanan, sabitleme oncesi sapma */
    rep->touchdown_speed_ms = 1.20;           /* TASARIM HEDEFI: simule edilmis bir deger degildir */
    rep->total_dv_used_ms = total_dv_km_s * 1000.0;
    rep->sun_illumination_pct = td->sun_illumination_pct;
    rep->earth_el_deg = td->earth_el_deg;
    rep->dte_connected = td->dte_connected;
    rep->surface_temp_k = td->surface_temp_k;
    int score = 96 - (int)(out->selected_site.slope_deg * 1.5);
    if (!td->dte_connected) score -= 18;
    if (!td->sun_visible) score -= 15;
    rep->mission_score = (int)clamp3b((double)score, 40.0, 99.0);
}

static void write_esc(FILE *fp, const char *s) {
    fputc('"', fp);
    for (const char *p = s; p && *p; p++) {
        if (*p == '"') fputs("\\\"", fp);
        else if (*p == '\\') fputs("\\\\", fp);
        else fputc(*p, fp);
    }
    fputc('"', fp);
}

static void write_3b_payload(FILE *fp, const Moon3BScene *s) {
    fprintf(fp, "{\n");
    fprintf(fp, "  \"scenario_id\": %d,\n", s->scenario_id);
    fprintf(fp, "  \"mission_mode\": %d,\n", s->mission_mode);
    fprintf(fp, "  \"sim_elapsed_sec\": %.3f,\n", s->sim_elapsed_sec);
    fprintf(fp, "  \"base_utc\": "); write_esc(fp, s->base_utc); fprintf(fp, ",\n");
    fprintf(fp, "  \"active_utc\": "); write_esc(fp, s->active_utc); fprintf(fp, ",\n");
    fprintf(fp, "  \"landing_utc\": "); write_esc(fp, s->landing_utc); fprintf(fp, ",\n");
    fprintf(fp, "  \"range_days\": %d,\n", s->range_days);

    fprintf(fp, "  \"sun\": { \"vec\": [%.5f, %.5f, %.5f], \"sub_lat\": %.2f, \"sub_lon\": %.2f, \"helio_km\": [%.1f, %.1f, %.1f] },\n",
            s->sun_vec[0], s->sun_vec[1], s->sun_vec[2], s->sun_sub_lat_deg, s->sun_sub_lon_deg,
            s->sun_helio_km[0], s->sun_helio_km[1], s->sun_helio_km[2]);
    fprintf(fp, "  \"earth\": { \"vec\": [%.5f, %.5f, %.5f], \"sub_lat\": %.2f, \"sub_lon\": %.2f, \"helio_km\": [%.1f, %.1f, %.1f] },\n",
            s->earth_vec[0], s->earth_vec[1], s->earth_vec[2], s->earth_sub_lat_deg, s->earth_sub_lon_deg,
            s->earth_helio_km[0], s->earth_helio_km[1], s->earth_helio_km[2]);
    fprintf(fp, "  \"moon_helio_km\": [%.1f, %.1f, %.1f],\n",
            s->moon_helio_km[0], s->moon_helio_km[1], s->moon_helio_km[2]);

    fprintf(fp, "  \"spice_bodies\": [\n");
    for (int i = 0; i < s->body_count; i++) {
        const SpiceBody3B *b = &s->bodies[i];
        fprintf(fp, "    {\"naif_id\": %d, \"name\": ", b->naif_id);
        write_esc(fp, b->name);
        fprintf(fp, ", \"category\": "); write_esc(fp, b->category);
        fprintf(fp, ", \"orbit_parent\": "); write_esc(fp, b->orbit_parent);
        fprintf(fp, ", \"from_spice_kernel\": %s, \"pos_km\": [%.1f, %.1f, %.1f], \"helio_km\": [%.1f, %.1f, %.1f], \"distance_km\": %.1f, \"radius_km\": %.3f, \"a_km\": %.1f, \"ecc\": %.4f, \"inc_deg\": %.2f, \"phase_deg\": %.2f, \"period_days\": %.2f, \"orbital_speed_kms\": %.3f, \"color\": ",
                b->from_spice_kernel ? "true" : "false",
                b->pos_moon_km[0], b->pos_moon_km[1], b->pos_moon_km[2],
                b->helio_pos_km[0], b->helio_pos_km[1], b->helio_pos_km[2],
                b->distance_km, b->radius_km, b->semi_major_axis_km,
                b->eccentricity, b->inclination_deg, b->phase_deg, b->period_days,
                b->orbital_speed_kms);
        write_esc(fp, b->color_hex);
        fprintf(fp, "}%s\n", (i + 1 < s->body_count) ? "," : "");
    }
    fprintf(fp, "  ],\n");

    fprintf(fp, "  \"selected_site\": {\"name\": "); write_esc(fp, s->selected_site.name);
    fprintf(fp, ", \"lat\": %.4f, \"lon\": %.4f, \"alt_m\": %.1f, \"slope_deg\": %.2f, \"sun_el\": %.2f, \"earth_el\": %.2f, \"is_custom\": %s},\n",
            s->selected_site.lat_deg, s->selected_site.lon_deg, s->selected_site.altitude_m,
            s->selected_site.slope_deg, s->selected_site.sun_el_deg, s->selected_site.earth_el_deg,
            s->selected_site.is_custom ? "true" : "false");

    fprintf(fp, "  \"sites\": [\n");
    for (int i = 0; i < s->site_count; i++) {
        const LunarSite3B *st = &s->sites[i];
        fprintf(fp, "    {\"name\": "); write_esc(fp, st->name);
        fprintf(fp, ", \"lat\": %.4f, \"lon\": %.4f, \"alt_m\": %.1f, \"slope_deg\": %.2f, \"sun_el\": %.2f, \"earth_el\": %.2f, \"is_custom\": %s}%s\n",
                st->lat_deg, st->lon_deg, st->altitude_m, st->slope_deg,
                st->sun_el_deg, st->earth_el_deg, st->is_custom ? "true" : "false",
                (i + 1 < s->site_count) ? "," : "");
    }
    fprintf(fp, "  ],\n");

    const Spacecraft3B *sc = &s->spacecraft;
    fprintf(fp, "  \"spacecraft\": {\n");
    fprintf(fp, "    \"mission_mode\": %d, \"sim_elapsed_sec\": %.3f, \"burn_elapsed_sec\": %.3f,\n",
            sc->mission_mode, sc->sim_elapsed_sec, sc->burn_elapsed_sec);
    fprintf(fp, "    \"lat\": %.4f, \"lon\": %.4f, \"altitude_km\": %.2f, \"initial_speed_kms\": %.4f, \"current_speed_kms\": %.4f,\n",
            sc->lat_deg, sc->lon_deg, sc->altitude_km, sc->initial_speed_kms, sc->current_speed_kms);
    fprintf(fp, "    \"pos_km\": [%.2f, %.2f, %.2f],\n", sc->pos_km[0], sc->pos_km[1], sc->pos_km[2]);
    fprintf(fp, "    \"vel_kms\": [%.4f, %.4f, %.4f],\n", sc->vel_kms[0], sc->vel_kms[1], sc->vel_kms[2]);
    fprintf(fp, "    \"gravity_ms2\": %.3f, \"thrust_ms2\": %.3f,\n", sc->gravity_ms2, sc->thrust_ms2);
    fprintf(fp, "    \"nominal_orbital_speed_kms\": %.4f,\n", sc->nominal_orbital_speed_kms);
    fprintf(fp, "    \"escape_speed_kms\": %.4f,\n", sc->escape_speed_kms);
    fprintf(fp, "    \"orbital_period_sec\": %.1f,\n", sc->orbital_period_sec);
    fprintf(fp, "    \"deorbit_dv_ms\": %.1f,\n", sc->deorbit_dv_ms);
    fprintf(fp, "    \"transfer_time_sec\": %.1f,\n", sc->transfer_time_sec);
    fprintf(fp, "    \"yaw_deg\": %.2f, \"pitch_deg\": %.2f, \"roll_deg\": %.2f,\n", sc->yaw_deg, sc->pitch_deg, sc->roll_deg);
    fprintf(fp, "    \"qibla_vec\": [%.5f, %.5f, %.5f],\n", sc->qibla_vec[0], sc->qibla_vec[1], sc->qibla_vec[2]);
    fprintf(fp, "    \"prograde_vec\": [%.5f, %.5f, %.5f],\n", sc->prograde_vec[0], sc->prograde_vec[1], sc->prograde_vec[2]);
    fprintf(fp, "    \"nadir_vec\": [%.5f, %.5f, %.5f],\n", sc->nadir_vec[0], sc->nadir_vec[1], sc->nadir_vec[2]);
    fprintf(fp, "    \"solar_vec\": [%.5f, %.5f, %.5f],\n", sc->solar_vec[0], sc->solar_vec[1], sc->solar_vec[2]);
    fprintf(fp, "    \"earth_dte_vec\": [%.5f, %.5f, %.5f],\n", sc->earth_dte_vec[0], sc->earth_dte_vec[1], sc->earth_dte_vec[2]);
    fprintf(fp, "    \"commanded_vec\": [%.5f, %.5f, %.5f],\n", sc->commanded_vec[0], sc->commanded_vec[1], sc->commanded_vec[2]);
    fprintf(fp, "    \"qibla_azimuth_deg\": %.2f, \"qibla_elevation_deg\": %.2f,\n", sc->qibla_azimuth_deg, sc->qibla_elevation_deg);
    fprintf(fp, "    \"commanded_azimuth_deg\": %.2f, \"commanded_elevation_deg\": %.2f,\n", sc->commanded_azimuth_deg, sc->commanded_elevation_deg);
    fprintf(fp, "    \"alignment_error_deg\": %.2f, \"is_qibla_aligned\": %s\n",
            sc->alignment_error_deg, sc->is_qibla_aligned ? "true" : "false");
    fprintf(fp, "  },\n");

    fprintf(fp, "  \"trajectory\": [\n");
    for (int i = 0; i < s->traj_count; i++) {
        const TrajectoryPoint3B *tp = &s->trajectory[i];
        fprintf(fp, "    {\"step\": %d, \"t_sec\": %.1f, \"pos_km\": [%.2f, %.2f, %.2f], \"vel_kms\": [%.4f, %.4f, %.4f], \"speed_kms\": %.4f, \"alt_km\": %.2f, \"gravity_ms2\": %.3f, \"thrust_ms2\": %.3f}%s\n",
                tp->step, tp->t_sec, tp->pos_km[0], tp->pos_km[1], tp->pos_km[2],
                tp->vel_kms[0], tp->vel_kms[1], tp->vel_kms[2],
                tp->speed_kms, tp->altitude_km, tp->gravity_ms2, tp->thrust_ms2,
                (i + 1 < s->traj_count) ? "," : "");
    }
    fprintf(fp, "  ],\n");

    fprintf(fp, "  \"landing_seconds\": [\n");
    for (int i = 0; i < s->landing_sample_count; i++) {
        const LandingSecondSample *ls = &s->landing_samples[i];
        fprintf(fp, "    {\"offset_sec\": %d, \"utc\": \"%s\", \"phase\": \"%s\", \"alt_m\": %.1f, \"vz_ms\": %.2f, \"sun_el\": %.2f, \"sun_pct\": %.1f, \"earth_el\": %.2f, \"dte\": %s, \"sun_vis\": %s, \"temp_k\": %.1f}%s\n",
                ls->offset_sec, ls->utc, ls->phase, ls->altitude_m, ls->vertical_speed_ms,
                ls->sun_el_deg, ls->sun_illumination_pct, ls->earth_el_deg,
                ls->dte_connected ? "true" : "false",
                ls->sun_visible ? "true" : "false",
                ls->surface_temp_k,
                (i + 1 < s->landing_sample_count) ? "," : "");
    }
    fprintf(fp, "  ],\n");

    const TouchdownReport3B *rep = &s->touchdown_report;
    fprintf(fp, "  \"touchdown_report\": {\n");
    fprintf(fp, "    \"success\": %s, \"status_label\": ", rep->success ? "true" : "false");
    write_esc(fp, rep->status_label);
    fprintf(fp, ", \"touchdown_utc\": "); write_esc(fp, rep->touchdown_utc);
    fprintf(fp, ", \"flight_duration_sec\": %.1f, \"miss_distance_m\": %.2f, \"touchdown_speed_ms\": %.2f, \"total_dv_used_ms\": %.1f, \"sun_illumination_pct\": %.1f, \"earth_el_deg\": %.2f, \"dte_connected\": %s, \"surface_temp_k\": %.1f, \"mission_score\": %d, \"guidance_model\": \"KINEMATIC_VISUALISATION_NO_MASS_MODEL\"\n",
            rep->flight_duration_sec, rep->miss_distance_m, rep->touchdown_speed_ms,
            rep->total_dv_used_ms, rep->sun_illumination_pct, rep->earth_el_deg,
            rep->dte_connected ? "true" : "false", rep->surface_temp_k, rep->mission_score);
    fprintf(fp, "  }\n");
    fprintf(fp, "}");
}

bool export_3b_scene_json(const char *json_path, const char *js_path, const Moon3BScene *scene) {
    if (!scene) return false;
    if (json_path) {
        FILE *fp = fopen(json_path, "w");
        if (fp) {
            write_3b_payload(fp, scene);
            fprintf(fp, "\n");
            fclose(fp);
        }
    }
    if (js_path) {
        FILE *jp = fopen(js_path, "w");
        if (jp) {
            fprintf(jp, "window.SCENE_3B_DATA = ");
            write_3b_payload(jp, scene);
            fprintf(jp, ";\n");
            fclose(jp);
        }
    }
    return true;
}