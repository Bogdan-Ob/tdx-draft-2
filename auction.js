'use strict';

/* ==========================================================================
   auction.js — режим Auction Draft.
   Загружается ДО app.js. Использует глобальные TEAMS, TEAM_LABEL, otherTeam, el,
   iconEl, towerName, seatTaken, myTeam, renderSeat, renderIfChanged, toast, ui
   (объявлены в app.js и вызываются уже после его загрузки).

   Колода здесь собирается сама: EDJ (бесплатно) + 5 выигранных башен = 6.

   Разделы:
     1. Настройки и состояние
     2. Правила лота (чистая логика, без DOM)
     3. Действия игрока (всё — транзакции Net.update)
     4. Разметка режима
     5. Анимации
     6. Отрисовка
   ========================================================================== */


/* ==========================================================================
   1. НАСТРОЙКИ И СОСТОЯНИЕ
   ========================================================================== */
const AUCTION = {
  BUDGET: 20,            // бюджет каждого игрока, $
  LOTS: 10,              // сколько башен в пуле (= лотов)
  MAX_WON: 5,            // максимум выигранных башен у одного игрока
  DECK_SIZE: 6,          // колода = EDJ + MAX_WON
  FREE_TOWER: 'edj',     // бесплатна для обоих, на аукцион не выставляется
};

function freshAuction() {
  return {
    phase: 'idle',                              // idle -> running -> done
    lots: [],                                   // id башен по порядку лотов
    idx: 0,                                     // номер текущего лота
    bid: { amount: 0, leader: null },           // текущая ставка и лидер
    passed: { blue: false, red: false },        // кто спасовал в ТЕКУЩЕМ лоте
    budget: { blue: AUCTION.BUDGET, red: AUCTION.BUDGET },
    won: { blue: [], red: [] },                 // выигранные башни
    results: [],                                // итоги лотов: {tower, winner, price, how}
  };
}

/* Firebase не хранит пустые массивы и null — возвращаем поля на место */
function normalizeAuction(a) {
  if (!a) return freshAuction();
  a.phase = a.phase || 'idle';
  a.lots = a.lots || [];
  a.idx = a.idx || 0;
  a.bid = a.bid || {};
  a.bid.amount = a.bid.amount || 0;
  a.bid.leader = a.bid.leader || null;
  a.results = a.results || [];
  ['passed', 'budget', 'won'].forEach(k => { a[k] = a[k] || {}; });
  TEAMS.forEach(t => {
    a.passed[t] = !!a.passed[t];
    a.budget[t] = typeof a.budget[t] === 'number' ? a.budget[t] : AUCTION.BUDGET;
    a.won[t] = a.won[t] || [];
  });
  delete a.deck;                                // поля старой версии (выбор колоды) больше не нужны
  delete a.confirmed;
  return a;
}


/* ==========================================================================
   2. ПРАВИЛА ЛОТА (чистая логика)
   ========================================================================== */

/* Может ли игрок сейчас сделать ставку выше текущей */
function aCanBid(a, t) {
  return a.phase === 'running' && a.won[t].length < AUCTION.MAX_WON && a.budget[t] > a.bid.amount;
}
/* Игрок «выбыл» из лота: спасовал или физически не может перебить */
function aOut(a, t) { return a.passed[t] || !aCanBid(a, t); }

/* Колода игрока: бесплатная EDJ + выигранные башни (порядок = порядок получения) */
function aDeck(a, t) { return [AUCTION.FREE_TOWER, ...a.won[t]]; }

/* Начало лота: сброс ставок. Если у одного игрока уже 5 башен — лот сразу уходит
   сопернику бесплатно (соревноваться некому). Иначе проверяем, не решён ли лот сам. */
function auctionBeginLot(a) {
  a.bid = { amount: 0, leader: null };
  a.passed = { blue: false, red: false };
  if (a.idx >= a.lots.length) { a.phase = 'done'; return; }
  const full = TEAMS.filter(t => a.won[t].length >= AUCTION.MAX_WON);
  if (full.length === 1) { auctionAward(a, otherTeam(full[0]), 0, 'auto'); return; }
  auctionResolve(a);
}

/* Лот достаётся игроку: списываем ставку, записываем результат, начинаем следующий */
function auctionAward(a, winner, price, how) {
  const tower = a.lots[a.idx];
  a.budget[winner] -= price;
  a.won[winner].push(tower);
  a.results.push({ tower, winner, price, how });   // how: bid | random | auto
  a.idx += 1;
  auctionBeginLot(a);
}

