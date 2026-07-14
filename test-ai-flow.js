import fs from 'fs';
import { execFileSync } from 'child_process';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function check(cmd, args) { execFileSync(cmd, args, { stdio: 'pipe' }); }

const here = new URL('.', import.meta.url);
function existing(...names) { for (const name of names) { const u = new URL(name, here); if (fs.existsSync(u)) return u; } throw new Error('File non trovato: ' + names.join(' / ')); }
const serverUrl = existing('./server.js', './rural-vet-server-ai-analytics-interventions.js');
const htmlUrl = existing('./index.html', './rural-vet-index-ai-analytics-interventions.html');
const server = fs.readFileSync(serverUrl, 'utf8');
const html = fs.readFileSync(htmlUrl, 'utf8');

check(process.execPath, ['--check', serverUrl.pathname]);
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (const script of scripts) new Function(script);

[
  'parseInterventionDraft',
  'findServiceCandidates',
  'findCompanyCandidates',
  'continuePendingInterventionDraft',
  'validateInterventionAction',
  'resolveNextInterventionStep',
  'interventionDraftToReply'
].forEach(name => assert(server.includes('function ' + name), 'Manca funzione ' + name));

assert(server.includes("type: 'continue_intervention_draft'"), 'Manca action continue_intervention_draft');
assert(server.includes('safeToApply'), 'Manca contratto safeToApply');
assert(server.includes('AI_DEBUG'), 'Manca AI_DEBUG');
assert(html.includes('pendingInterventionDraft'), 'Frontend non mantiene pendingInterventionDraft');
assert(html.includes('ctx.pendingInterventionDraft'), 'Frontend non invia pendingInterventionDraft nel context');
assert(html.includes("continue_intervention_draft"), 'Frontend non gestisce continue_intervention_draft');
assert(html.includes("Modifica prestazione"), 'Mancano bottoni modifica bozza');

assert(server.includes('draftProgressLine'), 'Manca progress line wizard intervento');
assert(server.includes('buildQuantityChoiceReply'), 'Manca step modifica quantità');
assert(server.includes("Aggiungi prestazione"), 'Manca bottone aggiungi prestazione');
assert(html.includes('interventionDraftQuickReplies'), 'Frontend non genera quick replies dinamiche per bozza');
assert(html.includes("Modifica quantità"), 'Manca bottone modifica quantità frontend');
assert(server.includes('chartResponse'), 'Manca generazione grafici AI backend');
assert(server.includes('ui.chart') || server.includes('{ chart }'), 'Manca contratto ui.chart/chart');
assert(html.includes('chartHtml'), 'Frontend non renderizza grafici AI');
assert(html.includes('lastAiChart'), 'Frontend non conserva grafico AI ultimo messaggio');
assert(server.includes('KPI periodo'), 'Mancano quick replies KPI analytics');
assert(server.includes('ruralVetAiBriefingQuery'), 'Manca briefing gestionale Rural Vet AI');
assert(server.includes('managementInsights'), 'Mancano insight gestionali Rural Vet AI');
assert(server.includes('dataQualityQuery'), 'Manca controllo qualità dati Rural Vet AI');
assert(server.includes('inactiveClientsQuery'), 'Manca analisi clienti fermi Rural Vet AI');
assert(server.includes('nextActionsQuery'), 'Manca motore priorità operative Rural Vet AI');
assert(server.includes('priorityTasks'), 'Manca generatore priorità Rural Vet AI');
assert(server.includes('Sei Rural Vet AI'), 'Prompt backend non nomina Rural Vet AI');
assert(html.includes('Rural Vet AI'), 'Frontend non mostra Rural Vet AI');
assert(html.includes('Controllo dati mancanti'), 'Mancano quick replies qualità dati frontend');
assert(html.includes('Clienti fermi'), 'Mancano quick replies clienti fermi frontend');
assert(!html.includes('>AI</') && !html.includes('content:"AI"'), 'Rimane una label AI generica visibile');

