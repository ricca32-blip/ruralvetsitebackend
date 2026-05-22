import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import OpenAI from 'openai';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 7000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 24000);

if (!process.env.OPENAI_API_KEY) {
  console.warn('ATTENZIONE: OPENAI_API_KEY non impostata. Il backend rispondera con errore finche non la configuri.');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-key' });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '45mb' }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN.split(',').map(s => s.trim()) }));

function safeText(value, max = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, max);
}
function asArray(value) { return Array.isArray(value) ? value : []; }
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function norm(value) {
  return safeText(value, 4000)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function euro(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num(value));
}
function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
function pad2(n) { return String(n).padStart(2, '0'); }
function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function dateFromISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
function inRange(dateString, period) {
  if (!period || !period.from || !period.to) return true;
  const d = dateFromISO(dateString);
  const a = dateFromISO(period.from);
  const b = dateFromISO(period.to);
  if (!d || !a || !b) return false;
  return d >= a && d <= b;
}
function compactDateLabel(period) {
  if (!period) return 'periodo richiesto';
  if (period.label) return period.label;
  if (period.from === period.to) return period.from;
  return `${period.from} - ${period.to}`;
}

const MONTHS = [
  ['gennaio', 0], ['febbraio', 1], ['marzo', 2], ['aprile', 3], ['maggio', 4], ['giugno', 5],
  ['luglio', 6], ['agosto', 7], ['settembre', 8], ['ottobre', 9], ['novembre', 10], ['dicembre', 11]
];
function periodFromText(text, now = new Date()) {
  const n = norm(text);
  const year = now.getFullYear();
  if (/\boggi\b/.test(n)) return { from: isoDate(now), to: isoDate(now), label: 'oggi' };
  if (/\bieri\b/.test(n)) { const d = addDays(now, -1); return { from: isoDate(d), to: isoDate(d), label: 'ieri' }; }
  if (/\bdomani\b/.test(n)) { const d = addDays(now, 1); return { from: isoDate(d), to: isoDate(d), label: 'domani' }; }
  if (/\bda inizio anno\b|\bdall inizio anno\b|\bytd\b|\bquest anno\b|\banno corrente\b|\bda gennaio\b/.test(n)) {
    return { from: `${year}-01-01`, to: isoDate(now), label: 'da inizio anno' };
  }
  if (/\banno scorso\b|\bscorso anno\b/.test(n)) return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: 'anno scorso' };
  if (/\bquesto mese\b|\bmese corrente\b/.test(n)) return { from: `${year}-${pad2(now.getMonth() + 1)}-01`, to: isoDate(now), label: 'questo mese' };
  if (/\bmese scorso\b|\bscorso mese\b/.test(n)) {
    const first = new Date(year, now.getMonth() - 1, 1);
    const last = new Date(year, now.getMonth(), 0);
    return { from: isoDate(first), to: isoDate(last), label: 'mese scorso' };
  }
  if (/\bquesta settimana\b|\bsettimana corrente\b/.test(n)) {
    const day = now.getDay() || 7;
    const start = addDays(now, 1 - day);
    return { from: isoDate(start), to: isoDate(now), label: 'questa settimana' };
  }
  if (/\bsettimana scorsa\b|\bscorsa settimana\b/.test(n)) {
    const day = now.getDay() || 7;
    const start = addDays(now, 1 - day - 7);
    const end = addDays(start, 6);
    return { from: isoDate(start), to: isoDate(end), label: 'settimana scorsa' };
  }
  for (const [name, idx] of MONTHS) {
    if (n.includes(name)) {
      const yMatch = n.match(/\b(20\d{2})\b/);
      const y = yMatch ? Number(yMatch[1]) : year;
      const first = new Date(y, idx, 1);
      const last = new Date(y, idx + 1, 0);
      return { from: isoDate(first), to: isoDate(last), label: `${name} ${y}` };
    }
  }
  const yMatch = n.match(/\b(20\d{2})\b/);
  if (/\banno\b/.test(n) && yMatch) return { from: `${yMatch[1]}-01-01`, to: `${yMatch[1]}-12-31`, label: `anno ${yMatch[1]}` };
  const iso = safeText(text).match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const d = `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
    return { from: d, to: d, label: d };
  }
  const italian = safeText(text).match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](20\d{2}|\d{2}))?\b/);
  if (italian) {
    const yy = italian[3] ? (italian[3].length === 2 ? Number('20' + italian[3]) : Number(italian[3])) : year;
    const d = `${yy}-${pad2(italian[2])}-${pad2(italian[1])}`;
    return { from: d, to: d, label: d };
  }
  return { from: `${year}-01-01`, to: isoDate(now), label: 'da inizio anno' };
}

function normalizeUser(raw) {
  if (!raw) return null;
  return { id: safeText(raw.id ?? raw.userId, 80), name: safeText(raw.name ?? raw.nome ?? raw.userName, 120), role: safeText(raw.role, 40) };
}
function compactUsers(context = {}) {
  const out = [];
  const current = normalizeUser(context.user);
  if (current && current.name) out.push(current);
  for (const u of asArray(context.users).concat(asArray(context.collaboratori)).concat(asArray(context.workers))) {
    const x = normalizeUser(u);
    if (x && x.name && !out.some(y => String(y.id) === String(x.id) || norm(y.name) === norm(x.name))) out.push(x);
  }
  return out;
}
function normalizeCompany(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    nome: safeText(raw.nome ?? raw.name, 180),
    ragioneSociale: safeText(raw.ragioneSociale ?? raw.ragione_sociale ?? raw.billName ?? raw.legalName, 240),
    addr: safeText(raw.addr ?? raw.indirizzo ?? raw.address, 260),
    comune: safeText(raw.comune ?? raw.city, 120),
    cap: safeText(raw.cap ?? raw.zip, 20),
    provincia: safeText(raw.provincia ?? raw.prov ?? raw.province, 40),
    piva: safeText(raw.piva ?? raw.partitaIva ?? raw.vat, 60),
    cf: safeText(raw.cf ?? raw.codiceFiscale ?? raw.fiscalCode, 60),
    sdi: safeText(raw.sdi ?? raw.codiceSdi ?? raw.codice_destinatario, 40),
    tel: safeText(raw.tel ?? raw.telefono ?? raw.phone, 80),
    email: safeText(raw.email ?? raw.mail, 120),
    km: num(raw.km, 0)
  };
}
function compactCompanies(context = {}) {
  const arr = asArray(context.aziende).concat(asArray(context.companies)).map(normalizeCompany).filter(a => a && (a.nome || a.ragioneSociale));
  const seen = new Set();
  return arr.filter(a => { const k = String(a.id || norm(a.nome)); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2500);
}
function normalizeService(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    nome: safeText(raw.nome ?? raw.name, 200),
    cat: safeText(raw.cat ?? raw.category, 100),
    tipo: safeText(raw.tipo ?? raw.type, 80),
    price: num(raw.price ?? raw.prezzo ?? raw.amount, 0)
  };
}
function compactServices(context = {}) {
  return asArray(context.prestazioni).concat(asArray(context.services)).map(normalizeService).filter(p => p && p.nome).slice(0, 1500);
}
function normalizeIntervention(raw, servicesCatalog = [], companies = [], users = []) {
  if (!raw) return null;
  const companyId = raw.aziendaId ?? raw.allId ?? raw.companyId;
  const company = companies.find(a => String(a.id) === String(companyId));
  const userId = raw.userId ?? raw.utenteId ?? raw.operatorId;
  const user = users.find(u => String(u.id) === String(userId));
  const rawServices = asArray(raw.prestazioni).concat(asArray(raw.servs)).concat(asArray(raw.services));
  const services = rawServices.map(s => {
    const id = s.id ?? s.serviceId;
    const catalog = servicesCatalog.find(p => String(p.id) === String(id));
    const qty = num(s.qty ?? s.quantita ?? s.quantity, 1) || 1;
    const unit = num(s.price ?? s.prezzo ?? s.unitPrice ?? catalog?.price, 0);
    return { id, nome: safeText(s.nome ?? s.name ?? catalog?.nome, 200), qty, price: unit, total: num(s.total ?? s.tot, unit * qty) };
  }).filter(s => s.nome || s.id);
  const total = num(raw.tot ?? raw.total ?? raw.totale ?? raw.amount, services.reduce((sum, s) => sum + num(s.total, s.price * s.qty), 0));
  return {
    id: raw.id,
    data: safeText(raw.data ?? raw.date, 20),
    ora: safeText(raw.ora ?? raw.time, 10),
    sessione: safeText(raw.sessione ?? raw.sess ?? raw.session, 10),
    userId,
    userName: safeText(raw.userName ?? raw.utente ?? user?.name, 120),
    aziendaId: companyId,
    azienda: safeText(raw.azienda ?? raw.companyName ?? company?.nome, 200),
    companyRagioneSociale: safeText(company?.ragioneSociale, 240),
    prestazioni: services,
    tot: total,
    fatt: !!(raw.fatt ?? raw.invoiced ?? raw.fatturato),
    note: safeText(raw.note ?? raw.notes, 500)
  };
}
function compactInterventions(context = {}, services = [], companies = [], users = []) {
  const arr = asArray(context.interventi).concat(asArray(context.interventiRecenti)).concat(asArray(context.activities));
  const seen = new Set();
  return arr.map(x => normalizeIntervention(x, services, companies, users)).filter(i => i && i.id).filter(i => { const k = String(i.id); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5000);
}
function normalizeInvoice(raw, companies = []) {
  if (!raw) return null;
  const companyId = raw.aziendaId ?? raw.allId ?? raw.companyId ?? raw.clientId;
  const company = companies.find(a => String(a.id) === String(companyId));
  return {
    id: raw.id,
    numero: safeText(raw.numero ?? raw.number ?? raw.num, 80),
    data: safeText(raw.data ?? raw.date, 20),
    aziendaId: companyId,
    azienda: safeText(raw.azienda ?? raw.companyName ?? raw.cliente ?? company?.nome, 200),
    tot: num(raw.tot ?? raw.total ?? raw.totale ?? raw.amount, 0),
    imponibile: num(raw.imponibile ?? raw.subtotal, 0),
    iva: num(raw.iva ?? raw.vat, 0),
    pagata: !!(raw.pagata ?? raw.paid),
    scadenza: safeText(raw.scadenza ?? raw.dueDate, 20),
    note: safeText(raw.note ?? raw.notes, 300)
  };
}
function compactInvoices(context = {}, companies = []) {
  return asArray(context.fatture).concat(asArray(context.invoices)).map(x => normalizeInvoice(x, companies)).filter(f => f && f.id).slice(0, 3000);
}
function compactKm(context = {}) {
  return asArray(context.km).concat(asArray(context.kmRoutes)).concat(asArray(context.routeKm)).slice(0, 2000).map(k => ({
    id: k.id,
    data: safeText(k.data ?? k.date, 20),
    userId: safeText(k.userId ?? k.workerId, 80),
    userName: safeText(k.userName ?? k.nome, 120),
    from: safeText(k.from ?? k.da, 180),
    to: safeText(k.to ?? k.a, 180),
    km: num(k.km ?? k.distance, 0),
    amount: num(k.amount ?? k.rimborso, 0)
  }));
}
function recentMemory(context = {}) {
  return asArray(context.aiMemoryRecent).slice(0, 80).map(m => ({
    at: m.at,
    userId: safeText(m.userId, 80),
    userName: safeText(m.userName, 80),
    kind: safeText(m.kind, 60),
    text: safeText(m.text, 1000)
  })).filter(m => m.text);
}

function tokenScore(query, target) {
  const q = norm(query);
  const t = norm(target);
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (q.includes(t) || t.includes(q)) return 80;
  const qTokens = new Set(q.split(' ').filter(x => x.length > 2));
  const tTokens = new Set(t.split(' ').filter(x => x.length > 2));
  if (!qTokens.size || !tTokens.size) return 0;
  let score = 0;
  for (const x of qTokens) if (tTokens.has(x)) score += 10;
  for (const x of qTokens) for (const y of tTokens) if (x.length > 4 && y.startsWith(x)) score += 4;
  return score;
}
function findCompany(text, companies) {
  const q = norm(text);
  const scored = companies.map(a => {
    const fields = [a.nome, a.ragioneSociale, a.piva, a.cf, a.sdi, a.comune].filter(Boolean);
    const score = Math.max(...fields.map(f => tokenScore(q, f)));
    return { company: a, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { match: null, alternatives: [] };
  const best = scored[0];
  const alternatives = scored.filter(x => x.score >= Math.max(15, best.score - 8)).slice(0, 8).map(x => x.company);
  return { match: best.score >= 20 ? best.company : null, alternatives };
}
function findUser(text, users) {
  const q = norm(text);
  const scored = users.map(u => ({ user: u, score: tokenScore(q, u.name) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.length && scored[0].score >= 20 ? scored[0].user : null;
}
function findService(text, services) {
  const q = norm(text);
  const scored = services.map(p => ({ service: p, score: Math.max(tokenScore(q, p.nome), tokenScore(q, p.cat)) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map(x => x.service);
}
function filterInterventions(interventions, { period, user, company, serviceText }) {
  return interventions.filter(i => {
    if (period && !inRange(i.data, period)) return false;
    if (user && String(i.userId) !== String(user.id) && norm(i.userName) !== norm(user.name)) return false;
    if (company && String(i.aziendaId) !== String(company.id) && norm(i.azienda) !== norm(company.nome)) return false;
    if (serviceText) {
      const q = norm(serviceText);
      const hit = i.prestazioni.some(p => norm(p.nome).includes(q) || q.includes(norm(p.nome)));
      if (!hit) return false;
    }
    return true;
  });
}
function filterInvoices(invoices, { period, company, paidStatus = null }) {
  return invoices.filter(f => {
    if (period && !inRange(f.data, period)) return false;
    if (company && String(f.aziendaId) !== String(company.id) && norm(f.azienda) !== norm(company.nome)) return false;
    if (paidStatus === 'paid' && !f.pagata) return false;
    if (paidStatus === 'unpaid' && f.pagata) return false;
    return true;
  });
}
function summarizeInterventions(items) {
  const total = items.reduce((s, i) => s + num(i.tot), 0);
  return { count: items.length, total };
}
function firstName(name) { return safeText(name).split(/\s+/)[0] || safeText(name); }

function looksLikeManagementQuestion(n) {
  return /\b(piva|partita iva|iva|codice fiscale|cf|sdi|indirizzo|ragione sociale|fattur|ricav|incass|pagat|da pagare|da fatturare|dashboard|quanto|quanti|interventi|prestazioni|clienti|aziende|km|chilometri|rimborso|listino|prezzo|telefono|email|mail|giornata|riepilogo)\b/.test(n);
}
function deterministicAnswer(payload) {
  const text = safeText(payload.messaggio, 5000);
  const n = norm(text);
  const context = payload._ctx;
  const { companies, services, users, interventions, invoices, kmRoutes, now } = context;
  if (!n || !looksLikeManagementQuestion(n)) return null;

  const period = periodFromText(text, now);
  const user = findUser(text, users) || (/\bmio\b|\bmi\b|\bho\b/.test(n) ? context.currentUser : null);
  const companyResult = findCompany(text, companies);
  const company = companyResult.match;

  if (/\b(piva|partita iva|codice fiscale|\bcf\b|sdi|indirizzo|ragione sociale|telefono|email|mail)\b/.test(n)) {
    if (!company) {
      const alts = companyResult.alternatives;
      if (alts.length) return { reply: 'Ho trovato piu clienti possibili: ' + alts.map((a, i) => `${i + 1}) ${a.nome}`).join(' · ') + '. Quale intendi?', action: null, learn: [] };
      return { reply: 'Non trovo quel cliente nel gestionale. Scrivimi il nome esatto o crealo con Rural Vet AI.', action: null, learn: [] };
    }
    const lines = [];
    if (/\bragione sociale\b/.test(n)) lines.push(`Ragione sociale: ${company.ragioneSociale || 'non presente'}`);
    if (/\bpiva\b|\bpartita iva\b/.test(n)) lines.push(`P.IVA: ${company.piva || 'non presente'}`);
    if (/\bcodice fiscale\b|\bcf\b/.test(n)) lines.push(`CF: ${company.cf || 'non presente'}`);
    if (/\bsdi\b/.test(n)) lines.push(`SDI: ${company.sdi || 'non presente'}`);
    if (/\bindirizzo\b|\bdove\b/.test(n)) lines.push(`Indirizzo: ${[company.addr, company.cap, company.comune, company.provincia].filter(Boolean).join(', ') || 'non presente'}`);
    if (/\btelefono\b|\btel\b/.test(n)) lines.push(`Telefono: ${company.tel || 'non presente'}`);
    if (/\bemail\b|\bmail\b/.test(n)) lines.push(`Email: ${company.email || 'non presente'}`);
    if (!lines.length) lines.push(`${company.nome}: ${company.ragioneSociale || ''} ${company.piva ? ' · P.IVA ' + company.piva : ''}`.trim());
    return { reply: lines.join('\n'), action: null, learn: [] };
  }

  if (/\bquanti\b.*\b(clienti|aziende)\b|\bnumero\b.*\b(clienti|aziende)\b/.test(n)) {
    return { reply: `Nel gestionale ci sono ${companies.length} clienti.`, action: null, learn: [] };
  }
  if (/\bquanti\b.*\binterventi\b/.test(n)) {
    const items = filterInterventions(interventions, { period, user, company });
    const parts = [];
    if (user) parts.push(firstName(user.name));
    if (company) parts.push(company.nome);
    parts.push(compactDateLabel(period));
    return { reply: `Interventi ${parts.join(' · ')}: ${items.length}. Totale: ${euro(summarizeInterventions(items).total)}.`, action: null, learn: [] };
  }

  if (/\b(fattur|ricav|incass|pagat|da pagare|da fatturare|dashboard|economico|totale)\b/.test(n)) {
    const scopeInt = filterInterventions(interventions, { period, user, company });
    const intSum = summarizeInterventions(scopeInt);
    const invScope = filterInvoices(invoices, { period, company });
    const invTot = invScope.reduce((s, f) => s + num(f.tot), 0);
    const paid = invScope.filter(f => f.pagata).reduce((s, f) => s + num(f.tot), 0);
    const unpaid = invTot - paid;
    const notInvoiced = scopeInt.filter(i => !i.fatt).reduce((s, i) => s + num(i.tot), 0);
    const who = [user ? firstName(user.name) : '', company ? company.nome : '', compactDateLabel(period)].filter(Boolean).join(' · ');
    if (/\bincass|pagat\b/.test(n) && !/da pagare/.test(n)) return { reply: `Incassato ${who}: ${euro(paid)} su ${invScope.length} fatture.`, action: null, learn: [] };
    if (/\bda pagare\b|\bnon pagat\b|\baperte\b/.test(n)) return { reply: `Da pagare ${who}: ${euro(unpaid)} su ${invScope.filter(f => !f.pagata).length} fatture aperte.`, action: null, learn: [] };
    if (/\bda fatturare\b/.test(n)) return { reply: `Da fatturare ${who}: ${euro(notInvoiced)} da ${scopeInt.filter(i => !i.fatt).length} interventi.`, action: null, learn: [] };
    if (/\bfatturato\b|\bfattur\b/.test(n) && invScope.length && !user) return { reply: `Fatturato emesso ${who}: ${euro(invTot)} (${invScope.length} fatture). Pagato: ${euro(paid)}. Da pagare: ${euro(unpaid)}.`, action: null, learn: [] };
    return { reply: `Ricavi interventi ${who}: ${euro(intSum.total)} (${intSum.count} interventi). Da fatturare: ${euro(notInvoiced)}.`, action: null, learn: [] };
  }

  if (/\b(interventi|giornata|riepilogo)\b/.test(n)) {
    const items = filterInterventions(interventions, { period, user, company }).sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.ora).localeCompare(String(b.ora)));
    if (!items.length) return { reply: `Non trovo interventi per ${[user?.name, company?.nome, compactDateLabel(period)].filter(Boolean).join(' · ')}.`, action: null, learn: [] };
    const lines = items.slice(0, 12).map(i => {
      const services = i.prestazioni.map(p => `${p.nome}${p.qty > 1 ? ' x' + p.qty : ''}`).join(', ');
      return `- ${i.data}${i.ora ? ' ' + i.ora : ''} · ${i.userName || ''} · ${i.azienda || ''} · ${services} · ${euro(i.tot)}`;
    });
    const sum = summarizeInterventions(items);
    const extra = items.length > 12 ? `\n+ altri ${items.length - 12} interventi.` : '';
    return { reply: `Riepilogo ${compactDateLabel(period)}: ${items.length} interventi, ${euro(sum.total)}.\n${lines.join('\n')}${extra}`, action: null, learn: [] };
  }

  if (/\b(prezzo|listino|quanto costa)\b/.test(n)) {
    const hits = findService(text, services);
    if (!hits.length) return { reply: 'Non trovo quella prestazione nel listino. Scrivimi il nome più preciso.', action: null, learn: [] };
    return { reply: hits.slice(0, 6).map(p => `${p.nome}: ${p.price ? euro(p.price) : 'prezzo non presente'}${p.cat ? ' · ' + p.cat : ''}`).join('\n'), action: null, learn: [] };
  }

  if (/\b(km|chilometri|rimborso)\b/.test(n)) {
    const items = kmRoutes.filter(k => (!period || inRange(k.data, period)) && (!user || String(k.userId) === String(user.id) || norm(k.userName) === norm(user.name)));
    if (!items.length) return { reply: `Non ho tratte km nel contesto per ${[user?.name, compactDateLabel(period)].filter(Boolean).join(' · ')}. Apri la pagina KM per calcolare/aggiornare le tratte.`, action: null, learn: [] };
    const kmTot = items.reduce((s, k) => s + num(k.km), 0);
    const amount = items.reduce((s, k) => s + num(k.amount), 0);
    const lines = items.slice(0, 8).map(k => `- ${k.data} · ${k.from || '?'} → ${k.to || '?'}: ${num(k.km).toFixed(1)} km`);
    return { reply: `KM ${[user?.name, compactDateLabel(period)].filter(Boolean).join(' · ')}: ${kmTot.toFixed(1)} km. Rimborso: ${euro(amount)}.\n${lines.join('\n')}`, action: null, learn: [] };
  }

  return null;
}

function buildBackendContext(reqBody) {
  const rawContext = reqBody.context || {};
  const users = compactUsers(rawContext);
  const companies = compactCompanies(rawContext);
  const services = compactServices(rawContext);
  const interventions = compactInterventions(rawContext, services, companies, users);
  const invoices = compactInvoices(rawContext, companies);
  const kmRoutes = compactKm(rawContext);
  return {
    rawContext,
    currentUser: normalizeUser(rawContext.user),
    users,
    companies,
    services,
    interventions,
    invoices,
    kmRoutes,
    memory: recentMemory(rawContext),
    now: new Date()
  };
}
function buildSystemPrompt() {
  return `
