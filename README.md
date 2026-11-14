# Lunar South Pole Mission Planner — AstroApex

**NASA Space Apps Challenge 2026 | Lunar Landing Site Navigator**

Ay'ın Güney Kutbu iniş sahaları için NASA CSPICE yörünge mekaniği, arazi ufuk maskelemesi ve
Lua görev orkestrasyonunu birleştiren C11 tabanlı görev planlama motoru.

> **Kod yazmadan önce:** [`AGENTS.md`](AGENTS.md) ve [`docs/FRONTEND_GUIDE.md`](docs/FRONTEND_GUIDE.md)
> dosyalarını oku. Bu iki dosya, özellikle yapay zekâ ajanlarının backend'i yanlışlıkla bozmasını
> engellemek için bağlayıcıdır.

## Sistem Mimarisi

```text
[NASA Kernels: .tls, .bsp, .tpc]       [LOLA / analitik arazi modeli]
                 \                         /
                  v                       v
        [C11 Fizik Çekirdeği: src/cspice_math.c]
                  |
                  +--> [Lua skorlama: lua/main.lua] --> data/output.json
                  |
                  +--> [3B sahne: src/3b_moon.c] ----> data/3b_scene.json
                                                        data/3b_scene.js
                  |
                  v
        [HTTP / CLI: src/main.c]
                  |
        +---------+------------------+
        |                            |
  GET / (2D JSON)              GET /3b (3B JSON)
        |                            |
  ui-starter/ sözleşmesi      test_3b_viewer.html
```

## İki Ayrı Veri Modeli

Bu projede iki çıktı vardır ve bunlar **birbirine karıştırılmamalıdır**:

1. **2D görev planı** → `data/output.json`
   - Güneş/Dünya görünürlüğü, arazi ufku, iletişim pencereleri, aday saha karşılaştırması.
   - Frontend sözleşmesi: `ui-starter/src/types/mission.ts`.
2. **3B sahne** → `data/3b_scene.json`, `data/3b_scene.js`
   - Uzay aracı konumu, iniş yörüngesi, iniş saniyeleri, touchdown raporu.
   - Şema kaynağı: `src/3b_moon.h`.
   - Referans görüntüleyici: `test_3b_viewer.html`.

## Dizin Yapısı

| Yol | Görev |
|---|---|
| `src/cspice_math.c` / `.h` | 2D fizik, CSPICE efemeris, arazi ufku, görünürlük pencereleri |
| `src/3b_moon.c` / `.h` | 3B sahne, uzay aracı durumu, iniş yörüngesi |
| `src/main.c` | CLI ve HTTP sunucusu |
| `lua/main.lua` | Lua sıralama/skorlama katmanı |
| `data/kernels/` | CSPICE kernel dosyaları |
| `data/output.json` | Üretilen 2D çıktı |
| `data/3b_scene.json` / `.js` | Üretilen 3B çıktı |
| `ui-starter/` | 2D TypeScript sözleşmesi ve API istemcisi |
| `test_3b_viewer.html` | Referans 3B görüntüleyici |
| `ui/` | Eski statik mock; gerçek backend'e bağlı değildir |
| `docs/` | Mimari ve frontend entegrasyon dokümanları |

## Hızlı Başlangıç

### Derleme

```bash
make clean && make
```

Bu komut `build/lunar_sim` dosyasını ve `MissionPlanner` bağlantısını üretir.

### Çalıştırma

```bash
./build/lunar_sim --once
```

Beklenen örnek çıktı:

```text
[3B SPICE UNIVERSE] 13 Gok Cismi | Yörünge Hızı: 1.629 km/s | ...
[C11 SUPER-CORE] Connecting Ridge (-89.45, -137.50) | ... | Karar: CAUTION (69/100)
```

### HTTP sunucusu

```bash
./build/lunar_sim --serve 8080
```

Başka bir terminalde:

```bash
# 2D görev planı
curl 'http://127.0.0.1:8080/?site=Shackleton%20Rim&lat=-89.9&lon=0&utc=2026-10-29T14:30:00&days=14'

# 3B iniş sahnesi
curl 'http://127.0.0.1:8080/3b?mode=2&t_sec=1200&burn_sec=1200'
```

### Test

```bash
make test               # smoke test: --once
bash build.sh           # derleme + smoke test
lua5.4 debug_pipeline.lua  # tam pipeline + 3B viewer
```

`make test` tam birim testi değildir; motorun çalıştığını doğrular.