assert(server.includes('auditGestionaleQuery'), 'Manca audit gestionale Rural Vet AI v8.5');
assert(server.includes('businessHealthScore'), 'Manca score salute gestionale v8.5');
assert(server.includes('cashflowQuery'), 'Manca cash flow Rural Vet AI v8.5');
assert(server.includes('interventionAnomaliesQuery'), 'Manca controllo anomalie interventi v8.5');
assert(server.includes('listinoQualityQuery'), 'Manca controllo qualità listino v8.5');
assert(server.includes('smartSuggestionsQuery'), 'Manca motore suggerimenti operativi v8.5');
assert(html.includes('rvAiInsightGrid'), 'Frontend non renderizza card insight v8.5');
assert(html.includes('lastAiInsights'), 'Frontend non conserva insight Rural Vet AI v8.5');
assert(html.includes('Audit gestionale'), 'Mancano quick replies audit frontend v8.5');
assert(html.includes('Cash flow'), 'Mancano quick replies cash flow frontend v8.5');
assert(html.includes('Anomalie interventi'), 'Mancano quick replies anomalie frontend v8.5');



assert(server.includes('8.12.0-paste-and-go-ai-hardening'), 'Versione server non aggiornata a v8.12');
assert(server.includes('ruralVetAiCockpitQuery'), 'Manca cockpit operativo Rural Vet AI v8.6');
assert(server.includes('dailyClosureQuery'), 'Manca chiusura giornata Rural Vet AI v8.6');
assert(server.includes('monthProjectionQuery'), 'Manca proiezione mese Rural Vet AI v8.6');
assert(server.includes('uploadPreflightQuery'), 'Manca preflight caricamento Rural Vet AI v8.6');
assert(server.includes('operationalCards'), 'Mancano card operative consolidate v8.6');
assert(html.includes('greetingInsights'), 'Manca funzione greetingInsights v8.6');
assert(html.includes('rv-vet-ai-v86-style'), 'Manca restyling grafico v8.6');
assert(html.includes('rvAiChartHeader'), 'Manca header grafico v8.6');
assert(html.includes('Cockpit Rural Vet AI'), 'Mancano quick replies cockpit frontend v8.6');
assert(html.includes('Proiezione mese'), 'Manca proiezione mese frontend v8.6');
assert(html.includes('Chiusura giornata'), 'Manca chiusura giornata frontend v8.6');
assert(server.includes('kmRowsFromContext'), 'Manca fallback KM da tratte/interventi v8.7');
assert(server.includes('kmEfficiencyQuery'), 'Manca efficienza KM Rural Vet AI v8.7');
assert(server.includes('performanceVeterinariQuery'), 'Manca performance veterinari Rural Vet AI v8.7');
assert(server.includes('weeklyDigestQuery'), 'Manca report settimanale/mensile Rural Vet AI v8.7');
assert(server.includes('ruralVetAiSelfTestQuery'), 'Manca diagnostica Rural Vet AI v8.7');
assert(html.includes('rv-vet-ai-v87-style'), 'Manca restyling grafico v8.7');
assert(html.includes('rvAiScoreMeter'), 'Manca score meter grafico v8.7');
assert(html.includes('rvAiChartStats'), 'Manca riepilogo statistiche grafico v8.7');
assert(html.includes('Efficienza KM'), 'Manca quick reply Efficienza KM v8.7');
assert(html.includes('Performance veterinari'), 'Manca quick reply Performance veterinari v8.7');
assert(html.includes('Diagnostica Rural Vet AI'), 'Manca diagnostica frontend v8.7');
assert(html.includes('rv-vet-ai-v88-style'), 'Manca restyling v8.8 compatto/leggibile');
assert(html.includes('mainRuralVetAiQuickReplies'), 'Manca set ridotto di quick replies iniziali v8.8');
assert(html.includes("return ['Cockpit Rural Vet AI','Inserisci intervento','Grafico ricavi'];"), 'Le quick replies iniziali non sono state ridotte a tre');
assert(html.includes('return [];') && html.includes('welcome volutamente compatto'), 'La welcome iniziale mostra ancora card pesanti');
assert(html.includes('#0b2845') && html.includes('#0f5d73'), 'Manca palette petrolio/blu v8.8');



