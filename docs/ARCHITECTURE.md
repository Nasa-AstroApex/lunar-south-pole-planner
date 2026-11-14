# AstroApex Backend Mimarisi

Bu doküman backend'in teknik akışını anlatır. Frontend entegrasyon kuralları için
[`FRONTEND_GUIDE.md`](FRONTEND_GUIDE.md) ve [`../AGENTS.md`](../AGENTS.md) dosyalarına bakın.

## 1. İki Çıktı Modeli

| Model | Üretici | Çıktı | Şema |
|---|---|---|---|
| 2D görev planı | `src/cspice_math.c` + `lua/main.lua` | `data/output.json` | `ui-starter/src/types/mission.ts` |
| 3B sahne | `src/3b_moon.c` | `data/3b_scene.json`, `data/3b_scene.js` | `src/3b_moon.h` |

Bu iki model bağımsızdır. 2D alanları 3B sahnede, 3B alanları 2D raporda kullanılmaz.

## 2. API ve Taşıma

Sunucu:

```bash
./build/lunar_sim --serve 8080
```

| İstek | Sonuç |
|---|---|
| `GET /3b?...` | 3B sahne JSON'u |
| `GET /` veya `/3b` dışındaki GET yolu | 2D görev JSON'u |
| `POST` gövdesi | Henüz parse edilmiyor |

2D query parametreleri: `site`, `lat`, `lon`, `utc`, `days`.

3B query parametreleri: `mode`, `t_sec`, `burn_sec`, `sc_lat`, `sc_lon`, `sc_alt`, `sc_speed`,
`site`, `lat`, `lon`.

CLI karşılığı:

```bash
./build/lunar_sim --once [site] [lat] [lon] [utc] [days]
```

`--once` varsayılan olarak `data/output.json` ve 3B sahneyi üretir.

## 3. 2D Bilimsel Akış

- **CSPICE / NAIF:** `de440s.bsp`, `pck00010.tpc`, `naif0012.tls` gibi kernel dosyaları
  `init_spice_engine()` ile yüklenir. `src/cspice_math.c` Güneş/Dünya durumlarını `MOON_ME`
  çerçevesinde sorgular.
- **Arazi ufku:** Hedef `(lat, lon, alt)` için 360 azimut ışını ile `terrain_horizon_mask` üretilir.
- **Görünürlük:** Güneş/Dünya yüksekliği yerel ufkun üzerindeyse görünür kabul edilir.
- **Pencereler:** Kesintisiz Güneş, DTE ve çakışma aralıkları `windows` altında üretilir.
- **Skorlama:** Aydınlanma, DTE, eğim, karanlık süresi ve operasyonel eşikler `mission_score`
  ve `verdict` alanlarına dönüşür.

Kernel bulunamazsa motor analitik yedek modele düşebilir. Bu durumda `spice_bodies[].from_spice_kernel`
ve ilgili çıktı alanları `false` olabilir; frontend bunu hata olarak değil, kaynak bilgisi olarak gösterir.

## 4. 3B Sahne Akışı

- Uzay aracı başlangıç konumu `(sc_lat, sc_lon, sc_alt)` ile tanımlanır.
- Hedef saha `(target_lat, target_lon)` ve yüzey yarıçapı ile hesaplanır.
- `compute_3b_moon_scene()`; Ay merkezli konum/hız, 96 noktalı yörünge, 60 saniyelik iniş örnekleri
  ve `touchdown_report` üretir.
- Çıktı `data/3b_scene.json` ve `data/3b_scene.js` olarak yazılır.
- `test_3b_viewer.html` bu veriyi çizer; fizik hesaplamaz.

3B alanlarının birimleri `src/3b_moon.h` yorumlarında tanımlıdır. Özellikle:
`pos_km` km, `vel_kms` km/s, `altitude_km` km, `gravity_ms2`/`thrust_ms2` m/s²,
`landing_seconds[].altitude_m` metre.

## 5. UI Eşleştirme İlkeleri

- 3B sahne: `trajectory[].pos_km` ve `vel_kms` doğrudan çizilir; yörünge yeniden hesaplanmaz.
- İniş paneli: `touchdown_report.success`, `status_label`, `miss_distance_m`, `touchdown_speed_ms`.
- 2D zaman çizelgesi: `samples[]`, `windows.sun`, `windows.earth`.
- 360° ufuk: `terrain_horizon_mask`.
- Aday saha tablosu: `site_comparison[]`.
- Tüm değerler backend'den geldiği gibi gösterilir; frontend yalnızca görüntüleme birimi dönüşümü yapar.

## 6. Değişiklik Sınırları

- Fizik sabitleri, kernel yolları, mass/fuel/thrust değerleri ve `MOON3B_TRAJ_POINTS` keyfî değiştirilmez.
- JSON alanı ekleme/çıkarma backend ve frontend birlikte yapılır.
- Üretilen `data/*.json` dosyaları elle düzenlenmez.
- Frontend hatası için backend davranışı değiştirilmez; önce sözleşme doğrulanır.
