'use strict';

/* ==========================================================================
   app.js — интерфейс и правила драфта (режим Wheel Draft).
   Порядок файлов: towers.js -> wheel-logic.js -> net.js -> app.js
   Разделы:
     1. Настройки и утилиты
     2. Состояние и лобби (места, heartbeat)
     3. Действия игрока (вращение, колода, подлянка)
     4. Отрисовка колеса (canvas)
     5. Отрисовка интерфейса
     6. Модальные окна и уведомления
     7. Запуск
   ========================================================================== */


/* ==========================================================================
   1. НАСТРОЙКИ И УТИЛИТЫ
   ========================================================================== */
const CFG = {
  SPINS_TOTAL: 10,            // сколько башен выпадает каждому игроку
  DECK_SIZE: 6,               // размер итоговой колоды
  SECRETS_COUNT: 2,           // сколько тайных башен для подлянки
};

const TEAMS = ['blue', 'red'];
const TEAM_LABEL = { blue: 'Blue', red: 'Red' };
const otherTeam = t => (t === 'blue' ? 'red' : 'blue');
const towerName = id => (TOWER_BY_ID[id] ? TOWER_BY_ID[id].name : id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---- ИКОНКИ: файлы icons/<id>.png; список имеющихся — icons/index.json.
   Нет файла — показываем цветной бейдж с инициалами. ---- */
const ICONS = { ids: new Set(), loaded: false };
const iconCache = {};   // id -> { img, state: 'loading'|'ok'|'fail', cbs }
function iconImage(id, onLoad) {
  if (!ICONS.ids.has(id)) return null;
  let c = iconCache[id];
  if (!c) {
    c = iconCache[id] = { img: new Image(), state: 'loading', cbs: [] };
    c.img.onload = () => { c.state = 'ok'; c.cbs.forEach(f => f()); };
    c.img.onerror = () => { c.state = 'fail'; };
    c.img.src = 'icons/' + id + '.png';
  }
  if (c.state === 'ok') return c.img;
  if (c.state === 'loading' && onLoad) c.cbs.push(onLoad);
  return null;
}
function loadIconManifest() {
  fetch('icons/index.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : []))
    .then(list => {
      ICONS.ids = new Set(list);
      Object.keys(lastSig).forEach(k => delete lastSig[k]);   // перерисовать пулы
      if (state) { render(state); TEAMS.forEach(t => (views[t].dirty = true)); }
    })
    .catch(() => {});
}

/* Иконка башни (DOM) */
function iconEl(id, size) {
  const name = towerName(id);
  const s = el('span', 'tower-icon', ICONS.ids.has(id) ? '' : towerInitials(name));
  if (ICONS.ids.has(id)) {
    const img = new Image();
    img.src = 'icons/' + id + '.png';
    img.alt = name;
    img.className = 'tower-icon-img';
    s.appendChild(img);
  }
  s.style.background = towerColor(name);
  s.style.width = s.style.height = size + 'px';
  s.style.fontSize = Math.round(size * 0.38) + 'px';
  return s;
}


/* ==========================================================================
   2. СОСТОЯНИЕ И ЛОББИ
   ========================================================================== */
let state = null;
const views = {};   // team -> WheelView
const ui = {};      // team -> ссылки на DOM половины

/* ---- Опция «EDJ бесплатно» (Wheel Draft) ----
   Включена: EDJ не выпадает на колесе и сразу лежит в пуле у обоих, вращений на одно меньше (9). */
const edjOn = s => !!(s.wheelOpts && s.wheelOpts.edj);
const spinsTotal = s => CFG.SPINS_TOTAL - (edjOn(s) ? 1 : 0);
const wheelIds = edj => (edj ? PVP_IDS.filter(id => id !== AUCTION.FREE_TOWER) : PVP_IDS);
const poolOf = (s, d) => (edjOn(s) ? [AUCTION.FREE_TOWER, ...d.spins] : d.spins);

function freshDraft(edj) {
  return {
    spins: [],                                  // id выпавших башен (до 10, при EDJ — до 9)
    wheel: { slots: initialSlots(wheelIds(edj)), rotSteps: 0, spin: null },
    secretsDealt: false,                        // игрок получил тайные башни (сами башни — приватно!)
    giftDecided: false,                         // игрок принял решение по подлянке
    gift: null,                                 // id переданной сопернику башни
    deck: [],                                   // выбранные для колоды id (до 6)
    confirmed: false,
  };
}

function createInitialState() {
  return {
    epoch: Date.now(),                          // меняется при сбросе драфта
    mode: 'wheel',                              // активный режим: 'wheel' | 'auction' (общий для обоих игроков)
    teams: { blue: { owner: null }, red: { owner: null } },
    wheelOpts: { edj: false },                          // общие настройки Wheel Draft
    draft: { blue: freshDraft(false), red: freshDraft(false) },   // состояние Wheel Draft
    auction: freshAuction(),                            // состояние Auction Draft (см. auction.js)
  };
}

/* Firebase Realtime Database не хранит пустые массивы и null — при каждом чтении
   возвращаем недостающие поля на место */
function normalizeState(raw) {
  if (!raw || !raw.draft || !raw.teams) return createInitialState();
  raw.wheelOpts = raw.wheelOpts || {};
  raw.wheelOpts.edj = !!raw.wheelOpts.edj;
  TEAMS.forEach(t => {
    raw.teams[t] = raw.teams[t] || {};
    raw.teams[t].owner = raw.teams[t].owner || null;
    const d = raw.draft[t] || (raw.draft[t] = freshDraft(raw.wheelOpts.edj));
    d.spins = d.spins || [];
    d.deck = d.deck || [];
    d.gift = d.gift || null;
    d.giftDecided = !!d.giftDecided;
    d.confirmed = !!d.confirmed;
    d.secretsDealt = !!d.secretsDealt;
    d.wheel = d.wheel || {};
    d.wheel.slots = d.wheel.slots || initialSlots(wheelIds(raw.wheelOpts.edj));
    d.wheel.rotSteps = d.wheel.rotSteps || 0;
    d.wheel.spin = d.wheel.spin || null;
    if (d.wheel.spin) d.wheel.spin.excluded = d.wheel.spin.excluded || [];
  });
  raw.mode = raw.mode === 'auction' ? 'auction' : 'wheel';
  raw.auction = normalizeAuction(raw.auction);
  raw.epoch = raw.epoch || Date.now();
  return raw;
}

/* Команды, которыми владеет эта вкладка (в обычном режиме — не больше одной) */
function ownedTeams(s) { return TEAMS.filter(t => s.teams[t].owner === Net.clientId); }

/* «Активная» команда этой вкладки. В ЛОКАЛЬНОМ режиме одна вкладка может занять обе
   команды (для теста в одиночку) и переключаться между ними кнопкой на половине. */
function myTeam(s) {
  const own = ownedTeams(s);
  if (!own.length) return null;
  const active = sessionStorage.getItem('tdx_active_team');
  return own.includes(active) ? active : own[0];
}
/* Место занято, пока в базе записан owner. Освобождает его сервер Firebase
   (onDisconnect), как только вкладка игрока закрылась или пропала связь. */
function seatTaken(s, t) {
  return !!s.teams[t].owner;
}

/* Защита: изменять можно только СВОЮ команду */
function ownTeamOrNull(s, team) {
  return s.teams[team].owner === Net.clientId ? s.draft[team] : null;
}

/* ---- Места ---- */
function claimTeam(team) {
  Net.update(s => {
    const owner = s.teams[team].owner;
    if (owner === Net.clientId) return;              // уже моя
    if (!Net.isLocal && (myTeam(s) || seatTaken(s, team))) return;   // обычный режим: одно место, чужое занять нельзя
    s.teams[team] = { owner: Net.clientId };         // транзакция: два игрока не займут одно место
  });
  sessionStorage.setItem('tdx_last_team', team);
  sessionStorage.setItem('tdx_active_team', team);
  if (state) render(state);
}
function releaseTeam(team) {                              // без аргумента — освободить все свои места
  Net.update(s => {
    TEAMS.forEach(t => {
      if ((!team || t === team) && s.teams[t].owner === Net.clientId) s.teams[t] = { owner: null };
    });
  });
  if (sessionStorage.getItem('tdx_last_team') === team || !team) sessionStorage.removeItem('tdx_last_team');
  if (sessionStorage.getItem('tdx_active_team') === team || !team) sessionStorage.removeItem('tdx_active_team');
}

/* Блок «место» в шапке половины (общий для Wheel и Auction).
   Локальный режим: занятое место можно перехватить, а команду второй половины — взять
   в той же вкладке и переключаться между ними («Играть за …»). */
function renderSeat(u, team, s, me) {
  const mine = me === team;
  const owned = s.teams[team].owner === Net.clientId;     // принадлежит этой вкладке (но может быть не активной)
  const taken = seatTaken(s, team);
  u.status.textContent = mine ? 'Вы управляете этой командой'
    : owned ? 'Ваша вторая команда (тест)' : taken ? 'Игрок подключён' : 'Место свободно';
  u.status.className = 'seat-status' + (mine || owned ? ' seat-status--me' : taken ? ' seat-status--taken' : '');
  u.claim.hidden = mine;
  if (Net.isLocal) {
    u.claim.textContent = owned ? 'Играть за ' + TEAM_LABEL[team] : taken ? 'Перехватить' : 'Занять ' + TEAM_LABEL[team];
    u.claim.disabled = false;
  } else {
    u.claim.textContent = taken ? 'Занято' : 'Занять ' + TEAM_LABEL[team];
    u.claim.disabled = taken || !!me;                      // занято другим или я уже в другой команде
  }
  u.leave.hidden = !owned;
}

/* ---- Присутствие (онлайн-статус) ----
   Для занятого места в базе взводится onDisconnect: при закрытии вкладки
   сервер сам очистит owner. Если связь пропала и место потеряно — пробуем вернуть. */
let reclaimBusy = false;
function syncPresence(s) {
  TEAMS.forEach(t => {
    const path = 'teams/' + t + '/owner';
    if (s.teams[t].owner === Net.clientId) Net.guard(path);
    else Net.unguard(path);
  });
  const last = sessionStorage.getItem('tdx_last_team');
  if (last && !myTeam(s) && !seatTaken(s, last) && !reclaimBusy) {
    reclaimBusy = true;
    claimTeam(last);
    setTimeout(() => { reclaimBusy = false; }, 1500);
  }
}


/* ==========================================================================
   3. ДЕЙСТВИЯ ИГРОКА
   ========================================================================== */

/* ---- Вращение колеса ---- */
function startSpin(team) {
  Net.update(s => {
    const d = ownTeamOrNull(s, team);
    if (!d) return;                                          // чужая команда — нельзя
    if (d.spins.length >= spinsTotal(s)) return;
    if (d.wheel.spin && !d.wheel.spin.finished) return;      // уже крутится
    d.wheel.spin = createSpin(d.wheel, d.spins, wheelIds(edjOn(s)), Net.now());
  });
}

/* Завершение вращения: башня попадает в пул (запись видят оба устройства) */
const commitTimers = {};
function scheduleCommit(team, spin) {
  if (commitTimers[spin.id]) return;
  const wait = Math.max(0, spin.startedAt + spin.duration - Net.now()) + 80;
  commitTimers[spin.id] = setTimeout(() => commitSpin(team, spin.id), wait);
}
function commitSpin(team, spinId) {
  Net.update(s => {
    const d = ownTeamOrNull(s, team);
    if (!d) return;
    const spin = d.wheel.spin;
    if (!spin || spin.finished || spin.id !== spinId) return;
    const plan = buildSpinPlan(spin, wheelIds(edjOn(s)));
    d.wheel.slots = plan.finalSlots;
    d.wheel.rotSteps = mod(spin.rot0Steps + spinSteps(spin), WHEEL.SLOTS);
    spin.finished = true;
    d.spins.push(spin.resultId);
    if (d.spins.length >= spinsTotal(s)) d.secretsDealt = true;
  });
}

/* ---- Выбор колоды ---- */
function incomingGift(s, team) { return s.draft[otherTeam(team)].gift; }

function toggleDeck(team, id) {
  Net.update(s => {
    const d = ownTeamOrNull(s, team);
    if (!d || d.confirmed || d.spins.length < spinsTotal(s)) return;
    if (incomingGift(s, team) === id) return;                // подарок удалить нельзя
    const i = d.deck.indexOf(id);
    if (i >= 0) d.deck.splice(i, 1);
    else if (d.deck.length < CFG.DECK_SIZE) d.deck.push(id);
    else toast('Колода заполнена (6/6) — сначала уберите башню');
  });
}

function toggleConfirm(team) {
  Net.update(s => {
    const d = ownTeamOrNull(s, team);
    if (!d) return;
    if (d.confirmed) { d.confirmed = false; return; }
    const oppDecided = s.draft[otherTeam(team)].giftDecided;
    if (d.deck.length === CFG.DECK_SIZE && oppDecided) d.confirmed = true;
  });
}

/* ---- Подлянка ---- */
/* Тайные башни хранятся ПРИВАТНО (sessionStorage этой вкладки), соперник их не видит */
function getSecrets(s, team) {
  const v = Net.getPrivate('secrets_' + team);       // отдельный ключ на команду (в тесте одна вкладка играет за обе)
  return v && v.epoch === s.epoch ? v.ids : null;
}
function ensureSecrets(s, team) {
  if (getSecrets(s, team)) return;
  const d = s.draft[team], o = s.draft[otherTeam(team)];
  const pool = wheelIds(edjOn(s)).filter(id => !d.spins.includes(id) && !o.spins.includes(id));
  Net.setPrivate('secrets_' + team, {
    epoch: s.epoch,
    ids: shuffled(pool).slice(0, CFG.SECRETS_COUNT),
  });
}
function decideGift(team, towerId) {
  Net.update(s => {
    const d = ownTeamOrNull(s, team);
    if (!d || d.giftDecided) return;
    d.gift = towerId || null;
    d.giftDecided = true;
  });
}

/* Получатель обязан взять подарок в колоду. Если колода полна — окно замены. */
let giftModalOpen = false;
function checkIncomingGift(s) {
  ownedTeams(s).forEach(t => checkGiftFor(s, t));
}
function checkGiftFor(s, t) {
  const d = s.draft[t], g = incomingGift(s, t);
  if (!g || d.spins.length < spinsTotal(s) || d.deck.includes(g)) return;
  if (d.deck.length < CFG.DECK_SIZE) {
    Net.update(x => {
      const dd = ownTeamOrNull(x, t);
      if (dd && !dd.deck.includes(g) && dd.deck.length < CFG.DECK_SIZE) { dd.deck.push(g); dd.confirmed = false; }
    });
  } else if (!giftModalOpen) {
    openReplaceModal(t, g, d.deck);
  }
}
function openReplaceModal(team, gift, deck) {
  giftModalOpen = true;
  const cards = deck.map(id => {
    const c = el('div', 'card card--clickable');
    c.append(iconEl(id, 30), el('span', 'card-name', towerName(id)));
    c.onclick = () => {
      Net.update(s => {
        const d = ownTeamOrNull(s, team);
        if (!d) return;
        d.deck = d.deck.filter(x => x !== id);
        if (!d.deck.includes(gift)) d.deck.push(gift);
        d.confirmed = false;
      });
      giftModalOpen = false;
      closeModal();
    };
    return c;
  });
  openModal({
    title: 'Подарок от соперника',
    text: `Соперник передал вам «${towerName(gift)}». Подарок обязательно должен быть в колоде, а колода уже полная (6/6). Выберите башню, которую он заменит:`,
    cards,
  });
}

/* ---- Переключатель «EDJ бесплатно» (только до первого вращения) ---- */
const wheelStarted = s => TEAMS.some(t => s.draft[t].wheel.spin || s.draft[t].spins.length > 0);
function toggleEdj() {
  Net.update(s => {
    if (!myTeam(s) || s.mode !== 'wheel' || wheelStarted(s)) return;
    s.wheelOpts.edj = !s.wheelOpts.edj;
    TEAMS.forEach(t => { s.draft[t].wheel.slots = initialSlots(wheelIds(s.wheelOpts.edj)); });   // колесо без/с EDJ
  });
}

/* ---- Сброс текущего режима (второй режим не затрагивается) ---- */
function resetDraft() {
  Net.update(s => {
    if (!myTeam(s)) return;                                   // сбрасывать могут только игроки
    if (s.mode === 'auction') { s.auction = freshAuction(); return; }
    s.draft = { blue: freshDraft(edjOn(s)), red: freshDraft(edjOn(s)) };
    s.epoch = Date.now();
  });
  TEAMS.forEach(t => Net.setPrivate('secrets_' + t, null));
}

/* ---- Переключение режима (меняется у обоих игроков) ---- */
function requestMode(mode) {
  const s = Net.get();
  if (!s || s.mode === mode) return;
  if (!myTeam(s)) { toast('Режим могут переключать только игроки — сначала займите команду'); return; }
  const busy = s.mode === 'auction'
    ? s.auction.phase === 'running'
    : TEAMS.some(t => s.draft[t].spins.length > 0 && !s.draft[t].confirmed);
  const go = () => Net.update(x => { if (myTeam(x)) x.mode = mode; });
  if (!busy) { go(); return; }
  openModal({
    title: 'Переключить режим?',
    text: 'Режим переключится у обоих игроков. Прогресс текущего режима сохранится — к нему можно вернуться.',
    buttons: [
      { label: 'Отмена', cls: 'btn--ghost' },
      { label: 'Переключить', cls: 'btn--primary', onClick: go },
    ],
  });
}


/* ==========================================================================
   4. ОТРИСОВКА КОЛЕСА (canvas)
   ========================================================================== */
class WheelView {
  constructor(team, canvas) {
    this.team = team;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.plan = null;          // кэш плана текущего вращения
    this.planId = null;
    this.dirty = true;
    this.geo = null;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
  }

  destroy() { this.ro.disconnect(); }                 // при смене режима колесо удаляется

  /* Геометрия: диаметр колеса ≈ ширина блока; высота = полукруг + корпус */
  resize() {
    const W = this.canvas.parentElement.clientWidth;
    if (!W) return;
    const R = W / 2 - 24;                 // запас под золотой обод
    const cy = R + 28;
    const H = Math.round(cy + 46);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.height = H + 'px';
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.geo = { W, H, R, cx: W / 2, cy, dpr };
    this.dirty = true;
  }

  /* Вызывается каждый кадр */
  tick(s) {
    const spin = s.draft[this.team].wheel.spin;
    if (this.dirty || (spin && !spin.finished)) {
      this.draw(s);
      this.dirty = false;
    }
  }

  draw(s) {
    if (!this.geo) return;
    const { W, H, R, cx, cy, dpr } = this.geo;
    const ctx = this.ctx;
    const d = s.draft[this.team], w = d.wheel, spin = w.spin;
    const N = WHEEL.SLOTS, STEP = WHEEL.STEP;

    // --- что показывать: идёт вращение или покой ---
    let slots = w.slots, rotDeg = w.rotSteps * STEP, winnerSlot = -1, spinning = false;
    if (spin && !spin.finished) {
      if (this.planId !== spin.id) { this.plan = buildSpinPlan(spin, wheelIds(edjOn(s))); this.planId = spin.id; }
      const p = clamp((Net.now() - spin.startedAt) / spin.duration, 0, 1);
      const Rr = this.plan.total * easeOut(p);                // угол по кривой скорости (см. easeOut)
      slots = slotsAt(this.plan, Rr);
      rotDeg = spin.rot0Steps * STEP + Rr;
      spinning = p < 1;
    } else if (d.spins.length > 0) {
      winnerSlot = mod(-w.rotSteps, N);                       // секция под стрелкой
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // --- 1. мягкое золотое свечение за колесом ---
    const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.12);
    glow.addColorStop(0, 'rgba(255,200,80,0)');
    glow.addColorStop(0.9, 'rgba(255,200,80,.18)');
    glow.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, cy);

    // --- 2. секции: рисуем только верхнюю половину (нижняя скрыта клипом) ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, cy);
    ctx.clip();

    for (let i = 0; i < N; i++) {
      const psi = mod(i * STEP + rotDeg, 360);                // 0 = стрелка, по часовой
      if (psi > 100 && psi < 260) continue;                   // полностью невидимые секции
      const a = (psi - 90) * Math.PI / 180;
      const half = (STEP / 2) * Math.PI / 180;
      const wedge = () => {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a - half, a + half);
        ctx.closePath();
      };

      // цвет секции: радиальный градиент (темнее у центра, ярче у обода)
      const hue = (i * STEP + 8) % 360;
      const base = i % 2 ? 44 : 52;
      const g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      g.addColorStop(0, `hsl(${hue},80%,${base - 20}%)`);
      g.addColorStop(0.55, `hsl(${hue},78%,${base - 4}%)`);
      g.addColorStop(1, `hsl(${hue},88%,${base + 8}%)`);
      wedge();
      ctx.fillStyle = g;
      ctx.fill();

      // блик у обода
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.95, a - half + 0.05, a + half - 0.05);
      ctx.lineWidth = R * 0.012;
      ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.stroke();

      // золотой разделитель и «гвоздик» на ободе
      const ax = a - half;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ax) * R * 0.2, cy + Math.sin(ax) * R * 0.2);
      ctx.lineTo(cx + Math.cos(ax) * R, cy + Math.sin(ax) * R);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,238,190,.92)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ax) * R * 0.965, cy + Math.sin(ax) * R * 0.965, R * 0.011, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffe9a0';
      ctx.fill();

      // подсветка выпавшей секции
      if (i === winnerSlot) {
        ctx.save();
        wedge();
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 28;
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.restore();
      }

      // иконка и название вдоль радиуса; в левой половине текст разворачиваем
      const flip = psi > 180;
      const sign = flip ? -1 : 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a + (flip ? Math.PI : 0));
      this.drawIcon(slots[i], sign * R * 0.875, 0, R * 0.062);

      const name = towerName(slots[i]);
      let fs = R * 0.06;
      ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`;
      const maxW = R * 0.52;
      const tw = ctx.measureText(name).width;
      if (tw > maxW) { fs *= maxW / tw; ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`; }
      ctx.textBaseline = 'middle';
      ctx.textAlign = flip ? 'left' : 'right';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(name, sign * R * 0.77, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, sign * R * 0.77, 0);
      ctx.restore();
    }

    // затемнение к центру — глубина
    const shade = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
    shade.addColorStop(0, 'rgba(0,0,0,.5)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, cy);
    ctx.restore();

    // --- 3. золотой обод ---
    const rimG = ctx.createLinearGradient(0, cy - R - 18, 0, cy);
    rimG.addColorStop(0, '#fff3b8');
    rimG.addColorStop(0.3, '#eab530');
    rimG.addColorStop(0.7, '#a8740e');
    rimG.addColorStop(1, '#d9a520');
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, Math.PI, 2 * Math.PI);
    ctx.lineWidth = 18;
    ctx.strokeStyle = rimG;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, Math.PI, 2 * Math.PI);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(70,40,0,.85)';
    ctx.stroke();

    // лампочки на ободе: при вращении «бегут»
    const bulbs = 41, phase = Math.floor(performance.now() / 90);
    for (let j = 0; j < bulbs; j++) {
      const ang = Math.PI + j * Math.PI / (bulbs - 1);
      const on = spinning ? (j + phase) % 3 === 0 : true;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * (R + 8), cy + Math.sin(ang) * (R + 8), 4.3, 0, 2 * Math.PI);
      if (on) { ctx.shadowColor = '#ffd75a'; ctx.shadowBlur = 9; }
      ctx.fillStyle = on ? '#fffbe3' : '#7a5a14';
      ctx.fill();
      ctx.restore();
    }

    // --- 4. корпус под колесом (скрывает нижнюю половину) ---
    const hg = ctx.createLinearGradient(0, cy, 0, H);
    hg.addColorStop(0, '#1d2740');
    hg.addColorStop(1, '#070b13');
    ctx.fillStyle = hg;
    ctx.fillRect(0, cy + 1, W, H - cy);
    const lineG = ctx.createLinearGradient(0, 0, W, 0);
    lineG.addColorStop(0, '#7a5510');
    lineG.addColorStop(0.5, '#f3c847');
    lineG.addColorStop(1, '#7a5510');
    ctx.fillStyle = lineG;
    ctx.fillRect(0, cy - 1, W, 5);
    ctx.fillStyle = '#3a4764';
    for (const rx of [0.08, 0.2, 0.8, 0.92]) {                // заклёпки
      ctx.beginPath();
      ctx.arc(W * rx, cy + 22, 4, 0, 2 * Math.PI);
      ctx.fill();
    }

    // --- 5. ступица (верхняя половина), под кнопкой вращения ---
    const hubG = ctx.createRadialGradient(cx, cy - R * 0.06, R * 0.02, cx, cy, R * 0.2);
    hubG.addColorStop(0, '#46557a');
    hubG.addColorStop(1, '#0f1628');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.2, Math.PI, 2 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = hubG;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e0a928';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.15, Math.PI, 2 * Math.PI);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,225,140,.7)';
    ctx.stroke();
    ctx.setLineDash([]);

    // --- 6. стрелка ---
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.65)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    const pg = ctx.createLinearGradient(0, cy - R - 22, 0, cy - R + 38);
    pg.addColorStop(0, '#ff7a68');
    pg.addColorStop(1, '#bf0f20');
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy - R - 20);
    ctx.lineTo(cx + 22, cy - R - 20);
    ctx.lineTo(cx, cy - R + 38);
    ctx.closePath();
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffeaa8';
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy - R - 16, 9, 0, 2 * Math.PI);
    ctx.fillStyle = '#f3c847';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7a5510';
    ctx.stroke();
  }

  /* Иконка на колесе (канвас-версия iconEl): картинка из icons/, иначе бейдж с инициалами */
  drawIcon(id, x, y, r) {
    const ctx = this.ctx, name = towerName(id);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = towerColor(name);
    ctx.fill();
    ctx.restore();

    const img = iconImage(id, () => { this.dirty = true; });
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r - 2, 0, 2 * Math.PI);
      ctx.clip();
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${r * 0.8}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(towerInitials(name), x, y + 1);
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}


