#!/usr/bin/env lua5.4
-- debug_pipeline.lua - Saf Lua 5.4 ile C+CSPICE+Lua derleme ve JSON doğrulama aracı

local REQUIRED_FILES = {
    "src/cspice_math.h",
    "src/cspice_math.c",
    "src/main.c",
    "lua/main.lua"
}

local REQUIRED_C_SYMBOLS = {
    "init_spice_engine",
    "run_lunar_simulation",
    "free_simulation_result"
}

local COMPILE_CMD = table.concat({
    "gcc -O2 -Wall -Wextra",
    "src/main.c src/cspice_math.c",
    "-I./cspice/include ./cspice/lib/cspice.a",
    "-I/usr/include/lua5.4 -llua5.4 -lm",
    "-o MissionPlanner"
}, " ")

-- =========================================================================
-- SAF LUA RECURSIVE-DESCENT JSON PARSER (Sıfır Dış Bağımlılık)
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
                error("Dizi içinde ',' veya ']' beklendi, bulunan: " .. c)
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
                error("Nesne anahtarı string olmalı, konum: " .. pos)
            end
            local key = parse_string()
            skip_ws()
            if str:sub(pos, pos) ~= ':' then
                error("':' beklendi, konum: " .. pos)
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
                error("Nesne içinde ',' veya '}' beklendi, bulunan: " .. c)
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

    return parse_value()
end

