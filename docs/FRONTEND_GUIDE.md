# Frontend Entegrasyon Kılavuzu

Bu doküman, AstroApex arayüzünü geliştiren kişiler ve yapay zekâ ajanları içindir.
Amaç: backend'in ürettiği fizik verisini **olduğu gibi** göstermek; frontend içinde ikinci bir
fizik motoru, sahte veri veya uydurma JSON alanı oluşmasını engellemek.

> Bağlayıcı kısa kurallar için önce kök dizindeki `AGENTS.md` dosyasını oku.

## 1. 30 Saniyelik Özet

- Backend C11 + CSPICE + Lua'dır. Fizik, yörünge, gölge, ufuk, sıcaklık ve iniş hesapları buradadır.
- Frontend yalnızca **gösterir**. Hesaplamaz, yeniden türetmez, tahmin etmez.
- İki ayrı veri modeli vardır:
  - 2D görev planı: `data/output.json`
  - 3B sahne: `data/3b_scene.json` / `data/3b_scene.js`
- 2D UI sözleşmesi: `ui-starter/src/types/mission.ts`
- 3B şema kaynağı: `src/3b_moon.h`
- Referans 3B görüntüleyici: `test_3b_viewer.html`
- `ui/` altındaki eski arayüz **mock**'tur; gerçek backend'e bağlı değildir. Yeni iş buraya yapılmaz.

## 2. Dosya Sahipliği

| Dosya / klasör | Sahip | Frontend dokunabilir mi? |
|---|---|---|
| `src/cspice_math.c`, `src/cspice_math.h` | Backend | Hayır |
| `src/3b_moon.c`, `src/3b_moon.h` | Backend | Hayır |
| `src/main.c` | Backend | Hayır |
| `lua/main.lua` | Backend | Hayır |
| `cspice/`, `data/kernels/` | Backend | Hayır |
| `data/output.json`, `data/3b_scene.*` | Üretilen çıktı | Elle düzenleme; yeniden üret |
| `ui-starter/src/types/mission.ts` | Ortak sözleşme | Sadece backend onayıyla |
| `ui-starter/src/services/plannerApi.ts` | Ortak API katmanı | Sadece backend onayıyla |
| `ui-starter/public/sample_output.json` | Çevrimdışı örnek | Güncellenecekse kaynağı belirt |
| `test_3b_viewer.html` | Frontend referans | Evet; fizik eklemeden |
| `ui/index.html`, `ui/script.js`, `ui/style.css` | Legacy mock | Hayır; yeni özellik eklenmez |

## 3. Backend Nasıl Çalışır?

### 2D görev planı

1. `src/main.c` CLI argümanlarını veya HTTP query parametrelerini okur.
2. `src/cspice_math.c` CSPICE/analitik efemeris, LOLA/arazi ufku, Güneş-Dünya görünürlüğü ve
   skor girdilerini hesaplar.
3. `lua/main.lua` aday sahaları sıralar ve yardımcı JSON üretir.
4. Sonuç `data/output.json` dosyasına yazılır.

### 3B sahne

1. `src/main.c`, `compute_3b_moon_scene()` çağırır.
2. `src/3b_moon.c` Ay merkezli konum, hız, iniş yörüngesi, iniş saniyeleri ve touchdown raporunu üretir.
3. Sonuç `data/3b_scene.json` ve `data/3b_scene.js` dosyalarına yazılır.
4. `test_3b_viewer.html` bu sahneyi çizer.

**Önemli:** 2D ve 3B alanları birbirine karıştırılmaz. Örneğin 2D `summary.illumination_percent`
ile 3B `landing_seconds[].sun_disk_pct` aynı şey değildir; her biri kendi modelinden okunur.

## 4. Build ve Çalıştırma

```bash
make clean && make
make test
./build/lunar_sim --once
./build/lunar_sim --serve 8080
```

Tam pipeline ve viewer:

```bash
lua5.4 debug_pipeline.lua
```

`make test` yalnızca duman testidir; `make validate` JSON tutarlılık kontrolüdür (2D + 3B + Lua).

## 5. Gerçek HTTP API

Sunucu `./build/lunar_sim --serve 8080` ile çalışır.

