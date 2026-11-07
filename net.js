'use strict';

/* ==========================================================================
   net.js — слой синхронизации.

   Два бэкенда с одним интерфейсом:
     • Firebase Realtime Database (по умолчанию) — игроки на разных компьютерах.
     • ЛОКАЛЬНЫЙ режим (включается сам для file:// и localhost; или адрес с ?local) —
       состояние лежит в localStorage, вторая вкладка этого же браузера получает
       изменения через событие 'storage'. Интернет и Firebase не нужны:
       удобно проверять дизайн и логику на одном компьютере.

   Всё общее состояние — один объект. Любое изменение делается ТРАНЗАКЦИЕЙ,
   поэтому два игрока не занимают одно место и не затирают друг друга.

   Интерфейс для app.js:
     Net.start({config, root, factory, normalize}) -> Promise (первый снимок получен)
     Net.get()                 — текущее состояние (кэш)
     Net.update(fn)            — изменить состояние: fn(state)
     Net.subscribe(fn)         — вызывается при любом изменении (своём и чужом)
     Net.now()                 — серверное время (часы игроков могут расходиться!)
     Net.guard(path)/unguard   — «при обрыве связи очистить этот путь» (освобождение команды)
     Net.getPrivate/setPrivate — данные ТОЛЬКО этой вкладки (тайные башни)
     Net.onError / onConnection / isLocal
   ========================================================================== */

const Net = (() => {
  /* Локальный режим включается сам, если сайт открыт как файл (двойной клик по index.html)
     или с localhost. Принудительно: добавить ?local. Подключиться к настоящему Firebase
     с localhost: добавить ?online. На GitHub Pages всегда работает Firebase. */
  const DEV_HOST = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const LOCAL = /[?&]local(=|&|$)/.test(location.search) || (DEV_HOST && !/[?&]online(=|&|$)/.test(location.search));
  const LOCAL_KEY = 'tdx_local_room_v2';

  let db = null, ref = null;
  let cache = null;
  let serverOffset = 0;               // разница серверных и локальных часов
  let connected = false;
  let normalize = x => x;
  let rootPath = '';
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

  /* ---------------- Firebase ---------------- */
  function armGuard(path) {
    if (connected && db) db.ref(rootPath + '/' + path).onDisconnect().set(null);
  }

  function startFirebase({ config, root }) {
    if (!window.firebase) {
      fail(new Error('Не загрузился Firebase SDK (нет интернета или заблокирован gstatic.com). Для проверки без интернета откройте адрес с ?local'));
      return new Promise(() => {});
    }
    rootPath = root;
    firebase.initializeApp(config);
    db = firebase.database();
    ref = db.ref(root);

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

  function updateFirebase(mutator) {
    return ref.transaction(current => {
      const s = normalize(current);
      mutator(s);
      return s;
    }, err => { if (err) fail(err); }, true);
  }

  /* ---------------- Локальный режим ---------------- */
  const lread = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { return null; } };
  const lwrite = s => localStorage.setItem(LOCAL_KEY, JSON.stringify(s));

  function clearPath(obj, path) {                  // 'teams/blue/owner' -> obj.teams.blue.owner = null
    const keys = path.split('/');
    let d = obj;
    for (let i = 0; i < keys.length - 1; i++) { d = d && d[keys[i]]; }
    if (d) d[keys[keys.length - 1]] = null;
  }

  function startLocal({ factory }) {
    cache = normalize(lread() || factory());
    lwrite(cache);
    window.addEventListener('storage', e => {
      if (e.key === LOCAL_KEY) { cache = normalize(lread()); emit(); }
    });
    // аналог onDisconnect: при закрытии вкладки освобождаем её места
    window.addEventListener('pagehide', () => {
      const raw = lread();
      if (!raw) return;
      guards.forEach(p => clearPath(raw, p));
      lwrite(raw);
    });
    return Promise.resolve();
  }

  function updateLocal(mutator) {
    const s = normalize(lread() || cache);
    mutator(s);
    lwrite(s);
    cache = s;
    emit();
  }

  /* ---------------- Публичный интерфейс ---------------- */
  return {
    clientId,
    isLocal: LOCAL,

    start(opts) {
      normalize = opts.normalize || normalize;
      return LOCAL ? startLocal(opts) : startFirebase(opts);
    },
    get: () => cache,
    update(mutator) { return LOCAL ? updateLocal(mutator) : updateFirebase(mutator); },
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