Sei Rural Vet AI, assistente operativo dentro il gestionale veterinario buiatrico Rural Vet.
Devi essere utile come assistente di studio: risposte brevi, concrete, senza inventare.

REGOLE ASSOLUTE
- Rispondi sempre in italiano.
- Per dati gestionali (dashboard, ricavi, fatture, P.IVA, clienti, interventi, km, listino) usa SOLO i dati forniti nel payload.
- Se un dato non e' nel payload, dillo chiaramente e chiedi di aggiornare/sincronizzare il gestionale. Non inventare mai numeri, P.IVA, indirizzi o fatturati.
- Prima di salvare, modificare o eliminare qualcosa, prepara sempre una proposta e chiedi conferma.
- Non dire mai "fatto" se il gestionale non ha ancora confermato il salvataggio.
- Se ci sono nomi clienti/prestazioni/interventi simili, elenca alternative numerate e chiedi scelta.

CASISTICHE OPERATIVE DA GESTIRE
1. Inserire interventi: estrai cliente, prestazioni, quantita, data, ora/sessione, note. Se manca data/ora chiedi: "Lo registro adesso o in altro giorno/ora?".
2. Eliminare interventi: cerca negli interventi recenti/forniti. Se uno solo e' sicuro, proponi eliminazione e chiedi conferma ELIMINA. Se piu' alternative, elenca numerate.
3. Modificare interventi: se chiede cambia/aggiorna/sposta, individua intervento e chiedi i dati mancanti; se non supportato dal frontend, spiega cosa serve.
4. Clienti/aziende: crea nuovo cliente se richiesto; chiedi ragione sociale, indirizzo, comune, CAP, provincia, P.IVA, CF, SDI se mancanti.
5. Domande dati: P.IVA, CF, SDI, ragione sociale, indirizzo, telefono, email, fatturato, ricavi, incassato, da pagare, da fatturare, quanti interventi, riepilogo giornata, km, listino.
6. Fatture: rispondi con dati fatture se presenti; per creare o segnare pagata, prepara proposta ma non inventare.
7. Clinica buiatrica: diagnosi probabile se possibile, massimo 2 differenziali e massimo 3 domande mirate. Niente spiegoni.
8. Istruzione/memoria: se l'utente dice ricorda/memorizza/impara, inserisci in learn solo regole durevoli, non ipotesi incerte.