| İstek | Dönen veri |
|---|---|
| `GET /3b?mode=2&t_sec=1200&burn_sec=1200` | 3B sahne JSON'u |
| `GET /?site=Shackleton%20Rim&lat=-89.7668&lon=-171.87&utc=2026-10-29T14:30:00&days=14` | 2D görev JSON'u |
| `GET /compare?utc=2026-10-29T14:30:00&days=14` | 5 sahalik karsilastirma (`site_comparison`) |
| `GET /3b` ve `/compare` dışındaki diğer GET yolları | 2D görev JSON'u |

`/compare` ve `/` yanıtları istek başına bellekte üretilir; global `data/output.json`
dosyası yazılmaz. Paralel isteklerde veri yarışı yoktur.

3B parametreleri:

```text
mode=0|1|2           0=ORBIT, 1=DESCENT, 2=LANDED
t_sec=<saniye>       sürekli zaman
burn_sec=<saniye>    iniş manevrası başlangıcı
sc_lat, sc_lon       uzay aracı başlangıç konumu
sc_alt               km cinsinden irtifa
sc_speed             km/s cinsinden başlangıç hızı
site, lat, lon       hedef iniş sahası
```

2D parametreleri:

```text
site, lat, lon, utc, days
```

### Bilinen API sınırlaması

Mevcut C sunucusu **POST gövdesini parse etmez**; yalnızca GET query parametrelerini okur.
`ui-starter/src/services/plannerApi.ts` bu yüzden canlı isteği GET ile yapar. Backend ekibi POST
desteği eklerse istemci de birlikte güncellenir. Backend kapalıysa `offline-sample` modunu açıkça
göster. Frontend'te bu açığı “fizik hesaplayarak” kapatma; bu bir backend sözleşme işidir.

## 6. 2D JSON Sözleşmesi

Kaynak tip dosyası: `ui-starter/src/types/mission.ts`.

Canlı `data/output.json` üst seviye alanları:

```text
status, dem_out_of_bounds, warning_msg, meta, summary, decision,
telemetry, optimizations, rover_traverse, windows, terrain_horizon_mask,
site_comparison, samples, events
```

Sık kullanılanlar:

| Alan | Birim / anlam |
|---|---|
| `summary.mission_score` | 0-100, backend skoru |
| `summary.illumination_percent` | % Güneş aydınlanması |
| `summary.total_sun_hours` | saat |
| `summary.total_earth_hours` | saat |
| `summary.overlap_hours` | saat |
| `summary.longest_dark_hours` | saat |
| `samples[].utc` | ISO-8601 UTC |
| `samples[].sun_azimuth_deg` | derece, 0-360 |
| `samples[].sun_elevation_deg` | derece, -90..+90 |
| `samples[].earth_azimuth_deg` | derece, 0-360 |
| `samples[].earth_elevation_deg` | derece, -90..+90 |
| `terrain_horizon_mask` | 360 eleman, her derece için ufuk açısı |
| `windows.sun`, `windows.earth` | başlangıç/bitiş ve saat cinsinden süre |
| `site_comparison` | aday sahalar; `verdict`, `min_battery_soc_pct`, `altitude_m` alanları ile |
| `decision.blocker_wall.distance_km` | LOLA profilinde `null`; `distance_known` ile kontrol et |
| `events.sun.visible_now` | başlangıç anında Güneş ufkun üstünde mi |
| `events.sun.hours_to_sunset` / `hours_to_sunrise` | saat; yoksa `next_*_utc` alanı yok |
| `events.earth.visible_now` / `hours_to_earthset` / `hours_to_earthrise` | Dünya için aynı |
| `events.search_exhausted` | aralıkta geçiş bulunamadı |

Canlı çıktıda `status` değeri `SUCCESS` olur. `meta`, `decision`, `telemetry`, `optimizations` ve
`rover_traverse` alanları çevrimdışı örnekte eksik olabilir; UI bunları opsiyonel kabul etmelidir.
Eski `metadata`, `warning` veya `status: "OK"` varsayımlarıyla kod yazma.

## 7. 3B JSON Sözleşmesi

