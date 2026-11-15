# AGENTS.md — Önce Bunu Oku

Bu dosya, repoda kod yazan **insanlar ve yapay zekâ ajanları** için bağlayıcı kısa kılavuzdur.
Çelişki olursa sıralama şudur: **bu dosya → `docs/FRONTEND_GUIDE.md` → `README.md` → diğer dokümanlar**.

## 1. Proje Nedir?

AstroApex, Ay Güney Kutbu için görev planlama simülatörüdür. İki ayrı çıktı üretir:

1. **2D görev planı** → `data/output.json`
   - C11 + CSPICE fizik çekirdeği + Lua sıralama katmanı.
   - Şema kaynağı: `src/cspice_math.h`; UI alan eşleştirmesi: `docs/UI_CONTRACT.md`.
2. **3B sahne** → `data/3b_scene.json` ve `data/3b_scene.js`
   - `src/3b_moon.c` tarafından üretilir.
   - Şema kaynağı: `src/3b_moon.h`.
   - Etkileşimli görüntüleyici: `ui-starter/` (referans prototip `test_3b_viewer.html` motorunun taşınmış hâli).

Bu iki model **ayrıdır**. 2D alanlarını 3B sahneye, 3B alanlarını 2D rapora karıştırma.

## 2. Katman Sahipliği

| Katman | Dosyalar | Kim değiştirir? |
|---|---|---|
| Fizik / efemeris | `src/cspice_math.c`, `src/cspice_math.h` | Sadece backend |
| 3B sahne motoru | `src/3b_moon.c`, `src/3b_moon.h` | Sadece backend |
| HTTP / CLI | `src/main.c` | Sadece backend |
| Lua skorlama | `lua/main.lua` | Sadece backend |
| Kernel / CSPICE | `cspice/`, `data/kernels/` | Sadece backend |
| UI kabuğu / HUD | `ui-starter/index.html`, `ui-starter/style.css` | Frontend |
| 3B viewer motoru | `ui-starter/app.js` | Frontend |
| Debug konsolu | `ui-starter/debug.js` | Frontend |
| Statik görüntü verisi | `ui-starter/data/3b_scene.js`, `ui-starter/data/demo_snapshots.json`, `ui-starter/data/sample_output.json` | Üretilir (`make snapshots`) |
| Referans 3B prototip | `test_3b_viewer.html` | Frontend |
| Eski statik mock | `ui/index.html`, `ui/script.js`, `ui/style.css` | Kimse; legacy |
| Üretilen veri | `data/output.json`, `data/3b_scene.json`, `data/3b_scene.js` | Elle düzenlenmez |

`ui/` altındaki arayüz **eski mock**'tur; gerçek backend'e bağlı değildir. Yeni özellikleri buraya eklemeyin.
Frontend çalışması `ui-starter/` üzerinden yürür; `test_3b_viewer.html` referans prototiptir.

`ui-starter/` içindeki tüm `fetch`/`<script>`/`<link>` yolları **göreli** olmalı (`data/...`,
`app.js`, `style.css`). Kök `/data/...` yolu GitHub Pages alt dizininde bozulur.

## 3. Kesin Yasaklar

1. **Frontend'te bilimsel fizik türetme / backend kararlarını yeniden hesaplama.**
   Güneş/Dünya efemerisi, gölge, ufuk, ışıklandırma oranı, sıcaklık, batarya, skor veya
   GO/NO-GO kararı yalnızca backend çıktısından okunur.
   `ui-starter/app.js` içindeki Kepler yörünge halkaları ve RK4 iniş **kinematik
   görselleştirmedir** (`KINEMATIC VISUALIZATION — NO MASS MODEL` etiketi); gösterim amaçlıdır
   ve hiçbir görev kararı ya da ölçümü üretmek için kullanılmaz.
2. **Yeni JSON alan adı uydurma.**
   2D için `src/cspice_math.h` + `docs/UI_CONTRACT.md`; 3B için `src/3b_moon.h` ve üretilen JSON.
3. **Üretilen dosyaları elle düzenleme.**
   `data/output.json`, `data/3b_scene.json`, `data/3b_scene.js` ve `ui-starter/data/*` yeniden üretilir.
4. **Backend dosyalarını “UI düzelsin” diye değiştirme.**
   Fizik sabitleri, `MOON3B_TRAJ_POINTS`, kernel yolları, mass/fuel/thrust değerleri keyfi değiştirilmez.
