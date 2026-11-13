// src/main.c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>

#include <lua.h>
#include <lualib.h>
#include <lauxlib.h>

#include "cspice_math.h"

#define PORT 8080

static lua_State *L = NULL;

static void push_site_summary_to_lua(lua_State *L_vm, const SiteSummary *s) {
    lua_newtable(L_vm);

    lua_pushstring(L_vm, s->site_name);
    lua_setfield(L_vm, -2, "site_name");

    lua_pushnumber(L_vm, s->latitude_deg);
    lua_setfield(L_vm, -2, "latitude_deg");

    lua_pushnumber(L_vm, s->longitude_deg);
    lua_setfield(L_vm, -2, "longitude_deg");

    lua_pushnumber(L_vm, s->altitude_m);
    lua_setfield(L_vm, -2, "altitude_m");

    lua_pushnumber(L_vm, s->total_sun_hours);
    lua_setfield(L_vm, -2, "total_sun_hours");

    lua_pushnumber(L_vm, s->illumination_percent);
    lua_setfield(L_vm, -2, "illumination_percent");

    lua_pushnumber(L_vm, s->longest_sun_hours);
    lua_setfield(L_vm, -2, "longest_sun_hours");

    lua_pushnumber(L_vm, s->total_earth_hours);
    lua_setfield(L_vm, -2, "total_earth_hours");

    lua_pushnumber(L_vm, s->earth_visibility_percent);
    lua_setfield(L_vm, -2, "earth_visibility_percent");

    lua_pushnumber(L_vm, s->longest_earth_hours);
    lua_setfield(L_vm, -2, "longest_earth_hours");

    lua_pushinteger(L_vm, s->dte_window_count);
    lua_setfield(L_vm, -2, "dte_window_count");

    lua_pushnumber(L_vm, s->overlap_hours);
    lua_setfield(L_vm, -2, "overlap_hours");

    lua_pushnumber(L_vm, s->longest_dark_hours);
    lua_setfield(L_vm, -2, "longest_dark_hours");

    lua_pushnumber(L_vm, s->avg_sun_elevation_deg);
    lua_setfield(L_vm, -2, "avg_sun_elevation_deg");

    lua_pushnumber(L_vm, s->avg_earth_elevation_deg);
    lua_setfield(L_vm, -2, "avg_earth_elevation_deg");

    lua_pushinteger(L_vm, s->mission_score);
    lua_setfield(L_vm, -2, "mission_score");
}

static void push_windows_to_lua(lua_State *L_vm, const VisibilityWindow *wins, int count) {
    lua_newtable(L_vm);
    for (int i = 0; i < count; i++) {
        lua_newtable(L_vm);
        lua_pushstring(L_vm, wins[i].start_utc);
        lua_setfield(L_vm, -2, "start_utc");
        lua_pushstring(L_vm, wins[i].end_utc);
        lua_setfield(L_vm, -2, "end_utc");
        lua_pushnumber(L_vm, wins[i].duration_hours);
        lua_setfield(L_vm, -2, "duration_hours");
        lua_rawseti(L_vm, -2, i + 1);
    }
}

