# AstroApex Backend Mimarisi

Bu doküman backend'in teknik akışını anlatır. Frontend entegrasyon kuralları için
[`FRONTEND_GUIDE.md`](FRONTEND_GUIDE.md) ve [`../AGENTS.md`](../AGENTS.md) dosyalarına bakın.

## 1. İki Çıktı Modeli

| Model | Üretici | Çıktı | Şema |
|---|---|---|---|
| 2D görev planı | `src/cspice_math.c` + `lua/main.lua` | `data/output.json` | `src/cspice_math.h` (+ `docs/UI_CONTRACT.md`) |
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
- **Skorlama:** Aydınlanma, DTE, eğim, karanlık süresi ve minimum batarya `mission_score`
  ve `verdict` alanlarına dönüşür. `%40` altı Güneş, `120` saat üstü karanlık, `%15` altı batarya
  veya `12°` üstü eğim NO-GO'dur. NO-GO skoru 39, CAUTION skoru 69 ile sınırlanır.

Kernel seti eksikse CLI/sunucu **fail-closed** davranır ve başlamaz. Kütüphane doğrudan çağrılırsa
analitik yedek model etiketiyle (`ephemeris_source: "ANALYTIC_MEEUS_FALLBACK"`) çalışabilir; bu
durumda `spice_bodies[].from_spice_kernel` ve ilgili çıktı alanları `false` olur. Frontend bunu hata
olarak değil, kaynak bilgisi olarak gösterir.

## 4. 3B Sahne Akışı

- Uzay aracı başlangıç konumu `(sc_lat, sc_lon, sc_alt)` ile tanımlanır.
- Hedef saha `(target_lat, target_lon)` ve yüzey yarıçapı ile hesaplanır.
- `compute_3b_moon_scene()`; Ay merkezli konum/hız, 96 noktalı yörünge, 60 saniyelik iniş örnekleri
  ve `touchdown_report` üretir.
- Çıktı `data/3b_scene.json` ve `data/3b_scene.js` olarak yazılır.
- `ui-starter/` bu veriyi çizer (motor `test_3b_viewer.html` referans prototipinden taşındı).
  İçindeki Kepler yörünge halkaları ve RK4 iniş **kinematik görselleştirmedir**
  (`KINEMATIC VISUALIZATION — NO MASS MODEL`); görev kararı/ölçümü üretmez, backend alanlarını değiştirmez.

3B alanlarının birimleri `src/3b_moon.h` yorumlarında tanımlıdır. Özellikle:
`pos_km` km ve `IAU_MOON` çerçevesinde, `vel_kms` km/s, `altitude_km` km (yerel sentetik zemine
göre AGL), `gravity_ms2`/`thrust_ms2` m/s², `landing_seconds[].altitude_m` metre.
`sun.vec`, `earth.vec`, site koordinatları, uzay aracı ve yörünge IAU_MOON'dur. `helio_km` alanları
analitik Kepler yaklaşımıdır (`helio_model: "ANALYTIC_KEPLER"`). 3B kinematik modeldir:
`scene_model: "kinematic-visualization"`, `physics_valid: false`, `trajectory_phase: "POST_BURN_DESCENT"`; `touchdown_report.mission_score`
yoktur.

## 5. UI Eşleştirme İlkeleri

- 3B sahne: `trajectory[].pos_km` ve `vel_kms` doğrudan çizilir; yörünge yeniden hesaplanmaz.
- İniş paneli: `touchdown_report.success`, `status_label`, `model`, `physics_valid`, `miss_distance_m`, `trajectory_snapped_to_target`, `touchdown_speed_ms`.
- 2D zaman çizelgesi: `samples[]`, `windows.sun`, `windows.earth`.
- 360° ufuk: `terrain_horizon_mask`.
- Aday saha tablosu: `site_comparison[]`.
- Tüm değerler backend'den geldiği gibi gösterilir; frontend yalnızca görüntüleme birimi dönüşümü yapar.

## 6. Değişiklik Sınırları

- Fizik sabitleri, kernel yolları, mass/fuel/thrust değerleri ve `MOON3B_TRAJ_POINTS` keyfî değiştirilmez.
- JSON alanı ekleme/çıkarma backend ve frontend birlikte yapılır.
- Üretilen `data/*.json` dosyaları elle düzenlenmez.
- Frontend hatası için backend davranışı değiştirilmez; önce sözleşme doğrulanır.
