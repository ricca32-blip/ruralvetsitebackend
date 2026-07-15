// Rural Vet AI v9 — test comportamentali end-to-end.
// Niente più assert sulle stringhe del sorgente: qui si testano router,
// motore KM, catalogo prestazioni, operazioni di riga e autorizzazioni
// con un dataset realistico e chiamate HTTP vere all'endpoint.
import assert from 'node:assert/strict';
import {
  app, buildContext, deterministicRouter, parsePeriod, collectKmRows, kmStats,
  kmAnalyticsQuery, serviceCatalogRouter, continueServiceDraft, applyLineOps,
  updateInterventionRequest, signDraft, readSignedDraft, rvMakeToken, rvVerifyToken
} from './server.js';

process.env.NODE_ENV = 'test';
const NOW = new Date('2026-07-15T10:00:00');
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  \u2713', name); }
  catch (e) { failed++; console.error('  \u2717', name, '\n    ', e.message); }
}

/* ------------------------------------------------------------------ */
/* Dataset realistico                                                  */
/* ------------------------------------------------------------------ */
const USERS = [
  { id: 'medardo', name: 'Medardo Cammi', role: 'worker' },
  { id: 'edoardo', name: 'Edoardo Ronda', role: 'worker' },
  { id: 'ruralvet', name: 'Rural Vet', role: 'company' }
];
const AZIENDE = [
  { id: 1, nome: 'Allevamento Rossi', addr: 'Via Po 7', km: 12, prezzi: { 4: 28 } },
  { id: 2, nome: 'Cascina Belloni', addr: 'Strada Campagna 55', km: 9, prezzi: {} },
  { id: 3, nome: 'Az. Agr. Fratelli Conti', addr: 'Via Cascina 12', km: 18, prezzi: {} },
  { id: 4, nome: 'Societa Agricola Rossi e Figli', addr: 'Via Emilia 3', km: 25, prezzi: {} }
];
const PREST = [
  { id: 1, nome: 'Visita clinica', cat: 'Visite', price: 35, _v: 2 },
  { id: 2, nome: 'Cesareo', cat: 'Chirurgia', price: 300, _v: 1 },
  { id: 4, nome: 'Fecondazione', cat: 'Riproduzione', price: 25 },
  { id: 5, nome: 'Ecografia gravidanza', cat: 'Riproduzione', price: 25 },
  { id: 7, nome: 'Trattamento mastite', cat: 'Terapia', price: 30 },
  { id: 8, nome: 'Controllo podale', cat: 'Chirurgia', price: 45 },
  { id: 9, nome: 'Vaccino vecchio', cat: 'Profilassi', price: 8, archived: true }
];
const INT = [
  { id: 101, data: '2026-07-15', ora: '08:30', sess: 'm', userId: 'medardo', allId: 1, servs: [{ id: 2, qty: 1, price: 300 }, { id: 4, qty: 2, price: 25 }], tot: 350, fatt: false },
  { id: 102, data: '2026-07-15', ora: '11:00', sess: 'm', userId: 'medardo', allId: 2, servs: [{ id: 1, qty: 1, price: 35 }], tot: 35, fatt: false },
  { id: 103, data: '2026-07-14', ora: '09:00', sess: 'm', userId: 'medardo', allId: 3, servs: [{ id: 5, qty: 2, price: 25 }], tot: 50, fatt: true },
  { id: 104, data: '2026-07-14', ora: '15:00', sess: 'p', userId: 'edoardo', allId: 1, servs: [{ id: 7, qty: 1, price: 30 }], tot: 30, fatt: false },
  { id: 105, data: '2026-07-08', ora: '08:00', sess: 'm', userId: 'medardo', allId: 3, servs: [{ id: 1, qty: 1, price: 35 }], tot: 35, fatt: true },
  { id: 106, data: '2026-06-10', ora: '10:00', sess: 'm', userId: 'medardo', allId: 2, servs: [{ id: 8, qty: 1, price: 45 }], tot: 45, fatt: true }
];
// Tratte materializzate + record sporchi che DEVONO essere esclusi.
const KMROUTES = [
  { id: 'r1', data: '2026-07-15', userId: 'medardo', userName: 'Medardo Cammi', from: 'Casa', to: 'Allevamento Rossi', aziendaId: 1, azienda: 'Allevamento Rossi', km: 12.4, method: 'ors', isEstimate: false, sess: 'm', interventionIds: [101] },
  { id: 'r2', data: '2026-07-15', userId: 'medardo', userName: 'Medardo Cammi', from: 'Allevamento Rossi', to: 'Cascina Belloni', aziendaId: 2, azienda: 'Cascina Belloni', km: 7.2, method: 'ors', isEstimate: false, sess: 'm', interventionIds: [102] },
  { id: 'r3', data: '2026-07-15', userId: 'medardo', userName: 'Medardo Cammi', from: 'Cascina Belloni', to: 'Casa', aziendaId: '', azienda: '', km: 9.1, method: 'ors', isEstimate: false, sess: 'm', interventionIds: [] },
  { id: 'r4', data: '2026-07-14', userId: 'medardo', userName: 'Medardo Cammi', from: 'Casa', to: 'Az. Agr. Fratelli Conti', aziendaId: 3, azienda: 'Az. Agr. Fratelli Conti', km: 18.3, method: 'ors', isEstimate: false, sess: 'm', interventionIds: [103] },
  { id: 'r5', data: '2026-07-14', userId: 'medardo', userName: 'Medardo Cammi', from: 'Az. Agr. Fratelli Conti', to: 'Casa', km: 18.3, method: 'ors', isEstimate: false, sess: 'm', interventionIds: [] },
  { id: 'r6', data: '2026-07-14', userId: 'edoardo', userName: 'Edoardo Ronda', from: 'Casa', to: 'Allevamento Rossi', aziendaId: 1, azienda: 'Allevamento Rossi', km: 12, method: 'company_distance', isEstimate: true, sess: 'p', interventionIds: [104] },
  { id: 'r7', data: '2026-07-08', userId: 'medardo', userName: 'Medardo Cammi', from: 'Casa', to: 'Az. Agr. Fratelli Conti', aziendaId: 3, azienda: 'Az. Agr. Fratelli Conti', km: 56, method: 'ors', isEstimate: false, sess: 'm', interventionIds: [105] },
  { id: 'r8', data: '2026-07-08', userId: 'medardo', userName: 'Medardo Cammi', from: 'Az. Agr. Fratelli Conti', to: 'Casa', km: 56, method: 'ors', isEstimate: false, sess: 'm', interventionIds: [] },
  { id: 'bad1', data: '', userId: 'medardo', km: 30, method: 'ors' },
  { id: 'bad2', data: '2026-07-15', userId: 'medardo', userName: 'Medardo Cammi', km: -5, method: 'ors' },
  { id: 'bad3', data: '2026-07-15', userId: 'medardo', userName: 'Medardo Cammi', km: 999, method: 'ors' }
];
const FATTURE = [{ id: 900, numero: '12', data: '2026-07-14', allId: 3, tot: 61, pagata: false, interventi: [103] }];