/* ==========================================================================
   5. ОТРИСОВКА ИНТЕРФЕЙСА
   ========================================================================== */
const lastSig = {};   // team+блок -> сигнатура, чтобы не перерисовывать без изменений
function renderIfChanged(key, sig, fn) {
  const str = JSON.stringify(sig);
  if (lastSig[key] === str) return;
  lastSig[key] = str;
  fn();
}

/* Режим -> разметка рабочей области. Пересобирается при смене режима. */
let layoutMode = null;
function buildLayout(mode) {
  const ws = document.getElementById('workspace');
  TEAMS.forEach(t => { if (views[t]) { views[t].destroy(); delete views[t]; } });
  ws.replaceChildren();
  Object.keys(lastSig).forEach(k => delete lastSig[k]);       // кэш отрисовки относится к старой разметке
  ws.className = 'workspace workspace--' + mode;
  layoutMode = mode;
  if (mode === 'auction') buildAuctionLayout(ws);
  else buildWheelLayout(ws);
}

function buildWheelLayout(ws) {
  const tpl = document.getElementById('half-template');
  TEAMS.forEach(team => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.classList.add('half--' + team);
    node.querySelector('.team-name').textContent = TEAM_LABEL[team];
    ws.appendChild(node);
    ui[team] = {
      root: node,
      status: node.querySelector('.seat-status'),
      claim: node.querySelector('.btn--claim'),
      leave: node.querySelector('.btn--leave'),
      spin: node.querySelector('.btn--spin'),
      capL: node.querySelector('.wheel-caption--left'),
      capR: node.querySelector('.wheel-caption--right'),
      pool: node.querySelector('.pool'),
      poolCount: node.querySelector('.pool-count'),
      deck: node.querySelector('.deck'),
      deckCount: node.querySelector('.deck-count'),
      actions: node.querySelector('.actions'),
    };
    views[team] = new WheelView(team, node.querySelector('.wheel-canvas'));
    ui[team].claim.onclick = () => claimTeam(team);
    ui[team].leave.onclick = () => releaseTeam(team);
    ui[team].spin.onclick = () => startSpin(team);
  });
}

