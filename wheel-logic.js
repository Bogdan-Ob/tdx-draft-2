'use strict';

/* ==========================================================================
   wheel-logic.js — чистая логика колеса (без DOM).
   Оба игрока строят ОДИНАКОВЫЙ "план" вращения из параметров spin,
   поэтому анимация на двух экранах совпадает без передачи кадров.
   ========================================================================== */

/* ---- НАСТРОЙКИ КОЛЕСА (менять тут) ---- */
const WHEEL = {
  SLOTS: 20,          // число секций на колесе
  STEP: 18,           // 360 / SLOTS
  SPIN_MS: 4000,      // длительность вращения
  BASE_STEPS: 30,     // минимум секций за вращение (30 = полтора оборота), к ним добавляется k (0..19)
  FAST_SHARE: 0.55,   // какая доля пути проходится на быстром старте
  FAST_DECAY: 0.07,   // меньше = резче падение скорости после старта
  START_LEAD_MS: 150, // запас, чтобы второй экран успел получить spin до старта
};

function mod(a, n) { return ((a % n) + n) % n; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

/* Детерминированный генератор: одинаковый seed -> одинаковые башни у обоих игроков */
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Кривая скорости: очень быстрый старт, РЕЗКОЕ падение скорости,
   дальше медленное вращение, плавно затухающее до остановки (названия читаются).
   Путь = быстрая часть (экспонента) + медленная часть (скорость линейно -> 0). */
function easeOut(p) {
  const tau = WHEEL.FAST_DECAY, f = WHEEL.FAST_SHARE;
  const fast = (1 - Math.exp(-p / tau)) / (1 - Math.exp(-1 / tau));
  const slow = 2 * p - p * p;
  return f * fast + (1 - f) * slow;
}

/* Сколько секций проходит колесо за вращение */
function spinSteps(spin) { return WHEEL.BASE_STEPS + spin.k; }

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Стартовая раскладка колеса: 20 разных башен */
function initialSlots(allowedIds) {
  return shuffled(allowedIds).slice(0, WHEEL.SLOTS);
}

/* Новое вращение. Результат выбирается из башен, которые ещё не выпадали
   и сейчас не на колесе (так выпавшая башня выходит из "скрытой" части). */
function createSpin(wheel, droppedIds, allowedIds, now) {
  const reserve = allowedIds.filter(id => !droppedIds.includes(id) && !wheel.slots.includes(id));
  return {
    id: now + '-' + Math.floor(Math.random() * 1e6),
    seed: Math.floor(Math.random() * 2147483647),
    startedAt: now + WHEEL.START_LEAD_MS,
    duration: WHEEL.SPIN_MS,
    k: Math.floor(Math.random() * WHEEL.SLOTS),   // на сколько секций докрутится сверх базы
    rot0Steps: wheel.rotSteps,
    startSlots: wheel.slots.slice(),
    excluded: droppedIds.slice(),
    resultId: randomPick(reserve),
    finished: false,
  };
}

/* ---- ЭФФЕКТ БЕГОВОЙ ДОРОЖКИ ----
   Позиция секции: psi = (i*STEP + rot) mod 360, 0 = стрелка сверху, по часовой.
   Видна при psi in [270..360] и [0..90]. Когда секция пересекает psi = 180
   (самая глубокая невидимая точка), её башню заменяют на новую из резерва.
   Последняя замена секции-победителя ставит resultId — она и остановится под стрелкой. */
function buildSpinPlan(spin, allowedIds) {
  const N = WHEEL.SLOTS, STEP = WHEEL.STEP;
  const total = spinSteps(spin) * STEP;            // общий угол: минимум полтора оборота
  const rot0 = spin.rot0Steps * STEP;
  const rng = mulberry32(spin.seed);
  const sStar = mod(-(spin.rot0Steps + spinSteps(spin)), N); // какая секция окажется под стрелкой

  // события замены: момент (угол R), когда секция i проходит через psi = 180
  const events = [];
  for (let i = 0; i < N; i++) {
    for (let R = mod(180 - i * STEP - rot0, 360); R <= total; R += 360) events.push({ R, slot: i });
  }
  events.sort((a, b) => a.R - b.R || a.slot - b.slot);

  let lastStar = -1;
  events.forEach((e, idx) => { if (e.slot === sStar) lastStar = idx; });

  const blocked = new Set(spin.excluded);
  blocked.add(spin.resultId);
  const candidates = allowedIds.filter(id => !blocked.has(id));
  const onWheel = new Set(spin.startSlots);
  const current = spin.startSlots.slice();
  const perSlot = Array.from({ length: N }, () => []);

  events.forEach((e, idx) => {
    let tower;
    if (idx === lastStar) {
      tower = spin.resultId;
    } else {
      const free = candidates.filter(id => !onWheel.has(id));
      const pool = free.length ? free : candidates;
      tower = pool[Math.floor(rng() * pool.length)];
    }
    onWheel.delete(current[e.slot]);
    onWheel.add(tower);
    current[e.slot] = tower;
    perSlot[e.slot].push({ R: e.R, tower });
  });

  return { total, sStar, perSlot, startSlots: spin.startSlots, finalSlots: current };
}

/* Какие башни стоят в секциях при пройденном угле R */
function slotsAt(plan, R) {
  return plan.startSlots.map((id, i) => {
    let t = id;
    for (const ev of plan.perSlot[i]) { if (ev.R <= R) t = ev.tower; else break; }
    return t;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { WHEEL, mod, clamp, easeOut, spinSteps, initialSlots, createSpin, buildSpinPlan, slotsAt, shuffled, randomPick };
}
