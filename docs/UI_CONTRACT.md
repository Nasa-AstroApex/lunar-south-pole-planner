# UI Sözleşmesi ve Alan Eşleştirme

Bu dosya, arayüz bileşenlerinin hangi backend alanını okuyacağını özetler.
Ayrıntılı kurallar ve yasaklar için [`FRONTEND_GUIDE.md`](FRONTEND_GUIDE.md) ve
[`../AGENTS.md`](../AGENTS.md) dosyalarına bakın.

## 1. Veri Kaynakları

| Kaynak | Kullanım |
|---|---|
| `GET /?site=...&lat=...&lon=...&utc=...&days=...` | Canlı 2D görev planı |
| `GET /compare?utc=...&days=...` | Canlı 5 sahalik karsilastirma |
| `GET /3b?...` | Canlı 3B sahne (yalnızca `localhost`/`127.0.0.1`/`?live=1`) |
| `ui-starter/data/3b_scene.js` | Statik varsayılan sahne (`window.SCENE_3B_DATA`) |
| `ui-starter/data/demo_snapshots.json` | Statik snapshot katalogu (backend kapalıyken) |
| `ui-starter/data/sample_output.json` | Backend kapalıyken çevrimdışı 2D örnek |
| `data/output.json` | 2D üretilen çıktı |
| `data/3b_scene.json` / `.js` | 3B üretilen çıktı |

Mevcut C sunucusu POST gövdesini okumaz. Canlı isteklerde GET kullanın veya çevrimdışı modu açıkça
belirtin.

## 2. 2D Bileşen Eşleştirmesi

| UI bileşeni | JSON alanı | Not |
|---|---|---|
| Karar bandı | `summary.mission_score`, `decision.verdict` | Skoru frontend'te yeniden hesaplama |
| Aydınlanma kartı | `summary.total_sun_hours`, `summary.illumination_percent`, `summary.longest_sun_hours` | Saat / % |
| DTE kartı | `summary.total_earth_hours`, `summary.earth_visibility_percent`, `summary.longest_earth_hours`, `summary.dte_window_count` | Saat / % / adet |
| Çakışma kartı | `summary.overlap_hours` | Saat |
| Karanlık kartı | `summary.longest_dark_hours` | Saat |
| Zaman çizelgesi | `samples[]`, `windows.sun`, `windows.earth` | `samples[].utc` ile senkronize et |
| 360° ufuk | `terrain_horizon_mask` | 360 eleman, derece |
| Sunset/Earthset geri sayımı | `events.sun` / `events.earth` | `visible_now`, `hours_to_sunset`, `hours_to_sunrise`, `hours_to_earthset`, `hours_to_earthrise` |
| Aday saha tablosu | `site_comparison[]` | `verdict`, `min_battery_soc_pct`, `altitude_m` alanları ile sırala |
| Engel duvarı | `decision.blocker_wall` | `distance_km` LOLA'da `null`; `distance_known` kontrol et |
| Uyarı bandı | `warning_msg`, `dem_out_of_bounds` | Alanlar opsiyonel olabilir |
| Kaynak/şeffaflık paneli | `meta`, `decision`, `telemetry` | Canlı çıktıda `meta`; `metadata` varsayma |

`data/output.json` içinde `status: "SUCCESS"` kullanılır. `status: "OK"` varsayımı yapılmaz.

## 3. 3B Bileşen Eşleştirmesi

| UI bileşeni | JSON alanı | Not |
|---|---|---|
| Uzay aracı | `spacecraft.pos_km`, `spacecraft.vel_kms`, `spacecraft.altitude_km` | km, km/s, AGL |
| Model kaynağı | `scene_model`, `physics_valid`, `frame`, `ephemeris_source`, `trajectory_phase` | 3B kinematik; `physics_valid=false` |
| Site yüksekliği | `selected_site.alt_source`, `sites[].alt_source` | `LOLA_80M` veya `SYNTHETIC_DEM` |
| Yörünge çizgisi | `trajectory[]` | 96 nokta; yeniden hesaplama yok |
| Ufuk kaynağı | `horizon_source` | `LOLA_80M_SKYLINE` veya `SYNTHETIC_ANALYTIC`; 2D ile aynı |
| Anlık görünürlük | `sun_visible`, `earth_visible`, `sun_horizon_deg`, `earth_horizon_deg` | aktif anda ufuk maskesine göre |
| İniş paneli | `touchdown_report.success`, `status_label`, `model`, `physics_valid`, `miss_distance_m`, `trajectory_snapped_to_target`, `touchdown_speed_ms`, `sun_disk_illuminated_pct`, `sun_visible` | m, m/s; 3B skoru yoktur |
| İniş geri sayımı | `landing_seconds[]` | 60 örnek; `altitude_m` metre; `sun_disk_pct` disk oranı, `sun_vis` ufuk görünürlüğü |
| Gökcismi listesi | `spice_bodies[]` | `from_spice_kernel` kaynak bilgisidir |
| Site seçimi | `selected_site`, `sites[]` | Backend koordinatlarını kullan |
| Güneş/Dünya vektörleri | `sun.vec`, `earth.vec` | Yön göstergesi; fizik türetme |

Mevcut 3B çıktıda `touchdown_report.outcome`, `fuel_remaining_kg`, `reference_frame` veya
`touchdown_report.mission_score` yoktur. `helio_km` analitik Kepler yaklaşımıdır; `pos_km` IAU_MOON'dur.
Bu alanlar gerekiyorsa backend sözleşmesi birlikte güncellenir.

## 4. Ortak Kurallar

- Alan adlarını değiştirme; yeni alan uydurma.
- Fizik, yörünge, gölge, ufuk, sıcaklık, skor veya iniş kararı hesaplama.
- Üretilen `data/*.json` dosyalarını elle düzenleme.
- Backend kapalıyken `source` bilgisini UI'da göster.
- Değişiklikten sonra `make test` ve `make validate` çalıştır.
