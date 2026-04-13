# NF Scout — Kullanım Kılavuzu

> FRC 2026 REBUILT | Team NF #9029  
> Tablet üzerinde çalışmak üzere tasarlanmıştır.

---

## İçindekiler

1. [Genel Bakış](#1-genel-bakış)
2. [Giriş Yapma](#2-giriş-yapma)
3. [Admin Paneli — Etkinlik Öncesi Kurulum](#3-admin-paneli--etkinlik-öncesi-kurulum)
4. [Saha Ekranı — Eyes-Free Terminal](#4-saha-ekranı--eyes-free-terminal)
5. [Pit Scout Paneli](#5-pit-scout-paneli)
6. [Video Scout Paneli](#6-video-scout-paneli)
7. [War Room — Strateji Merkezi](#7-war-room--strateji-merkezi)
8. [Takım Profili Popup](#8-takım-profili-popup)
9. [Scout Rotasyon Sistemi](#9-scout-rotasyon-sistemi)
10. [Veri Aktarımı ve Senkronizasyon](#10-veri-aktarımı-ve-senkronizasyon)
11. [Test Paneli](#11-test-paneli)
12. [Sık Karşılaşılan Durumlar](#12-sık-karşılaşılan-durumlar)

---

## 1. Genel Bakış

NF Scout, FRC etkinliklerinde takımların rakip ve potansiyel müttefik robotları gerçek zamanlı olarak izlemesini sağlayan bir scouting platformudur.

**Kim ne kullanır?**

| Kişi | Panel | Görev |
|---|---|---|
| **Saha Scoutları** (6–10 kişi) | 🕹 Saha | Maç sırasında canlı veri toplama |
| **Pit Scoutları** (2–4 kişi) | 🔍 Pit | Robot özellikleri kayıt altına alma |
| **Video Scout** | 🎬 Video | Oynanan maçları izleyerek şut analizi |
| **Strateji Sorumlusu** | ⚡ War Room | AI destekli strateji geliştirme |
| **Admin** | ⚙️ Admin | Kurulum, API key, vardiya ayarları |

**Çevrimdışı çalışır:** Tüm veriler önce cihazdaki IndexedDB'ye kaydedilir. İnternet bağlantısı yalnızca TBA/AI özellikleri için gereklidir.

---

## 2. Giriş Yapma

Uygulama açıldığında giriş ekranı gelir.

### Kimlik Bilgileri

**Admin:**
- Kullanıcı adı: `admin`
- Şifre: `efe123`

**Saha Scoutları:**
- Kullanıcı adı: `red1`, `red2`, `red3`, `blue1`, `blue2`, `blue3`
- Şifre: sıraya göre `r1pass`, `r2pass`, `r3pass`, `b1pass`, `b2pass`, `b3pass`
- Scout 7–10: `scout_7`..`scout_10` / şifre: `s7pass`..`s10pass`

**Pit Scoutları:**
- Admin panelinde kaç pit scout olduğunu ayarla (varsayılan: 2)
- Kullanıcı adı: `pit_1`, `pit_2`, ...
- Şifre: `pit1pass`, `pit2pass`, ...

**Video Scout:**
- Kullanıcı adı: `video`
- Şifre: `videopass`

> 💡 Giriş ekranındaki **hızlı giriş butonları** (Kırmızı 1, Mavi 1 vb.) test için şifreyi otomatik doldurur.

---

## 3. Admin Paneli — Etkinlik Öncesi Kurulum

Admin olarak giriş yap → **⚙️ Admin** sekmesi.

### 3.1 Ayarlar Sekmesi

**Yapılacaklar (sırayla):**

1. **Etkinlik Kodu** — TBA formatında gir (örn. `2026miket`, `2026ismir`)
2. **Takım Numaramız** — `9029` (War Room'da kendi maçlarımızı vurgular)
3. **TBA API Key** — https://thebluealliance.com/account adresinden al, yapıştır
4. **OpenRouter API Key** — https://openrouter.ai/keys adresinden al (War Room AI için)
5. **Model** — varsayılan `x-ai/grok-4-fast`, değiştirmek istersen başka model adı yaz

> Değişiklikler anında `localStorage`'a kaydedilir, KAYDET tuşu gerektirmez.

---

### 3.2 Vardiya Sekmesi

Etkinlik öncesinde **10 scout için isim** gir. Bu isimler:
- Rotasyon tablosunda görünür
- Saha ekranında scout adını gösterir

**Etkinlik Başlangıç Zamanı:**
- "⏱ Şimdi Başladı" butonuna bas → ilk maç başlar başlamaz değilse
- Ya da manuel olarak gir
- Sıfırlamak için "↺ Sıfırla" butonu

> Rotasyon sistemi hakkında detay için [Bölüm 9](#9-scout-rotasyon-sistemi)'a bak.

---

### 3.3 Saha Kalibrasyon Aracı

Saha fotoğrafını yükleyerek dokunmatik canvas'ı kalibre et.

1. **"Resim Yükle"** — gerçek saha fotoğrafı seç (landscape yönde çekilmiş olmalı)
2. **Zone çiz:** Her zone türü için "Çiz" butonuna bas → canvas üzerinde sürükleyerek alan belirle
   - `fieldBoundary` — saha dış sınırı
   - `blueZone` / `redZone` — ittifak alanları
   - `neutralZone` — orta alan
   - `blue_bump1`, `blue_bump2` → Mavi bumplar (kırmızı otomatik aynılanır)
   - `blue_trench1`, `blue_trench2` → Mavi trench'ler
   - `blueHub` / `redHub` — hub merkezleri
3. **"Kaydet"** — veriler `localStorage`'a yazılır, tüm cihazlara aktarmak için aynı adımı tekrar et

> Kalibrasyon yapılmadan uygulama varsayılan zone koordinatlarıyla çalışır.

---

## 4. Saha Ekranı — Eyes-Free Terminal

**Saha scoutları için** — maç sırasında ekrana bakmadan kullanmak üzere tasarlandı.

### 4.1 Hazırlık Ekranı (IDLE)

Maç başlamadan önce görünen ekran.

```
┌─────────────────────────────────┐
│  SEAT: RED 1                    │
│  Scout: Ali Veli                │
│                                 │
│  ← QUAL 12 →  [TBA'ya dön ↺]   │
│  Hedef: frc2056                 │
│                                 │
│  Vardiya durumu: ▶ 3 maç kaldı  │
│                                 │
│       MATCH START               │
└─────────────────────────────────┘
```

- **Qual numarası** otomatik TBA'dan gelir; `−` / `+` ile değiştirebilir veya direkt yazabilirsin
- `↺ TBA` — manuel değişikliği geri al, TBA verisiyle devam et
- **MATCH START** butonuna bas → maç başlar

---

### 4.2 Maç Fazları

| Süre | Faz | Renk | Ne yapılır |
|---|---|---|---|
| 0–20s | **AUTO** | 🟢 Yeşil | Canvas'a dokunarak otonom yol noktaları ekle |
| 20–30s | **OTO BİTTİ** | 🟡 Sarı | Noktaları sürükle/düzenle, **OTO KAYDET** bas |
| → soru | **Kim kazandı?** | — | RED veya BLUE seç |
| 30–40s | **TRANSİSYON** | 🟣 Mor | Konum ping + traversal butonları aktif |
| 40–130s | **TELEOP S1–S4** | 🔵 Mavi | Normal scouting |
| 130–160s | **ENDGAME** | 🟠 Turuncu | L1/L2/L3 + diğer butonlar |

---

### 4.3 AUTO Fazı (0–20 saniye)

**Sahaya dokun** → Otonom yol noktası eklenir (yeşil daire).

Tüm noktalar ekranda görünür — bu robotun gittiği yolu gösterir.

- **↩ Geri Al** — son noktayı sil
- Yanlışlıkla fazla nokta eklediysen geri al butonunu kullan

> İpucu: Nokta koymak için robot neredeyse orayı işaretle — ekrana bakmana gerek yok, başparmaklarınla sezgisel şekilde koy.

---

### 4.4 OTO BİTTİ / İnceleme (20–30s)

Otonom bitti. Artık noktaları düzenleyebilirsin:
- Herhangi bir noktayı sürükle → yerini düzelt
- ↩ Geri Al → son noktayı sil

**OTO KAYDET →** butonuna bas.

Hemen ardından: **"OTO KİM KAZANDI?"** sorusu gelir.
- **RED** veya **BLUE** seç
- Bu veri ittifak analizinde kullanılır

---

### 4.5 TELEOP Fazı (30–130s)

Bu fazda aktif olan butonlar:

#### 📍 Konum İşaretle (otomatik)
Her 5 saniyede bir ekranda **"📍 KONUM İŞARETLE"** çubuğu belirir.  
Şu an robotu nerede görüyorsan **sahaya dokun** → konum kaydedilir.  
- Sayaç kırmızıya döndüyse acele et
- Yanlış yere bastıysan sorun değil — yaklaşık konum yeterli

#### TRENCH / BUMP Butonları
Robot trench'ten veya bump'tan geçtiğinde bas:

| Buton | Ne zaman basılır |
|---|---|
| **TRENCH** | Robot trench bölgesinden (alt kenar bantları) geçerken |
| **BUMP** | Robot bump'ın üzerinden atlarken / geçerken |

Her basışta sayaç artar (×1, ×2, ...).

#### COMMS / MECH / STUCK / BRNOUT
Robot sorun yaşadığında:

| Buton | Anlam |
|---|---|
| **COMMS** | İletişim kopukluğu (titreme, tepkisizlik) |
| **MECH** | Mekanik arıza (parça kopması, takılma vb.) |
| **STUCK** | Robot sıkıştı, hareket edemiyor |
| **BRNOUT** | Güç düşüşü / brownout (robot yavaşlıyor) |

#### FOUL
Kural ihlali yaptığında bas → not penceresi açılır, kural numarasını yaz (örn. `G12`) ve KAYDET.

---

### 4.6 ENDGAME Fazı (130–160s)

Tüm TELEOP butonları hâlâ aktif + ek olarak:

| Buton | Ne zaman basılır |
|---|---|
| **L1** | Robot 1. seviyeye tırmandı — parmağını basılı tut, tırmanma bitince bırak |
| **L2** | Robot 2. seviyeye tırmandı — aynı şekilde |
| **L3** | Robot 3. seviyeye tırmandı — aynı şekilde |

> Parmağını ne kadar basılı tutarsan tırmanma süresi o kadar kaydedilir.

---

### 4.7 Maç Sonu

160. saniyede otomatik olarak **Post-Match** ekranı açılır.

**Doldurulacak alanlar:**
- Toplam skor tahmini (yaklaşık)
- Notlar — önemli gözlemler (serbest metin)
- İstersen yükleme/indirme animasyonu ile backend'e yüklenir

**GÖNDER** → Veri kaydedilir → hazırlık ekranına dön.

---

## 5. Pit Scout Paneli

**Pit scoutları için** — robot testleri ve konuşmaları sırasında tablet'e bakarak doldurulur.

### 5.1 Takım Seçimi

Sol sidebar'da atanan takımlar listesi görünür.

- Pit scout sayısı Admin'de belirlenmiştir (varsayılan: 2)
- `pit_1` 1, 3, 5, 7... sıradaki takımları; `pit_2` 2, 4, 6, 8... sıradaki takımları görür
- Admin girişiyle tüm takımlar görünür

> **TBA key eksikse:** Hata mesajı ve "↺ Tekrar Dene" butonu görünür. Admin'den key eklemesini iste.

---

### 5.2 Form Doldurma

Bir takıma tıkla → formu doldur.

**Yetenekler:**
- Bump geçişi yapabiliyor mu?
- Trench geçişi yapabiliyor mu?
- Şut atıyor mu? (uzak / yakın / yok)
- Teleop tırmanma? Otonom tırmanma?
- Savunma yapıyor mu?
- Sürüş motoru (NEO / Kraken X60 / CIM / Falcon / Diğer)
- Tutarlılık (1–5 yıldız)

**Skor Tahminleri:**
- Otonom yakıt puanı tahmini
- Teleop yakıt puanı tahmini
- Maksimum taşıma kapasitesi

**Notlar:** Serbest metin — önemli detayları buraya yaz.

**Fotoğraf:** Robot fotoğrafı çek veya yükle (opsiyonel).

### 5.3 Kaydetme

**KAYDET** butonu → veri `localStorage`'a yazılır ve War Room'da görünür.

---

## 6. Video Scout Paneli

**Oynanan maçları analiz etmek için** — internet bağlantısı gerekir.

### 6.1 Maç Seçimi

1. Sol sidebar'dan maç listesi yüklenir (TBA API)
2. Analiz etmek istediğin maçı seç
3. Sağ tarafta YouTube embed açılır

### 6.2 Video Kontrolleri

| Kontrol | Açıklama |
|---|---|
| Hız | 0.5x / 1x / 1.5x / 2x |
| Zoom | Sahaya yakınlaştır |
| Kalite | 144p–1080p (ağır internet için düşür) |
| Sidebar toggle | Video alanını genişlet |

### 6.3 Maç Başlangıcı İşaretleme

**🏁 MAÇ BAŞLADI** butonuna bas → videonun o anki saniyesi kaydedilir.

Bu bilgi, şut timestamp'lerinin gerçek maç süresiyle hizalanmasını sağlar.

Yanlış bastıysan tekrar bas → sıfırlanır.

### 6.4 Şut Kayıtları

Her robot için (kırmızı 1, 2, 3 ve mavi 1, 2, 3) iki buton:
- **Şut Başladı** → robotu şut atmaya başladığı anda bas
- **Şut Bitti** → şut bitti

Çiftler otomatik eşleşir → şut süreleri ve yakıt tahmini hesaplanır.

### 6.5 Gönderme

**GÖNDER** → maç verileri kaydedilir, War Room'da ve Takım Profili'nde görünür.

---

## 7. War Room — Strateji Merkezi

**Strateji sorumlusu için** — admin girişi gerekir.

### 7.1 Ana Ekran

```
┌──────────────────────────────────────────────────┐
│  ⚡ WAR ROOM                                     │
│                                                   │
│  GELECEK QUALLAR          KIRMIZI İTTİFAK        │
│  ┌────────────────┐  frc9029  frc254  frc1114     │
│  │ Q14 — 2 maç   │  [kart]   [kart]  [kart]      │
│  │ Q17 — 5 maç   │                               │
│  │ Q21 — BİZ ★   │  MAVİ İTTİFAK                │
│  └────────────────┘  frc1678  frc148  frc118     │
│                       [kart]   [kart]  [kart]    │
│                                                   │
│  [⚡ STRATEJİ ÜRET]                              │
└──────────────────────────────────────────────────┘
```

### 7.2 Maç Seçimi

Sol listeden bir maça tıkla → o maçın ittifakları ve takım kartları sağda görünür.

- **★ BİZ** rozeti → takım numaramızın bulunduğu maçlar
- Oynanan maçlarda skor tablosu görünür (örn. `145 : 132 👑`)

### 7.3 Takım Kartları

Her kart şunları gösterir:
- Takım numarası ve adı
- EPA puanı (Statbotics)
- Top 2–3 analitik insight rozeti (bump tercihi, şut pozisyonu, problem riski vb.)

**Karta tıkla** → [Takım Profili Popup](#8-takım-profili-popup) açılır.

### 7.4 AI Strateji Önerisi

Maç seçili haldeyken **⚡ STRATEJİ ÜRET** butonuna bas.

OpenRouter aracılığıyla AI:
- Her takımın güçlü/zayıf yönlerini analiz eder
- Bump/trench çakışma risklerini değerlendirir
- İttifak rolleri (shooter, carrier, defender) önerir
- Dikkat edilmesi gereken rakip taktiklerini belirtir

> **Gereksinim:** Admin panelinde OpenRouter API key ve model girilmiş olmalı.

Öneri kutusunun altında **yeniden üret** butonu bulunur.

### 7.5 Maç Analiz Kartları

Maç seçildiğinde ek analitik kartlar da görünür:
- EPA karşılaştırması (kırmızı vs mavi toplam)
- Otonom yol çakışma riskleri
- Rakip ana carrier ve choke point
- Trafik rotası önerileri
- Güvenilmez partner uyarıları

---

## 8. Takım Profili Popup

War Room'daki herhangi bir takım kartına tıklayarak aç.

### Sekme 1: Genel Bakış

- Pit raporu tüm alanları
- Ortalama yakıt, standart sapma
- Bump/trench zone kullanım dağılımı
  - Kırmızı Üst Bump, Mavi Alt Trench gibi spesifik bölgeler
  - O bölgede kullanıldığında ortalama skor
- Tırmanma geçmişi (L1/L2/L3 kaç kere)
- Problem dağılımı (COMMS, MECH vb.)
- EPA tablosu (Statbotics)

### Sekme 2: Maçlar

Scouting yapılmış tüm maçların listesi.

**Maça tıkla → Maç Tekrarı Oynatıcısı açılır:**

```
┌─────────────────────────────────────────┐
│  [SAHA RESMİ VEYA ZONE HARİTASI]        │
│                                         │
│    🟥 ← robot animasyonu                │
│    - - - (otonom yol referansı)         │
│                                         │
│  AUTO          GEÇİŞ          TELEOP    │
└─────────────────────────────────────────┘
│ ▶  0:30 / 2:40   ━━━━━●─────────────── │
│ [▶/⏸] [↩] [1x] [2x] [4x] [8x] [16x]  │
└─────────────────────────────────────────┘
```

**Kontroller:**
- **▶/⏸** — oynat/durdur
- **↩** — başa sar
- **1x / 2x / 4x / 8x / 16x** — oynatma hızı
- Kaydırıcı (scrubber) — dilediğin ana atla

**Robot simgesi:**
- 🟥 Kırmızı veya 🟦 Mavi kare
- Ok → hareket yönü
- Otonom fazda yeşil kesikli çizgi = yol haritası
- Teleop fazında renk izi = son 6 konum

### Sekme 3: Notlar & AI

- Tüm scoutların ham notları (maç bazında)
- Yaşanan problemler listesi
- **⚡ Özet Üret** → OpenRouter'a gönderilir, yapılandırılmış özet döner:
  - Güçlü Yanlar
  - Zayıf Yanlar
  - Önerilen Rol
  - Dikkat Noktaları
- Özetin üretilmesinden sonra yeni maç oynandıysa **"Yeni veri var"** uyarısı ve **Güncelle** butonu görünür

---

## 9. Scout Rotasyon Sistemi

10 saha scoutunun 6'sı aktif oynarken 4'ü mola verir. Her `R` maçta bir rotasyon yaşanır (varsayılan: 12 maç).

### Rotasyon Mantığı

| Scout | Grup |
|---|---|
| red1, red2 | A |
| blue1, blue2 | B |
| red3, blue3 | C |
| scout_7, scout_8 | D |
| scout_9, scout_10 | E |

Her döngü `5 × R` maçtan oluşur. Bir döngüde her grup sırayla mola verir.

### Vardiya Durumu Göstergesi

**Saha Ekranı → üst çubuk:**
- `▶ 3m` → aktif, 3 maç kaldı
- `☕ →Q14` → mola, Q14'ten itibaren aktif

**Hazırlık Ekranı:**
- Büyük kart olarak bulunduğun grubun durumu gösterilir

---

## 10. Veri Aktarımı ve Senkronizasyon

### Otomatik Sync

Backend çalışıyorsa uygulama sayfa yüklendiğinde IndexedDB'deki raporları backend'e göndermeye çalışır.

### Manuel QR Aktarımı (Çevrimdışı)

Backend yoksa veya cihazlar aynı ağda değilse:

1. Saha ekranı → Maç sonu → **QR KOD GÖSTER**
2. Strateji cihazında QR kod okuyucu aç
3. Veriyi import et → **📥 İmport Et**

> QR aktarımı tek maç verisi için uygundur. Büyük veri setleri için aynı Wi-Fi üzerinde backend sync kullan.

---

## 11. Test Paneli

**Admin girişi gerekir** → 🧪 Test sekmesi.

Gerçek etkinlik verisi olmadan uygulamayı test etmek için:

1. **REGIONAL YARAT** butonuna bas
2. ~5 saniye bekle
3. Sistem oluşturur:
   - 30 takım (frc9029 dahil), 40 qual takvimi
   - 30 oynanan qual için saha raporları
   - Pit raporları (çeşitli arketiplerle)
   - Gerçekçi skor verileri
4. Admin panelinden etkinlik kodunu `2026test` olarak ayarla
5. War Room'u aç → tüm veriler görünür

**Tekrar oluşturmak için:** Sayfayı yenile ve tekrar bas (eski veri üzerine yazar).

> Test verisini sil: Admin → Ayarlar → "Test Verisini Temizle" (veya `localStorage` ve IndexedDB'yi tarayıcıdan sil).

---

## 12. Sık Karşılaşılan Durumlar

### "Takım bulunamadı — TBA key gerekebilir"

**Neden:** TBA API key girilmemiş veya hatalı.  
**Çözüm:** Admin paneli → Ayarlar → TBA API Key alanını doldur.

---

### Qual numarası yanlış geliyor

**Neden:** TBA'dan gelen veri gecikmiş olabilir.  
**Çözüm:** Saha ekranı → hazırlık → `−` / `+` ile düzelt, veya direkt yaz.  
`↺ TBA` butonu → TBA verisine geri dön.

---

### Otonom yolu yanlış çizdim

**Neden:** Maç sırasında yanlış yere dokunuldu.  
**Çözüm:** **↩ Geri Al** butonu ile son noktayı sil. İnceleme fazında (20–30s) sürükleyerek düzelt.

---

### Konum ping sayacı hızlı doldu, bastım ama yanlış yere

**Neden:** Aceleyle yanlış noktaya basıldı.  
**Çözüm:** Endişelenme — yaklaşık konumlar analiz için yeterlidir. Veri kaybedilmez.

---

### War Room AI strateji üretmiyor

**Neden:** OpenRouter key eksik veya bakiyesi yok.  
**Çözüm:** Admin → Ayarlar → OpenRouter API Key kontrol et. https://openrouter.ai/credits adresinden bakiyeni gör.

---

### Maç tekrarı animasyonu çok yavaş / donuyor

**Neden:** Düşük performanslı cihaz.  
**Çözüm:** Hız ayarını **4x** veya **8x**'e çek. Sayfa yenileme de yardımcı olur.

---

### Veri backend'e gönderilmiyor

**Neden:** Backend çalışmıyor veya farklı ağda.  
**Çözüm:**
- Backend'in `--port 8001` ile çalıştığını kontrol et
- Tüm cihazların aynı Wi-Fi ağında olduğunu kontrol et
- Backend yoksa QR aktarımı kullan

---

### Saha görüntüsü bozuk görünüyor

**Neden:** Yüklenen saha fotoğrafı farklı bir cihazda kalibre edilmiş, bu cihazda farklı görünüyor.  
**Çözüm:** Bu cihazda Admin → Saha Kurulum → aynı fotoğrafı tekrar yükle ve kalibre et. Canvas artık fotoğrafın kendi oranını kullanır.

---

*Son güncelleme: NF Scout v2 — FRC 2026 REBUILT*