function render(s) {
  const me = myTeam(s);
  if (s.mode !== layoutMode) buildLayout(s.mode);
  if (s.mode === 'auction') renderAuction(s, me);
  else TEAMS.forEach(team => renderTeam(team, s, me));
  renderTopbar(s, me);
  document.querySelectorAll('.mode-btn[data-mode]').forEach(b =>
    b.classList.toggle('mode-btn--active', b.dataset.mode === s.mode));
  renderEdjToggle(s, me);
}

function renderEdjToggle(s, me) {
  const b = document.getElementById('btn-edj');
  b.hidden = s.mode !== 'wheel';
  const on = edjOn(s), locked = wheelStarted(s);
  b.textContent = on ? 'EDJ бесплатно: ВКЛ · 9 вращений' : 'EDJ бесплатно: ВЫКЛ · 10 вращений';
  b.classList.toggle('mode-btn--active', on);
  b.disabled = locked || !me;
  b.title = locked ? 'Менять можно только до первого вращения (кнопка «Сбросить драфт» вернёт возможность)'
    : !me ? 'Сначала займите команду' : 'Включено: EDJ бесплатна у обоих игроков и не выпадает на колесе';
}

function renderTeam(team, s, me) {
  const u = ui[team], d = s.draft[team], opp = otherTeam(team);
  const mine = me === team;
  const taken = seatTaken(s, team);
  const spinning = !!(d.wheel.spin && !d.wheel.spin.finished);
  const total = spinsTotal(s);
  const spinsDone = d.spins.length >= total;
  const gift = incomingGift(s, team);
  const items = poolOf(s, d);                          // пул: [EDJ] + выпавшие

  // --- место / лобби ---
  renderSeat(u, team, s, me);

  // --- колесо: кнопка и подписи ---
  u.spin.disabled = !(mine && !spinning && !spinsDone);
  u.spin.textContent = spinning ? 'КРУТИТСЯ…' : spinsDone ? 'ГОТОВО' : mine ? 'ВРАЩАТЬ' : 'ЖДЁТ';
  u.capL.textContent = `Вращений: ${d.spins.length}/${total}` + (spinning ? ' · идёт вращение' : '');
  u.capR.textContent = !spinning && d.spins.length ? 'Выпало: ' + towerName(d.spins[d.spins.length - 1]) : '';
  views[team].dirty = true;

  // --- пул ---
  renderIfChanged(team + 'pool', [d.spins, d.deck, gift, mine, d.confirmed, spinsDone, edjOn(s)], () => {
    u.pool.replaceChildren();
    u.poolCount.textContent = `${items.length}/${CFG.SPINS_TOTAL}` + (spinsDone ? ' · выберите 6 в колоду' : '');
    for (let i = 0; i < CFG.SPINS_TOTAL; i++) {
      const id = items[i];
      if (!id) { u.pool.appendChild(el('div', 'card card--empty', String(i + 1))); continue; }
      const inDeck = d.deck.includes(id);
      const c = el('div', 'card' + (inDeck ? ' card--in-deck' : '') + (gift === id ? ' card--gift' : ''));
      c.append(iconEl(id, 30), el('span', 'card-name', towerName(id)));
      if (gift === id) c.appendChild(el('span', 'badge', '🎁'));
      if (edjOn(s) && id === AUCTION.FREE_TOWER) c.appendChild(el('span', 'badge badge--free', 'FREE'));
      if (mine && spinsDone && !d.confirmed && gift !== id) {
        c.classList.add('card--clickable');
        c.onclick = () => toggleDeck(team, id);
      }
      if (i === items.length - 1 && !spinsDone && id !== AUCTION.FREE_TOWER) c.classList.add('card--new');
      u.pool.appendChild(c);
    }
  });

  // --- колода ---
  renderIfChanged(team + 'deck', [d.deck, gift, mine, d.confirmed], () => {
    u.deck.replaceChildren();
    u.deckCount.textContent = `${d.deck.length}/${CFG.DECK_SIZE}` + (d.confirmed ? ' · подтверждена' : '');
    for (let i = 0; i < CFG.DECK_SIZE; i++) {
      const id = d.deck[i];
      if (!id) { u.deck.appendChild(el('div', 'card card--empty', '—')); continue; }
      const c = el('div', 'card card--in-deck' + (gift === id ? ' card--gift' : ''));
      c.append(iconEl(id, 30), el('span', 'card-name', towerName(id)));
      if (gift === id) c.appendChild(el('span', 'badge', '🎁'));
      if (mine && !d.confirmed && gift !== id) {
        c.classList.add('card--clickable');
        c.onclick = () => toggleDeck(team, id);
      }
      u.deck.appendChild(c);
    }
  });

  // --- действия: подлянка + подтверждение ---
  if (mine && spinsDone && !d.giftDecided) ensureSecrets(s, team);
  const secrets = mine ? getSecrets(s, team) : null;
  renderIfChanged(team + 'actions', [
    mine, spinsDone, total, d.giftDecided, d.gift, gift, secrets, d.deck.length, d.confirmed, s.draft[opp].giftDecided,
  ], () => renderActions(team, s, mine, secrets));
}