-- =========================================================================
-- ADIM 1: DOSYA VE C SEMBOL SENKRONİZASYONU
-- =========================================================================
local function check_source_sync()
    print("[1/4] DOSYA VE SEMBOL SENKRONİZASYONU KONTROL EDİLİYOR...")
    for _, path in ipairs(REQUIRED_FILES) do
        local f = io.open(path, "rb")
        if not f then
            print(string.format("  [HATA] Eksik dosya: %s", path))
            return false
        end
        local sz = f:seek("end")
        f:close()
        print(string.format("  [OK] %-20s (%d byte)", path, sz))
    end

    local cf = io.open("src/cspice_math.c", "r")
    local c_code = cf:read("*a")
    cf:close()

    local missing = {}
    for _, sym in ipairs(REQUIRED_C_SYMBOLS) do
        if not c_code:find(sym, 1, true) then
            missing[#missing + 1] = sym
        end
    end

    if #missing > 0 then
        print("\n  [KRİTİK TESPİT] src/cspice_math.c güncel değil!")
        print("  Eksik fonksiyonlar: " .. table.concat(missing, ", "))
        return false
    end

    return true
end

-- =========================================================================
-- ADIM 2: C + CSPICE + LUA DERLEME
-- =========================================================================
local function compile_binary()
    print("\n[2/4] C + CSPICE + LUA DERLENİYOR...")
    print("  Komut: " .. COMPILE_CMD)
    local ok = os.execute(COMPILE_CMD)
    if not ok then
        print("  [HATA] Derleme başarısız oldu!")
        return false
    end
    print("  [OK] ./MissionPlanner başarıyla üretildi.")
    return true
end

-- =========================================================================
-- ADIM 3: CLI MODU İLE JSON ÜRETİMİ
-- =========================================================================
local function run_once()
    print("\n[3/4] MOTOR ÇALIŞTIRILIYOR (./MissionPlanner --once)...")
    local ok = os.execute("./MissionPlanner --once")
    if not ok then
        print("  [HATA] ./MissionPlanner çalıştırma hatası!")
        return false
    end
    return true
end

-- =========================================================================
-- ADIM 4: HAM JSON ÇIKTISINI DOĞRULA VE TERMİNALE BAS
-- =========================================================================
local function dump_raw_output()
    print("\n[4/4] HAM TELEMETRİ & JSON SÖZLEŞME DÖKÜMÜ (data/output.json)")
    print(string.rep("=", 82))

    local f = io.open("data/output.json", "r")
    if not f then
        print("[HATA] data/output.json bulunamadı!")
        return false
    end
    local raw_text = f:read("*a")
    f:close()

    local ok, data = pcall(parse_json, raw_text)
    if not ok or type(data) ~= "table" or data.status ~= "SUCCESS" then
        print("[HATA] JSON ayrıştırma veya sözleşme hatası: " .. tostring(data))
        return false
    end

    local meta = data.meta
    local sum  = data.summary
    local wins = data.windows
    local mask = data.terrain_horizon_mask or {}
    local smpl = data.samples or {}
    local cmps = data.site_comparison or {}

    print(string.format("Saha          : %s (Enlem: %.2f°, Boylam: %.2f°, Rakım: %.0f m)",
        meta.site_name, meta.latitude_deg, meta.longitude_deg, meta.altitude_m))
    print(string.format("Zaman Aralığı : %s -> %s (Adım: %d sn | Toplam: %d örnek)",
        meta.start_utc, meta.end_utc, meta.step_seconds, #smpl))
    print(string.format("DEM Durumu    : %s | Kapsama Dışı: %s",
        meta.dem_info.name, tostring(data.dem_out_of_bounds)))
    if data.warning_msg and #data.warning_msg > 0 then
        print("Uyarı         : " .. data.warning_msg)
    end
    print(string.rep("-", 82))

    print("[A. ÖZET KPI METRİKLERİ (SUMMARY)]")
    print(string.format("  • Toplam Güneş Süresi   : %.2f sa (%%%0.2f aydınlanma)", sum.total_sun_hours, sum.illumination_percent))
    print(string.format("  • En Uzun Kesintisiz Sun: %.2f sa", sum.longest_sun_hours))
    print(string.format("  • Toplam DTE Görüşü     : %.2f sa (%%%0.2f görüş | %d pencere)",
        sum.total_earth_hours, sum.earth_visibility_percent, sum.dte_window_count))
    print(string.format("  • En Uzun Kesintisiz DTE: %.2f sa", sum.longest_earth_hours))
    print(string.format("  • Eşzamanlı Çakışma     : %.2f sa", sum.overlap_hours))
    print(string.format("  • En Uzun Karanlık      : %.2f sa", sum.longest_dark_hours))
    print(string.format("  • Görev Uygunluk Puanı  : %d / 100", sum.mission_score))
    print(string.rep("-", 82))

    print(string.format("[B. KESİNTİSİZ PENCERELER] (Güneş: %d aralık | Dünya DTE: %d aralık)",
        #wins.sun, #wins.earth))
    for i = 1, math.min(3, #wins.earth) do
        local w = wins.earth[i]
        print(string.format("  DTE #%d : %s -> %s (%.2f saat)", i, w.start_utc, w.end_utc, w.duration_hours))
    end
    print(string.rep("-", 82))

    local first_bins = {}
    for i = 1, math.min(10, #mask) do
        first_bins[i] = string.format("%.2f°", mask[i])
    end
    print(string.format("[C. 360° ARAZİ UFUK MASKESİ] (%d açı dilimi | İlk 10: %s)",
        #mask, table.concat(first_bins, ", ")))
    print(string.rep("-", 82))

    print("[D. HAM ZAMAN ÖRNEKLERİ (İLK 5 ADIM)]")
    print(string.format("%-5s | %-20s | %-18s | %-18s | %s",
        "ADIM", "UTC ZAMANI", "GÜNEŞ (Az / El)", "DÜNYA (Az / El)", "DURUM"))
    for i = 1, math.min(5, #smpl) do
        local t = smpl[i]
        local sun_s   = string.format("%5.1f° / %+6.2f°", t.sun_azimuth_deg, t.sun_elevation_deg)
        local earth_s = string.format("%5.1f° / %+6.2f°", t.earth_azimuth_deg, t.earth_elevation_deg)
        local st      = string.format("Sun:%s | DTE:%s",
            t.is_sun_visible and "ACIK" or "GOLGE",
            t.is_earth_visible and "OK" or "YOK")
        print(string.format("%-5d | %-20s | %-18s | %-18s | %s",
            t.step_index, t.utc, sun_s, earth_s, st))
    end
    print(string.rep("-", 82))

    print("[E. TOPLU ADAY SAHA KARŞILAŞTIRMASI]")
    table.sort(cmps, function(a, b) return a.mission_score > b.mission_score end)
    for idx, c in ipairs(cmps) do
        print(string.format("  %d. %-18s | Aydınlanma: %%%5.1f | DTE: %6.1f sa | Çakışma: %6.1f sa | Karanlık: %5.1f sa | Skor: %d/100",
            idx, c.site_name, c.illumination_percent, c.total_earth_hours,
            c.overlap_hours, c.longest_dark_hours, c.mission_score))
    end

    print(string.rep("=", 82))
    print(string.format("[OK] Saf Lua doğrulaması başarılı | JSON Boyutu: %d byte", #raw_text))
    return true
end

if not check_source_sync() then os.exit(1) end
if not compile_binary() then os.exit(1) end
if not run_once() then os.exit(1) end
if not dump_raw_output() then os.exit(1) end