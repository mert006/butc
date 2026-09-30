// Bulut katmanı: Firebase Auth (üyelik) + Firestore (senkron) + AI Logic (fiş okuma).
// Veri düzeni: users/{uid}                 → ayarlar (kategoriler, kimin için listesi)
//              users/{uid}/months/{yyyy-mm} → { items: { [id]: harcama } }  (ay başına 1 belge = az okuma)
import { firebaseConfig, AI_MODELS, APP_CHECK_SITE_KEY, VAPID_KEY } from './firebase-config.js';

const V = '12.19.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}/`;
export const enabled = !!firebaseConfig;

let A, F, AI, AC, auth, fdb, ai, appCheck;

export async function init() {
  if (!enabled) return false;
  const [app, a, f, x, ac] = await Promise.all(['app', 'auth', 'firestore', 'ai', 'app-check'].map(m => import(`${CDN}firebase-${m}.js`)));
  A = a; F = f; AI = x; AC = ac;
  const fbApp = app.initializeApp(firebaseConfig);
  if (APP_CHECK_SITE_KEY) {
    appCheck = ac.initializeAppCheck(fbApp, { provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  auth = A.getAuth(fbApp);
  auth.languageCode = 'tr';
  fdb = F.initializeFirestore(fbApp, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  ai = AI.getAI(fbApp, { backend: new AI.GoogleAIBackend() });
  return true;
}

// ---------- üyelik ----------
export const onUser = cb => A.onAuthStateChanged(auth, cb);
export const loginGoogle = () => A.signInWithPopup(auth, new A.GoogleAuthProvider());
export const loginEmail = (e, p) => A.signInWithEmailAndPassword(auth, e, p);
export const registerEmail = (e, p) => A.createUserWithEmailAndPassword(auth, e, p);
export const resetPassword = e => A.sendPasswordResetEmail(auth, e);
export const logout = () => A.signOut(auth);

export function authError(e) {
  const m = {
    'auth/invalid-credential': 'E-posta ya da şifre hatalı.',
    'auth/wrong-password': 'Şifre hatalı.',
    'auth/user-not-found': 'Bu e-postayla hesap yok. Önce kayıt ol.',
    'auth/email-already-in-use': 'Bu e-posta zaten kayıtlı. Giriş yap.',
    'auth/weak-password': 'Şifre en az 6 karakter olacak gardaşım.',
    'auth/invalid-email': 'E-posta adresi geçersiz.',
    'auth/popup-closed-by-user': 'Giriş penceresi kapatıldı.',
    'auth/network-request-failed': 'İnternet bağlantısı yok.',
    'auth/too-many-requests': 'Çok fazla deneme. Biraz bekle.',
  };
  return m[e.code] || e.message;
}

// ---------- senkron ----------
const monthRef = (uid, ym) => F.doc(fdb, 'users', uid, 'months', ym);
const userRef = uid => F.doc(fdb, 'users', uid);
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function subscribe(uid, onExpenses, onSettings) {
  const u1 = F.onSnapshot(F.collection(fdb, 'users', uid, 'months'), snap => {
    const list = [];
    snap.forEach(d => list.push(...Object.values(d.data().items || {})));
    onExpenses(list, snap.metadata.fromCache);
  });
  const u2 = F.onSnapshot(userRef(uid), d => onSettings(d.exists() ? d.data() : null));
  return () => { u1(); u2(); };
}

// list: kaydedilecek harcamalar; prev: id → eski tarih (ay değiştiyse eski aydan silinir)
export function putExpenses(uid, list, prev = {}) {
  const b = F.writeBatch(fdb);
  for (const e of list) {
    // mergeFields: sadece bu harcamanın alanını tümden değiştirir (silinen alanlar da silinir), ayın diğer kayıtlarına dokunmaz
    b.set(monthRef(uid, e.date.slice(0, 7)), { items: { [e.id]: clean(e) } }, { mergeFields: [`items.${e.id}`] });
    const old = prev[e.id];
    if (old && old.slice(0, 7) !== e.date.slice(0, 7)) b.update(monthRef(uid, old.slice(0, 7)), { [`items.${e.id}`]: F.deleteField() });
  }
  return b.commit();
}
export const removeExpense = (uid, e) => F.updateDoc(monthRef(uid, e.date.slice(0, 7)), { [`items.${e.id}`]: F.deleteField() });
export const putSettings = (uid, s) => F.setDoc(userRef(uid), clean(s), { merge: true });
export async function wipe(uid, months) {
  const b = F.writeBatch(fdb);
  months.forEach(m => b.delete(monthRef(uid, m)));
  return b.commit();
}

// ---------- bildirim (FCM) ----------
// Token users/{uid}.pushTokens dizisinde tutulur; GitHub Actions (scripts/notify.mjs) günde 2 kez buraya gönderir.
let M, messaging;
async function msg() {
  if (!messaging) {
    M = await import(`${CDN}firebase-messaging.js`);
    if (!(await M.isSupported())) throw new Error('Bu tarayıcı bildirim desteklemiyor');
    messaging = M.getMessaging();
  }
  return messaging;
}
export async function enablePush(uid, swReg) {
  const token = await M_getToken(await msg(), swReg);
  await F.setDoc(userRef(uid), { pushTokens: F.arrayUnion(token) }, { merge: true });
  localStorage.setItem('bb.pushToken', token);
  return token;
}
const M_getToken = (m, swReg) => M.getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
export async function disablePush(uid) {
  const token = localStorage.getItem('bb.pushToken');
  if (token) await F.setDoc(userRef(uid), { pushTokens: F.arrayRemove(token) }, { merge: true });
  localStorage.removeItem('bb.pushToken');
  try { await M.deleteToken(await msg()); } catch (e) { /* zaten yok */ }
}

// ---------- fiş okuma ----------
export const appCheckToken = () => AC.getToken(appCheck, false).then(t => t.token);
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Zaman aşımı: fiş okunamadı, tekrar dene.')), ms))]);
export async function readReceipt(b64, prompt) {
  let lastErr;
  for (const name of AI_MODELS) {
    try {
      const model = AI.getGenerativeModel(ai, { model: name, generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } });
      const r = await timeout(model.generateContent([prompt, { inlineData: { data: b64, mimeType: 'image/jpeg' } }]), 50000);
      return r.response.text();
    } catch (e) { lastErr = e; }   // hangi hata olursa olsun sıradaki modeli dene
  }
  throw lastErr;
}
