import fs from 'fs';
import vm from 'vm';
import { execFileSync } from 'child_process';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function check(cmd, args) { execFileSync(cmd, args, { stdio: 'pipe' }); }

const serverPath = new URL('./server.js', import.meta.url).pathname;
const htmlPath = new URL('./index.html', import.meta.url).pathname;
const server = fs.readFileSync(serverPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
check(process.execPath, ['--check', serverPath]);
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (const script of scripts) new Function(script);

const start = server.indexOf('function safeText');
const end = server.indexOf("app.get('/'", start);
assert(start > 0 && end > start, 'Impossibile isolare funzioni server');
const code = server.slice(start, end);
const ctxVm = { console, process: { env: {} }, Intl, Date, Number, String, Math, Set, Map, Array, RegExp, JSON };
vm.createContext(ctxVm);
vm.runInContext(code, ctxVm);

['buildContext','startInterventionWizard','continuePendingInterventionDraft','findCompanyCandidates','findServiceCandidates','validateInterventionAction','extractInterventionParts'].forEach(name => assert(typeof ctxVm[name] === 'function', 'Manca funzione reale ' + name));
assert(html.includes('pendingInterventionDraft'), 'Frontend non mantiene pendingInterventionDraft');
assert(html.includes('ctx.pendingInterventionDraft'), 'Frontend non invia pendingInterventionDraft nel context');
assert(html.includes('ctx.aziende = aziendeAll.slice(0,5000)'), 'Frontend deve inviare più aziende, non solo hit filtrati');

const baseContext = {
  user: { id: 'u1', name: 'Medardo Cammi', role: 'vet' },
  aziende: [
    { id:'c1', nome:'Rossi Mario', comune:'Parma', provincia:'PR', ragioneSociale:'Rossi Mario' },
    { id:'c2', nome:'Azienda Agricola Rossi', comune:'Cremona', provincia:'CR', ragioneSociale:'Azienda Agricola Rossi S.S.' },
    { id:'c3', nome:'F.lli Rossi', comune:'Piacenza', provincia:'PC', ragioneSociale:'Soc. Agr. F.lli Rossi S.S.' },
    { id:'c4', nome:'Rossini Giuseppe', comune:'Lodi', provincia:'LO' },
    { id:'c5', nome:'Rossetti Carlo', comune:'Modena', provincia:'MO' },
    { id:'c6', nome:'Bianchi Luca', comune:'Lodi', provincia:'LO' },
    { id:'c7', nome:'Società Agricola Bianchi', comune:'Mantova', provincia:'MN' },
    { id:'c8', nome:'F.lli Bianchini', comune:'Cremona', provincia:'CR' },
    { id:'c9', nome:'Azienda Agricola Verde', comune:'Verona', provincia:'VR' },
    { id:'c10', nome:'Verdi Mario', comune:'Parma', provincia:'PR' }
  ],
  prestazioni: [
    { id:'s1', nome:'Fecondazione artificiale', price:20 },
    { id:'s2', nome:'Fecondazione artificiale prima', price:22 },
    { id:'s3', nome:'Fecondazione artificiale seconda', price:22 },
    { id:'s4', nome:'Fecondazione seme sessato', price:30 },
    { id:'s5', nome:'Fecondazione manza', price:20 },
    { id:'s6', nome:'Inseminazione bovina', price:21 },
    { id:'s7', nome:'Cesareo', price:300 },
    { id:'s8', nome:'Visita clinica', price:45 },
    { id:'s9', nome:'Visita riproduttiva', price:45 },
    { id:'s10', nome:'Ecografia gravidanza', price:35 },
    { id:'s11', nome:'Terapia mastite', price:60 },
    { id:'s12', nome:'Controllo post parto', price:40 }
  ],
  interventiRecenti: []
};
function build() { return ctxVm.buildContext({ context: JSON.parse(JSON.stringify(baseContext)) }); }

let ctx = build();
let res = ctxVm.startInterventionWizard('2 fecondazioni rossi', ctx);
assert(res.action?.type === 'intervention_draft', 'Step1 deve creare bozza');
assert(res.action.draft.services[0].qty === 2, 'Step1 deve mantenere qty=2');
assert(res.action.draft.companyRaw === 'rossi', 'Step1 deve estrarre companyRaw=rossi');
assert(res.ui.awaiting === 'service_choice', 'Step1 deve chiedere prestazione');
assert(res.quickReplies.some(x => String(x).includes('Fecondazione artificiale')), 'Step1 deve proporre fecondazioni reali');
assert(res.ui.safeToApply === false, 'Step1 non applicabile');
let draft = res.action.draft;
res = ctxVm.continuePendingInterventionDraft('Fecondazione artificiale', draft, ctx);
assert(res.action?.draft?.services?.[0]?.serviceId === 's1', 'Step2 deve assegnare s1');
assert(res.action.draft.services[0].qty === 2, 'Step2 non deve perdere qty=2');
assert(res.ui.awaiting === 'company_choice', 'Step2 deve chiedere azienda');
assert(res.quickReplies.some(x => String(x).includes('Rossi Mario')), 'Step2 deve proporre Rossi Mario');
assert(res.quickReplies.some(x => String(x).includes('F.lli Rossi')), 'Step2 deve proporre F.lli Rossi');
draft = res.action.draft;
res = ctxVm.continuePendingInterventionDraft('Rossi Mario · Parma', draft, ctx);
assert(res.action?.draft?.companyId === 'c1', 'Step3 deve assegnare c1');
assert(res.ui.awaiting === 'datetime_choice', 'Step3 deve chiedere data/ora');
draft = res.action.draft;
res = ctxVm.continuePendingInterventionDraft('ADESSO', draft, ctx);
assert(res.ui.awaiting === 'confirm', 'Step4 deve arrivare a conferma');
assert(res.ui.safeToApply === true, 'Step4 safeToApply true solo alla fine');
assert(res.action?.type === 'create_intervention', 'Step4 deve produrre create_intervention');
assert(res.action.companyId === 'c1', 'Step4 companyId reale');
assert(res.action.services[0].id === 's1', 'Step4 serviceId reale');
assert(res.action.services[0].qty === 2, 'Step4 qty ancora 2');

ctx = build();
res = ctxVm.startInterventionWizard('fecondazione artif. prima + cesareo da rossi', ctx);
draft = res.action.draft;
assert(draft.services.length === 2, 'Multiprestazione deve creare due services nella stessa bozza');
assert(draft.services[0].rawText.includes('fecondazione'), 'Prima prestazione fecondazione');
assert(draft.services[1].rawText.includes('cesareo'), 'Seconda prestazione cesareo');
res = ctxVm.continuePendingInterventionDraft('Fecondazione artificiale prima', draft, ctx);
draft = res.action.draft;
if (res.ui.awaiting === 'service_choice') res = ctxVm.continuePendingInterventionDraft('Cesareo', draft, ctx);
draft = res.action.draft || draft;
assert((draft.services || []).length === 2, 'La bozza deve restare un unico intervento con 2 prestazioni');

for (const [q, must] of [['ross','Rossi'], ['rosi','Rossi'], ['flli rossi','F.lli Rossi'], ['azienda agricola rossi','Azienda Agricola Rossi'], ['rossi parma','Rossi Mario'], ['bian','Bianchi'], ['ver','Verd']]) {
  const list = ctxVm.findCompanyCandidates(q, ctx.companies, { max: 8 });
  assert(list.length > 0, 'Nessun candidato per ' + q);
  assert(list.some(x => String(x.label).includes(must)), 'Manca candidato atteso per ' + q + ': ' + must + ' in ' + list.map(x=>x.label).join(', '));
}

// tre flussi consecutivi: ogni bozza nuova deve partire pulita e non ereditare dati vecchi
for (const input of ['2 fecondazioni rossi', 'cesareo bianchi', 'eco verdi']) {
  ctx = build();
  res = ctxVm.startInterventionWizard(input, ctx);
  assert(res.action?.type === 'intervention_draft', 'Flusso non parte per ' + input);
  assert(res.ui.safeToApply === false, 'Nuova bozza non deve essere subito applicabile: ' + input);
}

console.log('OK: wizard interventi reale, multiprestazione, stato, safeToApply e matching aziende superati.');
