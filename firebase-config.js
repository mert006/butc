// Firebase konsolu › Proje ayarları › Web uygulaması › "firebaseConfig" nesnesini buraya yapıştır.
// Bu değerler gizli değildir (tarayıcıda zaten görünür); güvenliği Firestore kuralları sağlar.
// null kalırsa uygulama "yerel mod"da çalışır: üyelik, senkron ve fiş okuma kapalı.
export const firebaseConfig = {
  apiKey: 'AIzaSyBN8M8TniguTEKFirQK2ti6gsMIh8Tyu3k',
  authDomain: 'bp-economy.firebaseapp.com',
  projectId: 'bp-economy',
  storageBucket: 'bp-economy.firebasestorage.app',
  messagingSenderId: '311392102267',
  appId: '1:311392102267:web:e38be043a247c80b917fde',
};

// App Check (Fraud Defense / reCAPTCHA Enterprise site anahtarı — herkese açık değer, gizli değil).
// Uygulama dışından Gemini kotasının kullanılmasını engeller.
export const APP_CHECK_SITE_KEY = '6Ld1I9gtAAAAADKMj3tVJKIR0Grm4J11etcn_0Ki';

// Bildirim (FCM Web Push) herkese açık VAPID anahtarı — Proje ayarları › Cloud Messaging.
export const VAPID_KEY = 'BBJYjAtfeLHhga9Xa_E_TncJ7RpQuoBvgZfuZpNMTviZs8vfJNq7m3iGgceS7B92JaqSeUOUDUn8VyK1AGpYhWs';

// Fiş okuma modeli. İlki çalışmazsa / yanıt vermezse sıradakine geçer.
// 2026-09-30 testi: 3.5-flash test fişini kusursuz okudu (~18 sn); lite 2,4 sn ama daha az isabetli;
// 3.8-flash ücretsiz katmanda yanıt vermedi (zaman aşımı).
export const AI_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