function renderActions(team, s, mine, secrets) {
  const u = ui[team], d = s.draft[team], opp = otherTeam(team);
  const spinsDone = d.spins.length >= spinsTotal(s);
  const gift = incomingGift(s, team);
  u.actions.replaceChildren();

  // левая часть: подлянка
  const left = el('div', 'actions-info');
  if (!spinsDone) {
    left.textContent = `Тайная подлянка откроется после ${spinsTotal(s)} вращений.`;
    if (gift) left.textContent += ` Соперник уже передал вам «${towerName(gift)}» — она добавится в колоду.`;
  } else if (!d.giftDecided) {
    if (mine && secrets) {
      const row = el('div', 'gift-row');
      row.appendChild(el('span', '', '🔒 Только вы видите:'));
      secrets.forEach(id => {
        const c = el('div', 'card card--secret');
        c.append(iconEl(id, 30), el('span', 'card-name', towerName(id)));
        const b = el('button', 'btn btn--small', 'Передать');
        b.onclick = () => decideGift(team, id);
        row.append(c, b);
      });
      const none = el('button', 'btn btn--ghost btn--small', 'Ничего не передавать');
      none.onclick = () => decideGift(team, null);
      row.appendChild(none);
      left.replaceChildren(row);
    } else {
      left.textContent = `🔒 У игрока ${CFG.SECRETS_COUNT} тайные башни — решает, передавать ли соперник.`;
    }
  } else if (d.gift) {
    left.textContent = `Передана сопернику: «${towerName(d.gift)}»`;
  } else {
    left.textContent = 'Подлянка: ничего не передано.';
  }
  if (spinsDone && gift && d.giftDecided) left.textContent += ` · Подарок от соперника: «${towerName(gift)}» (обязателен в колоде)`;
  u.actions.appendChild(left);

  // правая часть: подтверждение колоды
  if (mine) {
    const oppDecided = s.draft[opp].giftDecided;
    const b = el('button', 'btn btn--primary');
    b.textContent = d.confirmed ? 'Изменить колоду' : 'Подтвердить колоду';
    b.disabled = !d.confirmed && !(spinsDone && d.deck.length === CFG.DECK_SIZE && oppDecided);
    if (!d.confirmed && spinsDone && d.deck.length === CFG.DECK_SIZE && !oppDecided) b.textContent = 'Ждём решения соперника…';
    b.onclick = () => toggleConfirm(team);
    u.actions.appendChild(b);
  }
}