FORMATO OBBLIGATORIO
Rispondi SOLO con JSON valido:
{
  "reply": "testo breve per l'utente",
  "action": null oppure una azione,
  "actions": [],
  "learn": []
}

AZIONI SUPPORTATE DAL FRONTEND ATTUALE
{
  "type": "create_intervention",
  "companyName": "nome cliente",
  "companyId": "id se certo, altrimenti vuoto",
  "services": [{"name":"prestazione", "id":"id se certo", "qty":1}],
  "date": "YYYY-MM-DD oppure vuoto",
  "time": "HH:MM oppure vuoto",
  "session": "m/p/n oppure vuoto",
  "note": "nota breve"
}
{
  "type": "delete_intervention",
  "interventionId": "id se certo",
  "query": "testo di ricerca",
  "note": "motivo breve"
}
{
  "type": "create_client",
  "name": "nome gestionale",
  "ragioneSociale": "ragione sociale fattura",
  "address": "indirizzo",
  "comune": "comune",
  "cap": "CAP",
  "provincia": "provincia",
  "piva": "P.IVA",
  "cf": "CF",
  "sdi": "SDI"
}`;
}
function payloadForOpenAI(reqBody, backendContext) {
  const rawContext = reqBody.context || {};
  return {
    messaggio: safeText(reqBody.input, MAX_INPUT_CHARS),
    utente_corrente: backendContext.currentUser,
    data_ora_backend: new Date().toISOString(),
    conteggi: {
      clienti: backendContext.companies.length,
      prestazioni: backendContext.services.length,
      interventi: backendContext.interventions.length,
      fatture: backendContext.invoices.length,
      km: backendContext.kmRoutes.length,
      memoria: backendContext.memory.length
    },
    catalogo_aziende: backendContext.companies.slice(0, 900),
    catalogo_prestazioni: backendContext.services.slice(0, 900),
    collaboratori: backendContext.users,
    interventi_recenti: backendContext.interventions.slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.ora).localeCompare(String(a.ora))).slice(0, 250),
    fatture_recenti: backendContext.invoices.slice().sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 250),
    km_recenti: backendContext.kmRoutes.slice(-120),
    memoria_recente_cloud: backendContext.memory,
    istruzioni_e_appunti_frontend: safeText(reqBody.system, 12000),
    impostazioni_ai: reqBody.settings || {},
    contatori_gestionale: rawContext.counts || {},
    foto_allegata: reqBody.image ? { name: reqBody.image.name, mime: reqBody.image.mime } : null
  };
}
function toOpenAIContent(payload, image) {
  const text = JSON.stringify(payload);
  if (!image || !image.dataUrl) return text;
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: image.dataUrl } }
  ];
}
function cleanJson(raw) {
  const text = safeText(raw, 120000).trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return { reply: text || 'Non ho capito. Scrivimi in una frase cosa vuoi fare.', action: null, actions: [], learn: [] };
}
function validateAction(parsed, ctx) {
  const action = parsed && parsed.action ? parsed.action : null;
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
  const all = action ? [action, ...actions] : actions;
  for (const a of all) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'create_intervention') {
      if (a.companyId && !ctx.companies.some(c => String(c.id) === String(a.companyId))) a.companyId = '';
      if (Array.isArray(a.services)) {
        for (const s of a.services) if (s.id && !ctx.services.some(p => String(p.id) === String(s.id))) s.id = '';
      }
    }
    if (a.type === 'delete_intervention') {
      if (a.interventionId && !ctx.interventions.some(i => String(i.id) === String(a.interventionId))) a.interventionId = '';
    }
  }
  return parsed;
}

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'Rural Vet AI backend', version: '5.0.0', model: MODEL });
});
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'rural-vet-ai', version: '5.0.0', model: MODEL, time: new Date().toISOString() });
});

app.post('/api/vet-ai-chat', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ reply: 'Backend attivo, ma manca OPENAI_API_KEY nelle variabili ambiente.', action: null, actions: [], learn: [] });
    }
    const body = req.body || {};
    const backendContext = buildBackendContext(body);
    const basePayload = payloadForOpenAI(body, backendContext);
    basePayload._ctx = backendContext;

    const deterministic = deterministicAnswer(basePayload);
    if (deterministic) {
      return res.json({ ...deterministic, actions: deterministic.actions || [], model: 'rural-vet-deterministic-v5', source: 'gestionale' });
    }

    const history = asArray(body.conversation).slice(-4).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: safeText(m.content || m.text, 1500)
    })).filter(m => m.content);

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: toOpenAIContent(basePayload, body.image) }
    ];

    const completionPromise = openai.chat.completions.create({
      model: MODEL,
      temperature: 0.08,
      response_format: { type: 'json_object' },
      messages
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout OpenAI')), OPENAI_TIMEOUT_MS));
    const completion = await Promise.race([completionPromise, timeoutPromise]);
    const raw = completion.choices?.[0]?.message?.content || '{}';
    let parsed = validateAction(cleanJson(raw), backendContext);

    res.json({
      reply: safeText(parsed.reply || 'Dimmi meglio cosa vuoi fare.', 3500),
      action: parsed.action || null,
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 12) : [],
      learn: Array.isArray(parsed.learn) ? parsed.learn.slice(0, 12) : [],
      usage: completion.usage || null,
      model: MODEL,
      source: 'openai'
    });
  } catch (err) {
    console.error('Errore /api/vet-ai-chat', err);
    res.status(500).json({
      reply: 'Errore backend AI. Non rispondo a caso: controlla log Render, chiave OpenAI e modello.',
      action: null,
      actions: [],
      learn: [],
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Rural Vet AI backend v5 attivo sulla porta ${PORT} con modello ${MODEL}`);
});
