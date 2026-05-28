import fs from 'fs';
import { execFileSync } from 'child_process';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function check(cmd, args) { execFileSync(cmd, args, { stdio: 'pipe' }); }

const serverPath = new URL('./server.js', import.meta.url).pathname;
const htmlPath = new URL('./index.html', import.meta.url).pathname;
const server = fs.readFileSync(serverPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

check(process.execPath, ['--check', serverPath]);
check(process.execPath, ['--check', new URL('./test-ai-flow.js', import.meta.url).pathname]);

const start = server.indexOf('function safeText');
const end = server.indexOf('function parseClientFields');
assert(start >= 0 && end > start, 'Non riesco a estrarre le funzioni pure dal server');
const pure = server.slice(start, end);
const api = new Function(`${pure}\nreturn { buildContext, analyticsQuery, companyInfoQuery, continueAnalyticsQuery, parseAnalyticsQuery, parseAnalyticsPeriod, findCompanyCandidates, findServiceCandidates, euro };`)();

const ctxRaw = {
  date: '2026-05-28T10:00:00.000Z',
  user: { id:'u1', name:'Dr. Test' },
  aziende: [
    { id:'c1', nome:'Rossi Mario', comune:'Parma', provincia:'PR', piva:'01234567890', tel:'333111222', email:'rossi@example.com', km:24 },
    { id:'c2', nome:'Azienda Agricola Rossi', comune:'Cremona', provincia:'CR', piva:'09876543210' },
    { id:'c3', nome:'F.lli Rossi', comune:'Piacenza', provincia:'PC' },
    { id:'c4', nome:'Rossini Giuseppe', comune:'Lodi', provincia:'LO' },
    { id:'c5', nome:'Rossetti Carlo', comune:'Modena', provincia:'MO' },
    { id:'c6', nome:'Bianchi Luca', comune:'Lodi', provincia:'LO' },
    { id:'c7', nome:'Società Agricola Bianchi', comune:'Mantova', provincia:'MN' },
    { id:'c8', nome:'F.lli Bianchini', comune:'Cremona', provincia:'CR' },
    { id:'c9', nome:'Azienda Agricola Verde', comune:'Verona', provincia:'VR' },
    { id:'c10', nome:'Verdi Mario', comune:'Parma', provincia:'PR' }
  ],
  prestazioni: [
    { id:'s1', nome:'Fecondazione artificiale', price:50 },
    { id:'s2', nome:'Fecondazione seme sessato', price:90 },
    { id:'s3', nome:'Fecondazione manza', price:55 },
    { id:'s4', nome:'Cesareo', price:350 },
    { id:'s5', nome:'Visita clinica', price:40 },
    { id:'s6', nome:'Ecografia gravidanza', price:30 },
    { id:'s7', nome:'Terapia mastite', price:80 },
    { id:'s8', nome:'Controllo post parto', price:45 }
  ],
  interventi: [
    { id:'i1', data:'2026-01-10', ora:'10:00', allId:'c1', userId:'u1', fatt:true, servs:[{id:'s1', qty:2}] },
    { id:'i2', data:'2026-02-11', ora:'11:00', allId:'c2', userId:'u1', fatt:false, servs:[{id:'s4', qty:1}] },
    { id:'i3', data:'2026-05-12', ora:'09:00', allId:'c6', userId:'u1', fatt:false, servs:[{id:'s5', qty:1},{id:'s1', qty:2}] },
    { id:'i4', data:'2026-05-20', ora:'09:00', allId:'c10', userId:'u1', fatt:true, servs:[{id:'s6', qty:3}] },
    { id:'i5', data:'2026-05-21', ora:'10:30', allId:'c1', userId:'u1', fatt:true, servs:[{id:'s4', qty:1}] },
    { id:'i6', data:'2026-04-20', ora:'10:30', allId:'c9', userId:'u1', fatt:true, servs:[{id:'s7', qty:2}] },
    { id:'i7', data:'2025-05-20', ora:'10:30', allId:'c1', userId:'u1', fatt:true, servs:[{id:'s4', qty:1}] }
  ],
  fatture: [
    { id:'f1', numero:'1', data:'2026-01-31', allId:'c1', tot:100, pagata:true },
    { id:'f2', numero:'2', data:'2026-02-28', allId:'c2', tot:350, pagata:false },
    { id:'f3', numero:'3', data:'2026-05-25', allId:'c6', tot:140, pagata:true },
    { id:'f4', numero:'4', data:'2026-05-21', allId:'c1', tot:350, pagata:false }
  ]
};
const ctx = api.buildContext({ context: ctxRaw });
ctx.now = new Date('2026-05-28T10:00:00.000Z');

let r = api.analyticsQuery('Quale azienda ha fatto maggiori ricavi la scorsa settimana?', ctx);
assert(r && /Periodo: settimana scorsa/i.test(r.reply), 'Non interpreta scorsa settimana');
assert(/Top aziende per ricavi/i.test(r.reply), 'Non costruisce top aziende');
assert(/Rossi Mario/.test(r.reply), 'Top settimana scorsa dovrebbe contenere Rossi Mario');
assert(/%/.test(r.reply), 'Top aziende deve includere percentuali');

r = api.analyticsQuery('Quale azienda ha maggiori ricavi questo mese?', ctx);
assert(r && /Periodo: questo mese/i.test(r.reply), 'Non interpreta questo mese');
assert(/Top aziende per ricavi/i.test(r.reply), 'Top aziende mese non funziona');

r = api.analyticsQuery('Quali servizi sono i più venduti questo mese?', ctx);
assert(r && /Servizi più venduti/i.test(r.reply), 'Servizi più venduti non rilevato');
assert(/q\.tà/.test(r.reply) && /€/.test(r.reply) && /%/.test(r.reply), 'Servizi più venduti deve mostrare quantità, ricavi e percentuali');

r = api.analyticsQuery('Spaccato % ricavi per servizio ultimo mese', ctx);
assert(r && /Ricavi per prestazione|Servizi più venduti/i.test(r.reply), 'Spaccato % per servizio non funziona');
assert(/%/.test(r.reply), 'Spaccato deve includere percentuali');

r = api.analyticsQuery('Quanto ha fatturato Rossi da inizio anno?', ctx);
assert(r && r.action && r.action.type === 'analytics_query', 'Rossi ambiguo deve creare pendingAnalyticsQuery');
assert((r.quickReplies || []).some(x => String(x).includes('Rossi Mario')), 'Mancano bottoni aziende Rossi');
assert((r.quickReplies || []).some(x => /Tutte le aziende Rossi/i.test(String(x))), 'Manca bottone Tutte le aziende Rossi');
let pending = r.action.query;
r = api.continueAnalyticsQuery('Tutte le aziende Rossi', pending, ctx);
assert(r && /Fatturato:/i.test(r.reply), 'Scelta Tutte le aziende Rossi non calcola fatturato');
assert(/800,00|800/.test(r.reply), 'Fatturato Rossi aggregato non coerente');

r = api.analyticsQuery('Quante fecondazioni ho fatto questo mese?', ctx);
assert(r && r.action && r.action.type === 'analytics_query', 'Fecondazioni ambigue devono chiedere scelta prestazione');
assert((r.quickReplies || []).some(x => /Tutte le prestazioni fecondazioni/i.test(String(x))), 'Manca bottone tutte le fecondazioni');
r = api.continueAnalyticsQuery('Tutte le prestazioni fecondazioni', r.action.query, ctx);
assert(/Totale:\s*2\b/.test(r.reply) || /2 prestazioni/.test(r.reply), 'Conteggio fecondazioni mese non coerente');

r = api.analyticsQuery('Quanto devo ancora fatturare da Rossi?', ctx);
assert(r && r.action && r.action.type === 'analytics_query', 'Da fatturare Rossi ambiguo deve chiedere azienda');

r = api.companyInfoQuery('PIVA di Rossi', ctx);
assert(r && r.action && r.action.type === 'analytics_query', 'PIVA di Rossi ambiguo deve chiedere azienda');
assert((r.quickReplies || []).some(x => /Rossi Mario/.test(String(x))), 'Mancano bottoni aziende per PIVA Rossi');
r = api.continueAnalyticsQuery('Rossi Mario · Parma', r.action.query, ctx);
assert(/P\.IVA: 01234567890/.test(r.reply), 'Non risponde con PIVA corretta dopo scelta azienda');

r = api.companyInfoQuery('telefono di rosi', ctx);
assert(r && /Quale azienda|Telefono/.test(r.reply), 'Fuzzy anagrafica rosi non funziona');
assert(r.reply.includes('333111222') || (r.quickReplies || []).some(x => /Rossi Mario/.test(String(x))), 'Telefono rosi deve trovare/proporre Rossi');

r = api.companyInfoQuery('indirizzo azienda inesistente xyz', ctx);
assert(r && !/Via Roma 10/.test(r.reply) && /Non ho trovato|Quale azienda|Cerca meglio/.test(r.reply), 'Azienda inesistente non deve inventare');

r = api.analyticsQuery('Quanto ho incassato questo mese?', ctx);
assert(r && /Incassato:/i.test(r.reply) && /fatture/i.test(r.reply), 'Incassato questo mese non funziona');

const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (const script of scripts) new Function(script);
assert(html.includes('pendingAnalyticsQuery'), 'Frontend non mantiene pendingAnalyticsQuery');
assert(html.includes('ctx.pendingAnalyticsQuery'), 'Frontend non invia pendingAnalyticsQuery');

console.log('OK: dashboard avanzata, servizi più venduti, percentuali, anagrafica aziende, pending analytics e sintassi frontend superati.');