function makeBody({ user = USERS[0], km = KMROUTES, extras = {} } = {}) {
  return { context: { user, users: USERS, aziende: AZIENDE, prestazioni: PREST, interventi: INT, fatture: FATTURE, km, ...extras } };
}
function ctxFor(userId = 'medardo', opts = {}) {
  const user = USERS.find(u => u.id === userId);
  const auth = { uid: user.id, name: user.name, role: user.role, ai: userId !== 'edoardo', exp: Date.now() + 60000 };
  const ctx = buildContext(makeBody({ user, ...opts }), auth);
  ctx.now = NOW;
  return ctx;
}

/* ------------------------------------------------------------------ */
console.log('\n== dateRangeParser ==');
t('oggi', () => assert.deepEqual(parsePeriod('km oggi', NOW).from, '2026-07-15'));
t('ieri', () => assert.equal(parsePeriod('ieri', NOW).from, '2026-07-14'));
t('altroieri', () => assert.equal(parsePeriod('quanti km altroieri', NOW).from, '2026-07-13'));
t('data italiana', () => assert.equal(parsePeriod('km del 15/07/2026', NOW).from, '2026-07-15'));
t('data ISO', () => assert.equal(parsePeriod('km del 2026-07-08', NOW).from, '2026-07-08'));
t('nome mese', () => { const p = parsePeriod('km di giugno 2026', NOW); assert.equal(p.from, '2026-06-01'); assert.equal(p.to, '2026-06-30'); });
t('dal X al Y', () => { const p = parsePeriod('km dal 01/07 al 15/07', NOW); assert.equal(p.from, '2026-07-01'); assert.equal(p.to, '2026-07-15'); });
t('tra il 3 e il 15 luglio (mese condiviso)', () => { const p = parsePeriod('tra il 3 e il 15 luglio', NOW); assert.equal(p.from, '2026-07-03'); assert.equal(p.to, '2026-07-15'); });
t('dal 3 maggio 2026 al 20 maggio 2026', () => { const p = parsePeriod('dal 3 maggio 2026 al 20 maggio 2026', NOW); assert.equal(p.from, '2026-05-03'); assert.equal(p.to, '2026-05-20'); });
t('lunedì scorso', () => assert.equal(parsePeriod('lunedi scorso', NOW).from, '2026-07-13'));
t('questa settimana', () => assert.equal(parsePeriod('questa settimana', NOW).from, '2026-07-13'));
t('settimana scorsa', () => { const p = parsePeriod('settimana scorsa', NOW); assert.equal(p.from, '2026-07-06'); assert.equal(p.to, '2026-07-12'); });
t('da inizio anno', () => assert.equal(parsePeriod('da inizio anno', NOW).from, '2026-01-01'));
t('ultimi 7 giorni', () => assert.equal(parsePeriod('ultimi 7 giorni', NOW).from, '2026-07-09'));

