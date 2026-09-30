# BalPor Bütçe

Kişisel harcama takibi: elle ya da fiş fotoğrafıyla giriş, "kimin için" (kişisel/ev/iş/sevgili/aile/arkadaş), dönem raporları (1/3/6/9/12 ay, bu yıl), ürün bazlı zam + kişisel enflasyon, fırsat maliyeti (altın, dolar, euro, BIST 100, Bitcoin, mevduat).

## Mimari (tamamen ücretsiz, sunucusuz)
| Parça | Servis |
|---|---|
| Uygulama (PWA) | GitHub Pages |
| Üyelik | Firebase Auth (Google + e-posta) |
| Veri + cihazlar arası senkron | Firestore (`users/{uid}/months/{yyyy-mm}`, ay başına 1 belge), çevrimdışı çalışır |
| Fiş okuma + sorular | Firebase AI Logic → Gemini (`firebase-config.js` › `AI_MODELS`) |
| Piyasa verisi | GitHub Actions her gün `scripts/fetch-market.mjs` → `data/market.json` (Yahoo + TCMB) |

`firebase-config.js` boşsa uygulama **yerel mod**da çalışır (veri sadece cihazda, fiş okuma kapalı).

## Kurulum 1: Firebase (bir kere, ~10 dk, kart gerekmez)
1. https://console.firebase.google.com → **Proje ekle** → ad: `balpor-butce` (Analytics kapalı olabilir).
2. **Build › Authentication › Başlayın** → Sign-in method: **Google** ve **E-posta/Şifre**'yi aç.
3. **Build › Firestore Database › Veritabanı oluştur** → konum `eur3 (europe-west)` → **üretim modu**. Sonra **Kurallar** sekmesine `firestore.rules` içeriğini yapıştır → Yayınla.
4. **Build › AI Logic › Başlayın** → **Gemini Developer API**'yi seç (ücretsiz).
5. **Proje ayarları (⚙️) › Genel › Uygulamalarınız › Web (</>)** → kaydet → çıkan `firebaseConfig = {...}` nesnesini `firebase-config.js` içindeki `null` yerine yapıştır.
6. **Authentication › Ayarlar › Yetkili alan adları** → `<kullanıcı>.github.io` ekle.

## Kurulum 2: GitHub Pages
1. Public repo (ör. `balpor-butce`) → bu klasörün içeriğini yükle.
2. Settings › Pages › `main` / `root`.
3. Settings › Actions › General › Workflow permissions: **Read and write**.
4. Actions › "Piyasa verisi güncelle" › Run workflow.
5. Telefonda Chrome → `https://<kullanıcı>.github.io/balpor-butce/` → ⋮ › **Uygulamayı yükle**.

## Yerelde deneme
`python -m http.server 8765` → http://localhost:8765 (bilgisayarda telefon çerçevesiyle açılır).
localhost'ta konsoldan `__bbTest.receipt({...})` ile fiş akışı Firebase'siz denenebilir.

## Ücretsiz limitler (Spark planı)
- Firestore: 50.000 okuma / 20.000 yazma / gün, 1 GB. Ay başına 1 belge → kişi başı açılışta ~12-24 okuma.
- AI Logic (Gemini Developer API ücretsiz katman): dakika/gün başına istek limiti var; kişisel kullanım için fazlasıyla yeterli.
- BalPor'da herkese açılmadan önce: **App Check** (kötüye kullanım koruması) + limit/ücret araştırması.

## Notlar
- Kod güncellemesi sonrası `sw.js` içindeki `CACHE` sürümünü artır (`bb-v3`…).
- GitHub, 60 gün aktivitesiz repoda zamanlanmış işleri durdurur; günlük veri commit'leri repoyu aktif tutar.