/* Решён ли лот:
   - есть лидер, а соперник спасовал / не может перебить  -> побеждает лидер
   - ставок нет, а оба выбыли                              -> случайный победитель */
function auctionResolve(a) {
  if (a.phase !== 'running') return;
  const leader = a.bid.leader;
  if (leader) {
    if (aOut(a, otherTeam(leader))) auctionAward(a, leader, a.bid.amount, 'bid');
    return;
  }
  if (TEAMS.every(t => aOut(a, t))) {
    const eligible = TEAMS.filter(t => a.won[t].length < AUCTION.MAX_WON);
    auctionAward(a, eligible[Math.floor(Math.random() * eligible.length)], 0, 'random');
  }
}


/* ==========================================================================
   3. ДЕЙСТВИЯ ИГРОКА
   Каждое действие проверяет владельца команды и выполняется в одной
   транзакции вместе с разрешением лота — оба игрока видят один результат.
   ========================================================================== */
const auctionOwns = (s, team) => s.teams[team].owner === Net.clientId;

function auctionStart() {
  Net.update(s => {
    const a = s.auction;
    if (!myTeam(s) || a.phase !== 'idle') return;
    if (!TEAMS.every(t => seatTaken(s, t))) return;                 // нужны оба игрока
    const pool = PVP_IDS.filter(id => id !== AUCTION.FREE_TOWER);
    Object.assign(a, freshAuction(), {
      phase: 'running',
      lots: shuffled(pool).slice(0, AUCTION.LOTS),
    });
    auctionBeginLot(a);
  });
}

function auctionBid(team, amount) {
  Net.update(s => {
    const a = s.auction;
    if (!auctionOwns(s, team) || a.phase !== 'running' || a.passed[team]) return;
    if (a.bid.leader === team) return;                              // себя перебивать нельзя
    if (!Number.isInteger(amount) || amount <= a.bid.amount) return;
    if (amount > a.budget[team] || a.won[team].length >= AUCTION.MAX_WON) return;
    a.bid = { amount, leader: team };
    auctionResolve(a);
  });
}

function auctionPass(team) {
  Net.update(s => {
    const a = s.auction;
    if (!auctionOwns(s, team) || a.phase !== 'running' || a.passed[team]) return;
    if (a.bid.leader === team) return;                              // лидеру пасс не нужен
    a.passed[team] = true;
    auctionResolve(a);
  });
}

/* Проверка поля ввода (с понятными сообщениями) и отправка ставки */
function auctionSubmitBid(team) {
  const s = Net.get(), a = s.auction, u = ui[team];
  const raw = u.input.value.trim();
  if (!/^\d+$/.test(raw)) { toast('Введите целое число, например 5'); return; }
  const amount = Number(raw);
  if (amount <= a.bid.amount) { toast(`Ставка должна быть больше текущей ($${a.bid.amount})`); return; }
  if (amount > a.budget[team]) { toast(`Не больше вашего бюджета ($${a.budget[team]})`); return; }
  auctionBid(team, amount);
}


/* ==========================================================================
   4. РАЗМЕТКА РЕЖИМА
   ========================================================================== */
const auctionUI = { band: null };

/* Состояние анимаций: что было показано в прошлый раз. Пока ready=false (первая
   отрисовка после входа/смены режима) ничего не анимируем — только показываем. */
const auctionAnim = { ready: false, phase: null, idx: null, resLen: 0, bidKey: '0:null', fly: null, budget: {} };