console.log('\n== Motore KM ==');
t('KM oggi Medardo: totale esatto con decimali', () => {
  const st = kmStats(ctxFor('medardo'), { period: { from: '2026-07-15', to: '2026-07-15' }, user: USERS[0] });
  assert.equal(st.totalKm, 28.7);
  assert.equal(st.routeCount, 3);
  assert.equal(st.source, 'registered_routes');
  assert.equal(st.isEstimate, false);
});
t('record sporchi esclusi e riportati (senza data, negativi, anomali)', () => {
  const st = kmStats(ctxFor('medardo'), { period: { from: '2026-07-15', to: '2026-07-15' }, user: USERS[0] });
  const reasons = st.excluded.map(e => e.reason).join('|');
  assert.ok(/senza data/.test(reasons) && /negativ/.test(reasons) && /anomal/.test(reasons));
});
t('nessun doppio conteggio: le tratte vincono sugli interventi', () => {
  const withIntKm = INT.map(i => ({ ...i, km: 500 }));
  const ctx = ctxFor('medardo', { extras: { interventi: withIntKm } });
  const st = kmStats(ctx, { period: { from: '2026-07-15', to: '2026-07-15' }, user: USERS[0] });
  assert.equal(st.totalKm, 28.7);
  assert.equal(st.source, 'registered_routes');
});
t('fallback: KM salvati negli interventi quando mancano tratte', () => {
  const withIntKm = INT.map(i => ({ ...i, km: i.id === 101 ? 20 : (i.id === 102 ? 10 : 0) }));
  const ctx = ctxFor('medardo', { km: [], extras: { interventi: withIntKm } });
  const st = kmStats(ctx, { period: { from: '2026-07-15', to: '2026-07-15' }, user: USERS[0] });
  assert.equal(st.source, 'intervention_km');
  assert.equal(st.totalKm, 30);
});
t('fallback stima da distanza azienda con A/R, dichiarata come stima', () => {
  const ctx = ctxFor('medardo', { km: [] });
  const st = kmStats(ctx, { period: { from: '2026-07-15', to: '2026-07-15' }, user: USERS[0] });
  assert.equal(st.source, 'company_distance_estimate');
  assert.equal(st.isEstimate, true);
  assert.equal(st.totalKm, 24);
});
t('due interventi nella stessa azienda nello stesso giro = una sola tratta', () => {
  const doubled = [...INT, { id: 199, data: '2026-07-15', ora: '09:15', sess: 'm', userId: 'medardo', allId: 1, servs: [{ id: 1, qty: 1, price: 35 }], tot: 35, fatt: false }];
  const ctx = ctxFor('medardo', { km: [], extras: { interventi: doubled } });
  const st = kmStats(ctx, { period: { from: '2026-07-15', to: '2026-07-15' }, user: USERS[0] });
  assert.equal(st.totalKm, 24);
});
t('intervallo 1–15 luglio: totale, giorni attivi, media/intervento', () => {
  const st = kmStats(ctxFor('medardo'), { period: { from: '2026-07-01', to: '2026-07-15' }, user: USERS[0] });
  assert.equal(st.totalKm, 177.3);
  assert.equal(st.activeDays, 3);
  assert.equal(st.interventionCount, 4);
  assert.equal(st.averageKmPerIntervention, 44.33);
  assert.equal(st.topDays[0].label, '2026-07-08');
});
t('intervallo senza dati: risposta onesta con cosa manca', () => {
  const r = kmAnalyticsQuery('quanti km ho fatto a marzo 2026', ctxFor('medardo'));
  assert.ok(/Nessun dato KM affidabile/.test(r.reply));
  assert.equal(r.data.totalKm, 0);
});
t('kmAnalyticsQuery: giorno singolo con fonte e periodo visibili', () => {
  const r = kmAnalyticsQuery('quanti km ho percorso oggi?', ctxFor('medardo'));
  assert.ok(/28,7 km/.test(r.reply));
  assert.ok(/Fonte: tratte registrate/.test(r.reply));
  assert.ok(/oggi/.test(r.reply));
  assert.equal(r.data.source, 'registered_routes');
  assert.equal(r.ui.mode, 'km_analytics');
});
t('confronto con periodo precedente', () => {
  const r = kmAnalyticsQuery('confronta i km di questa settimana con quella precedente', ctxFor('medardo'));
  assert.ok(r.data.compare, 'manca il blocco confronto');
  assert.ok(/Confronto/.test(r.reply));
});
t('scope Medardo: "i miei km" filtrati su di lui automaticamente', () => {
  const r = kmAnalyticsQuery('i miei km di ieri', ctxFor('medardo'));
  assert.equal(r.data.totalKm, 36.6);
  assert.ok(/Medardo Cammi/.test(r.reply));
});
t('scope Medardo: chiedere i km di Edoardo torna comunque i propri', () => {
  const r = kmAnalyticsQuery('km di Edoardo di ieri', ctxFor('medardo'));
  assert.equal(r.data.totalKm, 36.6);
  assert.ok(/solo i propri KM/.test(r.reply));
});
t('scope Rural Vet: km di Edoardo (stima dichiarata)', () => {
  const r = kmAnalyticsQuery('km di Edoardo di ieri', ctxFor('ruralvet'));
  assert.equal(r.data.totalKm, 12);
  assert.ok(/stima/.test(r.reply.toLowerCase()));
});
t('scope Rural Vet: km societari del periodo (tutti gli utenti)', () => {
  const r = kmAnalyticsQuery('km dal 14 al 15 luglio', ctxFor('ruralvet'));
  assert.equal(r.data.totalKm, 77.3);
});
t('router: "mostrami tutte le tratte di ieri" passa dal motore KM', () => {
  const r = deterministicRouter('mostrami tutte le tratte di ieri', ctxFor('medardo'));
  assert.equal(r.ui.mode, 'km_analytics');
  assert.ok(/Tratte:/.test(r.reply));
});

