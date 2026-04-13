# NF Scout — FRC 2026 REBUILT Scouting App

> Offline-first scouting and strategy platform built for **Team NF (9029)**.  
> Designed for tablet use at FRC regional events — no internet required during matches.

---

## İçindekiler / Table of Contents

1. [Özellikler / Features](#özellikler--features)
2. [Mimari / Architecture](#mimari--architecture)
3. [Klasör Yapısı / Project Structure](#klasör-yapısı--project-structure)
4. [Kurulum / Setup](#kurulum--setup)
5. [API Anahtarları / API Keys](#api-anahtarları--api-keys)
6. [Paneller / Panels](#paneller--panels)
7. [Geliştirme Notları / Dev Notes](#geliştirme-notları--dev-notes)
8. [Test](#test)
9. [Katkı Rehberi / Contributing](#katkı-rehberi--contributing)

---

## Özellikler / Features

| Modül | Açıklama |
|---|---|
| 🕹 **Saha (Eyes-Free Terminal)** | Maç sırasında göze gerek duymadan veri toplama; otonom yol, konum pingleri, bump/trench geçişleri, tırmanma |
| 🔍 **Pit Scout** | Robot yetenekleri, fotoğraf yükleme, skor tahminleri |
| 🎬 **Video Scout** | YouTube embed, timestamp tabanlı şut kaydı, maç başlangıç işaretleme |
| ⚡ **War Room** | Gelecek quallar için AI strateji önerisi (OpenRouter), EPA entegrasyonu (Statbotics), maç sonuçları |
| 👤 **Takım Profili** | Tüm maç tekrarı animasyonu (auto + teleop), traversal zone analizi, LLM özet |
| ⚙️ **Admin Panel** | Etkinlik/TBA key ayarı, pit scout oluşturma, saha kalibrasyon, vardiya rotasyonu |
| 🧪 **Test Panel** | 30 takım / 40 qual ile gerçekçi mock regional üretici |
| 📡 **Offline-first** | IndexedDB'ye yaz, bağlantı gelince backend'e sync; QR kodu ile yedekleme |

---

## Mimari / Architecture

```
┌─────────────────────────────────────────┐
│              TABLET / BROWSER           │
│                                         │
│  React PWA (Vite)                       │
│  ├─ IndexedDB  ──► offline reports      │
│  ├─ localStorage ─► config / calib      │
│  └─ sessionStorage ─► auth session      │
│              │                          │
│              │ HTTP (localhost:8001)     │
└──────────────┼──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         FastAPI Backend (:8001)         │
│  ├─ SQLAlchemy ORM                      │
│  ├─ SQLite (dev) / PostgreSQL (prod)    │
│  └─ httpx → TBA API / Statbotics API   │
└─────────────────────────────────────────┘

Dış Servisler / External Services:
  The Blue Alliance (TBA) v3 API  ──► maç takvimi, takım listesi
  Statbotics API v3               ──► EPA verileri
  OpenRouter API                  ──► AI strateji önerisi (grok-4-fast)
```

**Backend opsiyoneldir.** Uygulama tamamen offline çalışır; backend yalnızca sync ve canlı hub durumu için gereklidir.

---

## Klasör Yapısı / Project Structure

```
frc-rebuilt-scouting-app/
│
├── backend/                        # Python FastAPI uygulaması
│   ├── app/
│   │   ├── main.py                 # Route tanımları, CORS
│   │   ├── db.py                   # SQLAlchemy engine (DATABASE_URL env)
│   │   ├── models.py               # ORM modelleri
│   │   ├── schemas.py              # Pydantic request/response şemaları
│   │   ├── services.py             # TBA + Statbotics HTTP client'ları
│   │   └── tests/
│   │       └── test_api.py         # pytest testleri
│   ├── schema.sql                  # PostgreSQL şeması (referans)
│   └── pyproject.toml              # Bağımlılıklar + pip install -e .[dev]
│
├── frontend/                       # Vite + React PWA
│   ├── public/
│   │   └── manifest.webmanifest    # PWA manifest
│   ├── src/
│   │   ├── main.jsx                # React 18 root
│   │   ├── App.jsx                 # Login + sekme yönlendirmesi
│   │   ├── styles.css              # Global stiller
│   │   ├── api.js                  # Backend + TBA API çağrıları
│   │   ├── sync.js                 # Backend'e offline sync
│   │   ├── storage.js              # IndexedDB yardımcıları
│   │   ├── qr.js                   # QR üretme/okuma
│   │   ├── adminConfig.js          # Config okuma/yazma (localStorage)
│   │   ├── teamAnalytics.js        # Derin saha analiz motoru
│   │   ├── strategyAI.js           # OpenRouter prompt builder + caller
│   │   └── components/
│   │       ├── EyesFreeTerminal.jsx    # 🕹 Saha ekranı
│   │       ├── PitScoutPanel.jsx       # 🔍 Pit scout
│   │       ├── VideoScoutPanel.jsx     # 🎬 Video scout
│   │       ├── WarRoomDashboard.jsx    # ⚡ War Room
│   │       ├── TeamProfileModal.jsx    # 👤 Takım profili popup
│   │       ├── AdminPanel.jsx          # ⚙️ Admin
│   │       ├── TestDataPanel.jsx       # 🧪 Test verisi üretici
│   │       ├── FieldSetupTool.jsx      # 🗺 Saha kalibrasyon aracı
│   │       ├── QrImportModal.jsx       # QR import
│   │       ├── AutonomousPathCanvas.jsx
│   │       ├── StrategyDashboard.jsx
│   │       └── TeleopTracker.jsx
│   ├── cypress/                    # E2E testler
│   ├── package.json
│   └── vite.config.js
│
├── .env.example                    # Backend ortam değişkenleri şablonu
├── .gitignore
└── README.md
```

---

## Kurulum / Setup

### Gereksinimler / Prerequisites

- **Python 3.11+**
- **Node.js 18+** ve npm
- (Opsiyonel) **PostgreSQL** — geliştirme için SQLite yeterli

---

### 1. Repoyu klonla

```bash
git clone https://github.com/efeerdogmus0/nfScout9029.git
cd nfScout9029
```

---

### 2. Backend

```bash
cd backend

# Sanal ortam oluştur
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Bağımlılıkları kur
pip install -e ".[dev]"

# (Opsiyonel) .env dosyası oluştur
cp ../.env.example .env
# .env içinde DATABASE_URL düzenle (varsayılan: SQLite)

# Sunucuyu başlat — PORT 8001 OLMALI (frontend bunu bekliyor)
uvicorn app.main:app --reload --port 8001
```

Backend çalışıyor olmalı: http://localhost:8001  
Sağlık kontrolü: http://localhost:8001/health

---

### 3. Frontend

```bash
cd frontend

# Bağımlılıkları kur
npm install

# Geliştirme sunucusunu başlat
npm run dev
```

Uygulama açılıyor: http://localhost:5173

---

### 4. İlk Giriş

Varsayılan admin şifresi: **`www.efe123`**

Admin panelinden:
1. **Etkinlik kodu** gir (örn. `2026miket`)
2. **TBA API Key** ekle → https://www.thebluealliance.com/account
3. **OpenRouter API Key** ekle → https://openrouter.ai/keys (War Room AI için)
4. **Takım Numaramız** gir: `9029`
5. Pit scout sayısını belirle → otomatik kimlik bilgileri oluşturulur

---

### 5. Üretim build

```bash
cd frontend
npm run build          # dist/ klasörüne oluşturur
npm run preview        # Lokal üretim önizlemesi
```

`dist/` klasörünü herhangi bir static sunucuya (Nginx, GitHub Pages, Netlify vb.) at.

---

## API Anahtarları / API Keys

| Servis | Nerede Kullanılır | Nereden Alınır |
|---|---|---|
| **The Blue Alliance (TBA)** | Maç takvimi, takım listesi | https://www.thebluealliance.com/account |
| **OpenRouter** | War Room AI strateji önerisi | https://openrouter.ai/keys |
| **Statbotics** | EPA verileri | Anahtar gerektirmez, ücretsiz |

> **Önemli:** API anahtarları frontend'in Admin panelinde `localStorage`'a kaydedilir, sunucuya gönderilmez. Repo'ya commit etme.

---

## Paneller / Panels

### 🕹 Saha Ekranı (EyesFreeTerminal)

Saha scoutları için gerçek zamanlı maç takip aracı. Tablet ekranına bakma gereksinimi en aza indirilmiştir.

**Oturumlar:** `red1`, `red2`, `red3`, `blue1`, `blue2`, `blue3` (+ `scout_7`..`scout_10`)  
**Maç fazları:** AUTO (0–15s) → GEÇİŞ (15–30s) → TELEOP S1/S2/S3/S4 (30–130s) → ENDGAME (130–160s)

Toplanan veriler:
- Otonom yol noktaları (dokunmatik canvas, normalize edilmiş 0–1 koordinatlar)
- Konum pingleri (TELEOP boyunca 5s'de bir)
- TRENCH / BUMP geçiş sayıları
- Problem logları (COMMS, MECH, STUCK, BROWNOUT, FOUL, DEFENSE)
- Tırmanma seviyesi (L1/L2/L3, basılı tutma süresi)

---

### 🔍 Pit Scout (PitScoutPanel)

Robot yeteneklerini ve teknik özellikleri kayıt altına al.

**Alanlar:** Sürüş motoru, taşıma kapasitesi, bump/trench/savunma yetenekleri, otonom ve teleop skor tahminleri, kalibre tutarlılık puanı, notlar, fotoğraf yükleme.

---

### 🎬 Video Scout (VideoScoutPanel)

Oynanan maçları analiz et.

- TBA'dan oynanan maçları listele
- YouTube embed ile video izle (hız, zoom, kalite ayarı)
- `🏁 MAÇ BAŞLADI` → videonun kaçıncı saniyesinde maç başladı işaretle
- Her robot için `Şut Başladı` / `Şut Bitti` timestamp'leri kaydet
- Kaydedilen veriler: yakıt sayısı, maksimum taşıma, her robotun şut süreleri

---

### ⚡ War Room (WarRoomDashboard)

Strateji merkezi — Sonraki maça hazırlık.

- Gelecek qual listesi, takım kartları
- Her takım için top 3 analitik insight rozeti
- EPA (Statbotics) verileri — ortalama, SD, sıralama, W/L
- Maç başlığına tıkla → AI stratejisi üret (OpenRouter)
- Oynanan maçlar için skor tablosu (kırmızı:mavi, kazanan)

---

### 👤 Takım Profili (TeamProfileModal)

Takım kartına tıklayarak aç.

**Sekmeler:**
1. **Genel Bakış** — Pit raporu, ortalama skor, bump/trench zone korelasyonları, tırmanma geçmişi
2. **Maçlar** — Scouting yapılmış tüm maçlar; her maç için canlı replay oynatıcısı (2D robot animasyonu, auto path + teleop hareket)
3. **Notlar & AI** — Ham scout notları + OpenRouter LLM özeti (yeniden üretilebilir, bayat veri uyarısı)

---

### ⚙️ Admin Panel

| Sekme | İçerik |
|---|---|
| ⚙️ Ayarlar | Etkinlik kodu, TBA key, takım numarası, OpenRouter key/model |
| 🔄 Vardiya | Scouter isimleri, etkinlik başlangıç zamanı, 45 dakikalık rotasyon takvimi |
| 🗺 Saha Kurulum | Saha fotoğrafı yükle, zone'ları kalibre et (bump, trench, hub, tower) |
| 🔑 Kimlik Bilgileri | Pit scout hesaplarını otomatik oluştur |

---

### 🧪 Test Paneli (TestDataPanel)

**"Regional Yarat"** tuşuyla:
- 30 takım, 40 qual (30 oynanmış), frc9029 dahil
- Pit raporları (5 arketip: powerhouse → savunma uzmanı)
- Saha raporları (otonom yollar, konum pingleri, traversal events, problemler)
- Gerçekçi skor verileri
- EF koordinat sistemine (mavi=sol, kırmızı=sağ) uyumlu veriler

---

## Geliştirme Notları / Dev Notes

### Koordinat Sistemi

**Kanvas iç koordinatları:** `CW=640 × CH=320` piksel (EyesFreeTerminal canvas)  
**Normalize koordinatlar:** `x / CW`, `y / CH` → `[0, 1]` aralığı  
**Kural:** `x=0` sol → **Mavi** taraf | `x=1` sağ → **Kırmızı** taraf

> ⚠️ `teamAnalytics.js` ve `TestDataPanel.jsx` bu EF kuralını kullanır. Yeni zone classifier yazarken dikkat et.

### Koordinat Normalizasyonu

`EyesFreeTerminal.jsx` → `submitPostMatch()` içinde her ping ve auto point `/ CW / CH` ile normalize edilip IndexedDB'ye yazılır. Raw canvas piksel koordinatlarını hiçbir yerde persist etme.

### Veritabanı

Geliştirme için varsayılan SQLite (`rebuilt.db`) yeterlidir. Prod ortamında:

```env
DATABASE_URL=postgresql+psycopg://user:pass@host:5432/dbname
```

### Frontend API Base URL

`frontend/src/api.js` ve `sync.js` dosyaları `http://localhost:8001` hardcode eder.  
Backend'i başlatırken `--port 8001` kullan.

### Kimlik Doğrulama

Client-side only, `sessionStorage` ile. Roller:

| Rol | Oturum Adı | Yönlendirme |
|---|---|---|
| Admin | `admin` | Tüm sekmeler |
| Saha scout | `red1`..`blue3`, `scout_7`..`scout_10` | Saha ekranı |
| Pit scout | `pit_1`..`pit_N` | Pit paneli |
| Video scout | `video` | Video paneli |

---

## Test

### Backend (pytest)

```bash
cd backend
source .venv/bin/activate
pytest -v
```

### Frontend E2E (Cypress)

Backend'in çalışır olduğundan emin ol, ardından:

```bash
cd frontend
npm run test:e2e          # headless
npx cypress open          # interaktif UI
```

---

## Katkı Rehberi / Contributing

### Branch stratejisi

```
master          ← kararlı sürüm, direkt push yok
feature/xxx     ← yeni özellikler
fix/xxx         ← bug düzeltmeleri
```

### Pull Request açmadan önce

1. `npm run build` hata vermemeli
2. `pytest` geçmeli
3. Yeni bir koordinat/zone eklediysen `teamAnalytics.js` ve `TestDataPanel.jsx`'i güncelle
4. CSS değişikliklerini `styles.css`'e yaz (component'e inline style ekleme)
5. `localStorage` key'i değiştirdiysen `adminConfig.js` DEFAULTS objesini güncelle

### Kod kuralları

- **React:** Functional component, hooks. Class component yok.
- **State:** Component-level `useState` / `useRef`. Global state yok (Redux vb. yok).
- **Stil:** `styles.css` BEM-benzeri class isimleri (`ef-`, `wr-`, `tp-`, `pit-`, `vs2-` prefix'leri).
- **API çağrıları:** Sadece `api.js` üzerinden. Component içinde direkt `fetch` kullanma.
- **Koordinatlar:** Her zaman normalize (0–1). Canvas piksel değeri persist etme.

### Yeni panel eklemek

1. `src/components/YeniPanel.jsx` oluştur
2. `App.jsx` → `TABS` dizisine ekle (`adminOnly` flag'ini ayarla)
3. `App.jsx` render bloğuna `{mode === "yeni" && <YeniPanel />}` ekle
4. `styles.css`'e `.yp-` prefix'li sınıflar ekle

---

## Lisans / License

Team NF iç kullanımı. Lütfen paylaşmadan önce ekip liderliğiyle iletişime geç.
