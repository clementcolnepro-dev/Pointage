/*
 * Moteur de calcul — Pointage
 * ---------------------------------------------------------------
 * Toutes les heures sont manipulées en MINUTES (entiers).
 *
 * Un pointage est stocké sous la forme { id, t, type } où :
 *   - t    = minutes "horloge murale" depuis le 01/01/1970 (sans fuseau),
 *            ex. 06/10/2026 08:02 -> un entier. Cela permet de faire des
 *            soustractions directes et de gérer le passage de minuit.
 *   - type = 'in' (Début) ou 'out' (Fin).
 *
 * Les pointages sont triés chronologiquement puis appariés Début -> Fin.
 * Une période appartient au jour de son pointage de Début (une période
 * 22:00 -> 01:30 compte donc pour la veille).
 * ---------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var DAY = 1440;            // minutes dans une journée
  var MAX_SHIFT = 20 * 60;   // au-delà de 20 h, un Début sans Fin est considéré oublié

  var DEFAULT_SETTINGS = {
    workMinutes: 420,        // 7h00 de travail effectif
    morningBreak: 15,        // pause du matin (min)
    breakMode: 'deducted',   // 'deducted' : pause déduite du temps de présence
                             // 'worked'   : pause comptée comme temps de travail
    weekStart: 1,            // 1 = lundi (0 = dimanche)
    resetDate: '',           // 'AAAA-MM-JJ' : le cumul repart de cette date
    initialBalance: 0        // solde de départ (min) à cette date
  };

  var STATUSES = {
    work:    { label: 'Travail',  short: '' },
    conge:   { label: 'Congé',    short: 'Congé' },
    ferie:   { label: 'Férié',    short: 'Férié' },
    absence: { label: 'Absence',  short: 'Absence' },
    repos:   { label: 'Repos',    short: 'Repos' }
  };

  /* ---------- dates & formats ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // 'AAAA-MM-JJ' + minutes dans la journée -> minutes murales
  function toWall(dateStr, minOfDay) {
    var p = dateStr.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]) / 60000 + (minOfDay || 0);
  }

  // Date JS (heure locale du téléphone) -> minutes murales
  function wallFromDate(d) {
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60000;
  }

  function wallDate(w) {
    var d = new Date(Math.floor(w / DAY) * DAY * 60000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function wallMinOfDay(w) { return ((w % DAY) + DAY) % DAY; }

  function addDays(dateStr, n) { return wallDate(toWall(dateStr) + n * DAY); }

  function dayDiff(a, b) { return (toWall(b) - toWall(a)) / DAY; }

  // 0 = dimanche ... 6 = samedi
  function weekday(dateStr) { return new Date(toWall(dateStr) * 60000).getUTCDay(); }

  function weekStartOf(dateStr, firstDay) {
    var back = (weekday(dateStr) - firstDay + 7) % 7;
    return addDays(dateStr, -back);
  }

  // "08:05" -> 485 ; renvoie NaN si invalide
  function parseHM(s) {
    var m = /^\s*(\d{1,2})\s*[:hH]\s*(\d{2})\s*$/.exec(String(s));
    if (!m) return NaN;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return NaN;
    return h * 60 + mi;
  }

  // heure d'horloge : 485 -> "08:05"
  function fmtClock(minOfDay) {
    var m = wallMinOfDay(Math.round(minOfDay));
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  // durée : 437 -> "07h17"
  function fmtDur(min) {
    var a = Math.abs(Math.round(min));
    return pad(Math.floor(a / 60)) + 'h' + pad(a % 60);
  }

  // solde signé : 17 -> "+00h17" ; -20 -> "-00h20"
  function fmtSigned(min) {
    var r = Math.round(min);
    return (r < 0 ? '-' : '+') + fmtDur(r);
  }

  /* ---------- appariement des pointages ---------- */

  function sortPunches(punches) {
    return punches.slice().sort(function (a, b) {
      if (a.t !== b.t) return a.t - b.t;
      if (a.type !== b.type) return a.type === 'out' ? -1 : 1; // même minute : Fin avant Début
      return String(a.id).localeCompare(String(b.id));
    });
  }

  /**
   * nowWall : minutes murales actuelles (pour savoir si une période est en cours)
   * Renvoie { intervals, orphans, open }
   *   intervals : [{ date, start, end, minutes }]
   *   orphans   : pointages qu'on ne peut pas apparier (oubli)
   *   open      : Début en cours (période non terminée, < 20 h) ou null
   */
  function pair(punches, nowWall) {
    var sorted = sortPunches(punches);
    var intervals = [], orphans = [], open = null;

    sorted.forEach(function (p) {
      if (p.type === 'in') {
        if (open) orphans.push(open);
        open = p;
      } else {
        if (open && p.t - open.t <= MAX_SHIFT) {
          intervals.push({ date: wallDate(open.t), start: open, end: p, minutes: p.t - open.t });
        } else {
          if (open) orphans.push(open);
          orphans.push(p);
        }
        open = null;
      }
    });

    if (open && (nowWall == null || nowWall - open.t > MAX_SHIFT || nowWall < open.t)) {
      orphans.push(open);
      open = null;
    }
    return { intervals: intervals, orphans: orphans, open: open };
  }

  /* ---------- calcul d'une journée ---------- */

  function dayStatus(data, date) {
    var meta = data.days && data.days[date];
    return (meta && STATUSES[meta.status]) ? meta.status : 'work';
  }

  /**
   * Calcule une journée.
   * Renvoie (toutes valeurs en minutes) :
   *   punchMinutes : somme des périodes pointées (présence effective)
   *   breakDeducted: pause du matin déduite
   *   worked       : temps réellement travaillé
   *   objective    : objectif de travail (0 si congé/férié/...)
   *   presenceTarget: présence nécessaire (objectif + pause)
   *   balance      : worked - objective
   *   firstIn / lastOut, lunch (pauses entre périodes)
   *   running, incomplete, counted
   */
  function computeDay(date, data, pairing, nowWall) {
    var s = data.settings;
    var status = dayStatus(data, date);
    var isWork = status === 'work';

    var ivs = pairing.intervals.filter(function (iv) { return iv.date === date; });
    var orphans = pairing.orphans.filter(function (p) { return wallDate(p.t) === date; });
    var running = !!(pairing.open && wallDate(pairing.open.t) === date);

    var punchMinutes = 0;
    ivs.forEach(function (iv) { punchMinutes += iv.minutes; });
    if (running) punchMinutes += Math.max(0, nowWall - pairing.open.t);

    var firstIn = null, lastOut = null;
    if (ivs.length) { firstIn = ivs[0].start.t; lastOut = ivs[ivs.length - 1].end.t; }
    if (running) { if (firstIn === null) firstIn = pairing.open.t; lastOut = null; }

    var span = (firstIn !== null) ? ((running ? nowWall : lastOut) - firstIn) : 0;
    var lunch = Math.max(0, span - punchMinutes);

    var deduct = (isWork && s.breakMode === 'deducted' && punchMinutes > 0)
      ? Math.min(s.morningBreak, punchMinutes) : 0;

    var worked = punchMinutes - deduct;
    var objective = isWork ? s.workMinutes : 0;
    var presenceTarget = isWork ? s.workMinutes + (s.breakMode === 'deducted' ? s.morningBreak : 0) : 0;
    var counted = ivs.length > 0 || orphans.length > 0 || running || !isWork;

    // heure de sortie pour atteindre l'objectif (si période en cours)
    var endAt = null;
    if (running && isWork) {
      var remaining = presenceTarget - punchMinutes;
      endAt = nowWall + Math.max(0, remaining);
    }

    return {
      date: date, status: status, intervals: ivs, orphans: orphans, running: running,
      openPunch: running ? pairing.open : null,
      punchMinutes: punchMinutes, breakDeducted: deduct, worked: worked,
      objective: objective, presenceTarget: presenceTarget,
      balance: counted ? worked - objective : 0,
      firstIn: firstIn, lastOut: lastOut, lunch: lunch,
      incomplete: orphans.length > 0, counted: counted, endAt: endAt
    };
  }

  /* ---------- toutes les journées / semaine / cumul ---------- */

  function allDates(data, pairing) {
    var set = {};
    pairing.intervals.forEach(function (iv) { set[iv.date] = 1; });
    pairing.orphans.forEach(function (p) { set[wallDate(p.t)] = 1; });
    if (pairing.open) set[wallDate(pairing.open.t)] = 1;
    Object.keys(data.days || {}).forEach(function (d) {
      if (dayStatus(data, d) !== 'work') set[d] = 1;
    });
    return Object.keys(set).sort();
  }

  function computeAll(data, nowWall) {
    var pairing = pair(data.punches, nowWall);
    var dates = allDates(data, pairing);
    var byDate = {};
    dates.forEach(function (d) { byDate[d] = computeDay(d, data, pairing, nowWall); });
    return {
      pairing: pairing, dates: dates, byDate: byDate,
      day: function (d) { return byDate[d] || computeDay(d, data, pairing, nowWall); }
    };
  }

  function computeWeek(all, data, anyDateInWeek) {
    var start = weekStartOf(anyDateInWeek, data.settings.weekStart);
    var days = [], total = 0, worked = 0;
    for (var i = 0; i < 7; i++) {
      var d = addDays(start, i);
      var c = all.day(d);
      days.push(c);
      if (c.counted) { total += c.balance; worked += c.worked; }
    }
    return { start: start, end: addDays(start, 6), days: days, total: total, worked: worked };
  }

  // Cumul : solde de départ + somme des soldes depuis la date de remise à zéro.
  // beforeDate (optionnel) : exclut ce jour et les suivants.
  function computeCumul(all, data, beforeDate) {
    var s = data.settings, total = s.initialBalance || 0;
    all.dates.forEach(function (d) {
      if (s.resetDate && d < s.resetDate) return;
      if (beforeDate && d >= beforeDate) return;
      total += all.byDate[d].balance;
    });
    return total;
  }

  // Type du prochain pointage du gros bouton
  function nextType(data, nowWall) {
    return pair(data.punches, nowWall).open ? 'out' : 'in';
  }

  /* ---------- validation des données (import) ---------- */

  function normalizeData(raw) {
    var data = { version: 1, punches: [], days: {}, settings: {} };
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.punches)) {
        raw.punches.forEach(function (p) {
          if (p && Number.isFinite(p.t) && (p.type === 'in' || p.type === 'out')) {
            data.punches.push({ id: String(p.id || ('p' + p.t + Math.random().toString(36).slice(2, 7))), t: Math.round(p.t), type: p.type });
          }
        });
      }
      if (raw.days && typeof raw.days === 'object') {
        Object.keys(raw.days).forEach(function (d) {
          var m = raw.days[d];
          if (isDateStr(d) && m && STATUSES[m.status]) data.days[d] = { status: m.status };
        });
      }
    }
    var rs = (raw && raw.settings) || {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      var def = DEFAULT_SETTINGS[k], v = rs[k];
      if (typeof def === 'number') data.settings[k] = Number.isFinite(v) ? Math.round(v) : def;
      else data.settings[k] = (typeof v === 'string') ? v : def;
    });
    if (data.settings.breakMode !== 'worked') data.settings.breakMode = 'deducted';
    if (data.settings.weekStart < 0 || data.settings.weekStart > 6) data.settings.weekStart = 1;
    if (data.settings.resetDate && !isDateStr(data.settings.resetDate)) data.settings.resetDate = '';
    return data;
  }

  var api = {
    DAY: DAY, MAX_SHIFT: MAX_SHIFT, DEFAULT_SETTINGS: DEFAULT_SETTINGS, STATUSES: STATUSES,
    pad: pad, toWall: toWall, wallFromDate: wallFromDate, wallDate: wallDate, wallMinOfDay: wallMinOfDay,
    addDays: addDays, dayDiff: dayDiff, weekday: weekday, weekStartOf: weekStartOf,
    parseHM: parseHM, fmtClock: fmtClock, fmtDur: fmtDur, fmtSigned: fmtSigned,
    sortPunches: sortPunches, pair: pair, computeDay: computeDay, computeAll: computeAll,
    computeWeek: computeWeek, computeCumul: computeCumul, nextType: nextType,
    normalizeData: normalizeData, isDateStr: isDateStr
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
