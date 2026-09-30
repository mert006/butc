// Günde 2 kez (öğlen / akşam) tüm kullanıcılara dürtme bildirimi gönderir.
// GitHub Actions çalıştırır; FIREBASE_SERVICE_ACCOUNT secret'ı gerekir (Firebase › Proje ayarları › Hizmet hesapları).
// Kullanıcı o gün harcama girdiyse farklı, girmediyse farklı mesaj alır.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.log('FIREBASE_SERVICE_ACCOUNT secret henüz eklenmemiş; bildirim atlandı.'); process.exit(0); }
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const TZ = 'Europe/Istanbul';
const now = new Date();
const today = now.toLocaleDateString('sv-SE', { timeZone: TZ });          // YYYY-MM-DD
const hour = +now.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
const slot = hour < 17 ? 'oglen' : 'aksam';

const MSG = {
  oglen: {
    yok: [
      'Öğlen oldu la, sabahtan beri bi kuruş mu harcamadın? Hadi yaz şunu.',
      'Gardaşım cüzdan açıldı mı bugün? Açıldıysa bi uğra.',
      'Kahveyi içtin, simidi yedin, yazmadın. Biliyom.',
      'Sabahki masrafı şimdi yazmazsan akşama unutursun, söyliyim.',
    ],
    var: [
      'Bugün {n} kalem yazmışsın, helal. Öğlen yemeğini de unutma.',
      'Sabahtan {t} gitmiş. Yavaş la, gün daha yarı.',
    ],
  },
  aksam: {
    yok: [
      'Gün bitti, harcama sıfır? Ya ermişsin ya da yazmayı unuttun.',
      'Akşam oldu la. Fişler cepte buruşmadan at şunları.',
      'Bugünkü masrafları yazmazsan ay sonu "para nereye gitti" diye ağlarsın.',
      'Hiç mi bi şey almadın bugün? Ekmek bile mi? Hadi hadi.',
    ],
    var: [
      'Bugün {t} harcamışsın. Başka bi şey kaldı mı yazılmadık?',
      'Günün hesabı: {n} kalem, {t}. Eksik varsa şimdi tamamla.',
    ],
  },
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const money = v => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(v);

let sent = 0, removed = 0;
const users = await db.collection('users').get();
for (const u of users.docs) {
  const tokens = u.get('pushTokens') || [];
  if (!tokens.length) continue;

  // Bugünün kayıtları: sadece bu ayın belgesi okunur (1 okuma)
  const month = await db.doc(`users/${u.id}/months/${today.slice(0, 7)}`).get();
  const items = Object.values(month.exists ? month.get('items') || {} : {}).filter(e => e.date === today);
  const total = items.reduce((t, e) => t + (e.amount || 0), 0);
  const body = pick(MSG[slot][items.length ? 'var' : 'yok']).replace('{n}', items.length).replace('{t}', money(total));

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title: 'Büt Ç.', body },
    webpush: { headers: { Urgency: 'normal', TTL: String(4 * 3600) } },
  });
  sent += res.successCount;
  // Geçersiz token'ları temizle (uygulama silinmiş / izin kaldırılmış)
  const dead = res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument|invalid-registration-token/.test(r.error?.code || '')) ? tokens[i] : null).filter(Boolean);
  if (dead.length) { await u.ref.update({ pushTokens: FieldValue.arrayRemove(...dead) }); removed += dead.length; }
}
console.log(`${slot}: ${sent} bildirim gönderildi, ${removed} geçersiz token silindi (${users.size} kullanıcı)`);
