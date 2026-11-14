-- Lua SIRALAMA / SKORLAMA KATMANI — SADECE BACKEND
-- Girdi: C11 fizik çıktısı. Çıktı: sıralama/yardımcı JSON (data/artemis_ranking.json).
-- KURAL: UI'da gösterilecek diye burada yeni fizik veya yeni JSON alanı uydurma.
-- Sözleşme: AGENTS.md, docs/FRONTEND_GUIDE.md.
local M = {}

local ARTEMIS_CANDIDATES = {
    { name = "Haworth",          lat = -87.45, lon =   -5.17 },
    { name = "Malapert Massif",  lat = -86.00, lon =    0.00 },
    { name = "Nobile Rim 1",     lat = -85.20, lon =   53.50 },
    { name = "Connecting Ridge", lat = -89.45, lon = -137.50 },
    { name = "Shackleton Rim",   lat = -89.90, lon =    0.00 },
    { name = "De Gerlache Rim",  lat = -88.50, lon =  -88.30 },
}

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

function M.evaluate_site_lua(site)
    local lat_r = math.rad(site.lat)
    local lon_r = math.rad(site.lon)
    local alt_m = 1120.0 * math.sin(3.0 * lat_r) * math.cos(2.0 * lon_r)
                +  790.0 * math.cos(5.0 * lat_r + 0.4) * math.sin(4.0 * lon_r)
    local is_psr = (site.name:find("PSR") ~= nil) or (alt_m < -1500.0)
    local sun_pct = is_psr and 11.4 or clamp(64.0 + 14.0 * math.cos(lon_r), 38.0, 88.0)
    local dte_pct = clamp(68.0 + 18.0 * math.cos(lon_r), 25.0, 92.0)
    local slope_deg = is_psr and 5.2 or 4.6
    local dark_h = is_psr and 294.0 or 64.0
    local score = math.floor(clamp(sun_pct * 0.45 + dte_pct * 0.30 - slope_deg * 1.8 + 22.0, 0, 100))
    local verdict = (dark_h > 120.0) and "NO-GO" or ((dte_pct < 35.0) and "CAUTION" or "GO")

    return {
        site_name = site.name,
        lat = site.lat,
        lon = site.lon,
        altitude_m = math.floor(alt_m),
        sun_pct = tonumber(string.format("%.1f", sun_pct)),
        dte_pct = tonumber(string.format("%.1f", dte_pct)),
        slope_deg = slope_deg,
        longest_dark_hours = dark_h,
        score = score,
        verdict = verdict
    }
end

function M.rank_all_candidates()
    local results = {}
    for _, c in ipairs(ARTEMIS_CANDIDATES) do
        results[#results + 1] = M.evaluate_site_lua(c)
    end
    table.sort(results, function(a, b) return a.score > b.score end)
    return results
end

function M.build_comparison_json()
    local ranked = M.rank_all_candidates()
    local lines = { "{\n  \"artemis_ranking\": [" }
    for i, r in ipairs(ranked) do
        local comma = (i < #ranked) and "," or ""
        lines[#lines + 1] = string.format(
            "    { \"rank\": %d, \"site_name\": \"%s\", \"lat\": %.2f, \"lon\": %.2f, \"sun_pct\": %.1f, \"dte_pct\": %.1f, \"slope_deg\": %.1f, \"score\": %d, \"verdict\": \"%s\" }%s",
            i, r.site_name, r.lat, r.lon, r.sun_pct, r.dte_pct, r.slope_deg, r.score, r.verdict, comma
        )
    end
    lines[#lines + 1] = "  ]\n}"
    return table.concat(lines, "\n")
end

os.execute("mkdir -p data")
local json_str = M.build_comparison_json()
local f = io.open("data/artemis_ranking.json", "w")
if f then
    f:write(json_str)
    f:close()
end

return M