function renderTopbar(s, me) {
  const el_ = document.getElementById('topbar-status');
  const full = TEAMS.every(t => seatTaken(s, t));
  let text;
  if (me) text = `Вы играете за ${TEAM_LABEL[me]}`;
  else if (full) text = 'Лобби заполнено (2/2) — вы наблюдатель';
  else text = 'Выберите команду: нажмите «Занять» на нужной половине';
  if (s.mode === 'auction') {
    if (s.auction.phase === 'running') text += ` · лот ${s.auction.idx + 1}/${AUCTION.LOTS}`;
    if (s.auction.phase === 'done') text = '✔ Аукцион завершён — колоды готовы';
  } else if (TEAMS.every(t => s.draft[t].confirmed)) {
    text = '✔ Драфт завершён — обе колоды подтверждены';
  }
  if (Net.isLocal) text += ' · ЛОКАЛЬНЫЙ РЕЖИМ: можно занять обе команды в одной вкладке и переключаться кнопкой «Играть за…»';
  el_.textContent = text;
}


/* ==========================================================================
   6. МОДАЛЬНЫЕ ОКНА И УВЕДОМЛЕНИЯ
   ========================================================================== */
function openModal({ title, text, cards, buttons }) {
  closeModal();
  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal');
  box.appendChild(el('h3', '', title));
  if (text) box.appendChild(el('p', '', text));
  if (cards) { const g = el('div', 'modal-content'); g.append(...cards); box.appendChild(g); }
  if (buttons) {
    const row = el('div', 'modal-buttons');
    buttons.forEach(b => {
      const btn = el('button', 'btn ' + (b.cls || ''), b.label);
      btn.onclick = () => { closeModal(); if (b.onClick) b.onClick(); };
      row.appendChild(btn);
    });
    box.appendChild(row);
  }
  overlay.appendChild(box);
  document.getElementById('modal-root').appendChild(overlay);
}
function closeModal() { document.getElementById('modal-root').replaceChildren(); }

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 2500);
}


