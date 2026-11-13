---

### 2. Dosya: `~/Project/Nasa/docs/UI_CONTRACT.md`

UI ekibinin arayüzdeki her grafiği, kartı ve uyarıyı hangi JSON alanına bağlayacağını gösteren teknik dokümanı oluşturmak için çalıştır:

```bash
mkdir -p ~/Project/Nasa/docs
cat << 'EOF' > ~/Project/Nasa/docs/UI_CONTRACT.md
# 🎨 UI Ekibi Gereksinim Listesi & JSON API Sözleşmesi

Bu doküman, Web UI (`ui/`) ile C + Lua hesaplama motoru arasındaki kesin veri sözleşmesini tanımlar.

---

## 1. İletişim ve Veri Akışı

* **Canlı API Endpoint:** `POST http://localhost:8080/api/calculate` (`Content-Type: application/json`)
* **Çevrimdışı / Statik Mod:** Backend sunucusu kapalıysa `data/output.json` dosyası doğrudan `fetch('../data/output.json')` ile okunarak arayüz tam fonksiyonlu çalıştırılabilir.

### UI → Backend İstek Formatı (`Request`)
Kullanıcı haritadan nokta seçtiğinde, tarih aralığını değiştirdiğinde veya gelişmiş eşikleri güncellediğinde şu JSON gönderilir:

```json
{
  "site": {
    "site_name": "Shackleton Rim",
    "latitude_deg": -89.90,
    "longitude_deg": 0.0,
    "altitude_m": 120,
    "use_custom": false
  },
  "time_range": {
    "start_utc": "2026-10-18T00:00:00Z",
    "end_utc": "2026-11-01T00:00:00Z",
    "step_seconds": 3600
  },
  "options": {
    "use_dem_horizon": true,
    "min_sun_elevation_deg": 0.0,
    "min_earth_elevation_deg": 0.0,
    "include_earth_disk": false
  }

2. Backend → UI Yanıt Eşleme Tablosu (Response)UI BileşeniOkunacak JSON AlanıKullanım DetayıKapsama / Uyarı Banner'ıdem_out_of_boundswarning_msgdem_out_of_bounds == true ise (seçilen nokta -90°..-80° DEM sınırının dışındaysa) warning_msg metnini uyarı kutusunda gösterin.Kart 1: Aydınlanma Potansiyelisummary.total_sun_hourssummary.illumination_percentsummary.longest_sun_hoursToplam güneşli saat, görev yüzdesi ve en uzun kesintisiz Güneş penceresi.Kart 2: Dünya Görüşü (DTE)summary.total_earth_hourssummary.earth_visibility_percentsummary.longest_earth_hourssummary.dte_window_countToplam geometrik görüş süresi, yüzdesi, en uzun kesintisiz DTE penceresi ve bağımsız pencere sayısı.Kart 3: Eşzamanlı Çakışmasummary.overlap_hoursGüneş ışığı ve Dünya görüşünün aynı anda açık olduğu toplam saat.Kart 4: En Uzun Karanlıksummary.longest_dark_hoursKesintisiz gölge/gece süresi (batarya dayanım analizi için).Yerel Ufuk / Gökyüzü Kubbesisamples[i].sun_azimuth_degsamples[i].sun_elevation_degsamples[i].earth_azimuth_degsamples[i].earth_elevation_degZaman sürgüsü (i) hareket ettikçe Güneş ve Dünya işaretçilerini Azimut (0°–360°) ve Yükseklik (-90°..+90°) açılarına göre yerleştirin.360° Arazi Ufuk Silüetiterrain_horizon_mask0°–359° arası 360 elemanlı derece dizisidir. Ufuk çizgisi üzerine yerel krater/dağ engeli profili olarak çizin.Zaman Çizelgesi Grafiğisamples[]windows.sun[]windows.earth[]Yatay eksen samples[i].utc; dikey eksen sun_elevation_deg, earth_elevation_deg ve sun_terrain_horizon_deg. Kesintisiz pencere blokları için windows dizisini kullanın. Grafikte bir noktaya tıklandığında özet kartlarını o adımın (i) verisine göre güncelleyin.Bölge Karşılaştırma Tablosusite_comparison[]5 Artemis aday sahasının hazır kıyaslama verilerini (mission_score sırasıyla) yan yana listeler.Veri ve Varsayımlar Panelimetaspice_kernels, dem_info, step_seconds, earth_visibility_model ve score_weights değerlerini şeffaflık sekmesinde gösterin.