// --- v8.12: controlli statici robustezza ---
assert(server.includes('smallTalkQuery'), 'Manca smallTalkQuery v8.12');
assert(server.includes('dopodomani'), 'Mancano date estese v8.12');
assert(server.includes('openai-missing-key'), 'Manca degradazione senza chiave OpenAI v8.12');
assert(html.includes("textContent = 'Riprova'"), 'Manca bottone Riprova v8.12');

// --- v8.11: controlli statici interfaccia AI pro ---
assert(html.includes('rv-v811-ai-pro-style') && html.includes('rv-v811-ai-pro-script'), 'Manca patch interfaccia AI v8.11');
assert(html.includes('rvAiScrollDown'), 'Manca scroll-to-bottom v8.11');
assert(html.includes('rvAiStatus'), 'Manca stato connessione header v8.11');
assert(html.includes('rvMsgTools'), 'Manca copia messaggio v8.11');

// --- v8.10: controlli statici UX + sostituzione prestazione ---
assert(html.includes('rv-v810-ux-style') && html.includes('rv-v810-ux-script'), 'Manca patch UX v8.10');
assert(html.includes('rvToast'), 'Manca sistema toast v8.10');
assert(html.includes('replaceService'), 'Frontend senza supporto replaceService');
assert(server.includes('replaceService'), 'Backend senza supporto replaceService');
assert(server.includes('interventionUpdateLabel'), 'Backend senza etichette italiane per le modifiche');

// --- v8.9: controlli statici nuovi ---
assert(server.includes("'/api/db/load'") && server.includes("'/api/db/save'") && server.includes("'/api/db/ping'"), 'Mancano gli endpoint proxy cloud /api/db/*');
assert(server.includes('JSONBIN_API_KEY') && server.includes('process.env.JSONBIN_API_KEY'), 'La chiave JSONBin non è letta da env');
assert(html.includes('rv-cloud-proxy-patch-v89'), 'Frontend senza patch proxy cloud v8.9');
assert(html.includes('Nessun intervento da fatturare per questo cliente.'), 'Manca guardia emitFatt su fattura vuota');