static int l_nasa_compute_c(lua_State *L_vm) {
    luaL_checktype(L_vm, 1, LUA_TTABLE);

    lua_getfield(L_vm, 1, "site_name");
    const char *site_name = luaL_optstring(L_vm, -1, "Shackleton Rim");

    lua_getfield(L_vm, 1, "latitude_deg");
    double lat = luaL_optnumber(L_vm, -1, -89.90);

    lua_getfield(L_vm, 1, "longitude_deg");
    double lon = luaL_optnumber(L_vm, -1, 0.00);

    lua_getfield(L_vm, 1, "altitude_m");
    double alt_m = luaL_optnumber(L_vm, -1, 0.0);

    lua_getfield(L_vm, 1, "use_custom");
    bool use_custom = lua_toboolean(L_vm, -1);

    lua_getfield(L_vm, 1, "start_utc");
    const char *start_utc = luaL_optstring(L_vm, -1, "2026-10-18T00:00:00");

    lua_getfield(L_vm, 1, "end_utc");
    const char *end_utc = luaL_optstring(L_vm, -1, "2026-11-01T00:00:00");

    lua_getfield(L_vm, 1, "step_seconds");
    int step_seconds = (int)luaL_optinteger(L_vm, -1, 3600);

    lua_getfield(L_vm, 1, "use_dem_horizon");
    bool use_dem = lua_isnil(L_vm, -1) ? true : lua_toboolean(L_vm, -1);

    lua_getfield(L_vm, 1, "min_sun_elevation_deg");
    double min_sun_el = luaL_optnumber(L_vm, -1, 0.0);

    lua_getfield(L_vm, 1, "min_earth_elevation_deg");
    double min_earth_el = luaL_optnumber(L_vm, -1, 0.0);

    lua_getfield(L_vm, 1, "include_earth_disk");
    bool include_disk = lua_toboolean(L_vm, -1);

    SimulationResult res = run_lunar_simulation(
        site_name, lat, lon, alt_m, use_custom,
        start_utc, end_utc, step_seconds,
        use_dem, min_sun_el, min_earth_el, include_disk
    );

    lua_pop(L_vm, 12);

    luaL_checkstack(L_vm, 20, "Lua stack yetersiz");
    lua_newtable(L_vm);

    lua_pushinteger(L_vm, res.status);
    lua_setfield(L_vm, -2, "status_code");

    if (res.status != 0) {
        lua_pushstring(L_vm, res.error_msg);
        lua_setfield(L_vm, -2, "error_msg");
        return 1;
    }

    lua_pushboolean(L_vm, res.using_real_dem);
    lua_setfield(L_vm, -2, "using_real_dem");

    lua_pushboolean(L_vm, res.dem_out_of_bounds);
    lua_setfield(L_vm, -2, "dem_out_of_bounds");

    lua_pushstring(L_vm, res.warning_msg);
    lua_setfield(L_vm, -2, "warning_msg");

    push_site_summary_to_lua(L_vm, &res.summary);
    lua_setfield(L_vm, -2, "summary");

    push_windows_to_lua(L_vm, res.sun_windows, res.sun_window_count);
    lua_setfield(L_vm, -2, "sun_windows");

    push_windows_to_lua(L_vm, res.earth_windows, res.earth_window_count);
    lua_setfield(L_vm, -2, "earth_windows");

    lua_newtable(L_vm);
    for (int i = 0; i < HORIZON_BINS; i++) {
        lua_pushnumber(L_vm, res.terrain_horizon_mask[i]);
        lua_rawseti(L_vm, -2, i + 1);
    }
    lua_setfield(L_vm, -2, "terrain_horizon_mask");

    lua_newtable(L_vm);
    for (int s = 0; s < res.total_steps; s++) {
        TimeSample *t = &res.samples[s];
        lua_newtable(L_vm);

        lua_pushinteger(L_vm, t->step_index);
        lua_setfield(L_vm, -2, "step_index");

        lua_pushstring(L_vm, t->utc);
        lua_setfield(L_vm, -2, "utc");

        lua_pushnumber(L_vm, t->sun_azimuth_deg);
        lua_setfield(L_vm, -2, "sun_azimuth_deg");

        lua_pushnumber(L_vm, t->sun_elevation_deg);
        lua_setfield(L_vm, -2, "sun_elevation_deg");

        lua_pushnumber(L_vm, t->earth_azimuth_deg);
        lua_setfield(L_vm, -2, "earth_azimuth_deg");

        lua_pushnumber(L_vm, t->earth_elevation_deg);
        lua_setfield(L_vm, -2, "earth_elevation_deg");

        lua_pushnumber(L_vm, t->sun_terrain_horizon_deg);
        lua_setfield(L_vm, -2, "sun_terrain_horizon_deg");

        lua_pushnumber(L_vm, t->earth_terrain_horizon_deg);
        lua_setfield(L_vm, -2, "earth_terrain_horizon_deg");

        lua_pushboolean(L_vm, t->is_sun_visible);
        lua_setfield(L_vm, -2, "is_sun_visible");

        lua_pushboolean(L_vm, t->is_earth_visible);
        lua_setfield(L_vm, -2, "is_earth_visible");

        lua_rawseti(L_vm, -2, s + 1);
    }
    lua_setfield(L_vm, -2, "samples");

    lua_newtable(L_vm);
    for (int i = 0; i < res.comparison_count; i++) {
        push_site_summary_to_lua(L_vm, &res.comparisons[i]);
        lua_rawseti(L_vm, -2, i + 1);
    }
    lua_setfield(L_vm, -2, "site_comparison");

    free_simulation_result(&res);
    return 1;
}

