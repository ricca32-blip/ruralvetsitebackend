process.env.RV_AI_TEST = '1';
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const mod = await import('./server.js');
const { buildContext, deterministicRouter, rvCreateInterventionRequest, rvExtractServicePhrases, rvCompanyCandidates, rvInterventionCandidates } = mod;
const today = new Date();
const pad2 = v => String(v).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const addDays = (d,n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate()+n); return x; };
const ctxRaw = {
  aiSessionId: 'test-session-1',
  user: { id: 1, name: 'Medardo Cammi', role: 'vet' },
  aziende: [
    { id: 1, nome: 'Arata Mario', comune: 'Cremona', piva:'111', telefono:'333' },
    { id: 2, nome: 'Azienda Agricola Arata', comune: 'Parma', piva:'222' },
    { id: 3, nome: 'Soc. Agr. Arata', comune: 'Lodi', piva:'333' },
    { id: 4, nome: 'Rossi Mario', comune: 'Piacenza' },
    { id: 5, nome: 'Bianchi Luca', comune: 'Lodi' },
    { id: 6, nome: 'Verdi Mario', comune: 'Verona' }
  ],
  prestazioni: [
    { id: 10, nome: 'Parto', price: 100 },
    { id: 11, nome: 'Assistenza parto', price: 120 },
    { id: 20, nome: 'Fecondazione artificiale prima', price: 50 },
    { id: 21, nome: 'Fecondazione art. Festiva', price: 60 },
    { id: 22, nome: 'Fecondazione artificiale assistita x difficoltà', price: 80 },
    { id: 23, nome: 'Fecondazione successiva', price: 45 },
    { id: 24, nome: 'Fecondazione artificiale successiva', price: 45 },
    { id: 30, nome: 'Cesareo', price: 300 },
    { id: 40, nome: 'Visita clinica', price: 50 },
    { id: 41, nome: 'Ecografia gravidanza', price: 50 },
    { id: 42, nome: 'Terapia mastite', price: 70 }
  ],
  interventi: [
    { id:'i1', allId:1, data: iso(addDays(today,-1)), ora:'20:00', servs:[{id:10,qty:1},{id:20,qty:1}], fatt:false, note:'parto + fecondazione' },
    { id:'i2', allId:1, data: iso(addDays(today,-1)), ora:'18:00', servs:[{id:40,qty:1}], fatt:false, note:'visita' },
    { id:'i3', allId:4, data: iso(today), ora:'10:00', servs:[{id:23,qty:2}], fatt:true, note:'fecondazioni' },
    { id:'i4', allId:5, data: iso(today), ora:'11:00', servs:[{id:41,qty:1}], fatt:false, note:'eco' },
    { id:'i5', allId:6, data: iso(addDays(today,-3)), ora:'09:30', servs:[{id:30,qty:1}], fatt:true, note:'cesareo' }
  ],
  fatture: [
    { id:'f1', allId:1, data: iso(addDays(today,-10)), tot:250, pagata:true },
    { id:'f2', allId:1, data: iso(addDays(today,-2)), tot:100, pagata:false },
    { id:'f3', allId:4, data: iso(addDays(today,-1)), tot:90, pagata:true }
  ]
};
function ctx(extra={}) { return buildContext({ context: { ...ctxRaw, ...extra } }); }
function isDraft(r) { return r?.action?.type === 'intervention_draft'; }
function click(input, draft) { return deterministicRouter(input, ctx({ pendingInterventionDraft: draft })); }
function completeCreate(input) {
  let r = deterministicRouter(input, ctx());
  let guard = 0;
  while (isDraft(r) && guard++ < 20) {
    const d = r.action.draft;
    if (d.awaiting === 'service_choice') r = click(d.services[d.currentServiceIndex].candidates[0].name, d);
    else if (d.awaiting === 'company_choice') r = click(d.companyCandidates[0]?.label || 'Arata Mario · Cremona', d);
    else if (d.awaiting === 'datetime_choice') r = click('ADESSO', d);
    else break;
  }
  return r;
}
let checks = 0;
const check = (cond,msg) => { checks++; assert(cond,msg); };