console.log('\n== Catalogo prestazioni ==');
t('creazione completa in un colpo: riepilogo e SALVA', () => {
  const r = serviceCatalogRouter('crea la prestazione visita ginecologica categoria Riproduzione prezzo 45', ctxFor('medardo'));
  assert.equal(r.action.type, 'create_service');
  assert.equal(r.action.price, 45);
  assert.ok(/SALVA/.test(r.reply));
});
t('creazione con prezzo mancante: lo chiede (bozza firmata)', () => {
  const r = serviceCatalogRouter('aggiungi la prestazione visita ginecologica al listino', ctxFor('medardo'));
  assert.equal(r.action.type, 'continue_service_draft');
  assert.ok(/prezzo/i.test(r.reply));
  const draft = readSignedDraft(r.action.draft);
  assert.equal(draft.kind, 'service_create');
});
t('continuazione bozza: risposta col prezzo completa il flusso', () => {
  const ctx = ctxFor('medardo');
  const r1 = serviceCatalogRouter('aggiungi la prestazione visita ginecologica categoria Riproduzione', ctx);
  const r2 = continueServiceDraft('45', r1.action.draft, ctx);
  assert.equal(r2.action.type, 'create_service');
  assert.equal(r2.action.price, 45);
});
t('bozza manomessa: rifiutata', () => {
  const ctx = ctxFor('medardo');
  const r1 = serviceCatalogRouter('aggiungi la prestazione visita ginecologica', ctx);
  const evil = { payload: r1.action.draft.payload, sig: 'a'.repeat(64) };
  const r2 = continueServiceDraft('45', evil, ctx);
  assert.ok(/non \u00e8 pi\u00f9 valida/.test(r2.reply));
});
t('duplicato esatto: non crea e lo dice', () => {
  const r = serviceCatalogRouter('crea la prestazione controllo podale a 45 euro', ctxFor('medardo'));
  assert.ok(/Esiste gi\u00e0/.test(r.reply));
  assert.ok(!r.action || r.action.type !== 'create_service');
});
t('modifica prezzo: PRIMA/DOPO + impatto e nessun ritocco storico', () => {
  const r = serviceCatalogRouter('porta il cesareo a 320 euro', ctxFor('medardo'));
  assert.equal(r.action.type, 'update_service');
  assert.deepEqual(r.action.before, { price: 300 });
  assert.deepEqual(r.action.after, { price: 320 });
  assert.equal(r.action.recordVersion, 1);
  assert.ok(/gi\u00e0 salvati restano invariati/.test(r.reply));
});
t('rinomina', () => {
  const r = serviceCatalogRouter('rinomina visita clinica in visita clinica bovina', ctxFor('medardo'));
  assert.equal(r.action.fields.name, 'Visita clinica bovina');
  assert.equal(r.action.before.name, 'Visita clinica');
});
t('cambio categoria', () => {
  const r = serviceCatalogRouter('sposta ecografia nella categoria Diagnostica', ctxFor('medardo'));
  assert.equal(r.action.fields.cat, 'Diagnostica');
});
t('modifica multipla: prezzo e categoria in una frase', () => {
  const r = serviceCatalogRouter('modifica controllo podale: prezzo 50 euro e categoria Ortopedia', ctxFor('medardo'));
  assert.equal(r.action.fields.price, 50);
  assert.equal(r.action.fields.cat, 'Ortopedia');
});
t('no-op: prezzo già impostato così', () => {
  const r = serviceCatalogRouter('porta il cesareo a 300 euro', ctxFor('medardo'));
  assert.ok(/gi\u00e0 impostato cos\u00ec/i.test(r.reply));
  assert.equal(r.action, null);
});
t('prezzo personalizzato per azienda: PRIMA (listino) → DOPO (personalizzato)', () => {
  const r = serviceCatalogRouter('imposta il prezzo del cesareo per Belloni a 280 euro', ctxFor('medardo'));
  assert.equal(r.action.type, 'update_service');
  assert.equal(String(r.action.companyId), '2');
  assert.equal(r.action.before.price, 300);
  assert.equal(r.action.after.price, 280);
});
t('prezzo personalizzato no-op (Rossi ha già fecondazione a 28)', () => {
  const r = serviceCatalogRouter('imposta il prezzo della fecondazione per Allevamento Rossi a 28 euro', ctxFor('medardo'));
  assert.ok(/gi\u00e0 impostato cos\u00ec/i.test(r.reply));
});
t('rimozione prezzo personalizzato', () => {
  const r = serviceCatalogRouter('togli il prezzo personalizzato di Allevamento Rossi per la fecondazione', ctxFor('medardo'));
  assert.equal(r.action.type, 'remove_company_price');
  assert.equal(r.action.before.price, 28);
  assert.equal(r.action.after.price, 25);
});
t('eliminazione prestazione usata → archiviazione con motivazione', () => {
  const r = serviceCatalogRouter('elimina il cesareo dal listino', ctxFor('medardo'));
  assert.equal(r.action.type, 'archive_service');
  assert.ok(/storico/.test(r.reply));
});
t('eliminazione prestazione mai usata → delete con ELIMINA e cestino', () => {
  const ctx = ctxFor('medardo', { extras: { prestazioni: [...PREST, { id: 99, nome: 'Voce inutilizzata', cat: 'Test', price: 10 }] } });
  const r = serviceCatalogRouter('elimina la prestazione voce inutilizzata', ctx);
  assert.equal(r.action.type, 'delete_service');
  assert.ok(/ELIMINA/.test(r.reply));
});
t('ripristino prestazione archiviata', () => {
  const r = serviceCatalogRouter('ripristina la prestazione vaccino vecchio', ctxFor('medardo'));
  assert.equal(r.action.type, 'restore_service');
});
t('versione record nel contratto (concorrenza)', () => {
  const r = serviceCatalogRouter('porta la visita clinica a 40 euro', ctxFor('medardo'));
  assert.equal(r.action.recordVersion, 2);
});

