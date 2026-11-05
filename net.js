'use strict';

/* ==========================================================================
   net.js — слой синхронизации на Firebase Realtime Database (бесплатный план).

   Всё общее состояние хранится одним объектом в базе по пути FIREBASE_ROOT.
   Любое изменение делается ТРАНЗАКЦИЕЙ — поэтому два игрока не могут
   одновременно занять одно место, а изменения не затирают друг друга.

   Интерфейс для app.js:
     Net.start({config, root, factory, normalize}) -> Promise (первый снимок получен)
     Net.get()                 — текущее состояние (кэш)
     Net.update(fn)            — изменить состояние: fn(state) (транзакция)
     Net.subscribe(fn)         — вызывается при любом изменении (своём и чужом)
     Net.now()                 — серверное время (часы игроков могут расходиться!)
     Net.guard(path)/unguard   — «при обрыве связи очистить этот путь» (освобождение команды)
     Net.getPrivate/setPrivate — данные ТОЛЬКО этой вкладки (тайные башни)
     Net.onError / onConnection
   ========================================================================== */

const Net = (() => {
  let db = null, ref = null;
  let cache = null;
  let serverOffset = 0;               // разница серверных и локальных часов
  let connected = false;
  let normalize = x => x;
  const listeners = [];
  const errorHandlers = [];
  const connHandlers = [];
  const guards = new Set();

  /* id этой вкладки. Лежит в sessionStorage: после перезагрузки вкладки остаётся тем же,
     поэтому игрок не теряет место. */
  let clientId = sessionStorage.getItem('tdx_client_id');
  if (!clientId) {
    clientId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
    sessionStorage.setItem('tdx_client_id', clientId);
  }

  const emit = () => listeners.forEach(fn => fn(cache));
  const fail = err => errorHandlers.forEach(fn => fn(err));

  function armGuard(path) {
    if (connected) db.ref(rootPath + '/' + path).onDisconnect().set(null);
  }
  let rootPath = '';

  function start({ config, root, factory, normalize: norm }) {
    if (!window.firebase) {
      const err = new Error('Не загрузился Firebase SDK (нет интернета или заблокирован gstatic.com)');
      fail(err);
      return new Promise(() => {});
    }
    normalize = norm || normalize;
    rootPath = root;
    firebase.initializeApp(config);
    db = firebase.database();
    ref = db.ref(root);

    // серверное время и статус соединения
    db.ref('.info/serverTimeOffset').on('value', s => { serverOffset = s.val() || 0; });
    db.ref('.info/connected').on('value', s => {
      connected = !!s.val();
      if (connected) guards.forEach(armGuard);     // onDisconnect нужно взводить заново после каждого переподключения
      connHandlers.forEach(fn => fn(connected));
    });

    return new Promise(resolve => {
      let first = true;
      ref.on('value', snap => {
        cache = normalize(snap.val());
        if (first) { first = false; resolve(); }
        emit();
      }, err => fail(err));
    });
  }

  /* Изменение состояния: читаем актуальное значение с сервера, меняем, записываем */
  function update(mutator) {
    return ref.transaction(current => {
      const s = normalize(current);
      mutator(s);
      return s;
    }, (err) => { if (err) fail(err); }, true);
  }

  return {
    clientId,
    start,
    get: () => cache,
    update,
    subscribe(fn) { listeners.push(fn); },
    now: () => Date.now() + serverOffset,

    guard(path) {
      if (guards.has(path)) return;
      guards.add(path);
      armGuard(path);
    },
    unguard(path) {
      if (!guards.has(path)) return;
      guards.delete(path);
      if (db) db.ref(rootPath + '/' + path).onDisconnect().cancel();
    },

    onError(fn) { errorHandlers.push(fn); },
    onConnection(fn) { connHandlers.push(fn); },

    // Приватные данные: sessionStorage не виден другим игрокам
    getPrivate(k) { try { return JSON.parse(sessionStorage.getItem('tdx_priv_' + k)); } catch (e) { return null; } },
    setPrivate(k, v) { sessionStorage.setItem('tdx_priv_' + k, JSON.stringify(v)); },
  };
})();
