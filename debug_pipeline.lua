#!/usr/bin/env lua5.4
-- debug_pipeline.lua - C11 + CSPICE + Lua + 3B SPICE Evreni Derleme ve Otomatik Önizleme Doğrulayıcı
--
-- Bu script backend'i derler, --once çalıştırır ve üretilen JSON'u doğrular.
-- Frontend katmanı değildir; UI için burada fizik veya JSON alanı eklenmez.
-- Kurallar: AGENTS.md, docs/FRONTEND_GUIDE.md.

local REQUIRED_FILES = {
    "src/cspice_math.h",
    "src/cspice_math.c",
    "src/3b_moon.h",
    "src/3b_moon.c",
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
    "src/main.c src/cspice_math.c src/3b_moon.c",
    "-I./cspice/include ./cspice/lib/cspice.a",
    "-I/usr/include/lua5.4 -llua5.4 -lm",
    "-o MissionPlanner"
}, " ")

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
                local escapes = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }
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
        if str:sub(pos, pos) == ']' then pos = pos + 1; return arr end
        while pos <= len do
            skip_ws()
            arr[#arr + 1] = parse_value()
            skip_ws()
            local c = str:sub(pos, pos)
            if c == ']' then pos = pos + 1; return arr
            elseif c == ',' then pos = pos + 1
            else error("Dizi içinde ',' veya ']' beklendi") end
        end
        error("Sonlandırılmamış JSON dizisi")
    end
    local function parse_object()
        pos = pos + 1
        local obj = {}
        skip_ws()
        if str:sub(pos, pos) == '}' then pos = pos + 1; return obj end
        while pos <= len do
            skip_ws()
            local key = parse_string()
            skip_ws()
            pos = pos + 1
            skip_ws()
            obj[key] = parse_value()
            skip_ws()
            local c = str:sub(pos, pos)
            if c == '}' then pos = pos + 1; return obj
            elseif c == ',' then pos = pos + 1
            else error("Nesne içinde ',' veya '}' beklendi") end
        end
        error("Sonlandırılmamış JSON nesnesi")
    end
    parse_value = function()
        skip_ws()
        local c = str:sub(pos, pos)
        if c == '"' then return parse_string()
        elseif c == '{' then return parse_object()
        elseif c == '[' then return parse_array()
        elseif c == 't' and str:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
        elseif c == 'f' and str:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
        elseif c == 'n' and str:sub(pos, pos + 3) == "null" then pos = pos + 4; return nil
        else return parse_number() end
    end
    return parse_value()
end

local function check_source_sync()
    print("[1/5] DOSYA VE SEMBOL SENKRONİZASYONU KONTROL EDİLİYOR...")
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
    for _, sym in ipairs(REQUIRED_C_SYMBOLS) do
        if not c_code:find(sym, 1, true) then
            print("  [HATA] Eksik fonksiyon: " .. sym)
            return false
        end
    end
    return true
end

local function compile_binary()
    print("\n[2/5] C11 + CSPICE + 3B_MOON + LUA DERLENİYOR...")
    print("  Komut: " .. COMPILE_CMD)
    if not os.execute(COMPILE_CMD) then
        print("  [HATA] Derleme başarısız oldu!")
        return false
    end
    print("  [OK] ./MissionPlanner başarıyla üretildi.")
    return true
end

local function run_once()
    print("\n[3/5] MOTOR ÇALIŞTIRILIYOR (./MissionPlanner --once)...")
    if not os.execute("./MissionPlanner --once") then
        print("  [HATA] ./MissionPlanner çalıştırma hatası!")
        return false
    end
    return true
end

local function verify_outputs()
    print("\n[4/5] TELEMETRİ & 3B SPICE EVRENİ DOĞRULANIYOR...")
    local f1 = io.open("data/output.json", "r")
    if not f1 then print("[HATA] data/output.json yok!"); return false end
    local d1 = parse_json(f1:read("*a"))
    f1:close()
    if d1.status ~= "SUCCESS" then print("[HATA] output.json status != SUCCESS"); return false end

    local f2 = io.open("data/3b_scene.json", "r")
    if not f2 then print("[HATA] data/3b_scene.json yok!"); return false end
    local raw3b = f2:read("*a")
    f2:close()
    local d3 = parse_json(raw3b)

    print(string.format("  [OK] output.json   -> Saha: %s | Skor: %d/100", d1.meta.site_name, d1.summary.mission_score))
    print(string.format("  [OK] 3b_scene.json -> %d Gök Cismi/Asteroit | Rota Noktası: %d | İniş Sn Örneği: %d",
        #d3.spice_bodies, #d3.trajectory, #d3.landing_seconds))
    for i = 1, math.min(6, #d3.spice_bodies) do
        local b = d3.spice_bodies[i]
        print(string.format("       • %-22s [%-8s] Uzaklık: %12.0f km | SPICE: %s",
            b.name, b.category, b.distance_km, tostring(b.from_spice_kernel)))
    end
    return true
end

local function open_3b_preview()
    print("\n[5/5] TAM EKRAN 3B MOCKUP ÖNİZLEME AÇILIYOR (test_3b_viewer.html)...")
    local hf = io.open("test_3b_viewer.html", "r")
    if not hf then
        print("  [UYARI] test_3b_viewer.html henüz proje kök dizinine kaydedilmemiş.")
        return
    end
    hf:close()
    os.execute("xdg-open test_3b_viewer.html >/dev/null 2>&1 &")
    print("  [OK] Tarayıcıda tam ekran 3B SPICE animasyonu açıldı.")
end

if not check_source_sync() then os.exit(1) end
if not compile_binary() then os.exit(1) end
if not run_once() then os.exit(1) end
if not verify_outputs() then os.exit(1) end
open_3b_preview()