function buildAuctionLayout(ws) {
  Object.assign(auctionAnim, { ready: false, phase: null, idx: null, resLen: 0, bidKey: '0:null', fly: null, budget: {} });

  // --- крупная зона лота: на всю ширину над обеими половинами ---
  const band = el('section', 'lot-band lot-band--none');
  const left = el('div', 'lot-side lot-side--left');
  const center = el('div', 'lot-center');
  const right = el('div', 'lot-side lot-side--right');
  const strip = el('div', 'lot-strip');
  band.append(left, center, right, strip);
  ws.appendChild(band);
  auctionUI.band = { root: band, left, center, right, strip };

  // --- две половины из шаблона ---
  const tpl = document.getElementById('auction-half-template');
  TEAMS.forEach(team => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.classList.add('half--' + team);
    node.querySelector('.team-name').textContent = TEAM_LABEL[team];
    node.querySelector('.bid-title').textContent = 'СТАВКА ' + TEAM_LABEL[team].toUpperCase();
    ws.appendChild(node);
    const q = sel => node.querySelector(sel);
    ui[team] = {
      root: node,
      status: q('.seat-status'), claim: q('.btn--claim'), leave: q('.btn--leave'),
      budget: q('.budget-value'), budgetChip: q('.budget-chip'),
      input: q('.bid-input'), bid: q('.btn--bid'), pass: q('.btn--pass'), hint: q('.bid-hint'),
      deck: q('.deck'), deckCount: q('.deck-count'),
    };
    const u = ui[team];
    u.claim.onclick = () => claimTeam(team);
    u.leave.onclick = () => releaseTeam(team);
    u.bid.onclick = () => auctionSubmitBid(team);
    u.pass.onclick = () => auctionPass(team);
    u.input.onkeydown = e => { if (e.key === 'Enter') auctionSubmitBid(team); };
  });
}


/* ==========================================================================
   5. АНИМАЦИИ (лёгкие; цвет зависит от команды; уважают prefers-reduced-motion)
   ========================================================================== */
const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* Башня «улетает» из зоны лота в колоду победителя */
function flyTower(r, rect, target, team) {
  if (!rect || !rect.width || !target || reducedMotion()) return;
  const tr = target.getBoundingClientRect();
  if (!tr.width) return;
  const size = rect.width;
  const clone = iconEl(r.tower, size);
  clone.classList.add('fly-icon', 'fly-icon--' + team);
  Object.assign(clone.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', margin: '0' });
  document.body.appendChild(clone);

  const dx = tr.left + Math.min(40, tr.width / 2) - (rect.left + size / 2);   // центр иконки в карточке
  const dy = tr.top + tr.height / 2 - (rect.top + size / 2);
  target.style.opacity = '0';                                                   // карточка появится после приземления

  const land = () => {
    clone.remove();
    target.style.opacity = '';
    target.classList.add('card--land', 'card--land-' + team);
  };
  clone.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
    { transform: `translate(${dx * 0.12}px, ${dy * 0.12 - 36}px) scale(1.12)`, opacity: 1, offset: 0.22 },
    { transform: `translate(${dx}px, ${dy}px) scale(${Math.max(0.2, 44 / size)})`, opacity: 0.95, offset: 1 },
  ], { duration: 780, easing: 'cubic-bezier(.55,0,.2,1)', fill: 'forwards' }).finished.then(land, land);
}

/* Вызывается после отрисовки обеих половин: нужная карточка в колоде уже существует */
function flushAuctionAnim(a) {
  const an = auctionAnim, fly = an.fly;
  an.fly = null;
  if (!fly) return;
  const w = fly.r.winner;
  const pos = a.won[w].indexOf(fly.r.tower);
  if (pos >= 0) flyTower(fly.r, fly.rect, ui[w].deck.children[1 + pos], w);
}


/* ==========================================================================
   6. ОТРИСОВКА
   ========================================================================== */
function renderAuction(s, me) {
  const a = s.auction;
  renderLotBand(s, a, me);
  TEAMS.forEach(t => renderAuctionTeam(t, s, a, me));
  flushAuctionAnim(a);
  auctionAnim.ready = true;
}

const priceText = r => (r.how === 'bid' ? '$' + r.price : r.how === 'random' ? 'жребий' : 'бесплатно');

function teamSpan(team) {
  return el('span', 'team-' + team, TEAM_LABEL[team]);
}