console.log('\n== Prestazioni negli interventi (operazioni di riga) ==');
const rows0 = [{ id: '2', nome: 'Cesareo', qty: 1, price: 300 }, { id: '4', nome: 'Fecondazione', qty: 2, price: 25 }];
t('applyLineOps: aggiunta con somma su riga esistente', () => {
  const r = applyLineOps(rows0, [{ op: 'add', serviceId: '4', qty: 2, price: 25 }]);
  assert.equal(r.rows.find(x => x.id === '4').qty, 4);
  assert.equal(r.total, 400);
});
t('applyLineOps: rimozione di una sola unità', () => {
  const r = applyLineOps(rows0, [{ op: 'removeUnit', serviceId: '4', qty: 1 }]);
  assert.equal(r.rows.find(x => x.id === '4').qty, 1);
  assert.equal(r.total, 325);
});
t('applyLineOps: rimozione unità che azzera la riga', () => {
  const r = applyLineOps(rows0, [{ op: 'removeUnit', serviceId: '2', qty: 1 }]);
  assert.ok(!r.rows.find(x => x.id === '2'));
  assert.equal(r.total, 50);
});
t('applyLineOps: sostituzione totale con fusione su riga esistente', () => {
  const r = applyLineOps([{ id: '2', nome: 'Cesareo', qty: 1, price: 300 }, { id: '1', nome: 'Visita clinica', qty: 1, price: 35 }], [{ op: 'replace', serviceId: '2', toServiceId: '1', toServiceName: 'Visita clinica', toPrice: 35 }]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].qty, 2);
  assert.equal(r.total, 70);
});
t('applyLineOps: sostituzione parziale (una delle due)', () => {
  const r = applyLineOps(rows0, [{ op: 'replacePartial', serviceId: '4', qty: 1, toServiceId: '5', toServiceName: 'Ecografia gravidanza', toPrice: 25 }]);
  assert.equal(r.rows.find(x => x.id === '4').qty, 1);
  assert.equal(r.rows.find(x => x.id === '5').qty, 1);
  assert.equal(r.total, 350);
});
t('applyLineOps: setQty e setPrice con totale corretto', () => {
  const r = applyLineOps(rows0, [{ op: 'setQty', serviceId: '4', qty: 3 }, { op: 'setPrice', serviceId: '2', price: 280 }]);
  assert.equal(r.total, 355);
});
t('applyLineOps: fusione di due righe uguali', () => {
  const r = applyLineOps([{ id: '4', nome: 'Fecondazione', qty: 1, price: 25 }, { id: '4', nome: 'Fecondazione', qty: 2, price: 25 }], []);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].qty, 3);
});
t('"aggiungi due fecondazioni all\'intervento di Rossi di oggi" → PRIMA/DOPO', () => {
  const r = updateInterventionRequest("aggiungi due fecondazioni all'intervento di Rossi di oggi", ctxFor('medardo'));
  assert.equal(r.action.type, 'update_intervention');
  assert.equal(r.action.interventionId, 101);
  assert.ok(/PRIMA/.test(r.reply) && /DOPO/.test(r.reply));
  assert.equal(r.action.after.total, 400);
});
t('"porta le fecondazioni a 3" nell\'intervento giusto', () => {
  const r = updateInterventionRequest('porta le fecondazioni da due a tre nell\'intervento di oggi', ctxFor('medardo'));
  assert.equal(r.action.after.rows.find(x => x.id === '4').qty, 3);
  assert.equal(r.action.after.total, 375);
});
t('"togli una fecondazione dall\'intervento di oggi"', () => {
  const r = updateInterventionRequest("togli una fecondazione dall'intervento di Rossi di oggi", ctxFor('medardo'));
  assert.equal(r.action.after.rows.find(x => x.id === '4').qty, 1);
  assert.equal(r.action.after.total, 325);
});
t('"cambia il cesareo in visita clinica" con quantità preservata', () => {
  const r = updateInterventionRequest('cambia il cesareo in visita clinica nell\'intervento di Rossi di oggi', ctxFor('medardo'));
  const v = r.action.after.rows.find(x => x.id === '1');
  assert.ok(v && v.qty === 1);
  assert.equal(r.action.after.total, 85);
});
t('"correggi il prezzo del cesareo in questo intervento a 280"', () => {
  const r = updateInterventionRequest('correggi il prezzo del cesareo in questo intervento a 280 di oggi', ctxFor('medardo'));
  assert.equal(r.action.after.rows.find(x => x.id === '2').price, 280);
  assert.equal(r.action.after.total, 330);
});
t('aggiunta usa il prezzo giusto per l\'azienda (Belloni: listino 25)', () => {
  const r = updateInterventionRequest("aggiungi una fecondazione all'intervento di Belloni di oggi", ctxFor('medardo'));
  const row = r.action.after.rows.find(x => x.id === '4');
  assert.equal(row.price, 25);
});
t('più interventi possibili → scelta numerata o target univoco, mai modifica cieca', () => {
  const r = updateInterventionRequest('togli il trattamento mastite dall\'intervento di ieri', ctxFor('ruralvet'));
  assert.ok(r.action.interventionId === 104 || Array.isArray(r.action.options));
});
t('no-op sulle righe: "è già così"', () => {
  const r = updateInterventionRequest('porta le fecondazioni a 2 nell\'intervento di Rossi di oggi', ctxFor('medardo'));
  assert.ok(/gi\u00e0 cos\u00ec/i.test(r.reply));
});

