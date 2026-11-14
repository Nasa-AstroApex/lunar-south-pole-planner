-- Lua SIRALAMA KATMANI — SADECE BACKEND
-- Girdi: C11 fizik çıktısı (data/output.json içindeki "site_comparison").
-- Çıktı: skora göre sıralanmış liste (data/artemis_ranking.json).
--
-- Bu katman fizik HESAPLAMAZ ve değer UYDURMAZ: yalnızca C çekirdeğinin ürettiği aday saha
-- sonuçlarını okur ve sıralar. (Eski sürüm C çıktısını okumadan cos(boylam) ile sayı üretiyordu.)
-- KURAL: UI'da gösterilecek diye burada yeni fizik veya yeni JSON alanı uydurma.
-- Sözleşme: AGENTS.md, docs/FRONTEND_GUIDE.md.
local M = {}

local OUTPUT_PATH = "data/output.json"
local RANKING_PATH = "data/artemis_ranking.json"

local function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local text = f:read("a")
    f:close()
    return text
end

-- data/output.json içindeki site_comparison dizisini okur. Her eleman düz (iç içe olmayan) bir
-- nesnedir; bu yüzden tam bir JSON ayrıştırıcıya gerek yoktur.
function M.load_candidates()
    local text = read_file(OUTPUT_PATH)
    if not text then return {} end
    local block = text:match('"site_comparison"%s*:%s*%[(.-)%]')
    if not block then return {} end

    local results = {}
    for obj in block:gmatch("{(.-)}") do
        local function num(key)
            return tonumber(obj:match('"' .. key .. '"%s*:%s*([%-%d%.]+)'))
        end
        local function str(key)
            return obj:match('"' .. key .. '"%s*:%s*"([^"]*)"')
        end
        local name = str("site_name")
        if name then
            results[#results + 1] = {
                site_name = name,
                lat = num("latitude_deg") or 0.0,
                lon = num("longitude_deg") or 0.0,
                sun_pct = num("illumination_percent") or 0.0,
                dte_pct = num("earth_visibility_percent") or 0.0,
                slope_deg = num("slope_deg") or 0.0,
                longest_dark_hours = num("longest_dark_hours") or 0.0,
                score = math.floor(num("mission_score") or 0),
                verdict = str("verdict") or "CAUTION"
            }
        end
    end
    return results
end

function M.rank_all_candidates()
    local results = M.load_candidates()
    table.sort(results, function(a, b)
        if a.score ~= b.score then return a.score > b.score end
        return a.site_name < b.site_name
    end)
    return results
end

function M.build_comparison_json()
    local ranked = M.rank_all_candidates()
    local lines = { "{\n  \"source\": \"data/output.json site_comparison (C11 core)\",\n  \"artemis_ranking\": [" }
    for i, r in ipairs(ranked) do
        local comma = (i < #ranked) and "," or ""
        lines[#lines + 1] = string.format(
            "    { \"rank\": %d, \"site_name\": \"%s\", \"lat\": %.4f, \"lon\": %.4f, \"sun_pct\": %.1f, \"dte_pct\": %.1f, \"slope_deg\": %.1f, \"longest_dark_hours\": %.1f, \"score\": %d, \"verdict\": \"%s\" }%s",
            i, r.site_name, r.lat, r.lon, r.sun_pct, r.dte_pct, r.slope_deg, r.longest_dark_hours, r.score, r.verdict, comma
        )
    end
    lines[#lines + 1] = "  ]\n}"
    return table.concat(lines, "\n")
end

os.execute("mkdir -p data")
local json_str = M.build_comparison_json()
local f = io.open(RANKING_PATH, "w")
if f then
    f:write(json_str)
    f:close()
end

return M
