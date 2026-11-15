/*
 * BACKEND GİRİŞ NOKTASI — CLI + HTTP
 *
 * Bu dosya yalnızca backend katmanıdır:
 *   - GET /3b?...  -> 3B sahne (data/3b_scene.json)
 *   - Diğer GET'ler -> 2D görev planı (data/output.json)
 *   - POST gövdesi şu an parse EDİLMEZ; yalnızca query parametreleri okunur.
 *
 * KURAL: UI düzelsin diye burada fizik, yörünge veya JSON alan adı değiştirme.
 * Sözleşme ve frontend kuralları: AGENTS.md, docs/FRONTEND_GUIDE.md.
 */
#define _POSIX_C_SOURCE 200809L
#include "cspice_math.h"
#include "3b_moon.h"
#include <arpa/inet.h>
#include <errno.h>
#include <math.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#if defined(__has_include) && __has_include(<lua.h>)
#define HAS_LUA54 1
#include <lua.h>
#include <lualib.h>
#include <lauxlib.h>
#else
#define HAS_LUA54 0
#endif

static void ensure_data_dir(void) {
    mkdir("data", 0755);
}

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static void run_lua_ranking_layer(void) {
#if HAS_LUA54
    FILE *f = fopen("lua/main.lua", "r");
    if (!f) return;
    fclose(f);

    lua_State *L = luaL_newstate();
    if (!L) return;
    luaL_openlibs(L);
    if (luaL_dofile(L, "lua/main.lua") != LUA_OK) {
        fprintf(stderr, "[LUA UYARI] %s\n", lua_tostring(L, -1));
    }
    lua_close(L);
#endif
}

/* atof("nan") / atof("inf") kabul etme; gecersizse guvenli varsayilana don. */
static double parse_finite_double(const char *s, double fallback) {
    if (!s || !s[0]) return fallback;
    char *end = NULL;
    errno = 0;
    double v = strtod(s, &end);
    if (end == s || !isfinite(v)) return fallback;
    return v;
}

static int hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/* Sorgu dizgisinden TAM anahtar eslesmesiyle deger okur ve URL kodlamasini (%XX, +) cozer.
   Eski surum strstr kullandigi icin "lat" anahtari "sc_lat" icinde de eslesiyordu. */
static void parse_query_param(const char *query, const char *key, char *dst, size_t dst_sz) {
    size_t klen = strlen(key);
    const char *p = query;
    while (p && *p && *p != ' ') {
        if (strncmp(p, key, klen) == 0 && p[klen] == '=') {
            p += klen + 1;
            size_t i = 0;
            while (*p && *p != '&' && *p != ' ' && *p != '#' && i + 1 < dst_sz) {
                if (*p == '%' && hex_val(p[1]) >= 0 && hex_val(p[2]) >= 0) {
                    dst[i++] = (char)(hex_val(p[1]) * 16 + hex_val(p[2]));
                    p += 3;
                } else {
                    dst[i++] = (*p == '+') ? ' ' : *p;
                    p++;
                }
            }
            dst[i] = '\0';
            return;
        }
        while (*p && *p != '&' && *p != ' ') p++;
        if (*p == '&') p++;
    }
}

static void send_buffer_response(int client, const char *body, size_t len) {
    if (!body) return;
    char hdr[512];
    int hlen = snprintf(hdr, sizeof(hdr),
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Cache-Control: no-store\r\n"
        "Content-Length: %zu\r\n\r\n", len);
    ssize_t w1 = write(client, hdr, (size_t)hlen);
    ssize_t w2 = write(client, body, len);
    (void)w1;
    (void)w2;
}

static char *build_compare_json(const SimulationResult *res) {
    if (!res) return NULL;
    char *buf = NULL;
    size_t sz = 0;
    FILE *fp = open_memstream(&buf, &sz);
    if (!fp) return NULL;
    fprintf(fp, "{\n");
    fprintf(fp, "  \"status\": \"SUCCESS\",\n");
    fprintf(fp, "  \"meta\": { \"utc\": \"%s\", \"days\": %d, \"candidate_count\": %d },\n",
            res->utc_start, res->duration_days, res->candidate_count);
    fprintf(fp, "  \"site_comparison\": [\n");
    for (int i = 0; i < res->candidate_count; i++) {
        const CandidateComparison *c = &res->candidates[i];
        fprintf(fp, "    {\"site_name\": \"%s\", \"latitude_deg\": %.4f, \"longitude_deg\": %.4f, \"altitude_m\": %.1f, \"illumination_percent\": %.1f, \"earth_visibility_percent\": %.1f, \"slope_deg\": %.1f, \"total_sun_hours\": %.1f, \"longest_sun_hours\": %.1f, \"total_earth_hours\": %.1f, \"longest_earth_hours\": %.1f, \"dte_window_count\": %d, \"overlap_hours\": %.1f, \"longest_dark_hours\": %.1f, \"min_battery_soc_pct\": %.1f, \"mission_score\": %d, \"verdict\": \"%s\"}%s\n",
                c->site_name, c->latitude_deg, c->longitude_deg, c->altitude_m, c->illumination_percent,
                c->earth_visibility_percent, c->slope_deg, c->total_sun_hours, c->longest_sun_hours,
                c->total_earth_hours, c->longest_earth_hours, c->dte_window_count,
                c->overlap_hours, c->longest_dark_hours, c->min_battery_soc_pct,
                c->mission_score, c->verdict, (i + 1 < res->candidate_count) ? "," : "");
    }
    fprintf(fp, "  ]\n}\n");
    fclose(fp);
    return buf;
}