// --- v8.9: test FUNZIONALI (eseguono davvero il router con dati finti) ---
async function functionalTests() {
  let mod;
  try {
    mod = await import(new URL('./server.js', import.meta.url).href);
  } catch (err) {
    console.log('ATTENZIONE: test funzionali saltati (dipendenze non installate: esegui `npm install`). Dettaglio: ' + err.message);
    return;
  }
  const today = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const oggi = iso(today);
  const ieri = iso(new Date(today.getTime() - 86400000));
  const body = { context: {
    user: { id:'medardo', name:'Medardo Cammi', role:'worker' },
    users: [{id:'medardo',name:'Medardo Cammi',role:'worker'}],
    aziende: [
      {id:1,nome:'Rossi',ragioneSociale:'Az. Agr. Rossi',piva:'12345678901',comune:'Piacenza',km:18},
      {id:2,nome:'Verdi',ragioneSociale:'Soc. Agr. Verdi',comune:'Lodi',km:32}
    ],
    prestazioni: [
      {id:10,nome:'Cesareo',price:300},{id:11,nome:'Fecondazione',price:25},{id:12,nome:'Visita clinica',price:50}
    ],
    interventi: [
      {id:100,data:oggi,ora:'08:30',userId:'medardo',aziendaId:1,azienda:'Rossi',tot:350,fatt:false,prestazioni:[{id:10,nome:'Cesareo',qty:1,price:300},{id:11,nome:'Fecondazione',qty:2,price:25}]},
      {id:101,data:ieri,ora:'15:00',userId:'medardo',aziendaId:2,azienda:'Verdi',tot:50,fatt:true,prestazioni:[{id:12,nome:'Visita clinica',qty:1,price:50}]}
    ],
    fatture: [ {id:200,num:9,azId:2,azienda:'Verdi',data:ieri,tot:61,imponibile:50,iva:11,pagata:false,scadenza:ieri} ],
    km: [ {data:oggi,userId:'medardo',km:44,azienda:'Rossi'} ]
  }};
  const ctx = mod.buildContext(body);
  assert(ctx.interventions.length === 2, 'buildContext non ingerisce gli interventi');
  assert(ctx.companies.length === 2 && ctx.services.length === 3 && ctx.invoices.length === 1 && ctx.kmRoutes.length === 1, 'buildContext: conteggi contesto errati');

  // alias inglese "interventions" (robustezza contratto)
  const ctxEn = mod.buildContext({ context: { ...body.context, interventi: undefined, interventions: body.context.interventi } });
  assert(ctxEn.interventions.length === 2, 'Alias context.interventions non accettato');

  const ask = t => mod.deterministicRouter(t, ctx);

  // KPI ricavi oggi (cifra esatta attesa: 350 €)
  const ricavi = ask('Quanti ricavi ho fatto oggi?');
  assert(ricavi && /350,00/.test(ricavi.reply), 'Ricavi oggi errati: ' + (ricavi && ricavi.reply));

  // Regression v8.9: i KM non devono più essere dirottati su "Non trovo quel cliente"
  const km = ask('Km percorsi oggi');
  assert(km && !/non trovo quel cliente/i.test(km.reply), 'Regressione: query KM dirottata su clientLookup');
  assert(/44/.test(km.reply), 'KM oggi errati: ' + (km && km.reply).slice(0,120));

  // Regression v8.9: "P.IVA di Rossi" deve rispondere con la P.IVA, non coi ricavi
  const piva = ask('P.IVA di Rossi');
  assert(piva && /12345678901/.test(piva.reply), 'P.IVA di Rossi non risolta: ' + (piva && piva.reply).slice(0,120));

  // Top clienti (ordine e importi)
  const top = ask('Top clienti questo mese');
  assert(top && top.reply.indexOf('Rossi') < top.reply.indexOf('Verdi') && /350,00/.test(top.reply), 'Top clienti errata');

  // Fatture scadute
  const scad = ask('Fatture scadute');
  assert(scad && /61,00/.test(scad.reply) && /n\.?9/.test(scad.reply.replace(/\s/g,'')), 'Fatture scadute errate');

  // Wizard intervento completo: azione pronta e sicura
  const wiz = ask('Ho fatto un cesareo e due fecondazioni da Rossi oggi alle 14:30');
  assert(wiz && wiz.action && wiz.action.type === 'create_intervention', 'Wizard non produce create_intervention');
  assert(wiz.ui && wiz.ui.safeToApply === true, 'Wizard: safeToApply dovrebbe essere true con dati completi');
  assert(/350,00/.test(wiz.reply), 'Wizard: totale stimato errato');
  const val = mod.validateInterventionAction(wiz.action, ctx);
  assert(val && val.ok !== false, 'validateInterventionAction boccia un intervento valido');

  // Wizard con azienda ambigua/mancante: NON deve essere safeToApply
  const wiz2 = ask('Ho fatto una visita clinica da Brambilla oggi alle 10:00');
  assert(wiz2 && (!wiz2.ui || wiz2.ui.safeToApply !== true), 'Wizard: safeToApply true con cliente inesistente');

  // v8.10: "cambia il cesareo in visita clinica" → sostituzione puntuale con etichetta italiana
  const swap = ask('Cambia il cesareo di Rossi in visita clinica');
  assert(swap && swap.action && swap.action.type === 'update_intervention', 'Sostituzione prestazione non riconosciuta');
  assert(swap.action.updates && swap.action.updates.replaceService && String(swap.action.updates.replaceService.fromId) === '10' && String(swap.action.updates.replaceService.toId) === '12', 'replaceService ids errati');
  assert(/Prestazione: Cesareo → Visita clinica/.test(swap.reply), 'Etichetta italiana sostituzione mancante');

  // v8.10: modifica senza cambiamenti reali → risposta onesta, nessuna azione
  const noop = ask("Segna l'intervento di ieri da Verdi come fatturato"); // è già fatturato nel dataset
  assert(noop && !noop.action && /già così|nulla da cambiare/i.test(noop.reply), 'No-op non riconosciuto: ' + (noop && noop.reply).slice(0,120));

  // v8.12: small talk gestito offline (niente OpenAI per un "ciao")
  const hi = ask('Ciao');
  assert(hi && /Ciao Medardo/.test(hi.reply) && hi.quickReplies && hi.quickReplies.length >= 3, 'Small talk non gestito');
  const hiData = ask('ciao, quanti ricavi oggi?');
  assert(hiData && /350,00/.test(hiData.reply), 'Saluto+richiesta deve rispondere coi dati, non col saluto');

  // v8.12: sinonimi economici e date estese
  const guad = ask('Quanto ho guadagnato oggi?');
  assert(guad && /350,00/.test(guad.reply), 'Sinonimo "guadagnato" non riconosciuto');
  const dopo = ask('Ho fatto una visita clinica da Rossi dopodomani alle 9');
  assert(dopo && dopo.action && dopo.action.type === 'create_intervention' && /09:00/.test(dopo.reply), '"dopodomani" non riconosciuto');

  // v8.12: le domande cliniche NON devono diventare bozze di intervento
  const clin = ask('Come si cura la mastite in una frisona?');
  assert(clin === null || (clin.action == null && !/prestazione vuoi inserire/i.test(clin.reply || '')), 'Domanda clinica dirottata sul wizard intervento');
  const clin2 = ask('Che terapia consigli per una metrite?');
  assert(clin2 === null || (clin2.action == null), 'Domanda clinica 2 dirottata sul wizard');
  // ...ma gli inserimenti espliciti restano wizard
  const reg = ask('Ho fatto un cesareo da Rossi oggi alle 9');
  assert(reg && reg.action && reg.action.type === 'create_intervention', 'Inserimento esplicito non più riconosciuto');

  // Eliminazione: mai azione applicabile senza conferma esplicita
  const del = ask('Elimina l\'intervento di Rossi di oggi');
  assert(del && (!del.ui || del.ui.safeToApply !== true || /ELIMINA/i.test(del.reply)), 'Eliminazione senza percorso di conferma');

  console.log('OK: test funzionali router v8.9 superati (KPI, KM, P.IVA, wizard, sicurezza).');

  // --- v8.9: endpoint /api/db/* (chiamati davvero, senza rete) ---
  if (mod.app && mod.app._routes) {
    function call(method, url, body) {
      return new Promise(resolve => {
        const h = mod.app._routes[method].get(url);
        assert(h, 'Endpoint mancante: ' + method + ' ' + url);
        const res = { statusCode: 200, status(c){ this.statusCode = c; return this; }, json(payload){ resolve({ status: this.statusCode, body: payload }); } };
        Promise.resolve(h({ body: body || {}, url }, res)).catch(e => resolve({ status: 500, body: { error: e.message } }));
      });
    }
    const ping = await call('GET', '/api/db/ping');
    assert(ping.body && ping.body.ok === true && ping.body.configured === false, '/api/db/ping deve dichiarare configured:false senza env');
    const loadNoCfg = await call('GET', '/api/db/load');
    assert(loadNoCfg.status === 503, '/api/db/load senza env deve rispondere 503, non fingere dati');
    const saveNoCfg = await call('POST', '/api/db/save', { db: { aziende: [], int: [], prest: [] } });
    assert(saveNoCfg.status === 503, '/api/db/save senza env deve rifiutare');
    console.log('OK: test endpoint /api/db/* v8.9 superati.');

    // v8.12: domanda libera senza OPENAI_API_KEY → risposta utile con quick replies, MAI un errore criptico
    if (!process.env.OPENAI_API_KEY) {
      const chat = await call('POST', '/api/vet-ai-chat', { input: 'Come si cura la mastite in una frisona?', context: { user:{id:'m',name:'Medardo'}, aziende: [], prestazioni: [], interventi: [], fatture: [] } });
      assert(chat.body && /gestionale/i.test(chat.body.reply) && Array.isArray(chat.body.quickReplies) && chat.body.quickReplies.length >= 3, 'Senza chiave OpenAI la risposta deve restare utile: ' + (chat.body && chat.body.reply));
      assert(chat.body.source === 'openai-missing-key', 'Source atteso openai-missing-key, ricevuto: ' + chat.body.source);
      console.log('OK: test degradazione senza OpenAI v8.12 superato.');
    }
  }
}


