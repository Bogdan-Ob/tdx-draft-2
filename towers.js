'use strict';

/* ==========================================================================
   towers.js — ЕДИНЫЙ список башен.
   Источник названий: https://tdx.fandom.com/wiki/Towers (+ Category:Towers).
   Названия написаны ровно так, как на вики (например "Golden Mine Layer").

   status:
     'pvp'    — разрешена в PvP (попадает во ВСЕ режимы через PVP_TOWERS)
     'event'  — Event Tower (в PvP запрещены, кроме Commando)
     'banned' — явно запрещена правилами PvP

   ЧТОБЫ ИЗМЕНИТЬ ПРАВИЛА PvP — правьте только status здесь.
   ========================================================================== */

const TOWER_LIST = [
  // ---------- Разрешённые в PvP ----------
  { name: 'AA Turret',          status: 'pvp' },
  { name: 'Armored Factory',    status: 'pvp' },
  { name: 'Artillery',          status: 'pvp' },
  { name: 'Barracks',           status: 'pvp' },
  { name: 'Behemoth Factory',   status: 'pvp' },
  { name: 'Commander',          status: 'pvp' },
  { name: 'Commando',           status: 'pvp' },   // Event-башня, но разрешена правилами PvP
  { name: 'Cryo Blaster',       status: 'pvp' },
  { name: 'EDJ',                status: 'pvp' },
  { name: 'Farm',               status: 'pvp' },
  { name: 'Ghost (Tower)',      status: 'pvp' },
  { name: 'Golden Juggernaut',  status: 'pvp' },
  { name: 'Golden Ranger',      status: 'pvp' },
  { name: 'Grenadier',          status: 'pvp' },
  { name: 'Helicopter',         status: 'pvp' },
  { name: 'Jet Trooper',        status: 'pvp' },
  { name: 'John',               status: 'pvp' },
  { name: 'Juggernaut',         status: 'pvp' },
  { name: 'Laser Gunner',       status: 'pvp' },
  { name: 'Machine Gunner',     status: 'pvp' },
  { name: 'Medic',              status: 'pvp' },
  { name: 'Mine Layer',         status: 'pvp' },
  { name: 'Missile Trooper',    status: 'pvp' },
  { name: 'MLRS',               status: 'pvp' },
  { name: 'Mobster',            status: 'pvp' },
  { name: 'Noob Tuber',         status: 'pvp' },
  { name: 'Operator',           status: 'pvp' },
  { name: 'Patrol Boat',        status: 'pvp' },
  { name: 'Railgunner',         status: 'pvp' },
  { name: 'Ranger',             status: 'pvp' },
  { name: 'Refractor',          status: 'pvp' },
  { name: 'Scout Helicopter',   status: 'pvp' },
  { name: 'Sentry',             status: 'pvp' },
  { name: 'Shield Tower',       status: 'pvp' },
  { name: 'Shotgunner',         status: 'pvp' },
  { name: 'Slammer',            status: 'pvp' },
  { name: 'Sniper',             status: 'pvp' },
  { name: 'Toxicnator',         status: 'pvp' },
  { name: 'War Machine Factory',status: 'pvp' },
  { name: 'Warship',            status: 'pvp' },
  { name: 'XWM Turret',         status: 'pvp' },

  // ---------- Явно запрещены правилами ----------
  { name: 'Combat Medic',       status: 'banned' },
  { name: 'Golden Mine Layer',  status: 'banned' },  // "Golden Minelayer" в правилах
  { name: 'Combat Drone',       status: 'banned' },
  { name: 'Golden Mobster',     status: 'banned' },
  { name: 'Oil Derrick',        status: 'banned' },

  // ---------- Event Towers (запрещены; Commando вынесена выше как исключение) ----------
  { name: 'Chicken House',      status: 'event' },
  { name: 'Cryo Helicopter',    status: 'event' },
  { name: 'Cryo Mortar',        status: 'event' },
  { name: 'Cryo Ranger',        status: 'event' },
  { name: 'Flame Trooper',      status: 'event' },
  { name: 'Goo Gunner',         status: 'event' },
  { name: 'Ice Breaker',        status: 'event' },
  { name: 'Psycho Slayer',      status: 'event' },
  { name: 'Relic',              status: 'event' },
  { name: 'Scarecrow',          status: 'event' },
  { name: 'Scout',              status: 'event' },
  { name: 'Shock Trooper',      status: 'event' },
  { name: 'Shotgunner (Legacy)',status: 'event' },
  { name: 'Troll Tower',        status: 'event' },
  { name: 'Z.E.D.',             status: 'event' },
];

/* Генерация id из названия: "Golden Ranger" -> "golden-ranger" */
function towerSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const TOWERS = TOWER_LIST.map(t => ({ ...t, id: towerSlug(t.name) }));
const TOWER_BY_ID = Object.fromEntries(TOWERS.map(t => [t.id, t]));

/* ЕДИНЫЙ список разрешённых PvP-башен: используют все режимы */
const PVP_TOWERS = TOWERS.filter(t => t.status === 'pvp');
const PVP_IDS = PVP_TOWERS.map(t => t.id);

/* --- Иконки: пока цветной бейдж с инициалами. Заменить на картинки — тут. --- */
function towerInitials(name) {
  const words = name.replace(/[()]/g, '').split(/[\s.]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function towerColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 38%)`;
}

if (typeof module !== 'undefined') module.exports = { TOWERS, TOWER_BY_ID, PVP_TOWERS, PVP_IDS };