static void run_http_server(int port) {
    /* Istemci baglantiyi erken kapatirsa write() sureci oldurmesin. */
    signal(SIGPIPE, SIG_IGN);
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("socket");
        return;
    }
    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);   /* yalnizca yerel makine */
    addr.sin_port = htons((uint16_t)port);

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(server_fd);
        return;
    }
    listen(server_fd, 16);
    printf("[OK] C11 + SPICE 3B Sürekli Zaman API dinliyor -> http://127.0.0.1:%d/3b?t_sec=0&mode=0\n", port);

    while (1) {
        int client = accept(server_fd, NULL, NULL);
        if (client < 0) continue;

        char req[2048] = {0};
        ssize_t r = read(client, req, sizeof(req) - 1);
        if (r > 0) {
            /* "/3b" tam yol olmalidir; "/3bx" gibi yollar 2D'ye duser. */
            const char *target = (strncmp(req, "GET ", 4) == 0) ? req + 4 : "";
            bool is_3b = (strncmp(target, "/3b", 3) == 0 &&
                          (target[3] == '\0' || target[3] == '?' ||
                           target[3] == ' ' || target[3] == '/'));
            bool is_compare = (strncmp(target, "/compare", 8) == 0 &&
                               (target[8] == '\0' || target[8] == '?' ||
                                target[8] == ' ' || target[8] == '/'));
            char site[64] = "Connecting Ridge";
            char lat_s[32] = "-89.4632";
            char lon_s[32] = "-137.49";
            char days_s[16] = "14";
            char utc[32] = "2026-10-29T14:30:00";
            char scen_s[16] = "3";
            char mode_s[16] = "0";
            char tsec_s[32] = "0.0";
            char bsec_s[32] = "0.0";
            char sclat_s[32] = "-38.0";
            char sclon_s[32] = "-105.0";
            char scalt_s[32] = "110.0";
            char scspd_s[32] = "1.629";
            char cust_s[16] = "0";
            char vx_s[32] = "0.0", vy_s[32] = "0.0", vz_s[32] = "0.0";

            char *q = strchr(req, '?');
            if (q) {
                parse_query_param(q + 1, "site", site, sizeof(site));
                parse_query_param(q + 1, "lat", lat_s, sizeof(lat_s));
                parse_query_param(q + 1, "lon", lon_s, sizeof(lon_s));
                parse_query_param(q + 1, "days", days_s, sizeof(days_s));
                parse_query_param(q + 1, "utc", utc, sizeof(utc));
                parse_query_param(q + 1, "scenario", scen_s, sizeof(scen_s));
                parse_query_param(q + 1, "mode", mode_s, sizeof(mode_s));
                parse_query_param(q + 1, "t_sec", tsec_s, sizeof(tsec_s));
                parse_query_param(q + 1, "burn_sec", bsec_s, sizeof(bsec_s));
                parse_query_param(q + 1, "sc_lat", sclat_s, sizeof(sclat_s));
                parse_query_param(q + 1, "sc_lon", sclon_s, sizeof(sclon_s));
                parse_query_param(q + 1, "sc_alt", scalt_s, sizeof(scalt_s));
                parse_query_param(q + 1, "sc_speed", scspd_s, sizeof(scspd_s));
                parse_query_param(q + 1, "custom", cust_s, sizeof(cust_s));
                parse_query_param(q + 1, "vx", vx_s, sizeof(vx_s));
                parse_query_param(q + 1, "vy", vy_s, sizeof(vy_s));
                parse_query_param(q + 1, "vz", vz_s, sizeof(vz_s));
            }

            if (is_3b) {
                Moon3BScene *sc3b = (Moon3BScene *)calloc(1, sizeof(Moon3BScene));
                char *body = NULL;
                if (sc3b) {
                    compute_3b_moon_scene(
                        sc3b, atoi(scen_s), atoi(mode_s), parse_finite_double(tsec_s, 0.0), parse_finite_double(bsec_s, 0.0),
                        utc, atoi(days_s),
                        parse_finite_double(sclat_s, -38.0), parse_finite_double(sclon_s, -105.0), parse_finite_double(scalt_s, 110.0), parse_finite_double(scspd_s, 1.629),
                        site, parse_finite_double(lat_s, -89.4632), parse_finite_double(lon_s, -137.49), atoi(cust_s) != 0,
                        parse_finite_double(vx_s, 0.0), parse_finite_double(vy_s, 0.0), parse_finite_double(vz_s, 0.0)
                    );
                    body = export_3b_scene_json_string(sc3b);
                    free(sc3b);
                }
                if (body) {
                    send_buffer_response(client, body, strlen(body));
                    free(body);
                }
            } else if (is_compare) {
                SimulationResult *res = run_lunar_simulation(site, parse_finite_double(lat_s, -89.4632), parse_finite_double(lon_s, -137.49), utc, atoi(days_s));
                char *body = build_compare_json(res);
                if (body) {
                    send_buffer_response(client, body, strlen(body));
                    free(body);
                }
                if (res) free_simulation_result(res);
            } else {
                SimulationResult *res = run_lunar_simulation(site, parse_finite_double(lat_s, -89.4632), parse_finite_double(lon_s, -137.49), utc, atoi(days_s));
                char *body = export_simulation_json_string(res);
                if (body) {
                    send_buffer_response(client, body, strlen(body));
                    free(body);
                }
                if (res) free_simulation_result(res);
            }
        }
        close(client);
    }
}

