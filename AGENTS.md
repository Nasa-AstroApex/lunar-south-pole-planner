# AGENTS.md — Önce Bunu Oku

Bu dosya, repoda kod yazan **insanlar ve yapay zekâ ajanları** için bağlayıcı kısa kılavuzdur.
Çelişki olursa sıralama şudur: **bu dosya → `docs/FRONTEND_GUIDE.md` → `README.md` → diğer dokümanlar**.

## 1. Proje Nedir?

AstroApex, Ay Güney Kutbu için görev planlama simülatörüdür. İki ayrı çıktı üretir:

1. **2D görev planı** → `data/output.json`
   - C11 + CSPICE fizik çekirdeği + Lua sıralama katmanı.
   - UI sözleşmesi: `ui-starter/src/types/mission.ts`.
2. **3B sahne** → `data/3b_scene.json` ve `data/3b_scene.js`
   - `src/3b_moon.c` tarafından üretilir.
   - Referans görüntüleyici: `test_3b_viewer.html`.
   - Şema kaynağı: `src/3b_moon.h`.

Bu iki model **ayrıdır**. 2D alanlarını 3B sahneye, 3B alanlarını 2D rapora karıştırma.

## 2. Katman Sahipliği

| Katman | Dosyalar | Kim değiştirir? |
|---|---|---|
| Fizik / efemeris | `src/cspice_math.c`, `src/cspice_math.h` | Sadece backend |
| 3B sahne motoru | `src/3b_moon.c`, `src/3b_moon.h` | Sadece backend |
| HTTP / CLI | `src/main.c` | Sadece backend |
| Lua skorlama | `lua/main.lua` | Sadece backend |
| Kernel / CSPICE | `cspice/`, `data/kernels/` | Sadece backend |
| 2D UI sözleşmesi | `ui-starter/src/types/mission.ts` | Frontend + backend onayı |
| API istemcisi | `ui-starter/src/services/plannerApi.ts` | Frontend + backend onayı |
| Referans 3B viewer | `test_3b_viewer.html` | Frontend |
| Eski statik mock | `ui/index.html`, `ui/script.js`, `ui/style.css` | Kimse; legacy |
| Üretilen veri | `data/output.json`, `data/3b_scene.json`, `data/3b_scene.js` | Elle düzenlenmez |

`ui/` altındaki arayüz **eski mock**'tur; gerçek backend'e bağlı değildir. Yeni özellikleri buraya eklemeyin.
Frontend çalışması `ui-starter/` ve `test_3b_viewer.html` üzerinden yürür.

## 3. Kesin Yasaklar

1. **JavaScript/TypeScript içinde fizik yazma.**
   Yörünge, Güneş/Dünya açısı, gölge, ufuk, ışıklandırma, sıcaklık veya iniş matematiği hesaplama.
   Bu değerler yalnızca backend çıktısından okunur.
2. **Yeni JSON alan adı uydurma.**
   2D için `ui-starter/src/types/mission.ts`; 3B için `src/3b_moon.h` ve üretilen JSON.
3. **Üretilen dosyaları elle düzenleme.**
   `data/output.json`, `data/3b_scene.json`, `data/3b_scene.js` yeniden üretilir.
4. **Backend dosyalarını “UI düzelsin” diye değiştirme.**
   Fizik sabitleri, `MOON3B_TRAJ_POINTS`, kernel yolları, mass/fuel/thrust değerleri keyfi değiştirilmez.
5. **Kod içine gizli mock/sabit veri gömme.**
   Demo verisi gerekiyorsa `ui-starter/public/sample_output.json` kullanılır ve kaynak açıkça belirtilir.
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
| `GET /` veya `/3b` dışındaki yol | 2D görev JSON'u (`data/output.json`) |
| `POST` gövdesi | **Şu an parse edilmiyor** |

Örnek:

```bash
curl 'http://127.0.0.1:8080/3b?mode=2&t_sec=1200&burn_sec=1200'
curl 'http://127.0.0.1:8080/?site=Shackleton%20Rim&lat=-89.7668&lon=-171.87&utc=2026-10-29T14:30:00&days=14'
```

**Bilinen sınırlama:** Mevcut C sunucusu POST gövdesini okumaz. `plannerApi.ts` canlı isteği
GET query parametreleriyle yapar; backend'e POST desteği eklenirse istemci de birlikte güncellenir.
Bu farkı “frontend'te fizik hesaplayarak” kapatmaya çalışma.

## 5. Komutlar

```bash
make clean && make        # build/lunar_sim + MissionPlanner
make test                 # smoke test (--once)
make validate             # 2D + 3B + Lua JSON tutarlilik kontrolu
make serve                # 8080
make snapshots            # statik demo snapshot katalogu + ornek veri
bash build.sh             # build + smoke test
lua5.4 debug_pipeline.lua # tam pipeline + viewer
```

`make test` tam birim testi değildir; sadece çalıştırma duman testidir.

## 6. Frontend İş Akışı

1. `docs/FRONTEND_GUIDE.md` ve ilgili JSON örneğini oku.
2. Sadece kendi katmanındaki dosyaları değiştir.
3. Backend alanlarını **olduğu gibi** kullan; sadece görüntüleme birimi dönüşümü yap.
4. Backend kapalıysa `runMissionSimulation` sonucundaki `source` alanını kontrol et:
   `live-backend` mi, `offline-sample` mı? UI'da göster.
5. Değişiklikten sonra `make test` ve `make validate`, varsa frontend build/lint çalıştır.
6. PR açıklamasına hangi JSON alanlarını kullandığını yaz.

## 7. Yapay Zekâ Ajanı İçin Kısa Talimat

> Sen yalnızca frontend katmanında çalışıyorsun. `src/`, `lua/`, `cspice/`, `data/kernels/` ve
> üretilen `data/*.json` dosyalarını değiştirme. Fizik, yörünge, gölge veya ışıklandırma hesabı yazma.
> Yeni JSON alanı uydurma; `docs/FRONTEND_GUIDE.md` ve mevcut tipleri kullan. API şu an GET tabanlıdır;
> POST gövdesinin desteklenmediğini varsay. Değişiklikten sonra `make test` ve `make validate`
> çalıştır ve sonucu raporla.

## 8. PR Kontrol Listesi

- [ ] Sadece frontend dosyaları mı değişti?
- [ ] JS/TS içinde fizik hesabı yok mu?
- [ ] JSON alan adları mevcut sözleşmeyle aynı mı?
- [ ] Üretilen veri dosyaları elle değiştirilmedi mi?
- [ ] Backend kapalıyken offline fallback çalışıyor mu?
- [ ] `make test` ve `make validate` başarılı mı?
