# 🌑 Lunar South Pole Mission Planner — AstroApex

**NASA Space Apps Challenge 2026 | Challenge: Lunar Landing Site Navigator**

Ay'ın Güney Kutbu iniş sahaları için **NASA CSPICE** yörünge mekaniği, **LOLA DEM** arazi ufuk maskelemesi ve **Lua 5.4** görev orkestrasyonunu birleştiren yüksek performanslı görev planlama motoru ve web arayüzü kontratı.

---

## 🏗️ Sistem Mimarisi

    [NASA Kernels (.tls, .bsp, .tpc) + LOLA DEM (.bin)]
                           │
                           ▼ (Zero-copy mmap + Yörünge Vektör Matematiği)
              [Saf C11 Motoru: src/cspice_math.c]
                           │
                           ▼ (Native C <-> Lua 5.4 Stack Köprüsü)
            [Lua Orkestratörü: lua/main.lua] ──► data/output.json
                           │
                           ▼ (HTTP POST API :8080 veya Statik JSON)
         [TypeScript Kontratı: ui-starter/src/types/mission.ts]
                           │
                           ▼
              [Web Arayüzü: React / Three.js UI]

---

## 📂 Dizin Yapısı ve Katmanlar

* **`src/cspice_math.c` & `src/cspice_math.h` (Fizik ve Efemeris Çekirdeği):**
  * NASA NAIF CSPICE (`de440s.bsp`, `pck00010.tpc`, `naif0012.tls`) ve ışık hızı/sapma düzeltmesi (`LT+S`) kullanarak `MOON_ME` referans çerçevesinde Güneş ve Dünya'nın anlık azimut/yükseklik açılarını hesaplar.
  * LRO LOLA Güney Kutbu DEM verisi (`data/lola_southpole.bin`, yoksa analitik krater modeli) üzerinde POSIX `mmap()` ile sıfır kopyalı (*zero-copy*) ışın izleme yaparak 360° `terrain_horizon_mask` profilini çıkarır.
  * Kısmi zaman adımlarını kırparak (`duration_seconds`) kesintisiz aydınlanma (`sun`), Dünya iletişim (`earth` / DTE), eşzamanlı çakışma (`overlap_hours`) ve maksimum karanlık (`longest_dark_hours`) sürelerini hesaplar.
* **`src/main.c` (Gömülü HTTP/1.1 Sunucusu & C-Lua Köprüsü):**
  * Harici bağımlılık olmadan `8080` portunda CORS destekli HTTP JSON sunucusu çalıştırır ve 20.000 zaman adımına kadar bellek sızıntısı olmadan Lua sanal makinesine veri aktarır.
* **`lua/main.lua` (Görev Skorlama & JSON Üretici):**
  * Hedef koordinatları aday iniş bölgeleriyle (`Shackleton Rim`, `Connecting Ridge`, `Malapert Massif`, `Nobile Rim 1`, `Haworth`) kıyaslar, `mission_score` (0–100) hesaplar ve standart JSON çıktısını serileştirir.
* **`ui-starter/` (Frontend TypeScript Kontratı):**
  * `src/types/mission.ts`: Backend JSON şemasının birebir TypeScript arayüzleri.
  * `src/services/plannerApi.ts`: `http://localhost:8080` API istemcisi ve backend kapalıyken devreye giren çevrimdışı yedekleme katmanı.
  * `public/sample_output.json`: Gerçek NASA CSPICE simülasyonundan üretilmiş hazır örnek veri.
* **`docs/ARCHITECTURE.md` (Teknik Spesifikasyon):**
  * JSON alanlarının fiziksel birimleri, bilimsel metodoloji ve UI bileşen eşleştirme rehberi.

---

## 🤖 AI Kodlama Asistanları ve Frontend Ekibi İçin Kesin Kurallar

Bu projede arayüz geliştiren **Cursor, Claude, Windsurf, Copilot, v0** gibi yapay zekâ ajanları ve frontend geliştiricileri aşağıdaki kurallara uymak zorundadır:

1. **JavaScript/TypeScript içinde yörünge, Güneş/Dünya açısı veya gölge matematiği YAZMAYIN.** Tüm fiziksel hesaplamalar yalnızca `POST http://localhost:8080` uç noktasından (veya çevrimdışı modda `ui-starter/public/sample_output.json` dosyasından) alınır.
2. **Yeni veya farklı JSON alan isimleri UYDURMAYIN.** Yalnızca `ui-starter/src/types/mission.ts` içinde tanımlı tipleri kullanın.
3. **API istekleri için `ui-starter/src/services/plannerApi.ts` modülünü kullanın.** Bu servis, yerel C/Lua sunucusu kapalı olsa bile arayüzün çalışması için otomatik olarak `sample_output.json` verisine düşer.
4. **Görsel bileşenleri tasarlarken `docs/ARCHITECTURE.md` dosyasındaki eşleştirmeleri takip edin** (3B sahne ışık vektörleri, 360° ufuk radarı, Güneş/DTE zaman çizelgesi ve aday saha karşılaştırma tablosu).

---

## 🚀 Hızlı Başlangıç (Backend)

### 1. Derleme
```bash
make clean && make