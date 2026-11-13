-- lua/main.lua - C Motoru ve JSON Sözleşmesi Orkestratörü

print("[LUA ORCHESTRATOR] Yörünge ve JSON yönetim katmanı aktif.")

-- Basit ve güvenli JSON alan okuyucu (Harici C/Lua kütüphanesi gerektirmez)
local function extract_json_string(json_str, key, default_val)
    local pattern = '"' .. key .. '"%s*:%s*"([^"]*)"'
    local val = string.match(json_str, pattern)
    return val or default_val
end

local function extract_json_number(json_str, key, default_val)
    local pattern = '"' .. key .. '"%s*:%s*([%-0-9%.]+)'
    local val = string.match(json_str, pattern)
    return val and tonumber(val) or default_val
end

local function extract_json_bool(json_str, key, default_val)
    local pattern = '"' .. key .. '"%s*:%s*(true|false)'
    local val = string.match(json_str, pattern)
    if val == "true" then return true end
    if val == "false" then return false end
    return default_val
end

-- JSON özel karakter kaçış yardımcısı
local function json_escape(s)
    return tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n')
end

-- C'den gelen zengin Lua tablosunu UI'ın beklediği kesin JSON sözleşmesine çevirir
local function build_contract_json(c_res, req_params)
    local s = c_res.summary
    local buf = {}
    local function add(str) buf[#buf + 1] = str end

    add('{\n')
    add('  "status": "SUCCESS",\n')

    -- 1. META BLOĞU
    add('  "meta": {\n')
    add(string.format('    "site_name": "%s",\n', json_escape(s.site_name)))
    add(string.format('    "latitude": %.4f,\n', s.latitude))
    add(string.format('    "longitude": %.4f,\n', s.longitude))
    add(string.format('    "start_date": "%s",\n', json_escape(req_params.start_date)))
    add(string.format('    "duration_days": %d,\n', req_params.duration_days))
    add(string.format('    "horizon_margin_deg": %.2f,\n', req_params.margin_deg))
    add('    "spice_kernels": ["naif0012.tls", "de440s.bsp", "pck00010.tpc"],\n')
    add('    "dem_source": "LOLA_SOUTH_POLE_MMAP"\n')
    add('  },\n')

    -- 2. PROCESSED (İŞLENMİŞ ÖZET KPI VERİLERİ)
    add('  "processed": {\n')
    add(string.format('    "illumination_percent": %.2f,\n', s.illumination_percent))
    add(string.format('    "dte_window_count": %d,\n', s.dte_window_count))
    add(string.format('    "overlap_hours": %d,\n', s.overlap_hours))
    add(string.format('    "longest_dark_hours": %d,\n', s.longest_dark_hours))
    add(string.format('    "avg_sun_elevation_deg": %.2f,\n', s.avg_sun_elevation_deg))
    add(string.format('    "avg_earth_elevation_deg": %.2f,\n', s.avg_earth_elevation_deg))
    add(string.format('    "mission_score": %d,\n', s.mission_score))

    -- 360° Arazi Ufuk Maskesi
    local mask_parts = {}
    for i = 1, #c_res.terrain_horizon_mask do
        mask_parts[i] = string.format("%.2f", c_res.terrain_horizon_mask[i])
    end
    add('    "terrain_horizon_mask": [' .. table.concat(mask_parts, ", ") .. ']\n')
    add('  },\n')

    -- 3. RAW_TIMELINE (SAATLİK HAM TELEMETRİ DİZİSİ)
    add('  "raw_timeline": [\n')
    local tl_count = #c_res.raw_timeline
    for i = 1, tl_count do
        local t = c_res.raw_timeline[i]
        local comma = (i < tl_count) and "," or ""
        add(string.format(
            '    {"hour_index": %d, "utc": "%s", "et_seconds": %.2f, "sun_azimuth_deg": %.2f, "sun_elevation_deg": %.2f, "earth_azimuth_deg": %.2f, "earth_elevation_deg": %.2f, "terrain_blocking_deg": %.2f, "is_sun_visible": %s, "is_earth_visible": %s}%s\n',
            t.hour_index,
            json_escape(t.utc),
            t.et_seconds,
            t.sun_azimuth_deg,
            t.sun_elevation_deg,
            t.earth_azimuth_deg,
            t.earth_elevation_deg,
            t.terrain_blocking_deg,
            tostring(t.is_sun_visible),
            tostring(t.is_earth_visible),
            comma
        ))
    end
    add('  ],\n')

    -- 4. SITE_COMPARISON (ADAY SAHALAR KARŞILAŞTIRMASI)
    add('  "site_comparison": [\n')
    local cmp_count = #c_res.site_comparison
    for i = 1, cmp_count do
        local c = c_res.site_comparison[i]
        local comma = (i < cmp_count) and "," or ""
        add(string.format(
            '    {"site_name": "%s", "latitude": %.2f, "longitude": %.2f, "illumination_percent": %.2f, "dte_window_count": %d, "overlap_hours": %d, "longest_dark_hours": %d, "mission_score": %d}%s\n',
            json_escape(c.site_name),
            c.latitude,
            c.longitude,
            c.illumination_percent,
            c.dte_window_count,
            c.overlap_hours,
            c.longest_dark_hours,
            c.mission_score,
            comma
        ))
    end
    add('  ]\n')
    add('}\n')

    return table.concat(buf)
end

-- Dış dünyadan (C HTTP Sunucusu veya CLI) tetiklenen ana orkestrasyon fonksiyonu
function handle_simulation_json(raw_json_input)
    local input = raw_json_input or "{}"

    -- 1. Gelen JSON'dan parametreleri oku (Yoksa güvenli varsayılanları kullan)
    local req_params = {
        site_name     = extract_json_string(input, "site_name", "Shackleton Rim"),
        latitude      = extract_json_number(input, "latitude", -89.90),
        longitude     = extract_json_number(input, "longitude", 0.00),
        use_custom    = extract_json_bool(input, "use_custom", false),
        start_date    = extract_json_string(input, "start_date", "2026-10-18T00:00:00"),
        duration_days = extract_json_number(input, "duration_days", 14),
        margin_deg    = extract_json_number(input, "horizon_margin_deg", 2.0)
    }

    -- Tarihi SPICE ISO formatına temizle (Sondaki 'Z' varsa kırp)
    req_params.start_date = req_params.start_date:gsub("Z$", "")

    -- 2. C Motorunu Tetikle
    local c_result = nasa_compute_c(req_params)
    if not c_result or c_result.status_code ~= 0 then
        local err_msg = (c_result and c_result.error_msg) or "Bilinmeyen C çekirdek hatası"
        return string.format('{"status":"ERROR","message":"%s"}', json_escape(err_msg))
    end

    -- 3. JSON Sözleşmesini Oluştur
    local final_json = build_contract_json(c_result, req_params)

    -- 4. JSON çıktısını diske kaydet (`data/output.json`) -> UI ve Python doğrulayıcı için
    local out_file = io.open("data/output.json", "w") or io.open("../data/output.json", "w")
    if out_file then
        out_file:write(final_json)
        out_file:close()
    end

    return final_json
end