import { useState } from "react";

const SECTIONS = [
  { id: "overview",   icon: "📋", title: "Genel Bakış" },
  { id: "login",      icon: "🔑", title: "Giriş Yapma" },
  { id: "admin",      icon: "⚙️", title: "Admin Kurulumu" },
  { id: "field",      icon: "🕹", title: "Saha Ekranı" },
  { id: "pit",        icon: "🔍", title: "Pit Scout" },
  { id: "video",      icon: "🎬", title: "Video Scout" },
  { id: "warroom",    icon: "⚡", title: "War Room" },
  { id: "profile",    icon: "👤", title: "Takım Profili" },
  { id: "rotation",   icon: "🔄", title: "Scout Rotasyonu" },
  { id: "sync",       icon: "📡", title: "Veri Sync / QR" },
  { id: "test",       icon: "🧪", title: "Test Paneli" },
  { id: "faq",        icon: "❓", title: "Sık Sorunlar" },
];

function Section({ id, icon, title, children }) {
  return (
    <section className="um-section" id={id}>
      <h2 className="um-section-title">
        <span className="um-section-icon">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ headers, rows }) {
  return (
    <div className="um-table-wrap">
      <table className="um-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Phase({ color, label, time, desc }) {
  return (
    <div className="um-phase" style={{ borderLeftColor: color }}>
      <div className="um-phase-header">
        <span className="um-phase-time">{time}</span>
        <span className="um-phase-label" style={{ color }}>{label}</span>
      </div>
      <div className="um-phase-desc">{desc}</div>
    </div>
  );
}

function Note({ type = "info", children }) {
  const colors = { info: "#38bdf8", warn: "#fbbf24", tip: "#4ade80", danger: "#f87171" };
  const icons  = { info: "ℹ️", warn: "⚠️", tip: "💡", danger: "🚨" };
  return (
    <div className="um-note" style={{ borderLeftColor: colors[type] }}>
      <span className="um-note-icon">{icons[type]}</span>
      <span>{children}</span>
    </div>
  );
}

function Kbd({ children }) {
  return <kbd className="um-kbd">{children}</kbd>;
}

export default function UserManual() {
  const [activeSection, setActiveSection] = useState("overview");

  function scrollTo(id) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="um-root">
      {/* ── Sidebar TOC ────────────────────────────────────────────── */}
      <nav className="um-toc">
        <div className="um-toc-title">İçindekiler</div>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            className={`um-toc-item${activeSection === s.id ? " active" : ""}`}
            onClick={() => scrollTo(s.id)}
          >
            <span>{s.icon}</span>
            <span>{s.title}</span>
          </button>
        ))}
      </nav>

      {/* ── Content ────────────────────────────────────────────────── */}
      <main className="um-content">

        {/* Hero */}
        <div className="um-hero">
          <div className="um-hero-badge">FRC 2026 REBUILT</div>
          <h1 className="um-hero-title">NF Scout</h1>
          <p className="um-hero-sub">Kullanım Kılavuzu · Team NF #9029</p>
        </div>

        {/* ── GENEL BAKIŞ ────────────────────────────────────────── */}
        <Section id="overview" icon="📋" title="Genel Bakış">
          <p className="um-p">
            NF Scout, FRC etkinliklerinde rakip ve potansiyel müttefik robotları gerçek zamanlı
            takip etmek için tasarlanmış offline-first bir scouting platformudur. Tüm veriler
            önce cihazda saklanır; internet yalnızca TBA/AI özellikleri için gereklidir.
          </p>

          <Table
            headers={["Rol", "Panel", "Görev"]}
            rows={[
              ["Saha Scoutları (6–10)", "🕹 Saha", "Maç sırasında canlı veri toplama"],
              ["Pit Scoutları (2–4)",   "🔍 Pit",  "Robot yeteneklerini kayıt altına alma"],
              ["Video Scout",           "🎬 Video", "Oynanan maçları analiz etme"],
              ["Strateji Sorumlusu",    "⚡ War Room", "AI destekli strateji geliştirme"],
              ["Admin",                 "⚙️ Admin", "Kurulum, API key, vardiya ayarları"],
            ]}
          />

          <div className="um-feature-grid">
            {[
              ["📡", "Offline-first",       "Veriler IndexedDB'ye yazılır, bağlantı gelince sync edilir"],
              ["🗺", "Saha Kalibrasyonu",    "Gerçek saha fotoğrafı yükle, zone'ları çiz"],
              ["🤖", "AI Strateji",         "OpenRouter üzerinden grok-4-fast ile maç analizi"],
              ["📊", "Derin Analitik",      "Bump/trench zone bazlı skor korelasyonları"],
              ["🔄", "Scout Rotasyonu",     "10 scout için 45 dakikalık otomatik vardiya"],
              ["🎬", "Maç Tekrarı",         "Auto + Teleop 2D robot animasyonu"],
            ].map(([icon, title, desc]) => (
              <div key={title} className="um-feature-card">
                <div className="um-feature-icon">{icon}</div>
                <div className="um-feature-name">{title}</div>
                <div className="um-feature-desc">{desc}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── GİRİŞ ──────────────────────────────────────────────── */}
        <Section id="login" icon="🔑" title="Giriş Yapma">
          <p className="um-p">
            Uygulama açıldığında tek bir giriş ekranı gelir. Rolüne göre farklı panellere
            yönlendirilirsin.
          </p>

          <Table
            headers={["Kullanıcı Adı", "Şifre", "Yönlendirme"]}
            rows={[
              ["admin",                   "efe123",           "Admin — tüm sekmeler"],
              ["red1 / red2 / red3",      "r1pass / r2pass / r3pass", "🕹 Saha"],
              ["blue1 / blue2 / blue3",   "b1pass / b2pass / b3pass", "🕹 Saha"],
              ["scout_7 … scout_10",      "s7pass … s10pass", "🕹 Saha"],
              ["pit_1 / pit_2 …",         "pit1pass / pit2pass …", "🔍 Pit"],
              ["video",                   "videopass",        "🎬 Video"],
            ]}
          />

          <Note type="tip">
            Giriş ekranındaki <strong>hızlı giriş butonları</strong> şifreyi otomatik
            doldurur — test ve sahada hızlı geçiş için kullanışlıdır.
          </Note>
        </Section>

        {/* ── ADMİN ──────────────────────────────────────────────── */}
        <Section id="admin" icon="⚙️" title="Admin Kurulumu">
          <p className="um-p">
            Her etkinlik öncesinde admin olarak giriş yap ve aşağıdaki adımları sırayla tamamla.
          </p>

          <h3 className="um-h3">⚙️ Ayarlar Sekmesi</h3>
          <ol className="um-ol">
            <li>
              <strong>Etkinlik Kodu</strong> — TBA formatında yaz
              (örn. <code className="um-code">2026miket</code>, <code className="um-code">2026ismir</code>)
            </li>
            <li>
              <strong>Takım Numaramız</strong> — <code className="um-code">9029</code>&nbsp;
              (War Room'da kendi maçlarımızı vurgular)
            </li>
            <li>
              <strong>TBA API Key</strong> — <a className="um-link" href="https://www.thebluealliance.com/account" target="_blank" rel="noreferrer">thebluealliance.com/account</a> adresinden al
            </li>
            <li>
              <strong>OpenRouter API Key</strong> — <a className="um-link" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a> adresinden al (War Room AI için)
            </li>
            <li>
              <strong>Model</strong> — varsayılan <code className="um-code">x-ai/grok-4-fast</code>,
              değiştirmek istersen başka model adı yaz
            </li>
          </ol>

          <Note type="warn">
            API anahtarları sunucuya gönderilmez, yalnızca cihazında saklanır. Başkasıyla paylaşma.
          </Note>

          <h3 className="um-h3">🔄 Vardiya Sekmesi</h3>
          <p className="um-p">
            10 scout için isim gir. Ardından etkinlik başladığında
            <Kbd>⏱ Şimdi Başladı</Kbd> butonuna bas; rotasyon takvimi bu andan itibaren hesaplanır.
          </p>

          <h3 className="um-h3">🗺 Saha Kalibrasyon Aracı</h3>
          <ol className="um-ol">
            <li>
              <strong>Resim Yükle</strong> — landscape yönde çekilmiş gerçek saha fotoğrafı
            </li>
            <li>
              Her zone türü için <Kbd>Çiz</Kbd> butonuna bas, sahada sürükleyerek alanı belirle:
              <code className="um-code">fieldBoundary</code> →
              <code className="um-code">blueZone / redZone</code> →
              <code className="um-code">blue_bump1/2</code> →
              <code className="um-code">blue_trench1/2</code> →
              <code className="um-code">blueHub / redHub</code>
              (kırmızı zone'lar otomatik aynılanır)
            </li>
            <li>
              <strong>Kaydet</strong> → veriler cihaza yazılır
            </li>
          </ol>

          <Note type="info">
            Kalibrasyon yapılmadan uygulama varsayılan zone koordinatlarıyla çalışır.
          </Note>
        </Section>

        {/* ── SAHA EKRANI ────────────────────────────────────────── */}
        <Section id="field" icon="🕹" title="Saha Ekranı (Eyes-Free Terminal)">
          <p className="um-p">
            Maç sırasında tablet ekranına bakmadan kullanmak üzere tasarlandı.
            Büyük dokunmatik butonlar, otomatik faz geçişleri ve kuvvetli geri bildirim.
          </p>

          <h3 className="um-h3">Hazırlık Ekranı</h3>
          <p className="um-p">
            Maç başlamadan önce qual numarası TBA'dan otomatik gelir.
            <Kbd>−</Kbd> / <Kbd>+</Kbd> ile değiştirebilir ya da direkt yazabilirsin.
            <Kbd>↺ TBA</Kbd> ile değişikliği geri al.
            Hazır olduğunda <Kbd>MATCH START</Kbd> butonuna bas.
          </p>

          <h3 className="um-h3">Maç Fazları</h3>
          <div className="um-phases">
            <Phase color="#4ade80" label="AUTO" time="0 – 20s"
              desc="Sahaya dokunarak otonom yol noktaları ekle. ↩ Geri Al ile son noktayı sil." />
            <Phase color="#fde68a" label="OTO BİTTİ" time="20 – 30s"
              desc="Noktaları sürükleyerek düzelt. OTO KAYDET → butonuna bas, ardından kim kazandı sorusuna cevap ver (RED / BLUE)." />
            <Phase color="#a78bfa" label="TRANSİSYON" time="30 – 40s"
              desc="Kısa geçiş penceresi. Konum ping, TRENCH/BUMP butonları aktif." />
            <Phase color="#38bdf8" label="TELEOP S1–S4" time="40 – 130s"
              desc="Ana scouting dönemi. Konum ping, traversal, problem butonları aktif." />
            <Phase color="#f97316" label="ENDGAME" time="130 – 160s"
              desc="Tüm teleop butonları + L1/L2/L3 tırmanma butonları aktif." />
          </div>

          <h3 className="um-h3">AUTO Fazında Ne Yapılır?</h3>
          <p className="um-p">
            Robot neredeyse oraya dokun — otonom yol noktası eklenir (yeşil daire).
            Ekrana bakman gerekmez, sezgisel olarak parmağınla koy.
          </p>

          <h3 className="um-h3">TELEOP Fazında Butonlar</h3>
          <Table
            headers={["Buton", "Ne Zaman Basılır"]}
            rows={[
              ["📍 Sahaya dokun", "Her ~5s'de bir 'KONUM İŞARETLE' çubuğu çıkar; robotu gördüğün yere dokun"],
              ["TRENCH", "Robot trench bölgesinden (alt/üst kenar bantları) geçerken"],
              ["BUMP", "Robot bump'ın üzerinden atlarken / geçerken"],
              ["COMMS", "İletişim kopukluğu — robot titriyor veya tepkisiz"],
              ["MECH", "Mekanik arıza — parça kopması, takılma"],
              ["STUCK", "Robot sıkıştı, hareket edemiyor"],
              ["BRNOUT", "Güç düşüşü / brownout — robot yavaşlıyor"],
              ["FOUL", "Kural ihlali — basınca not ekle (örn. G12)"],
            ]}
          />

          <h3 className="um-h3">ENDGAME'de Tırmanma Kaydetme</h3>
          <p className="um-p">
            <Kbd>L1</Kbd> / <Kbd>L2</Kbd> / <Kbd>L3</Kbd> butonlarına <strong>basılı tut</strong> →
            robot tırmanmaya başladığında bas, bitince bırak. Basılı tutma süresi otomatik kaydedilir.
          </p>

          <h3 className="um-h3">Maç Sonu</h3>
          <p className="um-p">
            160. saniyede post-match ekranı otomatik açılır.
            Skor tahmini ve notları doldur, <Kbd>GÖNDER</Kbd> ile kaydet.
          </p>

          <Note type="tip">
            Yanlış tuşa bastıysan paniklememe — yaklaşık veri yeterli. Kritik olan traversal
            ve problem kayıtlarıdır.
          </Note>
        </Section>

        {/* ── PİT SCOUT ──────────────────────────────────────────── */}
        <Section id="pit" icon="🔍" title="Pit Scout Paneli">
          <p className="um-p">
            Robot testleri ve pit konuşmaları sırasında tablet'e bakarak doldurulur.
            Sol kenardan takımı seç, formu doldur, kaydet.
          </p>

          <Table
            headers={["Alan", "Açıklama"]}
            rows={[
              ["Sürüş Motoru", "NEO / Kraken X60 / CIM / Falcon / Diğer"],
              ["Bump / Trench / Savunma", "Robot bu hareketleri yapabiliyor mu?"],
              ["Şut Mesafesi", "Uzak / Yakın / Yok"],
              ["Tırmanma (Teleop/Auto)", "Her faz için ayrı ayrı"],
              ["Tutarlılık", "1–5 yıldız"],
              ["Otonom Yakıt Tahmini", "Yaklaşık puan"],
              ["Teleop Yakıt Tahmini", "Yaklaşık puan"],
              ["Maks. Taşıma Kapasitesi", "Kaç adet"],
              ["Notlar", "Serbest metin — önemli detaylar"],
              ["Fotoğraf", "Robot fotoğrafı (opsiyonel)"],
            ]}
          />

          <Note type="warn">
            TBA key girilmemişse takım listesi yüklenemez.
            Hata mesajını admin'e ilet, <Kbd>↺ Tekrar Dene</Kbd> ile yenile.
          </Note>
        </Section>

        {/* ── VIDEO SCOUT ────────────────────────────────────────── */}
        <Section id="video" icon="🎬" title="Video Scout Paneli">
          <p className="um-p">
            Oynanan maçları YouTube embed üzerinden izleyerek şut analizini kayıt altına al.
            İnternet bağlantısı gerektirir.
          </p>

          <ol className="um-ol">
            <li>Sol kenardan analiz edilecek maçı seç (TBA'dan oynanan maçlar listelenir)</li>
            <li>
              Video yüklenince <strong>🏁 MAÇ BAŞLADI</strong> butonuna bas →
              videonun o anki saniyesi maç başlangıcı olarak kaydedilir
            </li>
            <li>
              Her robot için şut başladığında <Kbd>Şut Başladı</Kbd>,
              bittiğinde <Kbd>Şut Bitti</Kbd> bas
            </li>
            <li>
              <Kbd>GÖNDER</Kbd> ile verileri kaydet
            </li>
          </ol>

          <Table
            headers={["Kontrol", "Açıklama"]}
            rows={[
              ["Hız", "0.5× / 1× / 1.5× / 2×"],
              ["Zoom", "Sahaya yakınlaştır/uzaklaştır"],
              ["Kalite", "144p–1080p (yavaş internet için düşür)"],
              ["Sidebar toggle", "Video alanını genişlet"],
            ]}
          />
        </Section>

        {/* ── WAR ROOM ───────────────────────────────────────────── */}
        <Section id="warroom" icon="⚡" title="War Room — Strateji Merkezi">
          <p className="um-p">
            Strateji sorumlusu için. Admin girişi gerekir.
            Gelecek quallar için hazırlık ve AI destekli strateji üretimi.
          </p>

          <h3 className="um-h3">Temel İş Akışı</h3>
          <ol className="um-ol">
            <li>
              Sol listeden bir maça tıkla → o maçın ittifakları ve takım kartları görünür
            </li>
            <li>
              Takım kartlarında EPA (Statbotics) ve top 2–3 analitik insight rozeti görürsün
            </li>
            <li>
              <Kbd>⚡ STRATEJİ ÜRET</Kbd> butonuna bas → AI analiz eder ve öneri üretir
            </li>
          </ol>

          <h3 className="um-h3">Takım Kartı Ögeleri</h3>
          <Table
            headers={["Öge", "Anlam"]}
            rows={[
              ["★ BİZ rozeti", "Takım numaramızın bulunduğu maç"],
              ["EPA puanı", "Statbotics beklenen katkı puanı"],
              ["Insight rozetleri", "Bump tercihi, problem riski, şut pozisyonu vb."],
              ["Kart tıklama", "Detaylı Takım Profili popup'ı açar"],
              ["Maç skoru", "Oynanan maçlarda sonuç (👑 kazanan ittifak)"],
            ]}
          />

          <h3 className="um-h3">AI Önerisi Nasıl Kullanılır?</h3>
          <p className="um-p">
            AI çıktısı şu başlıkları içerir:
          </p>
          <ul className="um-ul">
            <li><strong>İttifak rolleri</strong> — shooter / carrier / defender önerileri</li>
            <li><strong>Bump/trench stratejisi</strong> — hangi zone'u kimin kullanacağı</li>
            <li><strong>Dikkat noktaları</strong> — rakip güçlü yanlar ve engellenecek robotlar</li>
            <li><strong>Risk uyarıları</strong> — otonom çakışma riskleri, güvenilmez partner</li>
          </ul>

          <Note type="tip">
            AI önerisi yalnızca scouting verisi varsa anlamlıdır. Test verisi ürettiysen
            önce birkaç maç yükle.
          </Note>
        </Section>

        {/* ── TAKIM PROFİLİ ──────────────────────────────────────── */}
        <Section id="profile" icon="👤" title="Takım Profili Popup">
          <p className="um-p">
            War Room'daki herhangi bir takım kartına tıklayarak aç.
            Bir takım hakkında toplanmış tüm veriyi üç sekmede görürsün.
          </p>

          <div className="um-tab-cards">
            <div className="um-tab-card">
              <div className="um-tab-card-title">1 · Genel Bakış</div>
              <ul className="um-ul">
                <li>Pit raporu tüm alanları</li>
                <li>Ortalama yakıt ve standart sapma</li>
                <li>Bump yan korelasyonu (kendi / rakip / bumpsız)</li>
                <li>Traversal zone dağılımı (Kırmızı Üst Bump vb.)</li>
                <li>Tırmanma geçmişi ve problem dağılımı</li>
                <li>EPA tablosu (Statbotics)</li>
              </ul>
            </div>
            <div className="um-tab-card">
              <div className="um-tab-card-title">2 · Maçlar</div>
              <ul className="um-ul">
                <li>Scouting yapılmış tüm maçların listesi</li>
                <li>Her maç için <strong>Maç Tekrarı</strong> oynatıcısı</li>
                <li>2D robot animasyonu (auto path + teleop hareket)</li>
                <li>Hız: 1× / 2× / 4× / 8× / 16×</li>
                <li>Scrubber ile dilediğin ana atla</li>
              </ul>
            </div>
            <div className="um-tab-card">
              <div className="um-tab-card-title">3 · Notlar & AI</div>
              <ul className="um-ul">
                <li>Ham scout notları (maç bazında)</li>
                <li>Yaşanan problemler listesi</li>
                <li><Kbd>⚡ Özet Üret</Kbd> → AI özetler</li>
                <li>Özet: Güçlü / Zayıf / Önerilen Rol / Dikkat</li>
                <li>Yeni maç oynandıysa "Güncelle" uyarısı</li>
              </ul>
            </div>
          </div>
        </Section>

        {/* ── ROTASYON ───────────────────────────────────────────── */}
        <Section id="rotation" icon="🔄" title="Scout Rotasyon Sistemi">
          <p className="um-p">
            10 saha scoutunun 6'sı aktif oynarken 4'ü mola verir.
            Varsayılan: her <strong>12 maçta</strong> bir rotasyon.
          </p>

          <Table
            headers={["Scout", "Grup"]}
            rows={[
              ["red1, red2",       "A"],
              ["blue1, blue2",     "B"],
              ["red3, blue3",      "C"],
              ["scout_7, scout_8", "D"],
              ["scout_9, scout_10","E"],
            ]}
          />

          <p className="um-p">
            Her döngüde gruplar sırayla mola verir. Aktif gruplar kalan maç sayısını,
            mola grupları bir sonraki aktif olacak qualı gösterir.
          </p>

          <h3 className="um-h3">Vardiya Göstergeleri</h3>
          <Table
            headers={["Görünüm", "Anlam"]}
            rows={[
              ["▶ 3m", "Aktif, 3 maç daha oynayacaksın"],
              ["☕ →Q14", "Mola, Q14'ten itibaren aktif olacaksın"],
            ]}
          />

          <Note type="info">
            Rotasyon saymaya başlaması için etkinliğin ilk <Kbd>MATCH START</Kbd> butonuna
            basılması ya da Admin → Vardiya'dan manuel olarak başlatılması gerekir.
          </Note>
        </Section>

        {/* ── SYNC / QR ──────────────────────────────────────────── */}
        <Section id="sync" icon="📡" title="Veri Aktarımı ve Senkronizasyon">
          <h3 className="um-h3">Otomatik Sync</h3>
          <p className="um-p">
            Backend çalışıyorsa sayfa yüklendiğinde IndexedDB'deki tüm raporlar backend'e
            otomatik gönderilir. Başarılı sync ekranın altında kısa toast mesajıyla bildirilir.
          </p>

          <h3 className="um-h3">Manuel QR Aktarımı</h3>
          <p className="um-p">
            Backend yoksa veya cihazlar farklı ağlardaysa:
          </p>
          <ol className="um-ol">
            <li>Saha ekranı → Maç sonu → <Kbd>QR KOD GÖSTER</Kbd></li>
            <li>Strateji cihazında üst nav'dan <Kbd>📥</Kbd> (İçe Aktar) butonuna bas</li>
            <li>QR kodu okut → veri aktarılır</li>
          </ol>

          <Note type="info">
            QR aktarımı tek maç verisi için uygundur.
            Büyük veri setleri için aynı Wi-Fi üzerinde backend sync kullan.
          </Note>
        </Section>

        {/* ── TEST PANELİ ────────────────────────────────────────── */}
        <Section id="test" icon="🧪" title="Test Paneli">
          <p className="um-p">
            Gerçek etkinlik verisi olmadan uygulamayı test etmek için sahte bir regional üret.
            Admin girişi gerekir.
          </p>

          <ol className="um-ol">
            <li><strong>🧪 Test</strong> sekmesini aç</li>
            <li><Kbd>REGIONAL YARAT</Kbd> butonuna bas (~5 saniye bekle)</li>
            <li>
              Sistem oluşturur: 30 takım (frc9029 dahil), 40 qual takvimi,
              30 oynanan qual için saha raporları, pit raporları, gerçekçi skor verileri
            </li>
            <li>Admin → Ayarlar'dan etkinlik kodunu <code className="um-code">2026test</code> yap</li>
            <li>War Room'u aç → tüm veriler görünür</li>
          </ol>

          <Note type="warn">
            Test verisi oluşturduktan sonra <strong>Test Verisini Temizle</strong> butonuyla
            ya da tarayıcı localStorage/IndexedDB'yi temizleyerek kaldırabilirsin.
            Gerçek etkinlik öncesinde temizlemeyi unutma.
          </Note>
        </Section>

        {/* ── SIK SORUNLAR ───────────────────────────────────────── */}
        <Section id="faq" icon="❓" title="Sık Karşılaşılan Sorunlar">
          {[
            {
              q: `"Takım bulunamadı — TBA key gerekebilir" yazıyor`,
              a: `Admin paneli → Ayarlar → TBA API Key alanını doldur. Key'i https://thebluealliance.com/account adresinden alabilirsin.`,
            },
            {
              q: "Qual numarası yanlış geliyor",
              a: "Hazırlık ekranındaki − / + butonlarıyla ya da direkt yazarak düzelt. ↺ TBA ile TBA verisine geri dön.",
            },
            {
              q: "Otonom yolu yanlış çizdim",
              a: "↩ Geri Al butonu ile son noktayı sil. İnceleme fazında (20–30s) noktaları sürükleyerek düzelt.",
            },
            {
              q: "War Room AI strateji üretmiyor",
              a: "Admin → Ayarlar → OpenRouter API Key kontrol et. Bakiyeni https://openrouter.ai/credits adresinden gör.",
            },
            {
              q: "Saha görseli bozuk / oran yanlış görünüyor",
              a: "Admin → Saha Kurulum'da aynı fotoğrafı bu cihazda yeniden yükle ve kalibre et. Canvas artık fotoğrafın gerçek oranını kullanır.",
            },
            {
              q: "Veri backend'e gönderilmiyor",
              a: "Backend'in --port 8001 ile çalıştığını ve tüm cihazların aynı Wi-Fi ağında olduğunu kontrol et. Backend yoksa QR aktarımı kullan.",
            },
            {
              q: "Maç tekrarı animasyonu donuyor",
              a: "Hız ayarını 4× veya 8×'e çek. Sayfayı yenilemek de yardımcı olur.",
            },
            {
              q: "Pit paneli boş geliyor",
              a: "Bu hesaba atanmış takım yoksa normal. Admin hesabıyla girildiğinde tüm takımlar görünür.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="um-faq-item">
              <div className="um-faq-q">❓ {q}</div>
              <div className="um-faq-a">{a}</div>
            </div>
          ))}
        </Section>

        <div className="um-footer">
          NF Scout — FRC 2026 REBUILT · Team NF #9029
        </div>
      </main>
    </div>
  );
}
