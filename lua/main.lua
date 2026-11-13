-- lua/main.lua - Tam JSON Ayrıştırıcılı ve Doğrulanmış Orkestratör

-- =========================================================================
-- 1. SAF LUA RECURSIVE-DESCENT JSON PARSER (Boolean ve İç İçe Nesne Korumalı)
-- =========================================================================
local function parse_json(str)
    local pos = 1
    local len = #str

    local function skip_ws()
        local _, e = str:find("^[ \t\r\n]*", pos)
        if e then pos = e + 1 end
    end

    local parse_value

    local function parse_string()
        pos = pos + 1
        local out = {}
        while pos <= len do
            local c = str:sub(pos, pos)
            if c == '"' then
                pos = pos + 1
                return table.concat(out)
            elseif c == '\\' then
                local nxt = str:sub(pos + 1, pos + 1)
                local escapes = {
                    ['"'] = '"', ['\\'] = '\\', ['/'] = '/',
                    b = '\b', f = '\f', n = '\n', r = '\r', t = '\t'
                }
                out[#out + 1] = escapes[nxt] or nxt
                pos = pos + 2
            else
                out[#out + 1] = c
                pos = pos + 1
            end
        end
        error("Sonlandırılmamış JSON string")
    end

    local function parse_number()
        local s, e = str:find("^-?%d+%.?%d*[eE]?[+-]?%d*", pos)
        if not s then error("Geçersiz sayı konumu: " .. pos) end
        pos = e + 1
        return tonumber(str:sub(s, e))
    end

    local function parse_array()
        pos = pos + 1
        local arr = {}
        skip_ws()
        if str:sub(pos, pos) == ']' then
            pos = pos + 1
            return arr
        end
        while pos <= len do
            skip_ws()
            arr[#arr + 1] = parse_value()
            skip_ws()
            local c = str:sub(pos, pos)
            if c == ']' then
                pos = pos + 1
                return arr
            elseif c == ',' then
                pos = pos + 1
            else
                error("Dizi içinde ',' veya ']' beklendi")
            end
        end
        error("Sonlandırılmamış JSON dizisi")
    end

    local function parse_object()
        pos = pos + 1
        local obj = {}
        skip_ws()
        if str:sub(pos, pos) == '}' then
            pos = pos + 1
            return obj
        end
        while pos <= len do
            skip_ws()
            if str:sub(pos, pos) ~= '"' then
                error("Nesne anahtarı string olmalı")
            end
            local key = parse_string()
            skip_ws()
            if str:sub(pos, pos) ~= ':' then
                error("':' beklendi")
            end
            pos = pos + 1
            skip_ws()
            obj[key] = parse_value()
            skip_ws()
            local c = str:sub(pos, pos)
            if c == '}' then
                pos = pos + 1
                return obj
            elseif c == ',' then
                pos = pos + 1
            else
                error("Nesne içinde ',' veya '}' beklendi")
            end
        end
        error("Sonlandırılmamış JSON nesnesi")
    end

    parse_value = function()
        skip_ws()
        local c = str:sub(pos, pos)
        if c == '"' then
            return parse_string()
        elseif c == '{' then
            return parse_object()
        elseif c == '[' then
            return parse_array()
        elseif c == 't' and str:sub(pos, pos + 3) == "true" then
            pos = pos + 4
            return true
        elseif c == 'f' and str:sub(pos, pos + 4) == "false" then
            pos = pos + 5
            return false
        elseif c == 'n' and str:sub(pos, pos + 3) == "null" then
            pos = pos + 4
            return nil
        else
            return parse_number()
        end
    end

    local res = parse_value()
    skip_ws()
    if pos <= len then
        error("JSON sonunda beklenmeyen karakterler")
    end
    return res
end

-- Açık 'false' ve '0' değerlerini koruyan seçim yardımcıları
local function pick_value(...)
    for i = 1, select("#", ...) do
        local v = select(i, ...)
        if v ~= nil then
            return v
        end
    end
    return nil
end

local function pick_bool(...)
    for i = 1, select("#", ...) do
        local v = select(i, ...)
        if type(v) == "boolean" then
            return v
        end
    end
    return nil
end

local function json_escape(s)
    return tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n')
end

-- =========================================================================
-- 2. ATOMİK / DOĞRULAMALI DOSYA YAZICI (open + write + close kontrolü)
-- =========================================================================
local function resolve_output_path()
    local probe_root = io.open("lua/main.lua", "r")
    if probe_root then
        probe_root:close()
        return "data/output.json"
    end
    local probe_sub = io.open("../lua/main.lua", "r")
    if probe_sub then
        probe_sub:close()
        return "../data/output.json"
    end
    return "data/output.json"
end

local function write_output_file(content)
    local path = resolve_output_path()
    local f, open_err = io.open(path, "wb")
    if not f then
        return false, path, tostring(open_err or "dosya açılamadı")
    end

    local ok_write, write_err = f:write(content)
    if not ok_write then
        f:close()
        return false, path, tostring(write_err or "yazma hatası")
    end

    local ok_close, close_err = f:close()
    if not ok_close then
        return false, path, tostring(close_err or "kapatma/flush hatası")
    end

    return true, path, nil
end

-- =========================================================================
-- 3. JSON SÖZLEŞME OLUŞTURUCU
-- =========================================================================
local function serialize_windows(win_list)
    local items = {}
    for i = 1, #win_list do
        local w = win_list[i]
        items[i] = string.format(
            '{"start_utc": "%s", "end_utc": "%s", "duration_hours": %.2f}',
            json_escape(w.start_utc), json_escape(w.end_utc), w.duration_hours
        )
    end
    return "[" .. table.concat(items, ", ") .. "]"
end

local function build_contract_json(c_res, req)
    local s = c_res.summary
    local buf = {}
    local function add(str) buf[#buf + 1] = str end

    local dem_label = "GEOMETRIC_HORIZON_ONLY"
    if req.use_dem_horizon then
        dem_label = c_res.using_real_dem and "LOLA_SOUTH_POLE_DEM_MMAP" or "SYNTHETIC_ANALYTICAL_FALLBACK"
    end

    add('{\n')
    add('  "status": "SUCCESS",\n')
    add(string.format('  "using_real_dem": %s,\n', tostring(c_res.using_real_dem)))
    add(string.format('  "dem_out_of_bounds": %s,\n', tostring(c_res.dem_out_of_bounds)))
    add(string.format('  "warning_msg": "%s",\n', json_escape(c_res.warning_msg or "")))

    add('  "meta": {\n')
    add(string.format('    "site_name": "%s",\n', json_escape(s.site_name)))
    add(string.format('    "latitude_deg": %.4f,\n', s.latitude_deg))
    add(string.format('    "longitude_deg": %.4f,\n', s.longitude_deg))
    add(string.format('    "altitude_m": %.1f,\n', s.altitude_m))
    add(string.format('    "start_utc": "%s",\n', json_escape(req.start_utc)))
    add(string.format('    "end_utc": "%s",\n', json_escape(req.end_utc)))
    add(string.format('    "step_seconds": %d,\n', req.step_seconds))
    add(string.format('    "use_dem_horizon": %s,\n', tostring(req.use_dem_horizon)))
    add(string.format('    "min_sun_elevation_deg": %.2f,\n', req.min_sun_elevation_deg))
    add(string.format('    "min_earth_elevation_deg": %.2f,\n', req.min_earth_elevation_deg))
    add(string.format('    "earth_visibility_model": "%s",\n', req.include_earth_disk and "EARTH_LIMB_DISK (~0.95 deg radius)" or "EARTH_CENTER_POINT"))
    add('    "spice_kernels": ["naif0012.tls", "de440s.bsp", "pck00010.tpc"],\n')
    add(string.format('    "dem_info": {"name": "%s", "is_real_dem": %s, "coverage": "-90 to -80 deg", "bins": 360},\n', dem_label, tostring(c_res.using_real_dem)))
    add('    "score_weights": {"illumination": 0.50, "earth_visibility": 0.30, "low_darkness": 0.20}\n')
    add('  },\n')

    add('  "summary": {\n')
    add(string.format('    "total_sun_hours": %.2f,\n', s.total_sun_hours))
    add(string.format('    "illumination_percent": %.2f,\n', s.illumination_percent))
    add(string.format('    "longest_sun_hours": %.2f,\n', s.longest_sun_hours))
    add(string.format('    "total_earth_hours": %.2f,\n', s.total_earth_hours))
    add(string.format('    "earth_visibility_percent": %.2f,\n', s.earth_visibility_percent))
    add(string.format('    "longest_earth_hours": %.2f,\n', s.longest_earth_hours))
    add(string.format('    "dte_window_count": %d,\n', s.dte_window_count))
    add(string.format('    "overlap_hours": %.2f,\n', s.overlap_hours))
    add(string.format('    "longest_dark_hours": %.2f,\n', s.longest_dark_hours))
    add(string.format('    "avg_sun_elevation_deg": %.2f,\n', s.avg_sun_elevation_deg))
    add(string.format('    "avg_earth_elevation_deg": %.2f,\n', s.avg_earth_elevation_deg))
    add(string.format('    "mission_score": %d\n', s.mission_score))
    add('  },\n')

    add('  "windows": {\n')
    add('    "sun": ' .. serialize_windows(c_res.sun_windows) .. ',\n')
    add('    "earth": ' .. serialize_windows(c_res.earth_windows) .. '\n')
    add('  },\n')

    local mask_parts = {}
    for i = 1, #c_res.terrain_horizon_mask do
        mask_parts[i] = string.format("%.2f", c_res.terrain_horizon_mask[i])
    end
    add('  "terrain_horizon_mask": [' .. table.concat(mask_parts, ", ") .. '],\n')

    add('  "samples": [\n')
    local count = #c_res.samples
    for i = 1, count do
        local t = c_res.samples[i]
        local comma = (i < count) and "," or ""
        add(string.format(
            '    {"step_index": %d, "utc": "%s", "duration_seconds": %.1f, "sun_azimuth_deg": %.2f, "sun_elevation_deg": %.2f, "earth_azimuth_deg": %.2f, "earth_elevation_deg": %.2f, "sun_terrain_horizon_deg": %.2f, "earth_terrain_horizon_deg": %.2f, "is_sun_visible": %s, "is_earth_visible": %s}%s\n',
            t.step_index, json_escape(t.utc), t.duration_seconds,
            t.sun_azimuth_deg, t.sun_elevation_deg,
            t.earth_azimuth_deg, t.earth_elevation_deg,
            t.sun_terrain_horizon_deg, t.earth_terrain_horizon_deg,
            tostring(t.is_sun_visible), tostring(t.is_earth_visible), comma
        ))
    end
    add('  ],\n')

    add('  "site_comparison": [\n')
    local cmp_count = #c_res.site_comparison
    for i = 1, cmp_count do
        local c = c_res.site_comparison[i]
        local comma = (i < cmp_count) and "," or ""
        add(string.format(
            '    {"site_name": "%s", "latitude_deg": %.2f, "longitude_deg": %.2f, "total_sun_hours": %.2f, "illumination_percent": %.2f, "longest_sun_hours": %.2f, "total_earth_hours": %.2f, "longest_earth_hours": %.2f, "dte_window_count": %d, "overlap_hours": %.2f, "longest_dark_hours": %.2f, "mission_score": %d}%s\n',
            json_escape(c.site_name), c.latitude_deg, c.longitude_deg,
            c.total_sun_hours, c.illumination_percent, c.longest_sun_hours,
            c.total_earth_hours, c.longest_earth_hours, c.dte_window_count,
            c.overlap_hours, c.longest_dark_hours, c.mission_score, comma
        ))
    end
    add('  ]\n')
    add('}\n')

    return table.concat(buf)
end

-- =========================================================================
-- 4. ANA GİRİŞ NOKTASI
-- =========================================================================
function handle_simulation_json(raw_json_input)
    local input = (raw_json_input and #raw_json_input > 0) and raw_json_input or "{}"

    local ok_parse, decoded = pcall(parse_json, input)
    if not ok_parse or type(decoded) ~= "table" then
        return string.format('{"status":"ERROR","message":"Geçersiz JSON isteği: %s"}', json_escape(tostring(decoded)))
    end

    local site = (type(decoded.site) == "table") and decoded.site or {}
    local tr   = (type(decoded.time_range) == "table") and decoded.time_range or {}
    local opts = (type(decoded.options) == "table") and decoded.options or {}

    local in_lat  = pick_value(site.latitude_deg, site.latitude, decoded.latitude_deg, decoded.latitude)
    local in_lon  = pick_value(site.longitude_deg, site.longitude, decoded.longitude_deg, decoded.longitude)
    local in_alt  = pick_value(site.altitude_m, site.altitude, decoded.altitude_m, decoded.altitude)
    local in_name = pick_value(site.site_name, site.name, decoded.site_name, decoded.name)

    -- Açık boolean değeri (false dahil) koru
    local explicit_use_custom = pick_bool(site.use_custom, decoded.use_custom)
    local has_explicit_coords = (in_lat ~= nil or in_lon ~= nil)
    local use_custom
    if explicit_use_custom ~= nil then
        use_custom = explicit_use_custom
    else
        use_custom = has_explicit_coords
    end

    local use_dem_horizon = pick_bool(opts.use_dem_horizon, decoded.use_dem_horizon)
    if use_dem_horizon == nil then use_dem_horizon = true end

    local include_earth_disk = pick_bool(opts.include_earth_disk, decoded.include_earth_disk)
    if include_earth_disk == nil then include_earth_disk = false end

    local start_utc = pick_value(tr.start_utc, tr.start_date, decoded.start_utc, decoded.start_date) or "2026-10-18T00:00:00"
    local end_utc   = pick_value(tr.end_utc, tr.end_date, decoded.end_utc, decoded.end_date) or "2026-11-01T00:00:00"
    local step_sec  = pick_value(tr.step_seconds, tr.interval_seconds, decoded.step_seconds, decoded.interval_seconds) or 3600

    local req = {
        site_name               = in_name or (use_custom and "Custom Coordinate" or "Shackleton Rim"),
        latitude_deg            = in_lat or -89.90,
        longitude_deg           = in_lon or 0.00,
        altitude_m              = in_alt or 0.0,
        use_custom              = use_custom,
        start_utc               = tostring(start_utc):gsub("Z$", ""),
        end_utc                 = tostring(end_utc):gsub("Z$", ""),
        step_seconds            = tonumber(step_sec) or 3600,
        use_dem_horizon         = use_dem_horizon,
        min_sun_elevation_deg   = tonumber(pick_value(opts.min_sun_elevation_deg, decoded.min_sun_elevation_deg)) or 0.0,
        min_earth_elevation_deg = tonumber(pick_value(opts.min_earth_elevation_deg, decoded.min_earth_elevation_deg)) or 0.0,
        include_earth_disk      = include_earth_disk
    }

    local c_result = nasa_compute_c(req)
    if not c_result or c_result.status_code ~= 0 then
        local err_msg = (c_result and c_result.error_msg) or "C motoru hesaplama hatası"
        return string.format('{"status":"ERROR","message":"%s"}', json_escape(err_msg))
    end

    local final_json = build_contract_json(c_result, req)

    local ok_save, saved_path, save_err = write_output_file(final_json)
    if not ok_save then
        return string.format('{"status":"ERROR","message":"Çıktı dosyası yazılamadı (%s): %s"}',
            json_escape(saved_path), json_escape(save_err))
    end

    return final_json
end