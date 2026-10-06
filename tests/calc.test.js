// Tests du moteur de calcul : node tests/calc.test.js
const C = require('../calc.js');
let ok = 0, ko = 0;
function eq(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) ok++; else { ko++; console.error('ÉCHEC', name, '\n  obtenu :', g, '\n  attendu:', e); }
}

let n = 0;
const P = (date, hm, type) => ({ id: 'p' + (++n), t: C.toWall(date, C.parseHM(hm)), type });
const mk = (punches, days = {}, settings = {}) => C.normalizeData({ punches, days, settings });

// --- formats
eq('parseHM', C.parseHM('07:15'), 435);
eq('parseHM 7h05', C.parseHM('7h05'), 425);
eq('parseHM invalide', Number.isNaN(C.parseHM('25:00')), true);
eq('fmtDur', C.fmtDur(437), '07h17');
eq('fmtSigned +', C.fmtSigned(17), '+00h17');
eq('fmtSigned -', C.fmtSigned(-20), '-00h20');
eq('fmtSigned 0', C.fmtSigned(0), '+00h00');
eq('fmtSigned gros', C.fmtSigned(6000), '+100h00');
eq('fmtClock', C.fmtClock(485), '08:05');

// --- dates
eq('weekday mardi', C.weekday('2026-10-06'), 2);
eq('début semaine lundi', C.weekStartOf('2026-10-06', 1), '2026-10-05');
eq('début semaine dimanche', C.weekStartOf('2026-10-11', 1), '2026-10-05');
eq('addDays fin de mois', C.addDays('2026-10-31', 1), '2026-11-01');
eq('addDays changement heure', C.addDays('2026-10-24', 2), '2026-10-26');

const D = '2026-10-06';
const NOW = C.toWall(D, C.parseHM('20:00'));

// --- journée type : 08:02-12:03 / 13:01-17:15
{
  const data = mk([P(D, '08:02', 'in'), P(D, '12:03', 'out'), P(D, '13:01', 'in'), P(D, '17:15', 'out')]);
  const d = C.computeAll(data, NOW).day(D);
  eq('présence pointée', d.punchMinutes, 241 + 254);   // 495 = 8h15
  eq('pause midi', d.lunch, 58);
  eq('pause matin déduite', d.breakDeducted, 15);
  eq('travaillé', d.worked, 480);
  eq('objectif', d.objective, 420);
  eq('présence requise', d.presenceTarget, 435);
  eq('solde', d.balance, 60);
}

// --- journée exacte 7h15 de présence => solde 0
{
  const data = mk([P(D, '08:00', 'in'), P(D, '12:00', 'out'), P(D, '13:00', 'in'), P(D, '16:15', 'out')]);
  eq('solde nul', C.computeAll(data, NOW).day(D).balance, 0);
}

// --- heures en moins
{
  const data = mk([P(D, '08:00', 'in'), P(D, '12:00', 'out'), P(D, '13:00', 'in'), P(D, '16:00', 'out')]);
  eq('solde négatif', C.computeAll(data, NOW).day(D).balance, -15);
}

// --- mode "pause comptée comme travail"
{
  const data = mk([P(D, '08:00', 'in'), P(D, '12:00', 'out'), P(D, '13:00', 'in'), P(D, '16:00', 'out')], {}, { breakMode: 'worked' });
  const d = C.computeAll(data, NOW).day(D);
  eq('mode worked travaillé', d.worked, 420);
  eq('mode worked solde', d.balance, 0);
  eq('mode worked présence requise', d.presenceTarget, 420);
}

// --- ordre de saisie quelconque (saisie manuelle après coup)
{
  const data = mk([P(D, '13:01', 'in'), P(D, '17:15', 'out'), P(D, '08:02', 'in'), P(D, '12:03', 'out')]);
  eq('ordre indifférent', C.computeAll(data, NOW).day(D).balance, 60);
}