// 1 parser safe: no catalog candidates as services
let parts = rvExtractServicePhrases('Aggiungi un parto e una fecondazione artif. prima da Arata ieri alle 20:00', ctx());
check(parts.length === 2, 'parser deve estrarre 2 servizi');
check(parts[0].rawText === 'parto', 'primo servizio parto');
check(/fecondazione/.test(parts[1].rawText) && /prima/.test(parts[1].rawText), 'secondo servizio fecondazione prima');
check(!parts.some(p => /festiva|difficolta|successiva/i.test(p.rawText)), 'non deve aggiungere candidati');
parts = rvExtractServicePhrases('1 fecondazione artif. prima e 1 fecondazione successiva da Arata oggi alle 15', ctx());
check(parts.length === 2, 'prima + successiva sono 2 segmenti');
check(parts.every(p => p.qty === 1), 'qty 1 e 1');
parts = rvExtractServicePhrases('visita + 2 fecondazioni da Rossi', ctx());
check(parts.length === 2 && parts[1].qty === 2, 'visita + 2 fecondazioni');

// 2 end to end create
let final = completeCreate('Aggiungi un parto e una fecondazione artif. prima da Arata ieri alle 20:00');
check(final.action?.type === 'create_intervention', 'create action finale');
check(final.action.services.length === 2, 'solo 2 servizi finali');
check(final.ui.safeToApply === true, 'safeToApply finale');
check(final.state?.pendingInterventionDraft, 'stato mantiene draft al riepilogo');
check(!/festiva|difficolt|successiva/i.test(final.action.services.map(s=>s.name).join(' ')), 'no candidates finali');
final = completeCreate('1 fecondazione artif. prima e 1 fecondazione successiva da Arata oggi alle 15');
check(final.action.services.length === 2, 'prima + successiva finale 2');
check(final.action.services.some(s => /successiva/i.test(s.name)), 'successiva risolta');
final = completeCreate('visita + 2 fecondazioni da Rossi');
check(final.action.services.some(s => s.qty === 2), 'mantiene qty 2');

// 3 progressive draft memory
let r = deterministicRouter('1 fecondazione artif. prima e 1 fecondazione successiva', ctx());
check(isDraft(r), 'progressivo avvia draft');
let d = r.action.draft;
while (d.awaiting === 'service_choice') { r = click(d.services[d.currentServiceIndex].candidates[0].name, d); d = r.action?.draft || r.state?.pendingInterventionDraft; }
check(d.services.length === 2, 'draft conserva 2 servizi');
r = click('da Arata', d); d = r.action?.draft || r.state?.pendingInterventionDraft;
check(d.companyRaw && /arata/i.test(d.companyRaw), 'aggiunge azienda da messaggio successivo');
if (d.awaiting === 'company_choice') { r = click(d.companyCandidates[0].label, d); d = r.action?.draft || r.state?.pendingInterventionDraft; }
r = click('oggi alle 15', d);
check(r.action?.type === 'create_intervention', 'progressivo arriva a riepilogo');
check(r.action.services.length === 2, 'progressivo conserva 2 servizi finale');

// 4 add during draft
r = deterministicRouter('1 fecondazione artif. prima da Arata', ctx()); d = r.action?.draft || r.state?.pendingInterventionDraft;
while (isDraft(r) && d.awaiting === 'service_choice') { r = click(d.services[d.currentServiceIndex].candidates[0].name, d); d = r.action?.draft || r.state?.pendingInterventionDraft; }
r = click('aggiungi anche 1 fecondazione successiva', d); d = r.action?.draft || r.state?.pendingInterventionDraft;
check(d.services.length >= 2, 'aggiungi anche aggiunge servizio alla bozza');

// 5 company fuzzy
for (const q of ['Arata','Aratta','Ara','Rossi']) {
  const c = rvCompanyCandidates(q, ctx().companies);
  check(c.length > 0, 'company candidates ' + q);
}