Şema kaynağı: `src/3b_moon.h`. Üretilen dosya: `data/3b_scene.json`.

Üst seviye alanlar:

```text
scenario_id, mission_mode, sim_elapsed_sec, base_utc, active_utc,
landing_utc, range_days, scene_model, physics_valid, frame,
ephemeris_source, helio_model, trajectory_phase, terrain_is_synthetic,
horizon_source, sun_visible, earth_visible, sun_horizon_deg, earth_horizon_deg,
sun, earth, moon_helio_km, spice_bodies, selected_site, sites, spacecraft,
trajectory, landing_seconds, touchdown_report
```

Sık kullanılanlar:

| Alan | Birim / anlam |
|---|---|
| `spacecraft.pos_km` | Ay merkezli km, `frame: "IAU_MOON"` |
| `spacecraft.vel_kms` | km/s |
| `spacecraft.altitude_km` | km, yerel sentetik zemine göre AGL |
| `spacecraft.gravity_ms2` | m/s² |
| `spacecraft.thrust_ms2` | m/s² |
| `trajectory[].alt_km` | km, yerel sentetik zemine göre AGL |
| `landing_seconds[].altitude_m` | metre, AGL |
| `landing_seconds[].vertical_speed_ms` | m/s |
| `landing_seconds[].sun_disk_pct` | %; diskin geometrik aydınlanma oranı (ufuk görünürlüğü değil) |
| `landing_seconds[].sun_vis` | boolean; ufuk maskesine göre gerçek görünürlük |
| `horizon_source` | `"LOLA_80M_SKYLINE"` veya `"SYNTHETIC_ANALYTIC"` (2D ile aynı kaynak) |
| `sun_visible` / `earth_visible` | boolean; secili sahada aktif anda ufuk gorunurlugu |
| `touchdown_report.sun_disk_illuminated_pct` | %; disk oranı |
| `touchdown_report.sun_visible` | boolean; ufuk maskesine göre |
| `touchdown_report.success` | boolean; kinematik hedefe yaklaşma |
| `touchdown_report.status_label` | Türkçe durum metni |
| `touchdown_report.miss_distance_m` | metre, sabitleme öncesi güdüm sapması |
| `touchdown_report.trajectory_snapped_to_target` | görselleştirme için son nokta hedefe sabitlendi |
| `touchdown_report.touchdown_speed_ms` | m/s |
| `touchdown_report.flight_duration_sec` | saniye |
| `touchdown_report.physics_valid` | her zaman `false`; kinematik model |
| `touchdown_report.model` | `"kinematic-visualization"` |
| `sites[].alt_source` | `"LOLA_80M"` veya `"SYNTHETIC_DEM"` |

Mevcut 3B çıktıda `touchdown_report.outcome`, `fuel_remaining_kg`, `reference_frame` veya
`touchdown_report.mission_score` alanları **yoktur**. 3B kinematik modeldir; `physics_valid=false`
ise `success=true` yalnızca hedefe yaklaşıldığını gösterir, fiziksel doğrulama değildir.
`helio_km` alanları analitik Kepler modelidir (`helio_model: "ANALYTIC_KEPLER"`); `pos_km` IAU_MOON'dur.
Alan eklenecekse önce `src/3b_moon.h` ve backend birlikte güncellenir.

## 8. Frontend'te Yapılması Gerekenler

1. Veriyi `fetch` ile al; alanları doğrudan kullan.
2. Birimleri yalnızca **gösterim** için dönüştür (`km` → `m`, `s` → `dk` gibi). JSON değerini geri yazma.
3. Eksik/opsiyonel alanları `undefined` kontrolüyle ele al.
4. Backend kapalıysa `source: "offline-sample"` bilgisini kullanıcıya göster.
5. 3B viewer'da `data/3b_scene.js` yüklüyse onu kullan; canlı API varsa `/3b` ile güncelle.
6. Değişiklikten sonra `make test` ve `make validate` çalıştır; hangi alanları kullandığını PR'a yaz.
7. UI'da “hesaplanan” değer ile “backend'den gelen” değeri karıştırma; tooltip/kaynak etiketi ekle.

## 9. Kesinlikle Yapılmaması Gerekenler