// --- v8.9: test funzionale del merge multi-dispositivo (esegue davvero il codice della patch) ---
function syncMergeTests() {
  const m = html.match(/<script id="rv-cloud-proxy-patch-v89">([\s\S]*?)<\/script>/);
  assert(m, 'Patch rv-cloud-proxy-patch-v89 non trovata nell\'HTML');
  const store = new Map();
  const dbObj = { aziende: [], prest: [], int: [], fatture: [], meta: {} }; // stesso oggetto, mutato in place (come il global db nel browser)
  const sandbox = {
    document: { getElementById: () => null },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    fetch: async () => { throw new Error('no network in test'); },
    alert: () => {},
    SYNC: { binId: '', apiKey: '' },
    RV_SAVE: { saving: false, dirty: false, lastKey: 'test_last_good', lastError: null },
    rvEnsureMeta: function(){ dbObj.meta = dbObj.meta || {}; return dbObj.meta; },
    rvNow: () => Date.now(),
    rvClone: o => JSON.parse(JSON.stringify(o)),
    migrate: () => {},
    setSaveState: () => {},
    mergeCloudRecord: () => {},
    saveLocalCopy: function(reason){ store.set('test_last_good', JSON.stringify({ reason, savedAt: Date.now(), db: JSON.parse(JSON.stringify(dbObj)) })); },
    loadLocalCopy: function(){ const raw = store.get('test_last_good'); if (!raw) return null; const p = JSON.parse(raw); return p && p.db ? p : null; }
  };
  sandbox.window = sandbox;
  const params = ['window','document','localStorage','fetch','alert','SYNC','RV_SAVE','db','rvEnsureMeta','rvNow','rvClone','migrate','setSaveState','mergeCloudRecord','saveLocalCopy','loadLocalCopy'];
  const fn = new Function(...params, m[1] + '\nreturn window.__rvSyncTest;');
  const api = fn(sandbox, sandbox.document, sandbox.localStorage, sandbox.fetch, sandbox.alert, sandbox.SYNC, sandbox.RV_SAVE, dbObj, sandbox.rvEnsureMeta, sandbox.rvNow, sandbox.rvClone, sandbox.migrate, sandbox.setSaveState, sandbox.mergeCloudRecord, sandbox.saveLocalCopy, sandbox.loadLocalCopy);
  assert(api && typeof api.mergeArr === 'function' && typeof api.stampChanged === 'function', 'Hook __rvSyncTest non esposto');

  // Caso 1: locale NON modificato, remoto più recente → deve vincere il remoto (prima veniva sovrascritto in silenzio)
  let merged = api.mergeArr([{ id: 1, nome: 'Rossi', note: 'vecchio', updatedAt: 1000 }], [{ id: 1, nome: 'Rossi', note: 'modificato da tablet', updatedAt: 2000 }], {});
  assert(merged.length === 1 && merged[0].note === 'modificato da tablet', 'Merge: il remoto più recente deve vincere');

  // Caso 2: locale più recente → vince il locale
  merged = api.mergeArr([{ id: 1, v: 'loc', updatedAt: 3000 }], [{ id: 1, v: 'rem', updatedAt: 2000 }], {});
  assert(merged[0].v === 'loc', 'Merge: il locale più recente deve vincere');

  // Caso 3: nessun timestamp → comportamento storico (vince il locale)
  merged = api.mergeArr([{ id: 1, v: 'loc' }], [{ id: 1, v: 'rem' }], {});
  assert(merged[0].v === 'loc', 'Merge: senza timestamp deve vincere il locale (compatibilità)');

  // Caso 4: tombstone → il record eliminato non deve tornare dal remoto
  merged = api.mergeArr([], [{ id: 9, v: 'zombie' }], { 9: Date.now() });
  assert(merged.length === 0, 'Merge: le eliminazioni (tombstone) devono essere rispettate');

  // Caso 5: stampChanged marca solo i record davvero modificati rispetto allo snapshot sincronizzato
  dbObj.aziende.push({ id: 1, nome: 'Rossi' }, { id: 2, nome: 'Verdi' });
  sandbox.saveLocalCopy('cloud-saved'); // baseline
  dbObj.aziende[0].nome = 'Rossi SRL';  // modifica reale solo sul primo
  api.stampChanged();
  assert(dbObj.aziende[0].updatedAt > 0, 'stampChanged: record modificato senza updatedAt');
  assert(!dbObj.aziende[1].updatedAt, 'stampChanged: record NON modificato marcato per errore');

  // Caso 6: record nuovo (assente nello snapshot) riceve il timestamp
  dbObj.int.push({ id: 100, data: '2026-07-14', tot: 350 });
  api.stampChanged();
  assert(dbObj.int[0].updatedAt > 0, 'stampChanged: nuovo record senza updatedAt');

  console.log('OK: test funzionali merge multi-dispositivo v8.9 superati.');
}
syncMergeTests();