/* ---- Зона лота ---- */
function renderLotBand(s, a, me) {
  const b = auctionUI.band, an = auctionAnim;
  const bothSeated = TEAMS.every(t => seatTaken(s, t));
  const leader = a.phase === 'running' && a.bid.leader ? a.bid.leader : 'none';
  b.root.className = 'lot-band lot-band--' + leader;

  renderIfChanged('lotband', [a.phase, a.idx, a.bid, a.lots, a.results, a.budget, bothSeated, !!me], () => {
    // --- что изменилось с прошлой отрисовки (для анимаций) ---
    const running = a.phase === 'running';
    const bidKey = a.bid.amount + ':' + a.bid.leader;
    const newLot = an.ready && running && (an.phase !== 'running' || an.idx !== a.idx);
    const bump = an.ready && running && !newLot && a.bid.leader && bidKey !== an.bidKey ? a.bid.leader : null;
    an.fly = null;
    if (an.ready && a.results.length > an.resLen) {
      const icon = b.center.querySelector('.lot-tower .tower-icon');          // позиция ушедшего лота (ещё в DOM)
      if (icon) an.fly = { r: a.results[an.resLen], rect: icon.getBoundingClientRect() };
    }
    const delay = an.fly ? 520 : 0;                                            // новая башня появляется после «улёта» прежней
    Object.assign(an, { phase: a.phase, idx: a.idx, resLen: a.results.length, bidKey });

    b.left.replaceChildren();
    b.center.replaceChildren();
    b.right.replaceChildren();
    b.strip.replaceChildren();

    // левая колонка: номер лота
    b.left.appendChild(el('div', 'lot-counter',
      a.phase === 'running' ? `ЛОТ ${a.idx + 1} / ${a.lots.length}` : a.phase === 'done' ? 'ИТОГИ' : 'АУКЦИОН'));

    // правая колонка: результат прошлого лота (в процессе) / правила / остатки
    const last = a.results[a.results.length - 1];
    if (a.phase === 'idle') {
      const rules = el('ul', 'lot-rules');
      [`Бюджет: $${AUCTION.BUDGET} у каждого`,
       `${AUCTION.LOTS} лотов — по одной башне`,
       `Максимум ${AUCTION.MAX_WON} башен на игрока`,
       'EDJ бесплатна для обоих — колода готова сразу',
       'Оба пасс — победитель случайно'].forEach(t => rules.appendChild(el('li', '', t)));
      b.right.appendChild(rules);
    } else if (last) {
      const line = el('div', 'lot-last');
      line.append(el('div', 'lot-last-label', 'ПРОШЛЫЙ ЛОТ'));
      const row = el('div', 'lot-last-row');
      row.append(el('b', '', towerName(last.tower)), ' → ', teamSpan(last.winner), ' · ' + priceText(last));
      line.append(row);
      b.right.appendChild(line);
    }

    // центр
    if (a.phase === 'idle') {
      const btn = el('button', 'btn btn--start', 'НАЧАТЬ АУКЦИОН');
      btn.disabled = !(me && bothSeated);
      btn.onclick = auctionStart;
      b.center.append(btn, el('div', 'lot-sub',
        !me ? 'Займите команду (Blue или Red)' : !bothSeated ? 'Ждём второго игрока…' : 'Оба игрока на местах'));
    } else if (running) {
      const id = a.lots[a.idx];
      const stage = el('div', 'lot-stage');

      const tower = el('div', 'lot-tower' + (newLot ? ' lot-tower--in' : ''));
      tower.style.animationDelay = delay + 'ms';
      tower.append(iconEl(id, Math.round(Math.min(150, Math.max(90, window.innerHeight * 0.13)))),
        el('div', 'lot-name', towerName(id)));

      // цена — рядом с башней, в центре зоны лота
      const box = el('div', 'lot-pricebox');
      box.append(el('div', 'lot-price-label', 'ТЕКУЩАЯ ЦЕНА'));
      const val = el('div', 'lot-price-value' + (bump ? ` price-bump price-bump--${bump}` : ''), '$' + a.bid.amount);
      if (!bump && a.bid.leader) val.classList.add('lot-price-value--' + a.bid.leader);
      box.append(val);
      if (bump) box.append(el('span', 'bid-ripple bid-ripple--' + bump));
      const lead = el('div', 'lot-leader' + (bump ? ' lot-leader--in lot-leader--in-' + bump : ''));
      if (a.bid.leader) lead.append('Лидер: ', teamSpan(a.bid.leader));
      else lead.textContent = 'Ставок пока нет';
      box.append(lead);

      stage.append(tower, box);
      b.center.appendChild(stage);
    } else {
      b.center.append(el('div', 'lot-name lot-name--done', 'АУКЦИОН ЗАВЕРШЁН'),
        el('div', 'lot-sub', 'Колоды готовы: EDJ + выигранные башни'));
      const rest = el('div', 'lot-leader lot-leader--rest');
      rest.append('Остаток: ', teamSpan('blue'), ` $${a.budget.blue} · `, teamSpan('red'), ` $${a.budget.red}`);
      b.center.appendChild(rest);
    }

    // лента лотов
    for (let i = 0; i < AUCTION.LOTS; i++) {
      const r = a.results[i];
      const isCur = running && i === a.idx;
      const chip = el('div', 'lot-chip' + (r ? ' lot-chip--' + r.winner : '') + (isCur ? ' lot-chip--current' : ''));
      if (r) {
        chip.append(iconEl(r.tower, 26));
        const t = el('div', 'lot-chip-text');
        t.append(el('div', 'lot-chip-name', towerName(r.tower)), el('div', 'lot-chip-price', priceText(r)));
        chip.append(t);
        chip.title = `${towerName(r.tower)} → ${TEAM_LABEL[r.winner]} (${priceText(r)})`;
        if (an.ready && i >= a.results.length - 1 && i === a.results.length - 1) chip.classList.add('lot-chip--new', 'lot-chip--new-' + r.winner);
      } else {
        chip.append(el('div', 'lot-chip-q', isCur ? '●' : '?'), el('div', 'lot-chip-num', String(i + 1)));
      }
      b.strip.appendChild(chip);
    }
  });
}