static char *execute_lua_pipeline(const char *json_request) {
    lua_getglobal(L, "handle_simulation_json");
    lua_pushstring(L, json_request ? json_request : "{}");

    if (lua_pcall(L, 1, 1, 0) != LUA_OK) {
        const char *err = lua_tostring(L, -1);
        char *err_json = (char *)malloc(512);
        snprintf(err_json, 512, "{\"status\":\"ERROR\",\"message\":\"%s\"}", err ? err : "Lua error");
        lua_pop(L, 1);
        return err_json;
    }

    const char *res_str = lua_tostring(L, -1);
    char *copy = strdup(res_str ? res_str : "{\"status\":\"ERROR\"}");
    lua_pop(L, 1);
    return copy;
}

static void handle_client(int client_socket) {
    char buffer[8192] = {0};
    ssize_t bytes_read = read(client_socket, buffer, sizeof(buffer) - 1);
    if (bytes_read <= 0) {
        close(client_socket);
        return;
    }

    if (strncmp(buffer, "OPTIONS ", 8) == 0) {
        const char *cors_resp =
            "HTTP/1.1 204 No Content\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\n"
            "Content-Length: 0\r\n\r\n";
        ssize_t w_cors = write(client_socket, cors_resp, strlen(cors_resp));
        (void)w_cors;
        close(client_socket);
        return;
    }

    char *json_body = strstr(buffer, "\r\n\r\n");
    if (json_body) json_body += 4;
    else json_body = "{}";

    char *json_response = execute_lua_pipeline(json_body);
    size_t body_len = strlen(json_response);

    char header[512];
    int header_len = snprintf(header, sizeof(header),
        "HTTP/1.1 200 OK\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: %zu\r\n\r\n",
        body_len);

    ssize_t w_hdr = write(client_socket, header, (size_t)header_len);
    ssize_t w_body = write(client_socket, json_response, body_len);
    (void)w_hdr;
    (void)w_body;

    free(json_response);
    close(client_socket);
}

int main(int argc, char **argv) {
    if (init_spice_engine(NULL) != 0) {
        fprintf(stderr, "[HATA] NASA SPICE motoru başlatılamadı.\n");
        return 1;
    }

    L = luaL_newstate();
    luaL_openlibs(L);
    lua_register(L, "nasa_compute_c", l_nasa_compute_c);

    const char *lua_script = (access("lua/main.lua", F_OK) == 0) ? "lua/main.lua" : "../lua/main.lua";
    if (luaL_dofile(L, lua_script) != LUA_OK) {
        fprintf(stderr, "[HATA] Lua script yüklenemedi: %s\n", lua_tostring(L, -1));
        lua_close(L);
        return 1;
    }

    // 1. CLI Modu (--once): data/input.json dosyasını okur, data/output.json üretir ve çıkar
    if (argc > 1 && strcmp(argv[1], "--once") == 0) {
        char *req_json = NULL;
        FILE *fp = fopen("data/input.json", "rb");
        if (!fp) fp = fopen("../data/input.json", "rb");

        if (fp) {
            fseek(fp, 0, SEEK_END);
            long fsize = ftell(fp);
            rewind(fp);
            if (fsize > 0) {
                req_json = (char *)malloc((size_t)fsize + 1);
                if (req_json) {
                    size_t n = fread(req_json, 1, (size_t)fsize, fp);
                    req_json[n] = '\0';
                }
            }
            fclose(fp);
        }

        const char *fallback_req =
            "{\"site_name\":\"Shackleton Rim\",\"start_utc\":\"2026-10-18T00:00:00\",\"end_utc\":\"2026-11-01T00:00:00\",\"step_seconds\":3600}";

        char *out = execute_lua_pipeline(req_json ? req_json : fallback_req);
        if (strstr(out, "\"status\":\"ERROR\"") != NULL) {
            fprintf(stderr, "[CLI HATA] Simülasyon başarısız: %s\n", out);
            free(out);
            free(req_json);
            lua_close(L);
            return 1;
        }

        printf("[CLI MODE] %s işlendi -> data/output.json üretildi (%zu byte).\n",
               req_json ? "data/input.json" : "varsayılan parametreler", strlen(out));
        free(out);
        free(req_json);
        lua_close(L);
        return 0;
    }

    // 2. HTTP API Sunucu Modu (8080 Portu)
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in address;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(PORT);

    if (bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        perror("[HATA] Port 8080 bağlanamadı");
        lua_close(L);
        return 1;
    }

    listen(server_fd, 16);
    printf("[C+LUA ENGINE] Mission Planner API http://localhost:%d adresinde hazır!\n", PORT);

    while (1) {
        socklen_t addrlen = sizeof(address);
        int client_socket = accept(server_fd, (struct sockaddr *)&address, &addrlen);
        if (client_socket >= 0) {
            handle_client(client_socket);
        }
    }

    lua_close(L);
    return 0;
}