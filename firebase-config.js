'use strict';

/* ==========================================================================
   firebase-config.js — подключение к Firebase.
   Эти значения НЕ секретные: любой веб-сайт на Firebase публикует их открыто.
   Защита данных настраивается правилами (Rules) в консоли Firebase, см. README.md.
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAAm9eYa_9cbBgKFP46M6M2q-fBceL_xPQ",
  authDomain: "tdx-draft.firebaseapp.com",
  databaseURL: "https://tdx-draft-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "tdx-draft",
  storageBucket: "tdx-draft.firebasestorage.app",
  messagingSenderId: "973812512865",
  appId: "1:973812512865:web:644595f7bcc407847f1220",
  measurementId: "G-6YHPEX8T8H"
};

/* Путь в базе, где лежит комната. Сменить значение = начать с чистой комнаты.
   Старые данные вашего другого проекта этот путь не затрагивает. */
const FIREBASE_ROOT = 'tdx-draft/main';