int main(int argc, char **argv) {
    ensure_data_dir();
    if (!init_spice_engine("data/kernels/meta_kernel.tm")) {
        fprintf(stderr,
                "[HATA] SPICE baslatilamadi. Sahte/fallback efemeris ile devam edilmiyor.\n"
                "       Kurulum: cspice/ kutuphanesi + data/kernels/{naif0012.tls,de440s.bsp,pck00010.tpc}\n");
        return 1;
    }

    if (argc >= 2 && strcmp(argv[1], "--serve") == 0) {
        int port = (argc >= 3) ? atoi(argv[2]) : 8080;
        run_http_server(port);
        return 0;
    }

    int arg_idx = 1;
    if (argc >= 2 && strcmp(argv[1], "--once") == 0) {
        arg_idx = 2;
    }

    const char *site = (argc > arg_idx)     ? argv[arg_idx]           : "Connecting Ridge";
    double lat       = (argc > arg_idx + 1) ? parse_finite_double(argv[arg_idx + 1], -89.4632) : -89.4632;
    double lon       = (argc > arg_idx + 2) ? parse_finite_double(argv[arg_idx + 2], -137.49) : -137.49;
    const char *utc  = (argc > arg_idx + 3) ? argv[arg_idx + 3]       : "2026-10-29T14:30:00";
    int days         = (argc > arg_idx + 4) ? atoi(argv[arg_idx + 4]) : 14;

    double t0 = now_ms();
    SimulationResult *res = run_lunar_simulation(site, lat, lon, utc, days);
    double elapsed_ms = now_ms() - t0;

    if (!res) {
        fprintf(stderr, "[HATA] Simulasyon baslatilamadi.\n");
        return 1;
    }

    export_simulation_json("data/output.json", res);
    run_lua_ranking_layer();

    Moon3BScene *scene3b = (Moon3BScene *)calloc(1, sizeof(Moon3BScene));
    if (scene3b) {
        compute_3b_moon_scene(
            scene3b, 3, MISSION_MODE_ORBIT, 0.0, 0.0, utc, days,
            -38.0, -105.0, 110.0, 1.629,
            site, lat, lon, false,
            0.0, 0.0, 0.0
        );
        export_3b_scene_json("data/3b_scene.json", "data/3b_scene.js", scene3b);
        printf("[3B SPICE UNIVERSE] %d Gok Cismi | Yörünge Hızı: %.3f km/s | Kıble Az/El: %.1f° / %.1f° | İniş UTC: %s\n",
               scene3b->body_count, scene3b->spacecraft.nominal_orbital_speed_kms,
               scene3b->spacecraft.qibla_azimuth_deg, scene3b->spacecraft.qibla_elevation_deg,
               scene3b->landing_utc);
        free(scene3b);
    }

    printf("[C11 SUPER-CORE] %s (%.2f, %.2f) | Sure: %.2f ms | Karar: %s (%d/100)\n",
           res->site_name, res->lat_deg, res->lon_deg, elapsed_ms, res->verdict, res->mission_score);

    free_simulation_result(res);
    return 0;
}