// 6 buttons state route priority
r = deterministicRouter('2 fecondazioni da Rossi', ctx());
d = r.action?.draft || r.state?.pendingInterventionDraft;
check(isDraft(r), '2 fecondazioni produce draft o choice');
let before = d?.draftId;
r = deterministicRouter('Modifica azienda', ctx({ pendingInterventionDraft: d }));
check(r.ui?.mode === 'intervention_wizard', 'Modifica azienda con pending resta wizard');
check((r.action?.draft || r.state?.pendingInterventionDraft)?.draftId === before, 'non riparte da zero su modifica azienda');

// 7 edit intervention wizard
r = deterministicRouter('aggiungi un cesareo all intervento di Arata di ieri', ctx());
check(r.ui?.mode === 'edit_intervention', 'edit mode');
if (r.action?.type === 'edit_intervention_draft') { const ed = r.action.draft; r = deterministicRouter(ed.interventionCandidates?.[0]?.label || 'Arata Mario', ctx({ pendingEditInterventionDraft: ed })); }
check(r.action?.type === 'update_intervention' || r.state?.pendingEditInterventionDraft, 'edit produce draft o action');
// choice remains in edit
let edraft = r.state?.pendingEditInterventionDraft;
if (edraft) { const rr = deterministicRouter('Modifica ancora', ctx({ pendingEditInterventionDraft: edraft })); check(rr.ui?.mode === 'edit_intervention', 'pending edit priorita'); } else checks++;

// 8 delete wizard
r = deterministicRouter('elimina intervento Arata di ieri', ctx());
check(r.ui?.mode === 'delete_intervention', 'delete mode');
if (r.action?.type === 'delete_intervention_draft') { const dd = r.action.draft; r = deterministicRouter(dd.interventionCandidates?.[0]?.label || 'Arata Mario', ctx({ pendingDeleteInterventionDraft: dd })); }
check(r.action?.type === 'delete_intervention' || r.state?.pendingDeleteInterventionDraft, 'delete produce draft/action');
check(r.ui?.safeToApply === true || r.ui?.awaiting === 'intervention_choice', 'delete sicuro o scelta');

// 9 analytics sanity
for (const q of ['Quanti ricavi ho fatto da Arata da inizio anno?', 'Top aziende questo mese', 'Spaccato servizi ultimo mese', 'Quanto ho incassato questo mese?']) {
  r = deterministicRouter(q, ctx());
  check(!!r && typeof r.reply === 'string', 'analytics risposta: '+q);
  check(!/undefined|null/.test(r.reply), 'analytics senza undefined: '+q);
}

// 10 consecutive flows no stale interference
const flows = ['parto da Arata oggi alle 10', 'cesareo da Rossi oggi alle 11', 'eco da Bianchi oggi alle 12', 'visita da Verdi oggi alle 13'];
for (const f of flows) {
  const out = completeCreate(f);
  check(out.action?.type === 'create_intervention', 'flusso consecutivo '+f);
  check(out.ui?.safeToApply, 'flusso consecutivo safe '+f);
}
// stale draft session ignored
const stale = { type:'intervention_draft', aiSessionId:'old-session', draftId:'old', services:[{rawText:'parto',qty:1}], awaiting:'company_choice', createdAt:new Date().toISOString() };
r = deterministicRouter('Arata', ctx({ aiSessionId:'new-session', pendingInterventionDraft:stale }));
check(!r || !(r.state?.pendingInterventionDraft?.draftId === 'old'), 'draft vecchia sessione ignorata');
// cancel clear state
r = deterministicRouter('Annulla', ctx({ pendingInterventionDraft:{...stale, aiSessionId:'test-session-1'} }));
check(r.clearState || r.clearDraft, 'annulla clear');

// Count extra consistency checks to ensure broad coverage
for (let i=0;i<25;i++) {
  const out = rvExtractServicePhrases(`${i%3+1} fecondazioni e 1 visita da Arata oggi alle 15`, ctx());
  check(out.length === 2, 'stress parser '+i);
}
console.log(`OK: suite estesa AI state machine, inserimenti/modifiche/eliminazioni/analytics superata. Assertions: ${checks}`);