/* ---- Половина команды ---- */
function renderAuctionTeam(team, s, a, me) {
  const u = ui[team], an = auctionAnim;
  const mine = me === team;
  const running = a.phase === 'running', done = a.phase === 'done';

  // место
  renderSeat(u, team, s, me);

  // бюджет (при изменении коротко вспыхивает)
  const budgetText = '$' + a.budget[team];
  if (u.budget.textContent !== budgetText) {
    u.budget.textContent = budgetText;
    if (an.ready && !reducedMotion()) {
      u.budgetChip.classList.remove('budget-chip--hit');
      void u.budgetChip.offsetWidth;                                 // перезапуск CSS-анимации
      u.budgetChip.classList.add('budget-chip--hit');
    }
  }

  // панель ставки
  const lead = a.bid.leader === team;
  const ctrl = mine && running && !a.passed[team] && !lead;          // можно действовать
  const can = ctrl && aCanBid(a, team);                              // можно перебить
  u.input.disabled = !can;
  u.bid.disabled = !can;
  u.pass.disabled = !ctrl;
  u.input.max = a.budget[team];
  u.root.classList.toggle('half--leading', running && lead);        // подсветка панели лидера

  const key = [a.phase, a.idx, a.bid.amount, a.bid.leader, can].join(':');
  if (u.lotKey !== key) {                                            // предлагаем минимальную ставку
    u.lotKey = key;
    u.input.value = can ? a.bid.amount + 1 : '';
  }

  let hint;
  if (a.phase === 'idle') hint = 'Аукцион ещё не начат';
  else if (done) hint = 'Аукцион завершён';
  else if (a.won[team].length >= AUCTION.MAX_WON) hint = `Уже ${AUCTION.MAX_WON} башен — лоты уходят сопернику`;
  else if (a.passed[team]) hint = 'Спасовал в этом лоте';
  else if (lead) hint = mine ? 'Ваша ставка лидирует — ждём соперника' : `Лидирует: $${a.bid.amount}`;
  else if (!aCanBid(a, team)) hint = `Бюджет $${a.budget[team]} не позволяет перебить $${a.bid.amount}`;
  else if (mine) hint = `От $${a.bid.amount + 1} до $${a.budget[team]}`;
  else hint = 'Выбирает…';
  u.hint.textContent = hint;

  // колода: EDJ + выигранные башни, шесть мест
  const deck = aDeck(a, team);
  renderIfChanged(team + 'adeck', [deck, a.phase], () => {
    u.deck.replaceChildren();
    u.deckCount.textContent = `${deck.length}/${AUCTION.DECK_SIZE}` + (done ? ' · готова' : '');
    for (let i = 0; i < AUCTION.DECK_SIZE; i++) {
      const id = deck[i];
      if (!id) { u.deck.appendChild(el('div', 'card card--empty', '—')); continue; }
      const c = el('div', 'card card--in-deck');
      c.append(iconEl(id, 44), el('span', 'card-name', towerName(id)));
      if (id === AUCTION.FREE_TOWER) c.appendChild(el('span', 'badge badge--free', 'FREE'));
      u.deck.appendChild(c);
    }
  });
}