## API Sözleşmesi

### 2D

```text
GET /?site=<ad>&lat=<derece>&lon=<derece>&utc=<ISO-8601>&days=<1-30>
```

`/3b` dışındaki tüm GET istekleri 2D simülasyonu çalıştırır ve `data/output.json` döndürür.

### 3B

```text
GET /3b?mode=0|1|2&t_sec=<sn>&burn_sec=<sn>
         &sc_lat=<derece>&sc_lon=<derece>&sc_alt=<km>&sc_speed=<km/s>
         &site=<ad>&lat=<derece>&lon=<derece>
```

Dönen veri `data/3b_scene.json` dosyasıdır.

### Bilinen sınırlama

C sunucusu şu an **POST gövdesini parse etmez**. `ui-starter/src/services/plannerApi.ts` canlı
isteği GET query parametreleriyle yapar. Backend'e POST desteği eklenirse API istemcisi de birlikte
güncellenir. Bu farkı frontend'te fizik yazarak kapatmayın.

## Veri ve Birimler

- 2D açılar: derece. Süreler: saat veya saniye (alan adına göre).
- 2D irtifa: metre. 3B `spacecraft.altitude_km`: kilometre.
- 3B konum: km, hız: km/s, ivme: m/s².
- 3B `landing_seconds[].altitude_m`: metre.
- UTC metinleri backend'den geldiği gibi gösterilir; frontend'te yeniden hesaplanmaz.
- `data/output.json`, `data/3b_scene.json`, `data/3b_scene.js` **üretilen** dosyalardır.
  Elle düzenlenmez; `./build/lunar_sim --once` ile yeniden üretilir.

## Frontend Kuralları

1. **Fizik yazma.** Yörünge, Güneş/Dünya açısı, gölge, ufuk, sıcaklık, iniş veya skor hesabı
   frontend'te yapılmaz. Yalnızca backend alanları gösterilir.
2. **Alan adı uydurma.** 2D için `ui-starter/src/types/mission.ts`, 3B için `src/3b_moon.h`.
3. **API katmanını kullan.** 2D istekleri `ui-starter/src/services/plannerApi.ts` üzerinden yapılır.
4. **Fallback'i göster.** Backend kapalıysa `source === "offline-sample"` bilgisini UI'da belirt.
5. **Üretilen veriyi düzenleme.** JSON dosyaları kaynak değil, çıktıdır.
6. **Legacy mock'u geliştirme.** `ui/` altındaki eski arayüz gerçek backend'e bağlı değildir.
7. **Backend'i UI için değiştirme.** Fizik sabitleri, kernel yolları ve şemalar keyfî değiştirilmez.

Ayrıntılı eşleştirme, sık yapılan hatalar ve AI prompt şablonu:
[`docs/FRONTEND_GUIDE.md`](docs/FRONTEND_GUIDE.md).

## Yapay Zekâ Ajanları İçin Kısa Kural

> Yalnızca frontend katmanında çalış. `src/`, `lua/`, `cspice/`, `data/kernels/` ve üretilen
> `data/*.json` dosyalarını değiştirme. Fizik hesaplama. Yeni JSON alanı uydurma. API şu an GET
> tabanlıdır; POST gövdesinin desteklenmediğini varsay. Değişiklikten sonra `make test` çalıştır.

## Sorun Giderme

| Belirti | Kontrol |
|---|---|
| `make` hiçbir şey yapmıyor | `make clean && make` |
| `make test` başarısız | `./build/lunar_sim --once` çıktısını ve kernel yolunu kontrol et |
| 3B viewer boş | Önce `--once` ile `data/3b_scene.js` üret; tarayıcı konsolunu kontrol et |
| API cevap vermiyor | `./build/lunar_sim --serve 8080` çalışıyor mu? |
| `POST` isteği yanlış sonuç | Bilinen sınırlama: POST gövdesi okunmuyor; GET kullan |
| SPICE verisi `false` görünüyor | `data/kernels/` ve kernel yükleme yolunu backend ekibiyle kontrol et |

## Ek Dokümanlar

- [`AGENTS.md`](AGENTS.md) — bağlayıcı kısa kurallar
- [`docs/FRONTEND_GUIDE.md`](docs/FRONTEND_GUIDE.md) — frontend entegrasyon kılavuzu
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — bilimsel/teknik mimari
- [`docs/UI_CONTRACT.md`](docs/UI_CONTRACT.md) — UI alan eşleştirme notları
