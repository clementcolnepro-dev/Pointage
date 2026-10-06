/* Pointage — interface (vanilla JS, aucune dépendance) */
(function () {
  'use strict';
  var C = window.Calc;
  var KEY = 'pointage.v1';

  /* ================= Stockage local ================= */

  function load() {
    try { return C.normalizeData(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (e) { return C.normalizeData(null); }
  }
  function save() {
    data.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  var data = load();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  function nowWall() { return C.wallFromDate(new Date()); }
  function today() { return C.wallDate(nowWall()); }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ================= Utilitaires d'affichage ================= */

  var $view = document.getElementById('view');
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function dateLabel(d, opts) {
    return new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: 'UTC' }, opts))
      .format(new Date(C.toWall(d) * 60000));
  }
  function longDate(d) { return dateLabel(d, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function shortDM(d) { return d.slice(8, 10) + '/' + d.slice(5, 7); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function clock(w) { return C.fmtClock(C.wallMinOfDay(w)); }
  function sign(min) {
    var cls = min > 0 ? 'pos' : (min < 0 ? 'neg' : 'zero');
    return '<span class="' + cls + '">' + C.fmtSigned(min) + '</span>';
  }
  function typeLabel(t) { return t === 'in' ? 'Début' : 'Fin'; }
  function statusLabel(s) { return C.STATUSES[s].label; }

  // affiche un pointage ; marque "+1j" si sur un autre jour que la journée
  function punchTime(p, dayDate) {
    var pd = C.wallDate(p.t), extra = '';
    if (pd !== dayDate) extra = ' <small>(' + (pd > dayDate ? '+' : '') + C.dayDiff(dayDate, pd) + 'j)</small>';
    return clock(p.t) + extra;
  }

  // pointages d'une journée (périodes + orphelins + en cours), triés
  function dayPunches(c) {
    var list = [];
    c.intervals.forEach(function (iv) { list.push(iv.start, iv.end); });
    c.orphans.forEach(function (p) { list.push(Object.assign({ orphan: true }, p)); });
    if (c.openPunch) list.push(c.openPunch);
    return C.sortPunches(list);
  }

  function toast(html, ms) {
    var t = document.getElementById('toast');
    t.innerHTML = html; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, ms || 3000);
    return t;
  }

  /* ================= Pointer ================= */

  var lastTap = 0;
  function punchNow() {
    var t = Date.now();
    if (t - lastTap < 2000) return;             // anti double-appui
    lastTap = t;
    var w = nowWall();
    var type = C.nextType(data, w);
    var p = { id: uid(), t: w, type: type };
    data.punches.push(p);
    save();
    if (navigator.vibrate) navigator.vibrate(40);
    render();
    var el = toast('<b>' + clock(w) + '</b> — ' + typeLabel(type) + ' enregistré <button class="link" id="undo">Annuler</button>', 6000);
    el.querySelector('#undo').onclick = function () {
      data.punches = data.punches.filter(function (x) { return x.id !== p.id; });
      save(); render(); el.hidden = true;
    };
  }

  /* ================= Dialogue ajout / modification ================= */

  var dlg = document.getElementById('punchDialog');
  var form = document.getElementById('punchForm');
  var editing = null;

  function openPunchDialog(punch, defaultDate) {
    editing = punch || null;
    document.getElementById('punchTitle').textContent = punch ? 'Modifier le pointage' : 'Ajouter un pointage';
    document.getElementById('punchDelete').hidden = !punch;
    if (punch) {
      form.date.value = C.wallDate(punch.t);
      form.time.value = clock(punch.t);
      form.type.value = punch.type;
    } else {
      var d = defaultDate || today();
      form.date.value = d;
      form.time.value = d === today() ? clock(nowWall()) : '08:00';
      // type proposé : l'inverse du dernier pointage de la journée
      var c = C.computeAll(data, nowWall()).day(d);
      var list = dayPunches(c);
      form.type.value = (list.length && list[list.length - 1].type === 'in') ? 'out' : 'in';
    }
    dlg.showModal();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var m = C.parseHM(form.time.value);
    if (!C.isDateStr(form.date.value) || Number.isNaN(m)) { alert('Date ou heure invalide'); return; }
    var t = C.toWall(form.date.value, m);
    if (editing) {
      var p = data.punches.find(function (x) { return x.id === editing.id; });
      if (p) { p.t = t; p.type = form.type.value; }
    } else {
      data.punches.push({ id: uid(), t: t, type: form.type.value });
    }
    save(); dlg.close(); render();
  });
  document.getElementById('punchCancel').onclick = function () { dlg.close(); };
  document.getElementById('punchDelete').onclick = function () {
    if (!editing || !confirm('Supprimer ce pointage ?')) return;
    data.punches = data.punches.filter(function (x) { return x.id !== editing.id; });
    save(); dlg.close(); render();
  };

  /* ================= Blocs communs ================= */

  function punchListHTML(c) {
    var list = dayPunches(c);
    if (!list.length) return '<p class="muted">Aucun pointage.</p>';
    return '<ul class="punches">' + list.map(function (p) {
      return '<li><button class="punch" data-edit="' + esc(p.id) + '">' +
        '<span class="time">' + punchTime(p, c.date) + '</span>' +
        '<span class="tag ' + p.type + '">' + typeLabel(p.type) + '</span>' +
        (p.orphan ? '<span class="warn">⚠ non apparié</span>' : '') +
        (c.openPunch && p.id === c.openPunch.id ? '<span class="live">en cours</span>' : '') +
        '<span class="chev">›</span></button></li>';
    }).join('') + '</ul>';
  }

  function detailHTML(c) {
    var s = data.settings, rows = [];
    if (c.firstIn !== null) {
      rows.push(['Présence', clock(c.firstIn) + ' → ' + (c.running ? 'en cours' : clock(c.lastOut))]);
      rows.push(['Temps pointé', C.fmtDur(c.punchMinutes)]);
      if (c.lunch) rows.push(['Pause midi', C.fmtDur(c.lunch)]);
    }
    if (c.status === 'work') {
      if (s.breakMode === 'deducted') rows.push(['Pause du matin (déduite)', c.breakDeducted ? '−' + C.fmtDur(c.breakDeducted) : '—']);
      rows.push(['Temps travaillé', '<b>' + C.fmtDur(c.worked) + '</b>']);
      rows.push(['Objectif', C.fmtDur(c.objective) + ' <small>(présence ' + C.fmtDur(c.presenceTarget) + ')</small>']);
    } else {
      rows.push(['Journée', statusLabel(c.status) + ' — pas d\'objectif']);
      if (c.worked) rows.push(['Temps travaillé', C.fmtDur(c.worked)]);
    }
    rows.push(['Solde', '<b>' + sign(c.balance) + '</b>']);
    return '<dl class="detail">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>';
  }

  function bindPunchEdits(root) {
    root.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var p = data.punches.find(function (x) { return x.id === b.dataset.edit; });
        if (p) openPunchDialog(p);
      };
    });
  }

  /* ================= Vues ================= */

  function viewToday() {
    var w = nowWall(), d = C.wallDate(w);
    var all = C.computeAll(data, w);
    var c = all.day(d);
    var next = C.nextType(data, w);
    var week = C.computeWeek(all, data, d);
    var cumul = C.computeCumul(all, data);
    var sorted = C.sortPunches(data.punches);
    var last = sorted[sorted.length - 1];

    var info = '';
    if (c.running && c.status === 'work') {
      info = c.endAt > w
        ? 'Objectif atteint à <b>' + clock(c.endAt) + '</b>'
        : '<span class="pos">Objectif atteint ✓</span>';
    } else if (!c.counted) {
      info = 'Objectif : ' + C.fmtDur(data.settings.workMinutes) + ' travaillées · ' + C.fmtDur(c.presenceTarget || data.settings.workMinutes) + ' de présence';
    }

    $view.innerHTML =
      '<header class="hero">' +
        '<p class="date">' + esc(longDate(d)) + '</p>' +
        (c.status !== 'work' ? '<p class="badge">' + statusLabel(c.status) + '</p>' : '') +
        '<p class="label">Solde du jour</p>' +
        '<p class="big">' + sign(c.balance) + '</p>' +
      '</header>' +
      '<button id="punchBtn" class="punch-btn ' + next + '" aria-label="Pointer : ' + typeLabel(next) + '">' +
        '<span class="pb-main">POINTER</span><span class="pb-sub">' + typeLabel(next) + '</span>' +
      '</button>' +
      '<p class="last">' + (last ? 'Dernier pointage : <b>' + clock(last.t) + '</b> — ' + typeLabel(last.type) +
        (C.wallDate(last.t) !== d ? ' <small>(' + shortDM(C.wallDate(last.t)) + ')</small>' : '') : 'Aucun pointage') + '</p>' +
      (info ? '<p class="info">' + info + '</p>' : '') +
      (c.incomplete ? '<p class="alert">⚠ Pointage incomplet aujourd\'hui — touchez-le pour corriger.</p>' : '') +
      '<div class="totals">' +
        '<a href="#week" class="tile"><span>Semaine</span><b>' + sign(week.total) + '</b></a>' +
        '<a href="#cumul" class="tile"><span>Cumul</span><b>' + sign(cumul) + '</b></a>' +
      '</div>' +
      '<section class="card">' +
        '<div class="card-head"><h3>Aujourd\'hui</h3><a class="link" href="#day/' + d + '">Détail ›</a></div>' +
        punchListHTML(c) +
        '<button class="btn ghost small" id="addPunch">+ Ajouter un pointage</button>' +
        '<p class="worked">Travaillé : <b>' + C.fmtDur(c.worked) + '</b> / ' + C.fmtDur(c.objective) + '</p>' +
      '</section>';

    document.getElementById('punchBtn').onclick = punchNow;
    document.getElementById('addPunch').onclick = function () { openPunchDialog(null, d); };
    bindPunchEdits($view);
  }

  function viewDay(d) {
    if (!C.isDateStr(d)) d = today();
    var c = C.computeAll(data, nowWall()).day(d);
    var chips = Object.keys(C.STATUSES).map(function (k) {
      return '<button class="chip' + (c.status === k ? ' on' : '') + '" data-status="' + k + '">' + C.STATUSES[k].label + '</button>';
    }).join('');

    $view.innerHTML =
      '<header class="pagehead">' +
        '<a class="nav" href="#day/' + C.addDays(d, -1) + '" aria-label="Jour précédent">‹</a>' +
        '<h2>' + esc(cap(longDate(d))) + '<small>' + d.slice(0, 4) + '</small></h2>' +
        '<a class="nav" href="#day/' + C.addDays(d, 1) + '" aria-label="Jour suivant">›</a>' +
      '</header>' +
      '<div class="chips">' + chips + '</div>' +
      (c.incomplete ? '<p class="alert">⚠ Un pointage n\'a pas de Début ou de Fin correspondant. Il n\'est pas compté : ajoutez le pointage manquant ou corrigez-le.</p>' : '') +
      '<section class="card">' + detailHTML(c) + '</section>' +
      '<section class="card"><div class="card-head"><h3>Pointages</h3></div>' + punchListHTML(c) +
        '<button class="btn primary small" id="addPunch">+ Ajouter un pointage</button></section>';

    $view.querySelectorAll('[data-status]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.status === 'work') delete data.days[d];
        else data.days[d] = { status: b.dataset.status };
        save(); render();
      };
    });
    document.getElementById('addPunch').onclick = function () { openPunchDialog(null, d); };
    bindPunchEdits($view);
  }

  function viewHistory() {
    var all = C.computeAll(data, nowWall());
    var dates = all.dates.slice().reverse();
    if (!dates.length) {
      $view.innerHTML = '<h2 class="title">Historique</h2><p class="muted center">Aucune journée enregistrée.</p>' +
        '<button class="btn ghost" id="addPast">+ Ajouter un pointage passé</button>';
      document.getElementById('addPast').onclick = function () { openPunchDialog(null, C.addDays(today(), -1)); };
      return;
    }
    var html = '<h2 class="title">Historique</h2>' +
      '<button class="btn ghost small" id="addPast">+ Ajouter un pointage passé</button>';
    var month = '';
    dates.forEach(function (d) {
      var c = all.byDate[d], m = d.slice(0, 7);
      if (m !== month) {
        if (month) html += '</ul>';
        month = m;
        html += '<h3 class="month">' + esc(cap(dateLabel(d, { month: 'long', year: 'numeric' }))) + '</h3><ul class="hist">';
      }
      html += '<li><a href="#day/' + d + '">' +
        '<span class="d">' + shortDM(d) + ' <small>' + esc(dateLabel(d, { weekday: 'short' })) + '</small></span>' +
        '<span class="w">' + (c.status !== 'work' ? '<em>' + statusLabel(c.status) + '</em>' : C.fmtDur(c.worked)) +
          (c.incomplete ? ' ⚠' : '') + (c.running ? ' ●' : '') + '</span>' +
        '<span class="b">' + sign(c.balance) + '</span></a></li>';
    });
    $view.innerHTML = html + '</ul>';
    document.getElementById('addPast').onclick = function () { openPunchDialog(null, C.addDays(today(), -1)); };
  }

  function viewWeek(anyDate) {
    if (!C.isDateStr(anyDate)) anyDate = today();
    var all = C.computeAll(data, nowWall());
    var wk = C.computeWeek(all, data, anyDate);
    var t = today();
    var rows = wk.days.map(function (c) {
      var val = c.counted
        ? (c.status !== 'work' ? '<em>' + statusLabel(c.status) + '</em>' : sign(c.balance))
        : '<span class="muted">—</span>';
      return '<li' + (c.date === t ? ' class="today"' : '') + '><a href="#day/' + c.date + '">' +
        '<span class="d">' + esc(cap(dateLabel(c.date, { weekday: 'long' }))) + ' <small>' + shortDM(c.date) + '</small></span>' +
        '<span class="w">' + (c.counted && c.worked ? C.fmtDur(c.worked) : '') + (c.incomplete ? ' ⚠' : '') + '</span>' +
        '<span class="b">' + val + '</span></a></li>';
    }).join('');
    var title = 'Semaine du ' + dateLabel(wk.start, { day: 'numeric', month: wk.start.slice(5, 7) === wk.end.slice(5, 7) ? undefined : 'long' }) +
      ' au ' + dateLabel(wk.end, { day: 'numeric', month: 'long' });

    $view.innerHTML =
      '<header class="pagehead">' +
        '<a class="nav" href="#week/' + C.addDays(wk.start, -7) + '" aria-label="Semaine précédente">‹</a>' +
        '<h2>' + esc(title) + '</h2>' +
        '<a class="nav" href="#week/' + C.addDays(wk.start, 7) + '" aria-label="Semaine suivante">›</a>' +
      '</header>' +
      '<ul class="hist week">' + rows + '</ul>' +
      '<section class="card total"><span>Total semaine</span><b>' + sign(wk.total) + '</b>' +
        '<small>Travaillé : ' + C.fmtDur(wk.worked) + '</small></section>' +
      (wk.start <= t && t <= wk.end ? '' : '<p class="center"><a class="link" href="#week">Revenir à cette semaine</a></p>');
  }

  function viewCumul() {
    var w = nowWall(), d = C.wallDate(w);
    var all = C.computeAll(data, w);
    var s = data.settings;
    var before = C.computeCumul(all, data, d);
    var total = C.computeCumul(all, data);
    var todayBal = all.day(d).balance;

    // totaux par mois
    var months = {};
    all.dates.forEach(function (x) {
      if (s.resetDate && x < s.resetDate) return;
      var m = x.slice(0, 7);
      months[m] = (months[m] || 0) + all.byDate[x].balance;
    });
    var mrows = Object.keys(months).sort().reverse().map(function (m) {
      return '<li class="plain"><span class="d">' + esc(cap(dateLabel(m + '-01', { month: 'long', year: 'numeric' }))) + '</span><span class="w"></span><span class="b">' + sign(months[m]) + '</span></li>';
    }).join('');

    $view.innerHTML =
      '<header class="hero"><p class="label">Solde actuel</p><p class="big">' + sign(total) + '</p>' +
        '<p class="muted">' + (s.resetDate ? 'Depuis le ' + dateLabel(s.resetDate, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Depuis le début') +
        (s.initialBalance ? ' · solde de départ ' + C.fmtSigned(s.initialBalance) : '') + '</p></header>' +
      '<section class="card"><dl class="detail">' +
        '<dt>Solde précédent</dt><dd>' + sign(before) + '</dd>' +
        '<dt>Aujourd\'hui' + (all.day(d).running ? ' (en cours)' : '') + '</dt><dd>' + sign(todayBal) + '</dd>' +
        '<dt><b>Nouveau solde</b></dt><dd><b>' + sign(total) + '</b></dd>' +
      '</dl></section>' +
      (mrows ? '<h3 class="month">Par mois</h3><ul class="hist">' + mrows + '</ul>' : '');
  }

  function hmInput(min) { return C.pad(Math.floor(min / 60)) + ':' + C.pad(min % 60); }

  function viewSettings() {
    var s = data.settings;
    var presence = s.workMinutes + (s.breakMode === 'deducted' ? s.morningBreak : 0);
    var ib = s.initialBalance || 0;
    $view.innerHTML =
      '<h2 class="title">Réglages</h2>' +
      '<section class="card form">' +
        '<label>Travail effectif par jour <input type="time" id="sWork" value="' + hmInput(s.workMinutes) + '"></label>' +
        '<label>Pause du matin (min) <input type="number" inputmode="numeric" min="0" max="120" id="sBreak" value="' + s.morningBreak + '"></label>' +
        '<label>La pause du matin est…' +
          '<select id="sMode">' +
            '<option value="deducted"' + (s.breakMode === 'deducted' ? ' selected' : '') + '>déduite (non payée) — à rattraper</option>' +
            '<option value="worked"' + (s.breakMode === 'worked' ? ' selected' : '') + '>comptée comme travail</option>' +
          '</select></label>' +
        '<p class="calc">Présence nécessaire : <b>' + C.fmtDur(presence) + '</b> / jour</p>' +
        '<label>Premier jour de la semaine' +
          '<select id="sWeek"><option value="1"' + (s.weekStart === 1 ? ' selected' : '') + '>Lundi</option>' +
          '<option value="0"' + (s.weekStart === 0 ? ' selected' : '') + '>Dimanche</option></select></label>' +
      '</section>' +
      '<h3 class="month">Remise à zéro du cumul</h3>' +
      '<section class="card form">' +
        '<label>Compter à partir du <input type="date" id="sReset" value="' + esc(s.resetDate) + '"></label>' +
        '<label>Solde de départ (ex. +03:42) <input type="text" id="sInit" inputmode="text" value="' + (ib < 0 ? '-' : '+') + hmInput(Math.abs(ib)) + '"></label>' +
        '<p class="hint">Les journées antérieures restent dans l\'historique mais ne comptent plus dans le cumul.</p>' +
        '<button class="btn ghost small" id="sResetToday">Remettre à zéro aujourd\'hui</button>' +
      '</section>' +
      '<h3 class="month">Sauvegarde</h3>' +
      '<section class="card form">' +
        '<button class="btn primary" id="exJson">Exporter la sauvegarde (.json)</button>' +
        '<button class="btn ghost" id="exCsv">Exporter pour Excel (.csv)</button>' +
        '<label class="btn ghost file">Importer une sauvegarde<input type="file" id="imJson" accept=".json,application/json" hidden></label>' +
        '<p class="hint">' + data.punches.length + ' pointage(s) stocké(s) sur ce téléphone. Exportez régulièrement.</p>' +
      '</section>' +
      '<p class="center"><button class="link danger" id="wipe">Tout effacer</button></p>' +
      '<p class="center muted small">Pointage v1.0 · fonctionne hors ligne</p>';

    function upd(fn) { return function () { fn(); save(); render(); }; }
    byId('sWork').onchange = upd(function () { var m = C.parseHM(byId('sWork').value); if (!Number.isNaN(m) && m > 0) s.workMinutes = m; });
    byId('sBreak').onchange = upd(function () { var v = parseInt(byId('sBreak').value, 10); if (v >= 0 && v <= 240) s.morningBreak = v; });
    byId('sMode').onchange = upd(function () { s.breakMode = byId('sMode').value; });
    byId('sWeek').onchange = upd(function () { s.weekStart = +byId('sWeek').value; });
    byId('sReset').onchange = upd(function () { var v = byId('sReset').value; s.resetDate = C.isDateStr(v) ? v : ''; });
    byId('sInit').onchange = upd(function () {
      var raw = byId('sInit').value.trim(), neg = raw.charAt(0) === '-';
      var m = C.parseHM(raw.replace(/^[+-]/, ''));
      if (!Number.isNaN(m)) s.initialBalance = neg ? -m : m;
      else if (/^[+-]?\d+$/.test(raw)) s.initialBalance = parseInt(raw, 10);  // minutes
    });
    byId('sResetToday').onclick = upd(function () {
      if (!confirm('Le cumul repartira de zéro à partir d\'aujourd\'hui. Continuer ?')) return;
      s.resetDate = today(); s.initialBalance = 0;
    });
    byId('exJson').onclick = exportJSON;
    byId('exCsv').onclick = exportCSV;
    byId('imJson').onchange = importJSON;
    byId('wipe').onclick = function () {
      if (!confirm('Effacer TOUS les pointages et réglages ? Pensez à exporter avant.')) return;
      if (!confirm('Vraiment tout effacer ?')) return;
      data = C.normalizeData(null); save(); location.hash = '#today'; render();
    };
  }
  function byId(id) { return document.getElementById(id); }

  /* ================= Export / import ================= */

  function share(name, mime, text) {
    var file = null;
    try { file = new File([text], name, { type: mime }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      navigator.share({ files: [file], title: name }).catch(function () {});
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function exportJSON() {
    share('pointage-' + today() + '.json', 'application/json', JSON.stringify(data, null, 1));
  }

  function exportCSV() {
    var all = C.computeAll(data, nowWall());
    var lines = ['Date;Statut;Pointages;Temps pointé;Pause matin déduite;Travaillé;Objectif;Solde;Solde (min);Incomplet'];
    all.dates.forEach(function (d) {
      var c = all.byDate[d];
      var p = dayPunches(c).map(function (x) { return clock(x.t) + (x.type === 'in' ? ' D' : ' F'); }).join(' ');
      lines.push([d, statusLabel(c.status), p, C.fmtDur(c.punchMinutes), C.fmtDur(c.breakDeducted),
        C.fmtDur(c.worked), C.fmtDur(c.objective), C.fmtSigned(c.balance), c.balance, c.incomplete ? 'oui' : ''].join(';'));
    });
    share('pointage-' + today() + '.csv', 'text/csv', '﻿' + lines.join('\r\n'));
  }

  function importJSON(e) {
    var f = e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var raw = JSON.parse(r.result);
        var nd = C.normalizeData(raw);
        if (!confirm('Importer ' + nd.punches.length + ' pointage(s) ? Les données actuelles (' + data.punches.length + ') seront remplacées.')) return;
        data = nd; save(); toast('Import réussi'); render();
      } catch (err) { alert('Fichier invalide : ' + err.message); }
    };
    r.readAsText(f);
  }

  /* ================= Routeur ================= */

  function render() {
    var h = (location.hash || '#today').slice(1).split('/');
    var tab = h[0] || 'today';
    var tabFor = { day: 'history' };
    document.querySelectorAll('#tabs a').forEach(function (a) {
      a.classList.toggle('on', a.dataset.tab === (tabFor[tab] || tab));
    });
    switch (tab) {
      case 'history': viewHistory(); break;
      case 'week': viewWeek(h[1]); break;
      case 'cumul': viewCumul(); break;
      case 'settings': viewSettings(); break;
      case 'day': viewDay(h[1]); break;
      default: viewToday();
    }
  }

  var lastHash = location.hash;
  window.addEventListener('hashchange', function () {
    document.getElementById('toast').hidden = true;
    render();
    if (location.hash !== lastHash) window.scrollTo(0, 0);
    lastHash = location.hash;
  });

  // rafraîchit l'écran (temps en cours) chaque minute, et au retour sur l'app
  setInterval(function () {
    if (!dlg.open && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') render();
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { data = load(); render(); }
  });

  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