/* ==========================================================================
   7. ЗАПУСК
   ========================================================================== */
function onState(s) {
  state = s;
  // Если моя команда крутит колесо — гарантируем завершение вращения (даже если вкладка в фоне)
  ownedTeams(s).forEach(t => {
    const spin = s.draft[t].wheel.spin;
    if (spin && !spin.finished) scheduleCommit(t, spin);
  });
  syncPresence(s);
  render(s);
  if (s.mode === 'wheel') checkIncomingGift(s);
}

function frame() {
  if (state && layoutMode === 'wheel') TEAMS.forEach(t => views[t] && views[t].tick(state));
  requestAnimationFrame(frame);
}

function showConn(text, isError) {
  let box = document.getElementById('conn-overlay');
  if (!text) { if (box) box.remove(); return; }
  if (!box) {
    box = el('div', 'conn-overlay');
    box.id = 'conn-overlay';
    document.body.appendChild(box);
  }
  box.className = 'conn-overlay' + (isError ? ' conn-overlay--error' : '');
  box.textContent = text;
}

function init() {
  buildLayout('wheel');
  document.querySelectorAll('.mode-btn[data-mode]').forEach(b => { b.onclick = () => requestMode(b.dataset.mode); });
  document.getElementById('btn-edj').onclick = toggleEdj;
  loadIconManifest();
  showConn('Подключение к серверу…');

  document.getElementById('btn-reset').onclick = () => {
    if (!myTeam(Net.get())) { toast('Сначала займите команду'); return; }
    const auctionMode = Net.get().mode === 'auction';
    openModal({
      title: auctionMode ? 'Сбросить аукцион?' : 'Сбросить драфт?',
      text: auctionMode
        ? 'Бюджеты, выигранные башни, лоты и колоды обоих игроков будут очищены. Wheel Draft не затрагивается.'
        : 'Пулы, колоды, колёса и подлянки обоих игроков будут очищены. Auction Draft не затрагивается.',
      buttons: [
        { label: 'Отмена', cls: 'btn--ghost' },
        { label: 'Сбросить', cls: 'btn--primary', onClick: resetDraft },
      ],
    });
  };

  // Ошибки связи / доступа показываем поверх интерфейса
  Net.onError(err => {
    const denied = err && /permission/i.test(err.message || err.code || '');
    showConn(denied
      ? 'Нет доступа к базе данных. Проверьте Rules в Firebase (см. README).'
      : 'Ошибка связи с сервером: ' + (err && err.message ? err.message : err), true);
  });
  Net.onConnection(online => { if (!online && state) toast('Связь потеряна, переподключаюсь…'); });

  Net.start({
    config: firebaseConfig,
    root: FIREBASE_ROOT,
    factory: createInitialState,
    normalize: normalizeState,
  }).then(() => {
    showConn(null);
    Net.subscribe(onState);
    onState(Net.get());
    requestAnimationFrame(frame);
  });
}

init();