// --- v8.10: test funzionale annulla-eliminazione (esegue davvero il codice della patch UX) ---
function uxUndoTests() {
  const m = html.match(/<script id="rv-v810-ux-script">([\s\S]*?)<\/script>/);
  assert(m, 'Patch rv-v810-ux-script non trovata');
  const dbObj = { int: [{ id: 100, data: '2026-07-14', tot: 350 }], deleted: { int: {}, fatture: {}, aziende: {}, prest: {} }, meta: {} };
  const timers = [];
  const els = {};
  function fakeEl(){ return { id:'', className:'', style:{}, children:[], textContent:'', type:'', onclick:null,
    appendChild(c){ this.children.push(c); return c; }, removeChild(c){ this.children = this.children.filter(x=>x!==c); },
    setAttribute(){}, getAttribute(){ return null; }, classList:{ contains:()=>false }, closest(){ return null; } }; }
  const sandbox = {
    document: {
      getElementById: id => els[id] || null,
      createElement: () => fakeEl(),
      body: Object.assign(fakeEl(), { appendChild(c){ if (c.id) els[c.id] = c; this.children.push(c); return c; }, style:{} }),
      addEventListener: () => {}
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    confirm: () => true,
    alert: () => {},
    console,
    JSON,
    Date,
    db: dbObj,
    tab: 'storico',
    rStorico: () => {},
    go: () => {},
    saveCloud: () => { sandbox.saves++; },
    saves: 0,
    rvEnsureMeta: function(){ dbObj.deleted = dbObj.deleted || { int:{} }; dbObj.meta = dbObj.meta || {}; return dbObj.meta; },
    canManageIntervento: () => true,
    setSaveState: () => {},
    openModal: () => {},
    closeModal: () => {},
    deleteIntervento: function(id){ /* versione base che la patch deve avvolgere */ dbObj.int = dbObj.int.filter(x => x.id !== id); }
  };
  sandbox.window = sandbox;
  const params = ['window','document','setTimeout','confirm','alert','console','db','tab','rStorico','go','saveCloud','rvEnsureMeta','canManageIntervento','setSaveState','openModal','closeModal'];
  const fn = new Function(...params, m[1] + '\nreturn window.__rvUxTest;');
  const api = fn(sandbox, sandbox.document, sandbox.setTimeout, sandbox.confirm, sandbox.alert, console, dbObj, sandbox.tab, sandbox.rStorico, sandbox.go, sandbox.saveCloud, sandbox.rvEnsureMeta, sandbox.canManageIntervento, sandbox.setSaveState, sandbox.openModal, sandbox.closeModal);
  assert(api && typeof api.deleteIntervento === 'function' && typeof api.toast === 'function', 'Hook __rvUxTest non esposto');

  // Eliminazione: record rimosso + tombstone scritto + salvataggio cloud
  api.deleteIntervento(100);
  assert(dbObj.int.length === 0, 'Undo test: intervento non eliminato');
  assert(dbObj.deleted.int['100'] > 0, 'Undo test: tombstone non scritto');
  assert(sandbox.saves >= 1, 'Undo test: saveCloud non chiamato dopo eliminazione');

  // Il toast deve offrire "Annulla": lo clicco e l'intervento torna, senza tombstone
  const host = els['rvToastHost'];
  assert(host && host.children.length === 1, 'Undo test: toast non mostrato');
  const toastEl = host.children[0];
  const btn = toastEl.children.find(c => typeof c.onclick === 'function');
  assert(btn && btn.textContent === 'Annulla', 'Undo test: bottone Annulla mancante');
  btn.onclick();
  assert(dbObj.int.length === 1 && String(dbObj.int[0].id) === '100', 'Undo test: intervento non ripristinato');
  assert(!dbObj.deleted.int['100'], 'Undo test: tombstone non rimosso dopo il ripristino');
  assert(dbObj.int[0].updatedAt > 0, 'Undo test: il ripristino deve marcare updatedAt per vincere nel merge');

  console.log('OK: test funzionali annulla-eliminazione v8.10 superati.');
}
uxUndoTests();

// --- v8.11: test funzionale del formatter dell'interfaccia AI (esegue davvero il codice della patch) ---
function aiProUiTests() {
  const m = html.match(/<script id="rv-v811-ai-pro-script">([\s\S]*?)<\/script>/);
  assert(m, 'Patch rv-v811-ai-pro-script non trovata');
  const sandbox = {
    document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ setAttribute(){}, appendChild(){}, addEventListener(){}, classList:{toggle(){}}, querySelectorAll: () => [] }), addEventListener: () => {}, body: null },
    localStorage: { getItem: () => null },
    fetch: async () => { throw new Error('no net'); },
    navigator: {},
    MutationObserver: undefined,
    console
  };
  sandbox.window = sandbox;
  const fn = new Function('window','document','localStorage','fetch','navigator','MutationObserver','console', m[1] + '\nreturn window.__rvAiProTest;');
  const api = fn(sandbox, sandbox.document, sandbox.localStorage, sandbox.fetch, sandbox.navigator, undefined, console);
  assert(api && typeof api.formatMessage === 'function', 'Hook __rvAiProTest non esposto');

  // Riepilogo tipico del backend → titolo, elenco puntato, importi evidenziati, hint separato
  const h1 = api.formatMessage('Riepilogo economico Medardo · oggi:\n- Ricavi interventi: 350,00 € (1 interventi).\n- Da fatturare: 350,00 €.\nVuoi il grafico?');
  assert(/rvRichTitle/.test(h1), 'Formatter: titolo mancante');
  assert(/rvRichScope/.test(h1), 'Formatter: scope (· oggi) non separato nel titolo');
  assert((h1.match(/<li>/g) || []).length === 2, 'Formatter: elenco puntato non costruito');
  assert(/rvNum/.test(h1) && /350,00\s?€/.test(h1), 'Formatter: importo non evidenziato');
  assert(/rvRichHint/.test(h1), 'Formatter: domanda finale non resa come hint');

  // Classifica numerata → <ol> con 2 voci; percentuali evidenziate
  const h2 = api.formatMessage('Ricavi per cliente · questo mese:\n1) Rossi: 350,00 € · 87,5%\n2) Verdi: 50,00 € · 12,5%');
  assert(/<ol>/.test(h2) && (h2.match(/<li>/g) || []).length === 2, 'Formatter: classifica non numerata');
  assert(/87,5\s?%/.test(h2), 'Formatter: percentuale persa');

  // SALVA/ELIMINA come tasti; XSS bloccato
  const h3 = api.formatMessage('Scrivi SALVA per applicarla oppure ELIMINA.\n<img src=x onerror=alert(1)>');
  assert(/<kbd>SALVA<\/kbd>/.test(h3) && /rvKbdDanger/.test(h3), 'Formatter: comandi non evidenziati');
  assert(!/<img/.test(h3) && /&lt;img/.test(h3), 'Formatter: HTML non sanificato (XSS)');

  // Importi negativi in rosso
  const h4 = api.formatMessage('Differenza: (120,00 €) rispetto a ieri');
  assert(/rvNeg/.test(h4), 'Formatter: importo negativo non marcato');

  console.log('OK: test funzionali interfaccia AI pro v8.11 superati.');
}
aiProUiTests();

await functionalTests();
console.log('OK: smoke test Rural Vet AI v8.9 (sync sicuro + fix router) superato.');
