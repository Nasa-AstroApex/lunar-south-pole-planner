cat << 'EOF' > ~/Project/Nasa/README.md
# 🌑 Lunar South Pole Mission Planner — AstroApex

Ay'ın Güney Kutbu iniş sahaları için **NASA CSPICE** yörünge mekaniği, **LOLA DEM** arazi ufuk maskelemesi ve **Lua 5.4** veri orkestrasyonunu birleştiren yüksek performanslı görev planlama motoru ve web arayüzü.

---

## 🏗️ Sistem Mimarisi

```text
[NASA Kernels (.tls, .bsp, .tpc) + LOLA DEM (.bin)]
                       │
                       ▼ (Zero-copy mmap + Yörünge Vektör Matematiği)
          [Saf C Motoru: src/cspice_math.c]
                       │
                       ▼ (Native C -> Lua Table Köprüsü)
        [Lua Orkestratörü: lua/main.lua] ──► data/output.json
                       │
                       ▼ (REST API :8080 veya Statik JSON)
            [Web Arayüzü: ui/index.html]