- Güneş/Dünya azimut-yükseklik açısını tarihten yeniden hesaplamak.
- Yörünge, iniş, gölge, ufuk, sıcaklık veya batarya modeli yazmak.
- `mission_score`, `verdict`, `success` gibi kararları frontend'te yeniden üretmek.
- JSON alanlarını yeniden adlandırmak (`meta` → `metadata`, `warning_msg` → `warning` gibi).
- `lon` değerini keyfî olarak 0-360 aralığına çevirmek; backend değerini olduğu gibi kullanmak.
- `data/output.json`, `data/3b_scene.json`, `data/3b_scene.js` dosyalarını elle düzenlemek.
- `MOON3B_TRAJ_POINTS`, mass/fuel/thrust, kernel yolları veya CSPICE sabitlerini “UI düzelsin” diye değiştirmek.
- `ui/script.js` içindeki eski mock'u gerçek backend bağlantısı sanmak.
- Backend dosyalarını değiştirerek frontend hatasını “çözmek”.

## 10. Sık Yapılan Yapay Zekâ Hataları

| Hata | Doğrusu |
|---|---|
| “Güneş açısını tarihten hesaplayayım” | `samples[].sun_elevation_deg` alanını oku |
| “3B yörüngeyi JS'te simüle edeyim” | `trajectory` dizisini çiz |
| “`touchdown_report.outcome` yoksa türeteyim” | `success` ve `status_label` kullan |
| “`status === "OK"` kontrolü” | Canlı çıktıda `SUCCESS` |
| “`metadata` alanı” | Canlı çıktıda `meta` |
| “POST JSON çalışıyor” | Mevcut backend POST gövdesini okumaz; GET kullan |
| “Örnek veriyle aynı olmalı” | `sample_output.json` eski olabilir; canlı şemayı `data/output.json` ile doğrula |
| “Alan adını düzelteyim” | Sözleşme değişikliği backend onayı ister |

## 11. Önerilen Frontend İş Akışı

1. `AGENTS.md` ve bu dosyayı oku.
2. `make clean && make && make test && make validate` ile backend'in ve JSON'un tutarlı olduğunu doğrula.
3. `./build/lunar_sim --serve 8080` başlat.
4. Örnek isteği `curl` ile kontrol et; JSON'u kaydet.
5. Sadece frontend dosyalarında değişiklik yap.
6. Backend açıkken canlı, kapalıyken offline fallback'i ayrı ayrı test et.
7. `make test`, `make validate` ve varsa frontend lint/build çalıştır.
8. PR'da kullanılan JSON alanlarını ve test adımlarını yaz.

## 12. Yapay Zekâ Ajanı İçin Kopyala-Yapıştır Prompt

```text
Sen AstroApex projesinde yalnızca frontend katmanında çalışan bir ajanısın.
Önce AGENTS.md ve docs/FRONTEND_GUIDE.md dosyalarını oku.

Kurallar:
- src/, lua/, cspice/, data/kernels/ ve üretilen data/*.json dosyalarını değiştirme.
- JavaScript/TypeScript içinde fizik, yörünge, gölge, ufuk, sıcaklık veya iniş hesabı yazma.
- Yeni JSON alan adı uydurma; mevcut alanları olduğu gibi kullan.
- Backend çıktısını yeniden hesaplama; yalnızca gösterim birimi dönüşümü yap.
- API'nin şu an GET tabanlı olduğunu, POST gövdesinin desteklenmediğini varsay.
- Değişiklikten sonra `make test` ve `make validate` çalıştır ve sonucu raporla.

Görev: <buraya frontend görevini yaz>
```

## 13. Backend Ekibine Sorulacaklar

Şu durumlarda frontend kendi çözümünü üretmemeli, backend'e danışmalıdır:

- Yeni bir fizik alanı gerekiyorsa (örneğin iniş yakıtı veya `outcome`).
- 2D ve 3B şemalarından birine alan eklenecekse.
- API'nin POST desteği, CORS veya hata formatı değişecekse.
- Bir değer UI'da “yanlış” görünüyorsa; önce backend çıktısı ve birim doğrulanır.
