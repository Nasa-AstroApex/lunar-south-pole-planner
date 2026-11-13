-- lua/main.lua - Doğrulanmış Sözleşme Orkestratörü

local function extract_json_string(json_str, key)
    local pattern = '"' .. key .. '"%s*:%s*"([^"]*)"'
    return string.match(json_str, pattern)
end

local function extract_json_number(json_str, key)
    local pattern = '"' .. key .. '"%s*:%s*([%-0-9%.]+)'
    local val = string.match(json_str, pattern)
    return val and tonumber(val) or nil
end

local function extract_json_bool(json_str, key)
    local pattern = '"' .. key .. '"%s*:%s*(true|false)'
    local val = string.match(json_str, pattern)
    if val == "true" then return true end
    if val == "false" then return false end
    return nil
end

local function json_escape(s)
    return tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n')
end

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
            '    {"step_index": %d, "utc": "%s", "sun_azimuth_deg": %.2f, "sun_elevation_deg": %.2f, "earth_azimuth_deg": %.2f, "earth_elevation_deg": %.2f, "sun_terrain_horizon_deg": %.2f, "earth_terrain_horizon_deg": %.2f, "is_sun_visible": %s, "is_earth_visible": %s}%s\n',
            t.step_index, json_escape(t.utc),
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

function handle_simulation_json(raw_json_input)
    local input = raw_json_input or "{}"

    local in_lat  = extract_json_number(input, "latitude_deg") or extract_json_number(input, "latitude")
    local in_lon  = extract_json_number(input, "longitude_deg") or extract_json_number(input, "longitude")
    local in_alt  = extract_json_number(input, "altitude_m") or extract_json_number(input, "altitude")
    local in_name = extract_json_string(input, "site_name") or extract_json_string(input, "name")
    local in_cust = extract_json_bool(input, "use_custom")

    -- Kullanıcı açıkça koordinat gönderdiyse use_custom otomatik true olur
    local has_explicit_coords = (in_lat ~= nil or in_lon ~= nil)
    local use_custom = (in_cust ~= nil) and in_cust or has_explicit_coords

    local start_utc = extract_json_string(input, "start_utc") or extract_json_string(input, "start_date") or "2026-10-18T00:00:00"
    local end_utc   = extract_json_string(input, "end_utc") or extract_json_string(input, "end_date") or "2026-11-01T00:00:00"
    local step_sec  = extract_json_number(input, "step_seconds") or extract_json_number(input, "interval_seconds") or 3600

    local use_dem   = extract_json_bool(input, "use_dem_horizon")
    if use_dem == nil then use_dem = true end

    local req = {
        site_name               = in_name or (has_explicit_coords and "Custom Coordinate" or "Shackleton Rim"),
        latitude_deg            = in_lat or -89.90,
        longitude_deg           = in_lon or 0.00,
        altitude_m              = in_alt or 0.0,
        use_custom              = use_custom,
        start_utc               = start_utc:gsub("Z$", ""),
        end_utc                 = end_utc:gsub("Z$", ""),
        step_seconds            = step_sec,
        use_dem_horizon         = use_dem,
        min_sun_elevation_deg   = extract_json_number(input, "min_sun_elevation_deg") or 0.0,
        min_earth_elevation_deg = extract_json_number(input, "min_earth_elevation_deg") or 0.0,
        include_earth_disk      = extract_json_bool(input, "include_earth_disk") or false
    }

    local c_result = nasa_compute_c(req)
    if not c_result or c_result.status_code ~= 0 then
        local err_msg = (c_result and c_result.error_msg) or "C motoru hesaplama hatası"
        return string.format('{"status":"ERROR","message":"%s"}', json_escape(err_msg))
    end

    local final_json = build_contract_json(c_result, req)

    local out_file = io.open("data/output.json", "w") or io.open("../data/output.json", "w")
    if out_file then
        out_file:write(final_json)
        out_file:close()
    end

    return final_json
end