console.log('\n== Autorizzazioni e token ==');
t('token valido verificato, manomesso rifiutato', () => {
  const tok = rvMakeToken({ id: 'medardo', name: 'Medardo Cammi', role: 'worker', aiAccess: true });
  assert.ok(rvVerifyToken(tok));
  assert.equal(rvVerifyToken(tok.slice(0, -2) + 'zz'), null);
});
t('buildContext ignora l\'impersonificazione dal client', () => {
  const auth = { uid: 'medardo', name: 'Medardo Cammi', role: 'worker', ai: true, exp: Date.now() + 60000 };
  const ctx = buildContext(makeBody({ user: { id: 'ruralvet', name: 'Rural Vet', role: 'company' } }), auth);
  assert.equal(ctx.currentUser.id, 'medardo');
});

console.log('\n== HTTP end-to-end (endpoint reali) ==');
const server = app.listen(0);
const base = () => `http://127.0.0.1:${server.address().port}`;
async function httpTests() {
  const post = (path, body, token) => fetch(base() + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });

  let r = await post('/api/auth/login', { userId: 'medardo', password: '1996' });
  assert.equal(r.status, 200); const medardo = await r.json(); assert.ok(medardo.token && medardo.aiAccess);
  passed++; console.log('  \u2713 login Medardo con token e aiAccess');

  r = await post('/api/auth/login', { userId: 'medardo', password: 'sbagliata' });
  assert.equal(r.status, 401); passed++; console.log('  \u2713 login con password errata rifiutato');

  r = await post('/api/auth/login', { userId: 'edoardo', password: '0000' });
  const edo = await r.json(); assert.equal(edo.aiAccess, false);
  passed++; console.log('  \u2713 login Edoardo: nessun accesso AI dichiarato');

  r = await post('/api/vet-ai-chat', { input: 'km oggi', ...makeBody() });
  assert.equal(r.status, 401); passed++; console.log('  \u2713 chat senza token \u2192 401');

  r = await post('/api/vet-ai-chat', { input: 'km oggi', ...makeBody({ user: USERS[1] }) }, edo.token);
  assert.equal(r.status, 403); passed++; console.log('  \u2713 Edoardo \u2192 403 anche chiamando l\u2019endpoint direttamente');

  r = await post('/api/vet-ai-chat', { input: 'quanti km ho percorso oggi?', ...makeBody() }, medardo.token);
  assert.equal(r.status, 200); const j = await r.json();
  assert.ok(/28,7/.test(j.reply)); assert.equal(j.ui.scope.userId, 'medardo'); assert.equal(j.data.source, 'registered_routes');
  passed++; console.log('  \u2713 chat Medardo: 28,7 km, scope e fonte nel contratto');

  r = await post('/api/vet-ai-chat', { input: 'km di edoardo di ieri', ...makeBody({ user: USERS[2] }) }, medardo.token);
  const j2 = await r.json(); assert.ok(/solo i propri KM/.test(j2.reply));
  passed++; console.log('  \u2713 il token vince sul context: niente impersonificazione');

  r = await post('/api/auth/login', { userId: 'ruralvet', password: '2026' });
  const rv = await r.json();
  r = await post('/api/vet-ai-chat', { input: 'km di edoardo di ieri', ...makeBody({ user: USERS[2] }) }, rv.token);
  const j3 = await r.json(); assert.equal(j3.data.totalKm, 12);
  passed++; console.log('  \u2713 Rural Vet legge i km di Edoardo (stima dichiarata)');

  r = await fetch(base() + '/api/db/load');
  assert.equal(r.status, 401); passed++; console.log('  \u2713 /api/db/load senza token \u2192 401');
}

httpTests().catch(e => { failed++; console.error('  \u2717 HTTP:', e.message); }).finally(() => {
  server.close();
  console.log(`\n${passed} test superati, ${failed} falliti.`);
  process.exit(failed ? 1 : 0);
});