// --- journée en cours
{
  const data = mk([P(D, '08:00', 'in'), P(D, '12:00', 'out'), P(D, '13:00', 'in')]);
  const now = C.toWall(D, C.parseHM('15:00'));
  const d = C.computeAll(data, now).day(D);
  eq('en cours', d.running, true);
  eq('en cours travaillé', d.worked, 360 - 15);
  eq('heure de fin prévue', C.fmtClock(C.wallMinOfDay(d.endAt)), '16:15');
  eq('prochain = Fin', C.nextType(data, now), 'out');
}

// --- oubli de pointage de fin (jour passé) => incomplet
{
  const data = mk([P('2026-10-05', '08:00', 'in')]);
  const all = C.computeAll(data, NOW);
  const d = all.day('2026-10-05');
  eq('oubli incomplet', d.incomplete, true);
  eq('oubli : pas en cours', d.running, false);
  eq('prochain = Début', C.nextType(data, NOW), 'in');
}

// --- deux Début consécutifs => premier orphelin
{
  const data = mk([P(D, '08:00', 'in'), P(D, '08:01', 'in'), P(D, '16:16', 'out')]);
  const d = C.computeAll(data, NOW).day(D);
  eq('double début incomplet', d.incomplete, true);
  eq('double début travaillé', d.worked, 495 - 15);
}

// --- passage de minuit : 22:00 -> 05:15 compte pour la veille
{
  const data = mk([P('2026-10-05', '22:00', 'in'), P('2026-10-06', '05:15', 'out')]);
  const all = C.computeAll(data, NOW);
  eq('nuit : compté la veille', all.day('2026-10-05').balance, 0);
  eq('nuit : rien le lendemain', all.dates.includes('2026-10-06'), false);
}

// --- congé / férié : pas de déficit
{
  const data = mk([], { '2026-10-07': { status: 'conge' }, '2026-10-08': { status: 'ferie' } });
  const all = C.computeAll(data, NOW);
  eq('congé solde 0', all.day('2026-10-07').balance, 0);
  eq('congé compté', all.day('2026-10-07').counted, true);
  eq('cumul congés', C.computeCumul(all, data), 0);
}

// --- jour sans pointage ni statut : non compté
{
  const all = C.computeAll(mk([]), NOW);
  eq('jour vide non compté', all.day('2026-10-09').counted, false);
}

// --- semaine + cumul + remise à zéro
{
  const days = [['2026-10-05', '16:25'], ['2026-10-06', '16:32'], ['2026-10-07', '16:10'], ['2026-10-08', '16:35'], ['2026-10-09', '16:30']];
  const punches = [];
  days.forEach(([d, end]) => punches.push(P(d, '08:00', 'in'), P(d, '12:00', 'out'), P(d, '13:00', 'in'), P(d, end, 'out')));
  // semaine précédente : +30
  punches.push(P('2026-09-30', '08:00', 'in'), P('2026-09-30', '15:45', 'out'));
  const data = mk(punches);
  const now = C.toWall('2026-10-10', 600);
  const all = C.computeAll(data, now);
  const w = C.computeWeek(all, data, '2026-10-08');
  eq('semaine début', w.start, '2026-10-05');
  eq('semaine soldes', w.days.slice(0, 5).map(d => d.balance), [10, 17, -5, 20, 15]);
  eq('semaine total', w.total, 57);
  eq('cumul', C.computeCumul(all, data), 87);
  eq('cumul avant date', C.computeCumul(all, data, '2026-10-06'), 40);

  data.settings.resetDate = '2026-10-05';
  data.settings.initialBalance = 222; // +3h42
  eq('cumul remise à zéro + solde initial', C.computeCumul(all, data), 222 + 57);
}

// --- normalisation d'un import invalide
{
  const d = C.normalizeData({ punches: [{ t: 'x', type: 'in' }, { t: 100, type: 'out' }], days: { foo: { status: 'conge' } }, settings: { workMinutes: 'a' } });
  eq('import filtré', d.punches.length, 1);
  eq('import jours filtrés', Object.keys(d.days).length, 0);
  eq('import réglage par défaut', d.settings.workMinutes, 420);
}

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
