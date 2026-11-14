# UI Sözleşmesi ve Alan Eşleştirme

Bu dosya, arayüz bileşenlerinin hangi backend alanını okuyacağını özetler.
Ayrıntılı kurallar ve yasaklar için [`FRONTEND_GUIDE.md`](FRONTEND_GUIDE.md) ve
[`../AGENTS.md`](../AGENTS.md) dosyalarına bakın.

## 1. Veri Kaynakları

| Kaynak | Kullanım |
|---|---|
| `GET /?site=...&lat=...&lon=...&utc=...&days=...` | Canlı 2D görev planı |
| `GET /3b?...` | Canlı 3B sahne |
| `ui-starter/public/sample_output.json` | Backend kapalıyken çevrimdışı örnek |
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
| Aday saha tablosu | `site_comparison[]` | `verdict` alanı ile sırala |
| Uyarı bandı | `warning_msg`, `dem_out_of_bounds` | Alanlar opsiyonel olabilir |
| Kaynak/şeffaflık paneli | `meta`, `decision`, `telemetry` | Canlı çıktıda `meta`; `metadata` varsayma |

`data/output.json` içinde `status: "SUCCESS"` kullanılır. `status: "OK"` varsayımı yapılmaz.

## 3. 3B Bileşen Eşleştirmesi

| UI bileşeni | JSON alanı | Not |
|---|---|---|
| Uzay aracı | `spacecraft.pos_km`, `spacecraft.vel_kms`, `spacecraft.altitude_km` | km, km/s |
| Yörünge çizgisi | `trajectory[]` | 96 nokta; yeniden hesaplama yok |
| İniş paneli | `touchdown_report.success`, `status_label`, `miss_distance_m`, `touchdown_speed_ms` | m, m/s |
| İniş geri sayımı | `landing_seconds[]` | 60 örnek; `altitude_m` metre |
| Gökcismi listesi | `spice_bodies[]` | `from_spice_kernel` kaynak bilgisidir |
| Site seçimi | `selected_site`, `sites[]` | Backend koordinatlarını kullan |
| Güneş/Dünya vektörleri | `sun.vec`, `earth.vec` | Yön göstergesi; fizik türetme |

Mevcut 3B çıktıda `touchdown_report.outcome`, `fuel_remaining_kg` veya `reference_frame` yoktur.
Bu alanlar gerekiyorsa backend sözleşmesi birlikte güncellenir.

## 4. Ortak Kurallar

- Alan adlarını değiştirme; yeni alan uydurma.
- Fizik, yörünge, gölge, ufuk, sıcaklık, skor veya iniş kararı hesaplama.
- Üretilen `data/*.json` dosyalarını elle düzenleme.
- Backend kapalıyken `source` bilgisini UI'da göster.
- Değişiklikten sonra `make test` çalıştır.