5. **Kod içine gizli mock/sabit veri gömme.**
   Demo verisi gerekiyorsa `ui-starter/data/sample_output.json` kullanılır ve kaynak açıkça belirtilir.
6. **API sözleşmesini tek taraflı değiştirme.**
   Alan ekleme/çıkarma/değiştirme backend ve frontend birlikte yapılır.

## 4. Gerçek API Durumu

Sunucu:

```bash
./build/lunar_sim --serve 8080
```

| İstek | Sonuç |
|---|---|
| `GET /3b?...` | 3B sahne JSON'u (`data/3b_scene.json`) |
| `GET /compare?...` | 5 sahalik karsilastirma (bellekte, dosya yazilmaz) |
| `GET /` veya `/3b` dışındaki yol | 2D görev JSON'u (`data/output.json`) |
| `POST` gövdesi | **Şu an parse edilmiyor** |

Örnek:

```bash
curl 'http://127.0.0.1:8080/3b?mode=2&t_sec=1200&burn_sec=1200'
curl 'http://127.0.0.1:8080/?site=Shackleton%20Rim&lat=-89.7668&lon=-171.87&utc=2026-10-29T14:30:00&days=14'
```

**Bilinen sınırlama:** Mevcut C sunucusu POST gövdesini okumaz; canlı istekler GET query
parametreleriyle yapılır. `ui-starter/app.js` canlı `/3b` yoklamasını yalnızca
`location.hostname === "localhost"` / `"127.0.0.1"` (veya açık `?live=1`) iken yapar.
Bu farkı “frontend'te fizik hesaplayarak” kapatmaya çalışma.

## 5. Komutlar

```bash
make clean && make        # build/lunar_sim + MissionPlanner
make test                 # smoke test (--once)
make validate             # 2D + 3B + Lua JSON tutarlilik kontrolu
make serve                # 8080
make snapshots            # statik demo snapshot katalogu + ornek veri (ui-starter/data/*)
bash build.sh             # build + smoke test
lua5.4 debug_pipeline.lua # tam pipeline + viewer
```

`make test` tam birim testi değildir; sadece çalıştırma duman testidir.

## 6. Frontend İş Akışı

1. `docs/FRONTEND_GUIDE.md` ve ilgili JSON örneğini oku.
2. Sadece kendi katmanındaki dosyaları değiştir.
3. Backend alanlarını **olduğu gibi** kullan; sadece görüntüleme birimi dönüşümü yap.
4. Canlı/statik kaynağı göster: `app.js` sağ üstte `C11 HTTP: LIVE` veya `C11 ENGINE: STATIC`
   rozetiyle durumu işaretler; canlı API yalnızca `localhost`/`127.0.0.1`/`?live=1` iken yoklanır.
5. Değişiklikten sonra `node --check ui-starter/app.js ui-starter/debug.js`, `make test` ve
   `make validate`, varsa frontend build/lint çalıştır.
6. PR açıklamasına hangi JSON alanlarını kullandığını yaz.

## 7. Yapay Zekâ Ajanı İçin Kısa Talimat

> Sen yalnızca frontend katmanında çalışıyorsun. `src/`, `lua/`, `cspice/`, `data/kernels/` ve
> üretilen `data/*.json` dosyalarını değiştirme. Bilimsel fizik (efemeris, gölge, ufuk,
> ışıklandırma, sıcaklık, skor) hesabı yazma; bunları backend çıktısından oku. `app.js` içindeki
> Kepler/RK4 yalnızca **kinematik görselleştirmedir**, görev kararı üretmez. Yeni JSON alanı
> uydurma; `docs/FRONTEND_GUIDE.md` ve mevcut şemayı kullan. API şu an GET tabanlıdır; POST
> gövdesinin desteklenmediğini varsay. Değişiklikten sonra `node --check` + `make validate`
> çalıştır ve sonucu raporla.

## 8. PR Kontrol Listesi

- [ ] Sadece frontend dosyaları mı değişti?
- [ ] Bilimsel fizik/karar backend'den okunuyor; kinematik görselleştirme etiketli mi?
- [ ] JSON alan adları mevcut sözleşmeyle aynı mı?
- [ ] Üretilen veri dosyaları elle değiştirilmedi mi?
- [ ] Tüm yollar göreli mi (`data/...`, `/data/...` değil)?
- [ ] Backend kapalıyken offline/statik fallback çalışıyor mu?
- [ ] `node --check`, `make test` ve `make validate` başarılı mı?
