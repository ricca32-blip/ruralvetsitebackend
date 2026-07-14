import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import OpenAI from 'openai';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 9000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 24000);
const VERSION = '8.12.0-paste-and-go-ai-hardening';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-key' });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: process.env.JSON_LIMIT || '12mb' }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN.split(',').map(s => s.trim()) }));
app.options('*', cors());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function safeText(value, max = 5000) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, max);
}
function asArray(value) { return Array.isArray(value) ? value : []; }
function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') value = value.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const n = norm(value);
  return ['true','si','sì','yes','1','pagata','fatturato','fatturata'].includes(n);
}
function norm(value) {
  return safeText(value, 8000)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' e ')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function euro(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num(value));
}
function pad2(v) { return String(v).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function dateFromISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function addDays(date, days) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() + days); return d; }
function startOfWeek(now) { const day = now.getDay() || 7; return addDays(now, 1 - day); }
function lastDayOfMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0); }
function inRange(dateString, period) {
  if (!period || !period.from || !period.to) return true;
  const d = dateFromISO(dateString);
  const a = dateFromISO(period.from);
  const b = dateFromISO(period.to);
  if (!d || !a || !b) return false;
  return d >= a && d <= b;
}
function periodLabel(period) {
  if (!period) return 'periodo non specificato';
  if (period.label) return period.label;
  if (period.from === period.to) return period.from;
  return `${period.from} - ${period.to}`;
}
function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const MONTHS = [
  ['gennaio',0], ['febbraio',1], ['marzo',2], ['aprile',3], ['maggio',4], ['giugno',5],
  ['luglio',6], ['agosto',7], ['settembre',8], ['ottobre',9], ['novembre',10], ['dicembre',11]
];
const STOP_TOKENS = new Set('azienda aziende agricola agricolo societa societa ss s ssa soc soc agr agric cascina allevamento allevamenti fratelli sorelle f lli flli di da del della dei delle de la il lo le gli un una uno e con per at in dal dallo dalla alla allo alle agli nella nello nelle nei negli cliente clienti ditta aziendale'.split(' '));
const NUMBER_WORDS = new Map([
  ['un',1], ['uno',1], ['una',1], ['due',2], ['tre',3], ['quattro',4], ['cinque',5], ['sei',6], ['sette',7], ['otto',8], ['nove',9], ['dieci',10]
]);

function parseItalianDate(text, now = new Date()) {
  const raw = safeText(text, 4000);
  const n = norm(raw);
  let m = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](20\d{2}|\d{2}))?\b/);
  if (m) {
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
  }
  if (/\boggi\b/.test(n)) return isoDate(now);
  if (/\bdopodomani\b|\bdopo domani\b/.test(n)) return isoDate(addDays(now, 2));
  if (/\baltroieri\b|\baltro ieri\b|\bl altro ieri\b/.test(n)) return isoDate(addDays(now, -2));
  if (/\bieri\b/.test(n)) return isoDate(addDays(now, -1));
  if (/\bdomani\b/.test(n)) return isoDate(addDays(now, 1));
  for (const [name, idx] of MONTHS) {
    const rx = new RegExp('\\b(\\d{1,2})\\s+' + name + '(?:\\s+(20\\d{2}|\\d{2}))?\\b');
    m = n.match(rx);
    if (m) {
      let y = m[2] ? Number(m[2]) : now.getFullYear();
      if (y < 100) y += 2000;
      return `${y}-${pad2(idx + 1)}-${pad2(m[1])}`;
    }
  }
  return '';
}
function parseTime(text) {
  const raw = safeText(text, 2000);
  let m = raw.match(/(?:\balle\b|\bore\b)?\s*(\d{1,2})[:.](\d{2})\b/i);
  if (m) return `${pad2(m[1])}:${pad2(m[2])}`;
  m = raw.match(/(?:\balle\b|\bore\b)\s*(\d{1,2})\b/i);
  if (m) return `${pad2(m[1])}:00`;
  return '';
}
function sessionFromText(text, time = '') {
  const n = norm(text);
  if (/\bmattina\b|\bmattino\b/.test(n)) return 'm';
  if (/\bpomeriggio\b|\bpomeridiano\b/.test(n)) return 'p';
  if (/\bsera\b|\bserale\b|\bnotte\b|\bnotturn/.test(n)) return 'n';
  if (time) { const h = Number(time.slice(0,2)); return h < 13 ? 'm' : (h < 20 ? 'p' : 'n'); }
  return '';
}
function parsePeriod(text, now = new Date(), fallback = 'ytd') {
  const raw = safeText(text, 4000);
  const n = norm(raw);
  const year = now.getFullYear();

  const rangeMatch = raw.match(/(?:dal|da)\s+(\d{1,2}[\/.-]\d{1,2}(?:[\/.-](?:20\d{2}|\d{2}))?)\s+(?:al|a)\s+(\d{1,2}[\/.-]\d{1,2}(?:[\/.-](?:20\d{2}|\d{2}))?)/i);
  if (rangeMatch) {
    const from = parseItalianDate(rangeMatch[1], now);
    const to = parseItalianDate(rangeMatch[2], now);
    if (from && to) return { from, to, label: `${from} - ${to}` };
  }
  if (/\boggi\b/.test(n)) return { from: isoDate(now), to: isoDate(now), label: 'oggi' };
  if (/\bieri\b/.test(n)) { const d = addDays(now, -1); return { from: isoDate(d), to: isoDate(d), label: 'ieri' }; }
  if (/\bdomani\b/.test(n)) { const d = addDays(now, 1); return { from: isoDate(d), to: isoDate(d), label: 'domani' }; }
  if (/\bda inizio anno\b|\bdall inizio anno\b|\bda gennaio\b|\bytd\b|\bquest anno\b|\banno corrente\b|\bda inizio\b/.test(n)) return { from: `${year}-01-01`, to: isoDate(now), label: 'da inizio anno' };
  if (/\banno scorso\b|\bscorso anno\b/.test(n)) return { from: `${year-1}-01-01`, to: `${year-1}-12-31`, label: 'anno scorso' };
  const yOnly = n.match(/\b(20\d{2})\b/);
  if (/\banno\b/.test(n) && yOnly) return { from: `${yOnly[1]}-01-01`, to: `${yOnly[1]}-12-31`, label: `anno ${yOnly[1]}` };
  if (/\bquesto mese\b|\bmese corrente\b/.test(n)) return { from: `${year}-${pad2(now.getMonth()+1)}-01`, to: isoDate(now), label: 'questo mese' };
  if (/\bmese scorso\b|\bscorso mese\b/.test(n)) { const first = new Date(year, now.getMonth()-1, 1); const last = new Date(year, now.getMonth(), 0); return { from: isoDate(first), to: isoDate(last), label: 'mese scorso' }; }
  if (/\bquesta settimana\b|\bsettimana corrente\b/.test(n)) { const first = startOfWeek(now); return { from: isoDate(first), to: isoDate(now), label: 'questa settimana' }; }
  if (/\bsettimana scorsa\b|\bscorsa settimana\b/.test(n)) { const first = addDays(startOfWeek(now), -7); const last = addDays(first, 6); return { from: isoDate(first), to: isoDate(last), label: 'settimana scorsa' }; }
  let m = n.match(/\bultim[ioe]?\s+(\d+)\s+giorn/);
  if (m) return { from: isoDate(addDays(now, -Number(m[1]) + 1)), to: isoDate(now), label: `ultimi ${m[1]} giorni` };
  m = n.match(/\bultim[ae]?\s+(\d+)\s+settiman/);
  if (m) return { from: isoDate(addDays(now, -Number(m[1]) * 7 + 1)), to: isoDate(now), label: `ultime ${m[1]} settimane` };
  for (const [name, idx] of MONTHS) {
    if (n.includes(name)) {
      const ym = n.match(/\b(20\d{2})\b/);
      const y = ym ? Number(ym[1]) : year;
      return { from: isoDate(new Date(y, idx, 1)), to: isoDate(lastDayOfMonth(y, idx)), label: `${name} ${y}` };
    }
  }
  const oneDay = parseItalianDate(raw, now);
  if (oneDay) return { from: oneDay, to: oneDay, label: oneDay };
  if (fallback === 'all') return null;
  if (fallback === 'today') return { from: isoDate(now), to: isoDate(now), label: 'oggi' };
  if (fallback === 'month') return { from: `${year}-${pad2(now.getMonth()+1)}-01`, to: isoDate(now), label: 'questo mese' };
  if (fallback === 'week') { const first = startOfWeek(now); return { from: isoDate(first), to: isoDate(now), label: 'questa settimana' }; }
  return { from: `${year}-01-01`, to: isoDate(now), label: 'da inizio anno' };
}
function parseWhen(text, now = new Date()) {
  const date = parseItalianDate(text, now);
  const time = parseTime(text);
  const session = sessionFromText(text, time);
  const n = norm(text);
  if (/\badesso\b|\bora\b|\bsubito\b|\bfatto ora\b|\bappena fatto\b/.test(n)) {
    return { date: isoDate(now), time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`, session: sessionFromText(text, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`), explicit: true, now: true };
  }
  return { date, time, session, explicit: !!(date || time || session), now: false };
}

function normalizeUser(raw) {
  if (!raw) return null;
  const name = safeText(raw.name ?? raw.nome ?? raw.userName ?? raw.label, 140);
  if (!name) return null;
  return { id: safeText(raw.id ?? raw.userId ?? raw.uid ?? name, 80), name, role: safeText(raw.role ?? raw.ruolo, 40), aliases: [name, raw.id].filter(Boolean).map(x => norm(x)) };
}
function compactUsers(context = {}) {
  const raw = [];
  if (context.user) raw.push(context.user);
  raw.push(...asArray(context.users), ...asArray(context.collaboratori), ...asArray(context.workers));
  return uniqueBy(raw.map(normalizeUser).filter(Boolean), u => String(u.id || norm(u.name))).slice(0, 100);
}
function normalizeCompany(raw) {
  if (!raw) return null;
  const nome = safeText(raw.nome ?? raw.name ?? raw.cliente ?? raw.label, 220);
  const ragioneSociale = safeText(raw.ragioneSociale ?? raw.ragione_sociale ?? raw.billName ?? raw.legalName ?? raw.azRagioneSociale, 260);
  if (!nome && !ragioneSociale) return null;
  const addr = safeText(raw.addr ?? raw.indirizzo ?? raw.address ?? raw.azAddr, 300);
  const comune = safeText(raw.comune ?? raw.city, 150);
  const cap = safeText(raw.cap ?? raw.zip, 20);
  const provincia = safeText(raw.provincia ?? raw.prov ?? raw.province, 40);
  return {
    id: raw.id ?? raw.azId ?? raw.aziendaId ?? raw.allId ?? raw.companyId ?? raw.clientId,
    nome,
    ragioneSociale,
    addr,
    indirizzo: addr,
    comune,
    cap,
    provincia,
    piva: safeText(raw.piva ?? raw.partitaIva ?? raw.vat ?? raw.azPiva, 80),
    cf: safeText(raw.cf ?? raw.codiceFiscale ?? raw.fiscalCode ?? raw.azCf, 80),
    sdi: safeText(raw.sdi ?? raw.codiceSdi ?? raw.codice_destinatario ?? raw.azSdi, 60),
    tel: safeText(raw.tel ?? raw.telefono ?? raw.phone, 100),
    email: safeText(raw.email ?? raw.mail, 140),
    km: num(raw.km ?? raw.kmFallback, 0),
    raw
  };
}
function compactCompanies(context = {}) {
  const raw = [...asArray(context.aziende), ...asArray(context.companies), ...asArray(context.clients), ...asArray(context.clienti)];
  return uniqueBy(raw.map(normalizeCompany).filter(Boolean), c => String(c.id || norm(c.nome || c.ragioneSociale))).slice(0, 5000);
}
function normalizeService(raw) {
  if (!raw) return null;
  const nome = safeText(raw.nome ?? raw.name ?? raw.label, 220);
  if (!nome) return null;
  return { id: raw.id ?? raw.serviceId ?? raw.prestazioneId, nome, cat: safeText(raw.cat ?? raw.category ?? raw.categoria, 120), tipo: safeText(raw.tipo ?? raw.type, 80), price: num(raw.price ?? raw.prezzo ?? raw.amount ?? raw.unitPrice, 0), raw };
}
function compactServices(context = {}) {
  const raw = [...asArray(context.prestazioni), ...asArray(context.services), ...asArray(context.prest), ...asArray(context.listino)];
  return uniqueBy(raw.map(normalizeService).filter(Boolean), s => String(s.id || norm(s.nome))).slice(0, 3000);
}
function normalizeIntervention(raw, ctx) {
  if (!raw) return null;
  const companyId = raw.aziendaId ?? raw.allId ?? raw.companyId ?? raw.clientId ?? raw.azId;
  const company = ctx.companies.find(c => String(c.id) === String(companyId));
  const userId = raw.userId ?? raw.utenteId ?? raw.operatorId ?? raw.collaboratoreId;
  const user = ctx.users.find(u => String(u.id) === String(userId));
  const rawServices = [...asArray(raw.prestazioni), ...asArray(raw.servs), ...asArray(raw.services), ...asArray(raw.voci)];
  const services = rawServices.map(s => {
    const id = s.id ?? s.serviceId ?? s.prestazioneId;
    const catalog = ctx.services.find(p => String(p.id) === String(id));
    const qty = Math.max(1, num(s.qty ?? s.quantita ?? s.quantity ?? s.qta, 1));
    const price = num(s.price ?? s.prezzo ?? s.unitPrice ?? catalog?.price, 0);
    return { id, nome: safeText(s.nome ?? s.name ?? catalog?.nome, 220), qty, price, total: num(s.total ?? s.tot, price * qty) };
  }).filter(s => s.nome || s.id);
  const total = num(raw.tot ?? raw.total ?? raw.totale ?? raw.amount, services.reduce((sum, s) => sum + num(s.total, s.price * s.qty), 0));
  const date = safeText(raw.data ?? raw.date, 20);
  const id = raw.id ?? raw.intId ?? raw.activityId;
  if (!id && !date && !services.length) return null;
  return {
    id,
    data: date,
    ora: safeText(raw.ora ?? raw.time, 10),
    sess: safeText(raw.sess ?? raw.sessione ?? raw.session, 10),
    userId,
    userName: safeText(raw.userName ?? raw.utente ?? raw.operatore ?? user?.name, 140),
    aziendaId: companyId,
    azienda: safeText(raw.azienda ?? raw.companyName ?? raw.cliente ?? company?.nome, 220),
    companyRagioneSociale: safeText(company?.ragioneSociale, 260),
    prestazioni: services,
    tot: total,
    fatt: bool(raw.fatt ?? raw.invoiced ?? raw.fatturato),
    note: safeText(raw.note ?? raw.notes, 600),
    raw
  };
}
function compactInterventions(context = {}, ctx) {
  const raw = [...asArray(context.interventi), ...asArray(context.interventiRecenti), ...asArray(context.activities), ...asArray(context.interventions), ...asArray(context.int)];
  return uniqueBy(raw.map(x => normalizeIntervention(x, ctx)).filter(Boolean), i => String(i.id || [i.data, i.ora, i.azienda, i.userName, i.prestazioni.map(p => p.nome).join(',')].join('|'))).slice(0, 8000);
}
function normalizeInvoice(raw, ctx) {
  if (!raw) return null;
  const companyId = raw.aziendaId ?? raw.allId ?? raw.companyId ?? raw.clientId ?? raw.azId ?? raw.azID;
  const company = ctx.companies.find(c => String(c.id) === String(companyId));
  const id = raw.id ?? raw.fatturaId;
  const numero = safeText(raw.numero ?? raw.number ?? raw.num ?? raw.n, 80);
  return {
    id,
    numero,
    data: safeText(raw.data ?? raw.date, 20),
    aziendaId: companyId,
    azienda: safeText(raw.azienda ?? raw.companyName ?? raw.cliente ?? raw.azNome ?? company?.nome, 220),
    ragioneSociale: safeText(raw.azRagioneSociale ?? raw.ragioneSociale ?? company?.ragioneSociale, 260),
    tot: num(raw.tot ?? raw.total ?? raw.totale ?? raw.amount, 0),
    imponibile: num(raw.imponibile ?? raw.subtotal, 0),
    iva: num(raw.iva ?? raw.vat, 0),
    pagata: bool(raw.pagata ?? raw.paid ?? raw.incassata),
    scadenza: safeText(raw.scadenza ?? raw.dueDate, 20),
    interventi: asArray(raw.interventi).map(x => String(x)),
    rows: asArray(raw.rows).map(r => ({ nome: safeText(r.nome ?? r.name, 220), qty: num(r.qty ?? r.qta, 1), tot: num(r.tot ?? r.total, 0), imp: num(r.imp ?? r.imponibile, 0) })),
    note: safeText(raw.note ?? raw.notes, 400),
    raw
  };
}
function compactInvoices(context = {}, ctx) {
  const raw = [...asArray(context.fatture), ...asArray(context.invoices)];
  return uniqueBy(raw.map(x => normalizeInvoice(x, ctx)).filter(Boolean), f => String(f.id || f.numero || [f.data, f.azienda, f.tot].join('|'))).slice(0, 5000);
}
function compactKm(context = {}) {
  return [...asArray(context.km), ...asArray(context.kmRoutes), ...asArray(context.routeKm)].map(k => ({
    id: k.id,
    data: safeText(k.data ?? k.date, 20),
    userId: safeText(k.userId ?? k.workerId, 80),
    userName: safeText(k.userName ?? k.nome, 140),
    from: safeText(k.from ?? k.da, 220),
    to: safeText(k.to ?? k.a, 220),
    aziendaId: k.aziendaId ?? k.allId ?? k.companyId ?? k.clientId ?? k.azId,
    azienda: safeText(k.azienda ?? k.companyName ?? k.cliente ?? k.to ?? k.a, 220),
    km: num(k.km ?? k.distance, 0),
    amount: num(k.amount ?? k.rimborso, 0)
  })).slice(0, 5000);
}
function recentMemory(context = {}) {
  return asArray(context.aiMemoryRecent).slice(0, 200).map(m => ({ at: m.at, userId: safeText(m.userId, 80), userName: safeText(m.userName, 100), kind: safeText(m.kind, 80), text: safeText(m.text, 1200) })).filter(m => m.text);
}
function buildContext(reqBody = {}) {
  const raw = reqBody.context || {};
  const users = compactUsers(raw);
  const currentUser = normalizeUser(raw.user) || users[0] || null;
  const companies = compactCompanies(raw);
  const services = compactServices(raw);
  const shell = { users, currentUser, companies, services };
  const interventions = compactInterventions(raw, shell);
  const invoices = compactInvoices(raw, { ...shell, interventions });
  const kmRoutes = compactKm(raw);
  return { raw, users, currentUser, companies, services, interventions, invoices, kmRoutes, memory: recentMemory(raw), counts: raw.counts || {}, now: new Date() };
}

function meaningfulTokens(s) {
  return norm(s).split(' ').filter(t => t.length > 1 && !STOP_TOKENS.has(t));
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
function tokenScore(query, target, options = {}) {
  const q = norm(query);
  const t = norm(target);
  if (!q || !t) return 0;
  if (q === t) return 120;
  let score = 0;
  if (q.includes(t)) score += Math.min(95, 35 + t.length);
  if (t.includes(q) && q.length > 2) score += Math.min(90, 30 + q.length);
  const qTokens = meaningfulTokens(q);
  const tTokens = meaningfulTokens(t);
  if (!qTokens.length || !tTokens.length) return score;
  const tSet = new Set(tTokens);
  for (const qt of qTokens) {
    if (tSet.has(qt)) score += 18;
    else {
      for (const tt of tTokens) {
        if (qt.length > 3 && tt.startsWith(qt)) score += 7;
        else if (tt.length > 3 && qt.startsWith(tt)) score += 5;
        else if (qt.length > 5 && tt.length > 5 && levenshtein(qt, tt) <= 1) score += 5;
      }
    }
  }
  const coverage = tTokens.filter(tk => qTokens.some(qk => qk === tk || tk.startsWith(qk) || qk.startsWith(tk))).length / Math.max(1, tTokens.length);
  score += Math.round(coverage * 25);
  if (options.strong && coverage >= 0.7) score += 20;
  return score;
}
function scoreCompany(text, c) {
  const fields = [c.nome, c.ragioneSociale, c.piva, c.cf, c.sdi, c.comune, c.addr].filter(Boolean);
  return Math.max(0, ...fields.map((f, idx) => tokenScore(text, f, { strong: idx < 2 }) - (idx > 2 ? 5 : 0)));
}
function resolveCompany(text, companies, { allowWeak = false } = {}) {
  const scored = companies.map(c => ({ item: c, score: scoreCompany(text, c) })).filter(x => x.score > (allowWeak ? 8 : 14)).sort((a, b) => b.score - a.score || String(a.item.nome).localeCompare(String(b.item.nome)));
  if (!scored.length) return { match: null, alternatives: [], score: 0, ambiguous: false };
  const best = scored[0];
  const alts = scored.filter(x => x.score >= Math.max(15, best.score - 10)).slice(0, 8).map(x => x.item);
  const ambiguous = alts.length > 1 && best.score < 75 && (scored[1]?.score || 0) >= best.score - 8;
  return { match: ambiguous ? null : best.item, alternatives: alts, score: best.score, ambiguous };
}
function scoreUser(text, u) { return Math.max(tokenScore(text, u.name), tokenScore(text, u.id)); }
function resolveUser(text, users, currentUser = null) {
  const n = norm(text);
  if (/\bio\b|\bmio\b|\bme\b|\bmiei\b|\bho fatto\b|\bquanto ho\b/.test(n) && currentUser) return currentUser;
  const scored = users.map(u => ({ item: u, score: scoreUser(text, u) })).filter(x => x.score > 10).sort((a,b) => b.score - a.score);
  if (!scored.length) return null;
  return scored[0].score >= 18 ? scored[0].item : null;
}
function canonicalServiceText(text) {
  let n = norm(text);
  n = n.replace(/\bcesari[oa]\b|\btaglio cesareo\b/g, ' cesareo ');
  n = n.replace(/\bfecondazion[ei]\b|\binseminazion[ei]\b|\bfa\b/g, ' fecondazione inseminazione ');
  n = n.replace(/\beco\b|\becografie\b/g, ' ecografia ');
  n = n.replace(/\bmetriti\b/g, ' metrite ');
  n = n.replace(/\bmastiti\b/g, ' mastite ');
  return n;
}
function scoreService(text, s) {
  const q = canonicalServiceText(text);
  const fields = [s.nome, s.cat, s.tipo].filter(Boolean).map(canonicalServiceText);
  return Math.max(0, ...fields.map((f, idx) => tokenScore(q, f, { strong: idx === 0 }) - (idx ? 8 : 0)));
}
function resolveServices(text, services) {
  const scored = services.map(s => ({ item: s, score: scoreService(text, s) })).filter(x => x.score > 12).sort((a,b) => b.score - a.score || String(a.item.nome).localeCompare(String(b.item.nome)));
  if (!scored.length) return { matches: [], alternatives: [], ambiguous: false };
  const top = scored[0].score;
  const alternatives = scored.filter(x => x.score >= Math.max(15, top - 12)).slice(0, 10).map(x => x.item);
  const matches = alternatives.filter((_, idx) => idx === 0 || alternatives.length <= 3 && top >= 70);
  const ambiguous = alternatives.length > 1 && top < 80 && (scored[1]?.score || 0) >= top - 10;
  return { matches: ambiguous ? [] : [scored[0].item], alternatives, ambiguous };
}
function qtyNearService(text, serviceName) {
  const n = norm(text);
  const serviceTokens = meaningfulTokens(serviceName).slice(0, 3);
  if (!serviceTokens.length) return 1;
  const idx = serviceTokens.map(t => n.indexOf(t)).filter(i => i >= 0).sort((a,b) => a-b)[0];
  const before = idx >= 0 ? n.slice(Math.max(0, idx - 40), idx).trim().split(' ').filter(Boolean).slice(-4) : [];
  for (let i = before.length - 1; i >= 0; i--) {
    const w = before[i];
    if (/^\d+$/.test(w)) return Math.max(1, Number(w));
    if (NUMBER_WORDS.has(w)) return NUMBER_WORDS.get(w);
  }
  return 1;
}

function requestedFields(text) {
  const n = norm(text);
  const fields = [];
  if (/\bpiva\b|\bp iva\b|\bpartita iva\b/.test(n)) fields.push('piva');
  if (/\bcodice fiscale\b|\bcf\b/.test(n)) fields.push('cf');
  if (/\bsdi\b|\bcodice destinatario\b/.test(n)) fields.push('sdi');
  if (/\bragione sociale\b|\brag sociale\b/.test(n)) fields.push('ragioneSociale');
  if (/\bindirizzo\b|\bdove\b|\bsede\b|\bvia\b/.test(n)) fields.push('address');
  if (/\btelefono\b|\btel\b|\bcellulare\b/.test(n)) fields.push('tel');
  if (/\bemail\b|\bmail\b|\bpec\b/.test(n)) fields.push('email');
  if (/\bkm\b|\bchilometri\b|\bdistanza\b/.test(n)) fields.push('km');
  return [...new Set(fields)];
}
function looksManagement(text) {
  const n = norm(text);
  return /\b(piva|partita iva|codice fiscale|\bcf\b|sdi|indirizzo|ragione sociale|cliente|clienti|azienda|aziende|fatturato|fatture|fattura|ricavi|ricavo|incassato|incassi|pagato|pagata|da pagare|da fatturare|intervento|interventi|prestazione|prestazioni|giornata|dashboard|km|chilometri|rimborso|listino|prezzo|qualita|qualità|mancanti|incompleti|incomplete|fermi|inattivi|priorita|priorità|cosa devo fare|quanto|quanti|quale|mostra|dammi|cerca|elenca|telefono|email|mail|costo|media|top|classifica|trend|confronta|confronto|iva|imponibile|scadenza|scadute|scaduti|configurazione|impostazioni|collaboratore|utente|tariffa|grafico|grafici|andamento|trend|indicatori|kpi|cockpit|cruscotto|centro controllo|proiezione|forecast|previsione|fine mese|chiusura giornata|fine giornata|richiami|follow up|followup|pronto da caricare|preflight|efficienza km|ricavi per km|km per intervento|performance|produttivita|redditivita|diagnostica|sanity check|test rural vet ai|report settimanale|report mensile|digest|team|collaboratori|trasferte|giri)\b/.test(n) || looksAction(text);
}
function looksAction(text) {
  const n = norm(text);
  return /\b(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti|salva|elimina|cancella|rimuovi|togli|annulla|modifica|cambia|aggiorna|sposta|correggi|imposta|porta|crea cliente|nuovo cliente|aggiungi cliente|crea prestazione|nuova prestazione|emetti fattura|genera fattura|segna pagata|segna fatturato)\b/.test(n);
}
function isDeleteRequest(text) { return /\b(elimina|cancella|rimuovi|togli|annulla)\b/.test(norm(text)) && /\b(intervento|prestazione|cesareo|fecondazione|visita|ecografia|mastite|metrite|fattura)?/.test(norm(text)); }
function isCreateClientRequest(text) { return /\b(crea|aggiungi|nuovo|inserisci)\b.*\b(cliente|azienda)\b/.test(norm(text)); }
function isCreateInterventionRequest(text) { return /\b(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti)\b/.test(norm(text)) && /\b(cesareo|cesario|fecondazione|inseminazione|visita|ecografia|vaccinazione|mastite|metrite|terapia|dislocazione|abomaso|intervento)\b/.test(norm(text)); }
function serviceTextFromRequest(text) {
  const n = norm(text);
  if (/cesar/.test(n)) return 'cesareo';
  if (/fecond|insemin/.test(n)) return 'fecondazione';
  if (/ecograf/.test(n)) return 'ecografia';
  if (/mastit/.test(n)) return 'mastite';
  if (/metrit/.test(n)) return 'metrite';
  if (/vaccin/.test(n)) return 'vaccinazione';
  if (/visita riprod/.test(n)) return 'visita riproduttiva';
  if (/visita clin/.test(n)) return 'visita clinica';
  if (/visita/.test(n)) return 'visita';
  return '';
}

function filterInterventions(ctx, filters = {}) {
  return ctx.interventions.filter(i => {
    if (filters.period && !inRange(i.data, filters.period)) return false;
    if (filters.user && String(i.userId) !== String(filters.user.id) && norm(i.userName) !== norm(filters.user.name)) return false;
    if (filters.company && String(i.aziendaId) !== String(filters.company.id) && norm(i.azienda) !== norm(filters.company.nome)) return false;
    if (filters.serviceText) {
      const q = canonicalServiceText(filters.serviceText);
      const hit = i.prestazioni.some(p => tokenScore(q, p.nome) >= 25 || canonicalServiceText(p.nome).includes(q) || q.includes(canonicalServiceText(p.nome)));
      if (!hit) return false;
    }
    return true;
  });
}
function filterInvoices(ctx, filters = {}) {
  return ctx.invoices.filter(f => {
    if (filters.period && !inRange(f.data, filters.period)) return false;
    if (filters.company && String(f.aziendaId) !== String(filters.company.id) && norm(f.azienda) !== norm(filters.company.nome)) return false;
    if (filters.paidStatus === 'paid' && !f.pagata) return false;
    if (filters.paidStatus === 'unpaid' && f.pagata) return false;
    if (filters.user) {
      const ids = new Set(f.interventi.map(String));
      if (!ids.size) return false;
      const related = ctx.interventions.some(i => ids.has(String(i.id)) && (String(i.userId) === String(filters.user.id) || norm(i.userName) === norm(filters.user.name)));
      if (!related) return false;
    }
    return true;
  });
}
function interventionTotal(items) { return items.reduce((s, i) => s + num(i.tot), 0); }
function invoiceTotal(items) { return items.reduce((s, f) => s + num(f.tot), 0); }
function displayScope({ period, user, company, serviceText }) {
  return [user?.name, company?.nome, serviceText, periodLabel(period)].filter(Boolean).join(' · ');
}
function formatIntervention(i) {
  const sv = i.prestazioni.map(p => `${p.nome || '?'}${p.qty > 1 ? ' x' + p.qty : ''}`).join(', ') || 'prestazione non indicata';
  return `${i.data || '?'}${i.ora ? ' ' + i.ora : ''} · ${i.userName || '?'} · ${i.azienda || '?'} · ${sv} · ${euro(i.tot)}`;
}
function formatInvoice(f) {
  return `${f.data || '?'} · n.${f.numero || f.id || '?'} · ${f.azienda || '?'} · ${euro(f.tot)} · ${f.pagata ? 'pagata' : 'da pagare'}`;
}


function isHelpRequest(text) {
  const n = norm(text);
  return /\b(cosa puoi fare|aiuto|help|comandi|funzioni|come posso|cosa sai fare|manuale ai)\b/.test(n);
}
function smallTalkQuery(text, ctx) {
  const n = norm(text);
  // Solo se il messaggio è DAVVERO small talk: corto e senza richieste gestionali ("ciao, ricavi oggi?" passa oltre)
  if (n.length > 40 || looksManagement(text)) return null;
  const name = ctx.currentUser?.name ? ' ' + String(ctx.currentUser.name).split(' ')[0] : '';
  const qr = ['Cockpit Rural Vet AI', 'Inserisci intervento', 'Grafico ricavi', 'Chiusura giornata'];
  if (/^(ciao|salve|hey|ehi|buongiorno|buonasera|buon pomeriggio|bella|we|hola)[\s!.,]*$/.test(n)) {
    return response(`Ciao${name}. Dimmi cosa ti serve: un dato del gestionale, un grafico o l'inserimento di un intervento.`, null, qr);
  }
  if (/^(grazie|grazie mille|top|perfetto|ottimo|ok grazie|bene grazie)[\s!.,]*$/.test(n)) {
    return response('Di nulla. Se ti serve altro sono qui.', null, qr);
  }
  if (/^(chi sei|cosa sei|come ti chiami|presentati)[\s?.,!]*$/.test(n)) {
    return response('Sono Rural Vet AI, il copilota del tuo gestionale: lavoro solo sui dati reali che vedi nelle sezioni (interventi, clienti, listino, fatture, km). Non invento mai numeri e non modifico nulla senza il tuo SALVA o ELIMINA.', null, qr);
  }
  if (/^(come va|tutto bene|come stai)[\s?.,!]*$/.test(n)) {
    return response('Tutto operativo. Vuoi il cockpit della giornata o un dato preciso?', null, qr);
  }
  return null;
}
function pct(part, total) { return total ? `${((num(part) / num(total)) * 100).toFixed(1).replace('.', ',')}%` : '0%'; }
function avg(total, count) { return count ? num(total) / count : 0; }
function signedEuro(value) { const v = num(value, 0); return (v >= 0 ? '+' : '-') + euro(Math.abs(v)); }
function signedPct(part, total) { const v = total ? (num(part, 0) / num(total, 0)) * 100 : 0; return (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%'; }
function managementInsights({ ricavi = 0, prevTot = null, daFatturare = 0, incassato = 0, aperte = 0, scadute = [], ints = [], kmTot = 0 } = {}) {
  const lines = [];
  if (prevTot !== null && prevTot !== undefined) {
    const delta = num(ricavi) - num(prevTot);
    if (Math.abs(delta) > 0) lines.push(`Trend ricavi: ${signedEuro(delta)}${prevTot ? ' (' + signedPct(delta, prevTot) + ')' : ''} rispetto al periodo precedente.`);
  }
  if (num(daFatturare) > 0) lines.push(`Da fatturare: ${euro(daFatturare)} su ${ints.length} interventi non ancora fatturati.`);
  if (num(aperte) > 0) lines.push(`Fatture aperte: ${euro(aperte)}${scadute.length ? ' · scadute ' + scadute.length : ''}.`);
  if (num(kmTot) > 0 && ints.length) lines.push(`Efficienza trasferte: ${(num(kmTot) / Math.max(1, ints.length)).toFixed(1).replace('.', ',')} km/intervento.`);
  if (!lines.length && ints.length) lines.push('Nessuna anomalia evidente nel periodo selezionato.');
  return lines.slice(0, 3);
}

function companyDataQualityStats(ctx) {
  const companies = ctx.companies || [];
  const missing = {
    piva: companies.filter(c => !c.piva).length,
    cf: companies.filter(c => !c.cf).length,
    sdi: companies.filter(c => !c.sdi).length,
    address: companies.filter(c => !c.addr && !c.indirizzo && !c.comune).length,
    tel: companies.filter(c => !c.tel).length,
    email: companies.filter(c => !c.email).length,
    km: companies.filter(c => !num(c.km, 0)).length
  };
  const incomplete = companies.filter(c => !c.piva || (!c.addr && !c.indirizzo && !c.comune) || !c.tel || !num(c.km, 0));
  return { total: companies.length, missing, incomplete };
}
function interventionDataQualityStats(ctx, filters = {}) {
  const items = filterInterventions(ctx, filters || {});
  const missingDate = items.filter(i => !i.data).length;
  const missingTime = items.filter(i => !i.ora && !i.sess).length;
  const missingCompany = items.filter(i => !i.aziendaId && !i.azienda).length;
  const missingService = items.filter(i => !(i.prestazioni || []).length).length;
  const zeroTotal = items.filter(i => !num(i.tot, 0)).length;
  return { total: items.length, missingDate, missingTime, missingCompany, missingService, zeroTotal };
}
function clientActivityRows(ctx, filters = {}) {
  const byId = new Map();
  const period = filters.period || null;
  for (const c of ctx.companies || []) byId.set(String(c.id || norm(c.nome)), { company: c, last: '', count: 0, total: 0, days: 9999 });
  for (const i of ctx.interventions || []) {
    const key = String(i.aziendaId || norm(i.azienda));
    const row = byId.get(key) || [...byId.values()].find(r => norm(r.company.nome) === norm(i.azienda));
    if (!row) continue;
    if (period && !inRange(i.data, period)) continue;
    row.count += 1;
    row.total += num(i.tot, 0);
    if (i.data && (!row.last || String(i.data) > String(row.last))) row.last = i.data;
  }
  const nowIso = isoDate(ctx.now);
  return [...byId.values()].map(r => {
    if (r.last) {
      const lastDate = dateFromISO(r.last);
      const nowDate = dateFromISO(nowIso);
      r.days = lastDate && nowDate ? Math.max(0, Math.round((nowDate - lastDate) / 86400000)) : 9999;
    }
    return r;
  }).sort((a,b) => b.days - a.days || a.count - b.count || String(a.company.nome).localeCompare(String(b.company.nome), 'it'));
}
function priorityTasks(ctx, filters = {}) {
  const period = filters.period || parsePeriod('', ctx.now, 'ytd');
  const ints = filterInterventions(ctx, { ...filters, period });
  const invs = filterInvoices(ctx, { ...filters, period });
  const unpaid = invs.filter(f => !f.pagata);
  const todayIso = isoDate(ctx.now);
  const scadute = unpaid.filter(f => f.scadenza && f.scadenza < todayIso);
  const notInvoiced = ints.filter(i => !i.fatt);
  const dq = companyDataQualityStats(ctx);
  const iq = interventionDataQualityStats(ctx, filters);
  const tasks = [];
  if (scadute.length) tasks.push({ label: 'Fatture scadute', value: invoiceTotal(scadute), count: scadute.length, unit: 'EUR', priority: 100, reply: `${scadute.length} fatture scadute (${euro(invoiceTotal(scadute))})` });
  if (notInvoiced.length) tasks.push({ label: 'Da fatturare', value: interventionTotal(notInvoiced), count: notInvoiced.length, unit: 'EUR', priority: 90, reply: `${notInvoiced.length} interventi da fatturare (${euro(interventionTotal(notInvoiced))})` });
  if (dq.incomplete.length) tasks.push({ label: 'Anagrafiche incomplete', value: dq.incomplete.length, count: dq.incomplete.length, unit: 'clienti', priority: 70, reply: `${dq.incomplete.length} clienti con dati anagrafici da completare` });
  if (iq.missingTime || iq.missingService || iq.zeroTotal) tasks.push({ label: 'Interventi da controllare', value: iq.missingTime + iq.missingService + iq.zeroTotal, count: iq.total, unit: 'anomalie', priority: 65, reply: `${iq.missingTime + iq.missingService + iq.zeroTotal} anomalie su interventi` });
  const inactive = clientActivityRows(ctx).filter(r => r.days > 90).length;
  if (inactive) tasks.push({ label: 'Clienti fermi', value: inactive, count: inactive, unit: 'clienti', priority: 50, reply: `${inactive} clienti senza interventi da oltre 90 giorni` });
  return tasks.sort((a,b) => b.priority - a.priority || b.value - a.value).slice(0, 8);
}
function dataQualityQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(qualita dati|qualità dati|dati mancanti|dati incompleti|anagrafiche incomplete|clienti incompleti|controllo anagrafiche|controlla dati|pulizia dati|data quality)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, 'ytd');
  const q = companyDataQualityStats(ctx);
  const iq = interventionDataQualityStats(ctx, filters);
  const rows = [
    { label:'P.IVA mancanti', value:q.missing.piva, unit:'clienti' },
    { label:'CF mancanti', value:q.missing.cf, unit:'clienti' },
    { label:'SDI mancanti', value:q.missing.sdi, unit:'clienti' },
    { label:'Indirizzi mancanti', value:q.missing.address, unit:'clienti' },
    { label:'Telefoni mancanti', value:q.missing.tel, unit:'clienti' },
    { label:'KM mancanti', value:q.missing.km, unit:'clienti' },
    { label:'Interventi senza ora', value:iq.missingTime, unit:'interventi' },
    { label:'Interventi a zero', value:iq.zeroTotal, unit:'interventi' }
  ];
  const sample = q.incomplete.slice(0, 8).map(c => `- ${c.nome}${!c.piva ? ' · no P.IVA' : ''}${(!c.addr && !c.indirizzo && !c.comune) ? ' · no indirizzo' : ''}${!c.tel ? ' · no tel' : ''}${!num(c.km,0) ? ' · no km' : ''}`);
  const reply = `Controllo dati Rural Vet AI:\nClienti: ${q.total}. Anagrafiche da completare: ${q.incomplete.length}.\nInterventi ${periodLabel(filters.period)}: ${iq.total}; senza ora/sessione ${iq.missingTime}, senza prestazioni ${iq.missingService}, importo zero ${iq.zeroTotal}.\n${sample.length ? 'Prime anagrafiche da sistemare:\n' + sample.join('\n') : 'Le anagrafiche principali risultano complete.'}`;
  return chartResponse(reply, chartObject('bar', 'Qualità dati gestionale', rows, { unit:'record', seriesName:'Record da completare' }), ['Clienti senza P.IVA','Clienti fermi','Da fatturare','KPI periodo']);
}
function inactiveClientsQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(clienti fermi|aziende ferme|clienti inattivi|aziende inattive|non vedo da|senza interventi|clienti da richiamare|aziende da richiamare)\b/.test(n)) return null;
  const m = safeText(text).match(/(?:oltre|da piu di|da più di|da almeno)\s*(\d{1,4})\s*(giorni|mesi|anni)?/i);
  let days = 90;
  if (m) { days = Number(m[1]); if (/mes/i.test(m[2] || '')) days *= 30; if (/ann/i.test(m[2] || '')) days *= 365; }
  const rows = clientActivityRows(ctx).filter(r => r.days >= days).slice(0, 20);
  if (!rows.length) return response(`Non trovo clienti fermi da almeno ${days} giorni.`, null, ['Clienti ultimi 90 giorni','Top clienti','KPI periodo']);
  const reply = `Clienti fermi da almeno ${days} giorni: ${rows.length}.\n` + rows.slice(0, 12).map((r,i)=>`${i+1}) ${r.company.nome}: ultimo intervento ${r.last || 'mai registrato'}${r.days < 9999 ? ' · ' + r.days + ' giorni fa' : ''}`).join('\n');
  return chartResponse(reply, chartObject('bar', `Clienti fermi · soglia ${days} giorni`, rows.slice(0, 12).map(r => ({ label:r.company.nome, value:r.days < 9999 ? r.days : days, unit:'giorni' })), { unit:'giorni', seriesName:'Giorni da ultimo intervento' }), ['Top clienti','Controllo dati mancanti','Inserisci intervento']);
}

function listinoQualityStats(ctx) {
  const rows = (ctx.services || []).map(s => ({
    service: s,
    missingPrice: !num(s.price, 0),
    missingCategory: !safeText(s.cat || s.tipo || '', 60).trim(),
    lowPrice: num(s.price, 0) > 0 && num(s.price, 0) < 5
  }));
  return {
    total: rows.length,
    missingPrice: rows.filter(r => r.missingPrice).map(r => r.service),
    missingCategory: rows.filter(r => r.missingCategory).map(r => r.service),
    lowPrice: rows.filter(r => r.lowPrice).map(r => r.service)
  };
}
function cashflowRows(ctx, filters = {}) {
  const ints = filterInterventions(ctx, filters);
  const invs = filterInvoices(ctx, filters);
  const unpaid = invs.filter(f => !f.pagata);
  const overdue = unpaid.filter(f => f.scadenza && f.scadenza < isoDate(ctx.now));
  const notInvoiced = ints.filter(i => !i.fatt);
  return { ints, invs, unpaid, overdue, notInvoiced };
}
function debtorRows(invoices) {
  return groupMap(invoices || [], f => f.azienda || 'Cliente', f => f.tot).map(r => ({ label: r.key, value: r.total, count: r.count, unit: 'EUR' })).slice(0, 12);
}
function businessHealthScore(ctx, filters = {}) {
  const cf = cashflowRows(ctx, filters);
  const cq = companyDataQualityStats(ctx);
  const iq = interventionDataQualityStats(ctx, filters);
  const lq = listinoQualityStats(ctx);
  const inactive = clientActivityRows(ctx).filter(r => r.days > 90).length;
  const ricavi = interventionTotal(cf.ints);
  const daFatturare = interventionTotal(cf.notInvoiced);
  const aperte = invoiceTotal(cf.unpaid);
  const scadute = invoiceTotal(cf.overdue);
  let score = 100;
  const issues = [];
  const addIssue = (label, value, penalty, severity, detail) => {
    if (!value) return;
    score -= penalty;
    issues.push({ label, value, penalty, severity, detail });
  };
  addIssue('Fatture scadute', cf.overdue.length, Math.min(25, 6 + cf.overdue.length * 2), 'high', `${cf.overdue.length} fatture scadute (${euro(scadute)})`);
  addIssue('Da fatturare', cf.notInvoiced.length, Math.min(20, 4 + cf.notInvoiced.length), 'medium', `${cf.notInvoiced.length} interventi da fatturare (${euro(daFatturare)})`);
  addIssue('Anagrafiche incomplete', cq.incomplete.length, Math.min(18, Math.ceil(cq.incomplete.length / 2)), 'medium', `${cq.incomplete.length} clienti con campi utili mancanti`);
  addIssue('Interventi anomali', iq.missingTime + iq.missingService + iq.zeroTotal, Math.min(18, iq.missingTime + iq.missingService + iq.zeroTotal), 'medium', `${iq.missingTime + iq.missingService + iq.zeroTotal} anomalie interventi`);
  addIssue('Clienti fermi', inactive, Math.min(12, Math.ceil(inactive / 3)), 'low', `${inactive} clienti senza interventi da oltre 90 giorni`);
  addIssue('Listino da completare', lq.missingPrice.length + lq.missingCategory.length, Math.min(10, lq.missingPrice.length + Math.ceil(lq.missingCategory.length / 3)), 'low', `${lq.missingPrice.length} prestazioni senza prezzo, ${lq.missingCategory.length} senza categoria`);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, issues: issues.sort((a,b)=>b.penalty-a.penalty), ricavi, daFatturare, aperte, scadute, counts: { interventi: cf.ints.length, fattureAperte: cf.unpaid.length, fattureScadute: cf.overdue.length, daFatturare: cf.notInvoiced.length, anagraficheIncomplete: cq.incomplete.length, anomalieInterventi: iq.missingTime + iq.missingService + iq.zeroTotal, clientiFermi: inactive, listinoPrezziMancanti: lq.missingPrice.length } };
}

function scoreLabel(score) {
  const s = num(score, 0);
  if (s >= 90) return 'ottimo';
  if (s >= 75) return 'buono';
  if (s >= 55) return 'da sistemare';
  return 'critico';
}
function scoreSeverity(score) {
  const s = num(score, 0);
  if (s < 55) return 'high';
  if (s < 75) return 'medium';
  return 'low';
}
function operationalCards(ctx, filters = {}) {
  const cf = cashflowRows(ctx, filters);
  const h = businessHealthScore(ctx, filters);
  const ints = filterInterventions(ctx, filters);
  const invoices = filterInvoices(ctx, filters);
  const paidInvoices = invoices.filter(f => f.pagata);
  const kmTot = ints.reduce((sum, i) => sum + num(i.raw?.km ?? i.raw?.kmTot ?? i.raw?.distance, 0), 0) || ctx.kmRoutes.filter(k => !filters.period || inRange(k.data, filters.period)).reduce((sum,k)=>sum+num(k.km,0),0);
  const prestQty = ints.reduce((sum, i) => sum + (i.prestazioni || []).reduce((a,p)=>a+num(p.qty,1),0), 0);
  const avgTicket = ints.length ? interventionTotal(ints) / ints.length : 0;
  return { cf, h, ints, invoices, paidInvoices, kmTot, prestQty, avgTicket };
}

function interventionKmValue(i) {
  const raw = i && i.raw ? i.raw : {};
  return num(raw.km ?? raw.kmTot ?? raw.kmPercorsi ?? raw.chilometri ?? raw.distance ?? raw.distanza, 0);
}
function kmRowsFromContext(ctx, filters = {}) {
  const routeRows = [];
  const companyNorm = filters.company ? norm(filters.company.nome) : '';
  for (const k of ctx.kmRoutes || []) {
    if (filters.period && !inRange(k.data, filters.period)) continue;
    if (filters.user && String(k.userId) !== String(filters.user.id) && norm(k.userName) !== norm(filters.user.name)) continue;
    if (filters.company) {
      const target = norm([k.azienda, k.to, k.from, k.aziendaId].filter(Boolean).join(' '));
      if (String(k.aziendaId || '') !== String(filters.company.id || '') && !target.includes(companyNorm)) continue;
    }
    const km = num(k.km, 0);
    if (!km) continue;
    routeRows.push({ data:k.data, userId:k.userId, userName:k.userName, company:k.azienda || k.to || '', km, amount:num(k.amount,0), source:'tratta', label:[k.data, k.userName, k.azienda || k.to].filter(Boolean).join(' · ') });
  }
  if (routeRows.length) return { rows: routeRows, source:'tratte KM calcolate' };
  const ints = filterInterventions(ctx, filters);
  const interventionRows = ints.map(i => {
    const km = interventionKmValue(i);
    return { data:i.data, userId:i.userId, userName:i.userName, company:i.azienda, km, amount:0, source:'intervento', intervention:i, label:[i.data, i.userName, i.azienda].filter(Boolean).join(' · ') };
  }).filter(r => r.km > 0);
  return { rows: interventionRows, source:'KM registrati negli interventi' };
}
function kmEfficiencyStats(ctx, filters = {}) {
  const pack = kmRowsFromContext(ctx, filters);
  const ints = filterInterventions(ctx, filters);
  const ricavi = interventionTotal(ints);
  const kmTot = pack.rows.reduce((s,r)=>s+num(r.km,0),0);
  const rimborso = pack.rows.reduce((s,r)=>s+num(r.amount,0),0);
  return {
    rows: pack.rows,
    source: pack.source,
    ints,
    ricavi,
    kmTot,
    rimborso,
    kmPerIntervento: ints.length ? kmTot / ints.length : 0,
    ricaviPerKm: kmTot ? ricavi / kmTot : 0,
    rimborsoPerKm: kmTot ? rimborso / kmTot : 0
  };
}
function kmEfficiencyQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(efficienza km|km per intervento|ricavi per km|redditivita km|redditivita trasferte|trasferte|giri|percorsi|viaggi|rimborsi km|costo km)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /oggi/.test(n) ? 'today' : (/settimana|settiman/.test(n) ? 'week' : 'ytd'));
  const scope = displayScope(filters) || periodLabel(filters.period);
  const st = kmEfficiencyStats(ctx, filters);
  if (!st.rows.length) return response(`Non ho dati KM per ${scope}. Posso leggere tratte KM calcolate oppure KM salvati negli interventi.`, null, ['Calcola KM','Interventi periodo','Cockpit Rural Vet AI']);
  const groupByUser = /\b(veterinario|collaboratore|utente|team)\b/.test(n);
  const groupByCompany = /\b(cliente|azienda|clienti|aziende)\b/.test(n);
  const rows = groupMap(st.rows, r => groupByUser ? (r.userName || r.userId || 'Utente') : (groupByCompany ? (r.company || 'Cliente') : dayKey(r.data)), r => r.km)
    .sort((a,b)=> groupByUser || groupByCompany ? b.total-a.total : String(a.key).localeCompare(String(b.key)))
    .map(r => ({ label:r.key, value:r.total, count:r.count, unit:'km' }));
  const reply = `Efficienza KM Rural Vet AI · ${scope}\nKM ${st.kmTot.toFixed(1).replace('.', ',')} · interventi ${st.ints.length} · ricavi ${euro(st.ricavi)}.\nMedia ${st.kmPerIntervento.toFixed(1).replace('.', ',')} km/intervento · ricavi ${euro(st.ricaviPerKm)}/km${st.rimborso ? ` · rimborsi ${euro(st.rimborso)}` : ''}.\nFonte: ${st.source}.`;
  const insights = [
    { label:'KM totali', value:st.kmTot.toFixed(1).replace('.', ','), detail:st.source, severity:'low' },
    { label:'KM/intervento', value:st.kmPerIntervento.toFixed(1).replace('.', ','), detail:`${st.ints.length} interventi`, severity:st.kmPerIntervento > 80 ? 'medium' : 'low' },
    { label:'Ricavi/km', value:euro(st.ricaviPerKm), detail:'indicatore operativo', severity:st.ricaviPerKm && st.ricaviPerKm < 2 ? 'medium' : 'low' }
  ];
  return chartResponse(reply, chartObject(rows.length > 8 ? 'line' : 'bar', `Efficienza KM · ${scope}`, rows, { unit:'km', seriesName:'KM' }), ['Performance veterinari','Ricavi periodo','Clienti fermi','Cockpit Rural Vet AI'], { insights });
}
function performanceVeterinariQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(performance|produttivita|produttività|per veterinario|per collaboratore|classifica veterinari|classifica collaboratori|team|operatori|chi ha fatto di piu|chi fattura di piu)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /oggi/.test(n) ? 'today' : (/settimana|settiman/.test(n) ? 'week' : 'ytd'));
  const scope = displayScope(filters) || periodLabel(filters.period);
  const ints = filterInterventions(ctx, filters);
  if (!ints.length) return response(`Non trovo interventi per calcolare la performance in ${scope}.`, null, ['Interventi periodo','Inserisci intervento','Cockpit Rural Vet AI']);
  const kmPack = kmRowsFromContext(ctx, filters);
  const map = new Map();
  function rowFor(id, name){ const key = String(id || name || 'Utente'); if (!map.has(key)) map.set(key, { id:key, label:name || key, ricavi:0, interventi:0, prestazioni:0, km:0 }); return map.get(key); }
  for (const i of ints) {
    const r = rowFor(i.userId, i.userName || 'Utente');
    r.ricavi += num(i.tot,0);
    r.interventi += 1;
    r.prestazioni += (i.prestazioni || []).reduce((s,p)=>s+num(p.qty,1),0);
  }
  for (const k of kmPack.rows) rowFor(k.userId, k.userName || 'Utente').km += num(k.km,0);
  let metric = 'ricavi', unit = 'EUR', label = 'Ricavi';
  if (/\bkm\b|chilometri/.test(n)) { metric = 'km'; unit = 'km'; label = 'KM'; }
  else if (/prestaz/.test(n)) { metric = 'prestazioni'; unit = 'prestazioni'; label = 'Prestazioni'; }
  else if (/intervent/.test(n)) { metric = 'interventi'; unit = 'interventi'; label = 'Interventi'; }
  const rows = [...map.values()].sort((a,b)=>num(b[metric])-num(a[metric]) || b.ricavi-a.ricavi).slice(0, 12);
  const top = rows[0];
  const reply = `Performance veterinari Rural Vet AI · ${scope}\n${rows.length} operatori · ${ints.length} interventi · ricavi ${euro(interventionTotal(ints))}.\n` + rows.slice(0,8).map((r,i)=>`${i+1}) ${r.label}: ${euro(r.ricavi)} · ${r.interventi} interventi · ${r.prestazioni} prestazioni${r.km ? ' · ' + r.km.toFixed(1).replace('.', ',') + ' km' : ''}`).join('\n');
  const chartRows = rows.map(r => ({ label:r.label, value:r[metric], count:r.interventi, unit }));
  const insights = top ? [
    { label:'Top operatore', value:top.label, detail:`${euro(top.ricavi)} · ${top.interventi} interventi`, severity:'low' },
    { label:'Ticket medio team', value:euro(interventionTotal(ints) / Math.max(1, ints.length)), detail:'ricavo medio/intervento', severity:'low' },
    { label:'Fonte KM', value:kmPack.rows.length ? 'OK' : 'NO', detail:kmPack.rows.length ? kmPack.source : 'KM non presenti', severity:kmPack.rows.length ? 'low' : 'medium' }
  ] : [];
  return chartResponse(reply, chartObject('bar', `${label} per veterinario · ${scope}`, chartRows, { unit, seriesName:label }), ['Efficienza KM','Top clienti','Top prestazioni','KPI periodo'], { insights });
}
function weeklyDigestQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(report|riepilogo|digest|resoconto)\b.*\b(settimana|settimanale|mese|mensile|periodo|gestionale)\b/.test(n)) return null;
  let periodText = text;
  if (/settimana|settimanale/.test(n) && !/scorsa|questa|ultim/.test(n)) periodText += ' questa settimana';
  if (/mese|mensile/.test(n) && !MONTHS.some(([name]) => n.includes(name)) && !/scorso|questo/.test(n)) periodText += ' questo mese';
  const filters = managementFilters(periodText, ctx, /settimana|settimanale/.test(n) ? 'week' : (/mese|mensile/.test(n) ? 'month' : 'ytd'));
  const scope = displayScope(filters) || periodLabel(filters.period);
  const h = businessHealthScore(ctx, filters);
  const st = kmEfficiencyStats(ctx, filters);
  const ints = filterInterventions(ctx, filters);
  const tasks = priorityTasks(ctx, filters);
  const ricavi = interventionTotal(ints);
  const prestQty = ints.reduce((sum, i) => sum + (i.prestazioni || []).reduce((a,p)=>a+num(p.qty,1),0), 0);
  const reply = `Report Rural Vet AI · ${scope}\nScore ${h.score}/100 · ricavi ${euro(ricavi)} · interventi ${ints.length} · prestazioni ${prestQty}${st.kmTot ? ' · KM ' + st.kmTot.toFixed(1).replace('.', ',') : ''}.\nDa fatturare ${euro(h.daFatturare)} · fatture aperte ${euro(h.aperte)} · scadute ${euro(h.scadute)}.\nPriorità: ${tasks[0] ? tasks[0].reply : 'nessuna urgenza evidente nei dati disponibili'}.`;
  const rows = [
    { label:'Ricavi', value:ricavi, unit:'EUR' },
    { label:'Da fatturare', value:h.daFatturare, unit:'EUR' },
    { label:'Fatture aperte', value:h.aperte, unit:'EUR' },
    { label:'Scadute', value:h.scadute, unit:'EUR' }
  ];
  const insights = [
    { label:'Score', value:`${h.score}/100`, detail:scoreLabel(h.score), severity:scoreSeverity(h.score) },
    { label:'Interventi', value:String(ints.length), detail:`${prestQty} prestazioni`, severity:'low' },
    { label:'Priorità', value:tasks[0] ? tasks[0].label : 'OK', detail:tasks[0] ? tasks[0].reply : 'nessuna urgenza', severity:tasks[0] && tasks[0].priority >= 90 ? 'high' : (tasks[0] ? 'medium' : 'low') }
  ];
  return chartResponse(reply, chartObject('bar', `Report gestionale · ${scope}`, rows, { unit:'EUR', seriesName:'Importi' }), ['Cockpit Rural Vet AI','Performance veterinari','Efficienza KM','Cash flow','Anomalie interventi'], { insights, score:h.score });
}
function ruralVetAiSelfTestQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(diagnostica rural vet ai|diagnostica ai|test rural vet ai|test ai|sanity check|verifica rural vet ai|verifica ai|ai funziona|controllo ai)\b/.test(n)) return null;
  const checks = [
    { label:'Backend', ok:true, detail:`server ${VERSION}` },
    { label:'OpenAI key', ok:!!process.env.OPENAI_API_KEY, detail:process.env.OPENAI_API_KEY ? 'chiave presente sul backend' : 'chiave non presente in ambiente locale/server' },
    { label:'Clienti', ok:ctx.companies.length > 0, detail:`${ctx.companies.length} clienti nel contesto` },
    { label:'Prestazioni', ok:ctx.services.length > 0, detail:`${ctx.services.length} voci listino nel contesto` },
    { label:'Interventi', ok:ctx.interventions.length > 0, detail:`${ctx.interventions.length} interventi nel contesto` },
    { label:'Grafici', ok:true, detail:'contratto ui.chart attivo' },
    { label:'Azioni sicure', ok:true, detail:'SALVA/ELIMINA richiesti per modifiche distruttive' }
  ];
  const ok = checks.filter(c => c.ok).length;
  const reply = `Diagnostica Rural Vet AI: ${ok}/${checks.length} controlli ok.\n` + checks.map(c => `- ${c.label}: ${c.detail}`).join('\n') + `\nComandi consigliati per prova finale: Cockpit Rural Vet AI, Report settimanale, Efficienza KM, Inserisci intervento, Modifica intervento, Elimina intervento.`;
  const insights = checks.map(c => ({ label:c.label, value:c.ok ? 'OK' : 'NO', detail:c.detail, severity:c.ok ? 'low' : 'high' }));
  return chartResponse(reply, chartObject('bar', 'Diagnostica Rural Vet AI', checks.map(c => ({ label:c.label, value:c.ok ? 1 : 0, unit:'check' })), { unit:'check', seriesName:'Stato' }), ['Cockpit Rural Vet AI','Report settimanale','Efficienza KM','Preflight caricamento','Audit gestionale'], { insights, score:Math.round(ok / checks.length * 100) });
}

function ruralVetAiCockpitQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(cockpit|cruscotto|centro controllo|dashboard rural vet ai|dashboard ai|panoramica completa|situazione completa|quadro completo|controllo totale|command center|briefing completo)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b|giornata/.test(n) ? 'today' : 'ytd');
  if (/\bmese\b|mensile/.test(n) && !MONTHS.some(([name]) => n.includes(name))) {
    filters.period = { from: `${ctx.now.getFullYear()}-${pad2(ctx.now.getMonth()+1)}-01`, to: isoDate(ctx.now), label: 'questo mese' };
  }
  const scope = displayScope(filters) || periodLabel(filters.period);
  const { cf, h, ints, paidInvoices, kmTot, prestQty, avgTicket } = operationalCards(ctx, filters);
  const tasks = priorityTasks(ctx, filters);
  const ricavi = interventionTotal(ints);
  const incassato = invoiceTotal(paidInvoices);
  const firstAction = tasks[0] ? tasks[0].reply : 'nessuna urgenza evidente nei dati disponibili';
  const reply = `Rural Vet AI Cockpit · ${scope}\nScore ${h.score}/100 (${scoreLabel(h.score)}). Ricavi ${euro(ricavi)} · incassato ${euro(incassato)} · da fatturare ${euro(h.daFatturare)}.\nInterventi ${ints.length} · prestazioni ${prestQty} · ticket medio ${euro(avgTicket)}${kmTot ? ` · KM ${kmTot.toFixed(1).replace('.', ',')}` : ''}.\nPrima azione consigliata: ${firstAction}.`;
  const chartRows = [
    { label:'Ricavi', value:ricavi, unit:'EUR' },
    { label:'Incassato', value:incassato, unit:'EUR' },
    { label:'Da fatturare', value:h.daFatturare, unit:'EUR' },
    { label:'Fatture aperte', value:h.aperte, unit:'EUR' },
    { label:'Scadute', value:h.scadute, unit:'EUR' }
  ];
  const insights = [
    { label:'Score gestionale', value:`${h.score}/100`, detail:scoreLabel(h.score), severity:scoreSeverity(h.score) },
    { label:'Interventi', value:String(ints.length), detail:`Prestazioni ${prestQty}`, severity:'low' },
    { label:'Da fatturare', value:euro(h.daFatturare), detail:`${cf.notInvoiced.length} interventi`, severity:h.daFatturare ? 'medium' : 'low' },
    { label:'Scadute', value:euro(h.scadute), detail:`${cf.overdue.length} fatture`, severity:h.scadute ? 'high' : 'low' },
    { label:'Ticket medio', value:euro(avgTicket), detail:'ricavo medio per intervento', severity:'low' },
    { label:'Prima azione', value:tasks[0] ? tasks[0].label : 'OK', detail:firstAction, severity:tasks[0] && tasks[0].priority >= 90 ? 'high' : (tasks[0] ? 'medium' : 'low') }
  ];
  return chartResponse(reply, chartObject('bar', `Cockpit economico · ${scope}`, chartRows, { unit:'EUR', seriesName:'Importi' }), ['Audit gestionale','Priorità operative','Cash flow','Chiusura giornata','Proiezione mese','Anomalie interventi','Inserisci intervento'], { insights, score:h.score, priority:tasks.slice(0,5) });
}
function monthProjectionQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(proiezione|forecast|previsione|stima fine mese|fine mese|a fine mese|proietta|come chiudo il mese)\b/.test(n)) return null;
  const now = ctx.now || new Date();
  const period = { from: `${now.getFullYear()}-${pad2(now.getMonth()+1)}-01`, to: isoDate(now), label: 'mese corrente a oggi' };
  const filters = { ...managementFilters(text, ctx, 'month'), period };
  const ints = filterInterventions(ctx, filters);
  const ricavi = interventionTotal(ints);
  const day = Math.max(1, now.getDate());
  const daysInMonth = lastDayOfMonth(now.getFullYear(), now.getMonth()).getDate();
  const projected = Math.round((ricavi / day) * daysInMonth * 100) / 100;
  const avgDaily = ricavi / day;
  const reply = `Proiezione Rural Vet AI · mese corrente\nRicavi registrati finora: ${euro(ricavi)} in ${day} giorni. Ritmo medio: ${euro(avgDaily)}/giorno.\nStima a fine mese: ${euro(projected)}. È una proiezione matematica sui dati attuali, non una previsione clinica o contabile certa.`;
  const rows = [
    { label:'Registrato oggi', value:ricavi, unit:'EUR' },
    { label:'Proiezione fine mese', value:projected, unit:'EUR' }
  ];
  const insights = [
    { label:'Ritmo giornaliero', value:euro(avgDaily), detail:'media ricavi/giorno finora', severity:'low' },
    { label:'Giorni mese', value:`${day}/${daysInMonth}`, detail:'avanzamento mese', severity:'low' },
    { label:'Stima', value:euro(projected), detail:'basata solo su dati registrati', severity:'medium' }
  ];
  return chartResponse(reply, chartObject('bar', 'Proiezione ricavi mese', rows, { unit:'EUR', seriesName:'Ricavi' }), ['Grafico ricavi mese','KPI periodo','Da fatturare','Cockpit Rural Vet AI'], { insights });
}
function dailyClosureQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(chiusura giornata|fine giornata|chiudi giornata|riepilogo fine giornata|controllo serale|prima di chiudere|cosa manca oggi)\b/.test(n)) return null;
  const period = parsePeriod('oggi', ctx.now, 'today');
  const filters = { ...managementFilters(text, ctx, 'today'), period };
  const { cf, h, ints, kmTot, prestQty } = operationalCards(ctx, filters);
  const anomalies = interventionAnomalyRows(ctx, filters);
  const ricavi = interventionTotal(ints);
  const checklist = [];
  if (cf.notInvoiced.length) checklist.push(`${cf.notInvoiced.length} interventi ancora da fatturare`);
  if (anomalies.length) checklist.push(`${anomalies.length} interventi da controllare`);
  if (!ints.length) checklist.push('nessun intervento registrato oggi');
  if (!checklist.length) checklist.push('giornata pulita nei dati disponibili');
  const reply = `Chiusura giornata Rural Vet AI · oggi\nInterventi ${ints.length} · prestazioni ${prestQty} · ricavi ${euro(ricavi)}${kmTot ? ` · KM ${kmTot.toFixed(1).replace('.', ',')}` : ''}.\nDa chiudere: ${checklist.join(' · ')}.`;
  const rows = [
    { label:'Interventi', value:ints.length, unit:'interventi' },
    { label:'Prestazioni', value:prestQty, unit:'prestazioni' },
    { label:'Da fatturare', value:cf.notInvoiced.length, unit:'interventi' },
    { label:'Anomalie', value:anomalies.length, unit:'record' }
  ];
  const insights = [
    { label:'Score oggi', value:`${h.score}/100`, detail:scoreLabel(h.score), severity:scoreSeverity(h.score) },
    { label:'Ricavi oggi', value:euro(ricavi), detail:`${ints.length} interventi`, severity:'low' },
    { label:'Da fatturare', value:String(cf.notInvoiced.length), detail:euro(interventionTotal(cf.notInvoiced)), severity:cf.notInvoiced.length ? 'medium' : 'low' },
    { label:'Anomalie', value:String(anomalies.length), detail:'ora/prestazioni/importo', severity:anomalies.length ? 'medium' : 'low' }
  ];
  return chartResponse(reply, chartObject('bar', 'Chiusura giornata', rows, { unit:'record', seriesName:'Controlli' }), ['Interventi oggi','Da fatturare oggi','Anomalie interventi oggi','Inserisci intervento','Cockpit Rural Vet AI'], { insights });
}
function uploadPreflightQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(pronto da caricare|pronta da caricare|preflight|deploy check|controllo deploy|prima di caricare|pronto upload|production ready)\b/.test(n)) return null;
  const checks = [
    { label:'Backend collegato', value:process.env.OPENAI_API_KEY ? 1 : 0, detail:process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY presente' : 'OPENAI_API_KEY mancante su server' },
    { label:'Clienti letti', value:ctx.companies.length ? 1 : 0, detail:`${ctx.companies.length} clienti nel contesto` },
    { label:'Prestazioni lette', value:ctx.services.length ? 1 : 0, detail:`${ctx.services.length} voci listino nel contesto` },
    { label:'Interventi letti', value:ctx.interventions.length ? 1 : 0, detail:`${ctx.interventions.length} interventi nel contesto` },
    { label:'Fatture lette', value:ctx.invoices.length ? 1 : 0, detail:`${ctx.invoices.length} fatture nel contesto` }
  ];
  const ok = checks.filter(c => c.value).length;
  const reply = `Preflight Rural Vet AI: ${ok}/${checks.length} controlli ok.\n` + checks.map(c => `- ${c.label}: ${c.detail}`).join('\n') + `\nPrima del caricamento finale prova questi comandi: Cockpit Rural Vet AI, Inserisci intervento, Modifica intervento, Elimina intervento, Grafico ricavi mese.`;
  const insights = checks.map(c => ({ label:c.label, value:c.value ? 'OK' : 'NO', detail:c.detail, severity:c.value ? 'low' : 'high' }));
  return chartResponse(reply, chartObject('bar', 'Preflight caricamento', checks.map(c => ({ label:c.label, value:c.value, unit:'check' })), { unit:'check', seriesName:'Stato' }), ['Cockpit Rural Vet AI','Inserisci intervento','Grafico ricavi mese','Audit gestionale'], { insights });
}
function auditGestionaleQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(audit|check\s*up|checkup|salute gestionale|score|punteggio|diagnosi gestionale|quanto e sano|quanto è sano|controllo completo|analisi completa|migliora gestionale)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b|\bgiornata\b/.test(n) ? 'today' : 'ytd');
  const scope = displayScope(filters) || periodLabel(filters.period);
  const h = businessHealthScore(ctx, filters);
  const rows = [
    { label:'Score', value:h.score, unit:'punti' },
    { label:'Da fatturare', value:h.counts.daFatturare, unit:'interventi' },
    { label:'Fatture scadute', value:h.counts.fattureScadute, unit:'fatture' },
    { label:'Anagrafiche incomplete', value:h.counts.anagraficheIncomplete, unit:'clienti' },
    { label:'Anomalie interventi', value:h.counts.anomalieInterventi, unit:'record' },
    { label:'Clienti fermi', value:h.counts.clientiFermi, unit:'clienti' }
  ];
  const topIssues = h.issues.slice(0, 5);
  const reply = `Audit Rural Vet AI · ${scope}: score ${h.score}/100.\n` +
    (topIssues.length ? topIssues.map((x,i)=>`${i+1}) ${x.detail}`).join('\n') : 'Non vedo criticità importanti nei dati disponibili.') +
    `\nQuadro: ricavi ${euro(h.ricavi)}, da fatturare ${euro(h.daFatturare)}, fatture aperte ${euro(h.aperte)}.`;
  const insights = topIssues.map(x => ({ label:x.label, value:String(x.value), detail:x.detail, severity:x.severity }));
  return chartResponse(reply, chartObject('bar', `Audit Rural Vet AI · ${scope}`, rows, { unit:'record', seriesName:'Controllo' }), ['Priorità operative','Cash flow','Anomalie interventi','Controllo dati mancanti','Clienti fermi','Listino da sistemare'], { insights, score:h.score });
}
function cashflowQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(cash\s*flow|cashflow|cassa|incassi previsti|soldi da incassare|recupero crediti|solleciti|scadenzario|crediti|fatture da incassare)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, 'ytd');
  const scope = displayScope(filters) || periodLabel(filters.period);
  const cf = cashflowRows(ctx, filters);
  const unpaid = invoiceTotal(cf.unpaid);
  const overdue = invoiceTotal(cf.overdue);
  const notInvoiced = interventionTotal(cf.notInvoiced);
  const rows = [
    { label:'Da fatturare', value:notInvoiced, unit:'EUR' },
    { label:'Fatture aperte', value:unpaid, unit:'EUR' },
    { label:'Scadute', value:overdue, unit:'EUR' }
  ];
  const debtors = debtorRows(cf.unpaid);
  const debtorText = debtors.length ? '\nClienti principali da incassare:\n' + debtors.slice(0, 6).map((r,i)=>`${i+1}) ${r.label}: ${euro(r.value)} · ${r.count} fatture`).join('\n') : '';
  const overdueText = cf.overdue.length ? `\nAttenzione: ${cf.overdue.length} fatture scadute per ${euro(overdue)}.` : '';
  const reply = `Cash flow Rural Vet AI · ${scope}:\nDa fatturare ${euro(notInvoiced)} · fatture aperte ${euro(unpaid)} · scadute ${euro(overdue)}.${overdueText}${debtorText}`;
  const chartRows = debtors.length ? debtors : rows;
  return chartResponse(reply, chartObject('bar', debtors.length ? `Clienti da incassare · ${scope}` : `Cash flow · ${scope}`, chartRows, { unit:'EUR', seriesName:'Importo' }), ['Fatture scadute','Da fatturare','Top clienti','Priorità operative','Audit gestionale']);
}
function listinoQualityQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(listino da sistemare|controllo listino|qualita listino|qualità listino|prezzi mancanti|prestazioni senza prezzo|prestazioni senza categoria|tariffe da sistemare)\b/.test(n)) return null;
  const q = listinoQualityStats(ctx);
  const rows = [
    { label:'Senza prezzo', value:q.missingPrice.length, unit:'prestazioni' },
    { label:'Senza categoria', value:q.missingCategory.length, unit:'prestazioni' },
    { label:'Prezzo molto basso', value:q.lowPrice.length, unit:'prestazioni' }
  ];
  const sample = q.missingPrice.slice(0, 10).map((s,i)=>`${i+1}) ${s.nome || s.name || s.id}`).join('\n');
  const reply = `Controllo listino Rural Vet AI: ${q.total} prestazioni.\nSenza prezzo: ${q.missingPrice.length}. Senza categoria: ${q.missingCategory.length}. Prezzo molto basso: ${q.lowPrice.length}.` + (sample ? `\nPrime prestazioni senza prezzo:\n${sample}` : '');
  return chartResponse(reply, chartObject('bar', 'Qualità listino', rows, { unit:'prestazioni', seriesName:'Record' }), ['Prezzi mancanti','Controllo dati mancanti','Audit gestionale','Top prestazioni']);
}
function interventionAnomalyRows(ctx, filters = {}) {
  const items = filterInterventions(ctx, filters);
  return items.map(i => {
    const issues = [];
    if (!safeText(i.ora || i.session || i.sess, 40).trim()) issues.push('senza ora/sessione');
    if (!Array.isArray(i.prestazioni) || !i.prestazioni.length) issues.push('senza prestazioni');
    if (!num(i.tot, 0)) issues.push('importo zero');
    if (!i.aziendaId && !i.azienda) issues.push('cliente mancante');
    return { intervention:i, issues };
  }).filter(x => x.issues.length);
}
function interventionAnomaliesQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(anomalie interventi|interventi anomali|interventi da controllare|interventi incompleti|interventi senza ora|interventi a zero|importo zero|senza prestazioni)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, 'ytd');
  const scope = displayScope(filters) || periodLabel(filters.period);
  const rows = interventionAnomalyRows(ctx, filters);
  if (!rows.length) return response(`Non trovo anomalie interventi per ${scope}.`, null, ['Audit gestionale','KPI periodo','Inserisci intervento']);
  const chartRows = groupMap(rows, r => r.issues[0], () => 1).map(r => ({ label:r.key, value:r.count, count:r.count, unit:'interventi' }));
  const reply = `Interventi da controllare ${scope}: ${rows.length}.\n` + rows.slice(0, 12).map((r,i)=>`${i+1}) ${formatIntervention(r.intervention)} · ${r.issues.join(', ')}`).join('\n') + (rows.length > 12 ? `\n+ altri ${rows.length - 12}` : '');
  return chartResponse(reply, chartObject('bar', `Anomalie interventi · ${scope}`, chartRows, { unit:'interventi', seriesName:'Anomalie' }), ['Modifica intervento','Audit gestionale','Controllo dati mancanti','Da fatturare']);
}
function smartSuggestionsQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(suggerimenti|consigliami|cosa miglioro|ottimizza|proponi azioni|azioni intelligenti|prossimi passi|fammi lavorare meglio)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, 'ytd');
  const h = businessHealthScore(ctx, filters);
  const suggestions = [];
  const has = label => h.issues.some(x => x.label === label);
  if (has('Fatture scadute')) suggestions.push('Parti dalle fatture scadute: sono denaro già maturato e bloccato.');
  if (has('Da fatturare')) suggestions.push('Emetti o prepara fatture per gli interventi non fatturati, così riduci il lavoro arretrato.');
  if (has('Anagrafiche incomplete')) suggestions.push('Completa P.IVA/SDI/indirizzi dei clienti principali prima della fatturazione.');
  if (has('Interventi anomali')) suggestions.push('Sistema interventi senza ora/prestazioni/importo: falsano ricavi e KPI.');
  if (has('Clienti fermi')) suggestions.push('Guarda i clienti fermi: possono diventare richiami o visite programmate.');
  if (!suggestions.length) suggestions.push('Il gestionale sembra pulito: usa il tempo per guardare trend ricavi e top prestazioni.');
  const reply = `Suggerimenti Rural Vet AI · score gestionale ${h.score}/100:\n` + suggestions.slice(0,5).map((x,i)=>`${i+1}) ${x}`).join('\n');
  return response(reply, null, ['Cash flow','Da fatturare','Anomalie interventi','Clienti fermi','Grafico ricavi','Audit gestionale'], aiUi('analytics','none',null,false,{ insights:suggestions.slice(0,5).map((x,i)=>({ label:'Azione '+(i+1), value:'', detail:x, severity:i<2?'medium':'low' })), score:h.score }));
}
function nextActionsQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(cosa devo fare|priorita|priorità|azioni consigliate|prossime azioni|to do|todo|da sistemare|alert gestionale|criticita|criticità)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /oggi|giornata/.test(n) ? 'today' : 'ytd');
  const tasks = priorityTasks(ctx, filters);
  if (!tasks.length) return response(`Non vedo criticità operative per ${displayScope(filters) || periodLabel(filters.period)}.`, null, ['Briefing Rural Vet AI','KPI periodo','Grafico ricavi']);
  const reply = `Priorità Rural Vet AI per ${displayScope(filters) || periodLabel(filters.period)}:\n` + tasks.slice(0, 6).map((t,i)=>`${i+1}) ${t.reply}`).join('\n');
  return chartResponse(reply, chartObject('bar', 'Priorità operative', tasks.map(t => ({ label:t.label, value:t.value, count:t.count, unit:t.unit })), { unit:'record', seriesName:'Impatto' }), ['Cash flow','Audit gestionale','Da fatturare','Fatture scadute','Anomalie interventi','Clienti fermi']);
}
function firstMoney(text) {
  const raw = safeText(text, 2000);
  let m = raw.match(/(?:€|eur|euro)?\s*(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?/i);
  return m ? num(m[1], NaN) : NaN;
}
function textAfter(text, rx) {
  const m = safeText(text, 4000).match(rx);
  return m ? safeText(m[1], 600).trim() : '';
}
function actionButtons(kind = 'save') {
  if (kind === 'delete') return ['ELIMINA', 'Annulla'];
  if (kind === 'when') return ['ADESSO', 'oggi 14:30', 'ieri 09:00', 'Annulla'];
  if (kind === 'choice') return [];
  return ['SALVA', 'Annulla'];
}
function response(reply, action = null, quickReplies = [], ui = null, extra = {}) {
  return Object.assign({ reply, action, actions: [], learn: [], quickReplies, ui: ui || aiUi() }, extra || {});
}
function wantsChart(text) {
  const n = norm(text);
  return /\b(grafico|grafici|diagramma|andamento|trend|serie|visuale|visualizza|barre|linea|torta|mese per mese|mensil|giorno per giorno|giornalier|confronto)\b/.test(n);
}
function chartObject(type, title, rows, { xKey = 'label', yKey = 'value', unit = '', seriesName = 'Valore' } = {}) {
  const safeRows = asArray(rows).slice(0, 36).map(r => ({
    label: safeText(r.label ?? r.key ?? r.name, 80),
    value: Math.round(num(r.value ?? r.total ?? r.count ?? r.km, 0) * 100) / 100,
    count: num(r.count ?? r.interventi, 0),
    unit: safeText(r.unit ?? unit, 20)
  })).filter(r => r.label);
  return { type, title: safeText(title, 120), xKey, yKey, unit, series: [{ name: seriesName, data: safeRows }] };
}
function chartResponse(reply, chart, quickReplies = [], extra = {}) {
  const uiExtras = Object.assign({ chart }, extra || {});
  return response(reply, null, quickReplies, aiUi('chart', 'none', null, false, uiExtras), Object.assign({ chart }, extra || {}));
}
function summarizeTopRows(rows, valueFormatter = euro, max = 5) {
  return rows.slice(0, max).map((r, i) => `${i + 1}) ${r.key || r.label}: ${valueFormatter(r.total ?? r.value)}${r.count !== undefined ? ` · ${r.count} interventi` : ''}`).join('\n');
}
function monthRowsForInterventions(items, valueFn = i => i.tot) {
  return groupMap(items, i => monthKey(i.data), valueFn).sort((a,b)=>String(a.key).localeCompare(String(b.key))).map(r => ({ label: r.key, value: r.total, count: r.count, unit: 'EUR' }));
}
function dayRowsForInterventions(items, valueFn = i => i.tot) {
  return groupMap(items, i => dayKey(i.data), valueFn).sort((a,b)=>String(a.key).localeCompare(String(b.key))).map(r => ({ label: r.key, value: r.total, count: r.count, unit: 'EUR' }));
}
function groupMap(items, keyFn, valueFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'Non indicato';
    const value = valueFn ? num(valueFn(item), 0) : num(item.tot, 0);
    const old = map.get(key) || { key, count: 0, total: 0, items: [] };
    old.count += 1; old.total += value; old.items.push(item);
    map.set(key, old);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count || String(a.key).localeCompare(String(b.key), 'it'));
}
function serviceTotalRows(items) {
  const map = new Map();
  for (const i of items) {
    for (const p of i.prestazioni || []) {
      const key = p.nome || String(p.id || 'Prestazione');
      const old = map.get(key) || { key, count: 0, qty: 0, total: 0 };
      old.count += 1; old.qty += num(p.qty, 1); old.total += num(p.total, num(p.price) * num(p.qty, 1));
      map.set(key, old);
    }
  }
  return [...map.values()].sort((a,b)=>b.total-a.total || b.qty-a.qty || String(a.key).localeCompare(String(b.key),'it'));
}
function monthKey(dateString) { return String(dateString || '').slice(0, 7) || 'Senza data'; }
function dayKey(dateString) { return String(dateString || '').slice(0, 10) || 'Senza data'; }
function hasAny(n, words) { return words.some(w => n.includes(w)); }
function detectRequestedServices(text, services, { max = 8 } = {}) {
  const raw = safeText(text, 4000);
  const n = canonicalServiceText(raw);
  const out = [];
  const add = (svc, qty = 1, score = 0) => {
    if (!svc) return;
    const key = String(svc.id || norm(svc.nome));
    const old = out.find(x => String(x.id || norm(x.nome)) === key);
    if (old) { old.qty = Math.max(old.qty || 1, qty || 1); old.score = Math.max(old.score || 0, score || 0); return; }
    out.push({ id: svc.id, nome: svc.nome, name: svc.nome, qty: Math.max(1, qty || 1), score });
  };
  const syns = [
    [/cesar|taglio cesareo/, /cesar/],
    [/fecond|insemin/, /fecond|insemin/],
    [/ecograf/, /ecograf/],
    [/mastit/, /mastit/],
    [/metrit/, /metrit/],
    [/vaccin/, /vaccin/],
    [/visita\s+clin/, /visita.*clin/],
    [/visita\s+riprod|ginecol|gravidanza/, /riprod|gravid|ginecol/],
    [/post\s*parto|puerper/, /post.*parto|puerper/],
    [/disloc|abomas/, /disloc|abomas/],
    [/terapia\s+endoven|endovena/, /terapia.*endoven|endoven/],
    [/preliev|sangue|feci/, /preliev|sangue|feci/],
    [/calcio|ipocalc/, /calcio/],
    [/emogas/, /emogas/],
    [/autops/, /autops/]
  ];
  for (const [rx, svcRx] of syns) {
    const m = n.match(rx);
    if (m) add(services.find(s => svcRx.test(canonicalServiceText(s.nome))), qtyNearService(raw, m[0]), 100);
  }
  const parts = raw.split(/[,;+]|\s+(?:e|piu|più|con)\s+/i).map(x=>x.trim()).filter(x=>x.length>2);
  for (const part of parts) {
    const res = resolveServices(part, services);
    if (!res.ambiguous && res.matches.length) add(res.matches[0], qtyNearService(raw, res.matches[0].nome), 75);
  }
  for (const svc of services) {
    const st = canonicalServiceText(svc.nome);
    if (!st || st.length < 5) continue;
    const score = tokenScore(n, st, { strong: true });
    const svcTokens = meaningfulTokens(st).filter(t => t.length > 3);
    const hits = svcTokens.filter(t => n.includes(t)).length;
    if ((score >= 86 && hits >= 1) || hits >= Math.min(2, svcTokens.length)) add(svc, qtyNearService(raw, svc.nome), score);
  }
  return out.sort((a,b)=>b.score-a.score || String(a.nome).localeCompare(String(b.nome),'it')).slice(0, max).map(({score, ...x})=>x);
}
function extractServiceFilter(text, ctx) {
  const direct = serviceTextFromRequest(text);
  if (direct) return direct;
  const candidates = detectRequestedServices(text, ctx.services, { max: 1 });
  return candidates[0]?.nome || '';
}
function managementHelpQuery(text, ctx) {
  if (!isHelpRequest(text)) return null;
  return response(`Rural Vet AI può controllare quasi tutto il gestionale da chat:\n• interventi: inserire, cercare, contare, modificare data/ora/cliente/prestazioni/note/fatturato, eliminare;\n• aziende: cercare dati fiscali, creare, modificare P.IVA/CF/SDI/indirizzo/tel/km, eliminare;\n• listino: cercare prezzi, creare voci, cambiare prezzi base o prezzi specifici per azienda;\n• fatture: elencare, emettere per cliente, segnare pagate/non pagate, annullare;\n• analisi: ricavi per giorno/mese/anno/YTD, da fatturare, incassato, fatture aperte/scadute, top clienti, top prestazioni, ricavi per veterinario, medie e confronti;\n• impostazioni: IVA, tariffe km, casa/email/tel dei collaboratori.\nPer ogni modifica preparo l'azione e ti chiedo SALVA o ELIMINA prima di toccare i dati.`, null, ['Inserisci intervento', 'Audit gestionale', 'Cash flow', 'Ricavi da inizio anno', 'Top clienti mese']);
}
function periodForPrevious(period) {
  if (!period?.from || !period?.to) return null;
  const from = dateFromISO(period.from), to = dateFromISO(period.to);
  if (!from || !to) return null;
  const days = Math.round((to - from) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -days + 1);
  return { from: isoDate(prevFrom), to: isoDate(prevTo), label: `periodo precedente (${isoDate(prevFrom)} - ${isoDate(prevTo)})` };
}
function ruralVetAiBriefingQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(fammi il punto|situazione|panoramica|briefing|riepilogo intelligente|controllo gestionale|come va|dashboard rural vet ai|rural vet ai dashboard)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b|\bgiornata\b/.test(n) ? 'today' : 'ytd');
  if (filters.companyResult.ambiguous) {
    const buttons = filters.companyResult.alternatives.slice(0,8).map(a => ({ label: candidateButtonLabel(a, 'company'), value: a.nome }));
    return response('Ho trovato più clienti possibili. Quale intendi?', null, buttons, aiUi('analytics', 'company_choice', null, false));
  }
  const ints = filterInterventions(ctx, filters);
  const invs = filterInvoices(ctx, filters);
  const paid = invs.filter(f => f.pagata);
  const unpaid = invs.filter(f => !f.pagata);
  const notInvoiced = ints.filter(i => !i.fatt);
  const scope = displayScope(filters) || periodLabel(filters.period);
  const ricavi = interventionTotal(ints);
  const incassato = invoiceTotal(paid);
  const aperte = invoiceTotal(unpaid);
  const daFatturare = interventionTotal(notInvoiced);
  const kmItems = ctx.kmRoutes.filter(k => (!filters.period || inRange(k.data, filters.period)) && (!filters.user || String(k.userId) === String(filters.user.id) || norm(k.userName) === norm(filters.user.name)));
  const kmTot = kmItems.reduce((s,k)=>s+num(k.km),0);
  const prestQty = ints.reduce((s,i)=>s+(i.prestazioni||[]).reduce((q,p)=>q+num(p.qty,1),0),0);
  const scadute = unpaid.filter(f => f.scadenza && f.scadenza < isoDate(ctx.now));
  const prev = periodForPrevious(filters.period);
  const prevTot = prev ? interventionTotal(filterInterventions(ctx, { ...filters, period: prev })) : null;
  const insights = managementInsights({ ricavi, prevTot, daFatturare, incassato, aperte, scadute, ints, kmTot });
  const priorities = priorityTasks(ctx, filters).slice(0, 3);
  if (priorities.length) insights.push(...priorities.map(t => 'Priorità: ' + t.reply));
  const rows = [
    { label:'Ricavi', value:ricavi, unit:'EUR' },
    { label:'Incassato', value:incassato, unit:'EUR' },
    { label:'Da fatturare', value:daFatturare, unit:'EUR' },
    { label:'Fatture aperte', value:aperte, unit:'EUR' }
  ];
  const reply = `Rural Vet AI · situazione ${scope}:\nRicavi ${euro(ricavi)} · Incassato ${euro(incassato)} · Da fatturare ${euro(daFatturare)}.\nInterventi ${ints.length} · Prestazioni ${prestQty} · KM ${kmTot.toFixed(1).replace('.', ',')}.\n${insights.map(x => '• ' + x).join('\n')}`;
  return chartResponse(reply, chartObject('bar', `Rural Vet AI · KPI ${scope}`, rows, { unit:'EUR', seriesName:'Importo' }), ['Grafico ricavi','Top clienti','Top prestazioni','Interventi periodo','KM periodo','Da fatturare']);
}

function analyticsQuery(text, ctx) {
  const n = norm(text);
  const wants = /\b(ricavi|ricavo|fatturato|fatturati|fatture|fattura|incassato|incassi|pagato|pagata|da pagare|da fatturare|economico|totale|top|classifica|miglior|peggior|media|medie|trend|andamento|grafico|grafici|kpi|indicatori|dashboard|riepilogo|per cliente|per azienda|per veterinario|per collaboratore|per prestazione|per mese|per giorno|scadut|aperte|imponibile|iva|ytd|inizio anno|anno|mese|settimana)\b/.test(n);
  if (!wants) return null;

  const filters = managementFilters(text, ctx, /\boggi\b|\bgiorno\b|\bgiornata\b/.test(n) ? 'today' : 'ytd');
  if (filters.companyResult.ambiguous) {
    const buttons = filters.companyResult.alternatives.slice(0,8).map(a => ({ label: candidateButtonLabel(a, 'company'), value: a.nome }));
    return response('Ho trovato più clienti possibili. Quale intendi?', null, buttons, aiUi('analytics', 'company_choice', null, false));
  }

  const ints = filterInterventions(ctx, filters);
  const invs = filterInvoices(ctx, filters);
  const invPaid = invs.filter(f => f.pagata);
  const invUnpaid = invs.filter(f => !f.pagata);
  const invoicedInts = ints.filter(i => i.fatt);
  const notInvoicedInts = ints.filter(i => !i.fatt);
  const scope = displayScope(filters) || periodLabel(filters.period);
  const ricavi = interventionTotal(ints);
  const fattureEmesse = invoiceTotal(invs);
  const incassato = invoiceTotal(invPaid);
  const aperte = invoiceTotal(invUnpaid);
  const daFatturare = interventionTotal(notInvoicedInts);
  const giaFatturati = interventionTotal(invoicedInts);
  const imponibile = invs.reduce((s,f)=>s+num(f.imponibile, 0),0);
  const iva = invs.reduce((s,f)=>s+num(f.iva, 0),0);
  const todayIso = isoDate(ctx.now);
  const scadute = invUnpaid.filter(f => f.scadenza && f.scadenza < todayIso);
  const quick = ['Grafico ricavi', 'Top clienti', 'Top prestazioni', 'Confronto periodo', 'KPI periodo', 'Da fatturare'];

  if (/\bscadut/.test(n)) {
    if (!scadute.length) return response(`Non risultano fatture scadute per ${scope}.`, null, ['Fatture aperte','Riepilogo economico']);
    return response(`Fatture scadute ${scope}: ${scadute.length}, totale ${euro(invoiceTotal(scadute))}.\n` + scadute.slice(0,15).map(f => `- ${formatInvoice(f)}${f.scadenza ? ' · scad. ' + f.scadenza : ''}`).join('\n'), null, ['Fatture aperte','Incassato','Riepilogo economico']);
  }

  const wantsTop = /\btop\b|\bclassifica\b|\bmiglior|\bpeggior|per\s+(cliente|azienda|veterinario|collaboratore|prestazione|mese|giorno)/.test(n);
  if (wantsTop) {
    let rows = [];
    let title = `Classifica ${scope}`;
    let detailFmt = r => `${r.count} interventi`;
    let chartType = 'bar';
    const byService = /per\s+prestaz|top\s+prestaz|classifica\s+prestaz|miglior[ie]?\s+prestaz/.test(n);
    const byUser = /per\s+(veterinario|collaboratore|utente)|top\s+(veterinari|collaboratori|utenti)|classifica\s+(veterinari|collaboratori|utenti)/.test(n);
    const byMonth = /per\s+mese|mese\s+per\s+mese|mensil/.test(n);
    const byDay = /per\s+(giorno|giornata|data)|giorno\s+per\s+giorno|giornalier/.test(n);
    if (byService) { rows = serviceTotalRows(ints).map(r => ({ key: r.key, count: r.count, qty: r.qty, total: r.total, detail: `${r.qty} q.tà · ${r.count} interventi` })); title = `Ricavi per prestazione · ${scope}`; detailFmt = r => r.detail; }
    else if (byUser) { rows = groupMap(ints, i => i.userName || i.userId || 'Utente'); title = `Ricavi per veterinario · ${scope}`; }
    else if (byMonth) { rows = groupMap(ints, i => monthKey(i.data)).sort((a,b)=>String(a.key).localeCompare(String(b.key))); title = `Ricavi mensili · ${scope}`; chartType = 'line'; }
    else if (byDay) { rows = groupMap(ints, i => dayKey(i.data)).sort((a,b)=>String(a.key).localeCompare(String(b.key))); title = `Ricavi giornalieri · ${scope}`; chartType = 'line'; }
    else { rows = groupMap(ints, i => i.azienda || 'Cliente'); title = `Ricavi per cliente · ${scope}`; }
    if (!rows.length) return response(`Non ho dati per fare la classifica ${scope}.`, null, ['Cambia periodo','Riepilogo economico']);
    const reply = `${title}:\n` + rows.slice(0,12).map((r,i)=>`${i+1}) ${r.key}: ${euro(r.total)} · ${detailFmt(r)} · ${pct(r.total, ricavi)}`).join('\n');
    if (wantsChart(text) || byMonth || byDay) {
      const chart = chartObject(chartType, title, rows.map(r => ({ label:r.key, value:r.total, count:r.count, unit:'EUR' })), { unit:'EUR', seriesName:'Ricavi' });
      return chartResponse(reply, chart, ['KPI periodo','Top clienti','Top prestazioni','Confronto periodo']);
    }
    return response(reply, null, ['Grafico','KPI periodo','Confronto periodo']);
  }

  if (/\bmedia|medie|ticket medio|valore medio|kpi|indicatori|dashboard|riepilogo/.test(n)) {
    const byDay = groupMap(ints, i => dayKey(i.data));
    const activeDays = byDay.length;
    const kmItems = ctx.kmRoutes.filter(k => (!filters.period || inRange(k.data, filters.period)) && (!filters.user || String(k.userId) === String(filters.user.id) || norm(k.userName) === norm(filters.user.name)));
    const kmTot = kmItems.reduce((s,k)=>s+num(k.km),0);
    const insights = managementInsights({ ricavi, daFatturare, incassato, aperte, scadute, ints, kmTot });
    const reply = `KPI ${scope}:\nRicavi: ${euro(ricavi)} · Interventi: ${ints.length} · Prestazioni: ${ints.reduce((s,i)=>s+(i.prestazioni||[]).reduce((q,p)=>q+num(p.qty,1),0),0)}.\nRicavo medio/intervento: ${euro(avg(ricavi, ints.length))} · Ricavo medio/giorno attivo: ${euro(avg(ricavi, activeDays))}.\nKM: ${kmTot.toFixed(1).replace('.', ',')} · Da fatturare: ${euro(daFatturare)} · Incassato: ${euro(incassato)}.\n${insights.map(x => '• ' + x).join('\n')}`;
    const rows = [
      { label:'Ricavi', value:ricavi, unit:'EUR' },
      { label:'Da fatturare', value:daFatturare, unit:'EUR' },
      { label:'Incassato', value:incassato, unit:'EUR' },
      { label:'Fatture aperte', value:aperte, unit:'EUR' }
    ];
    if (wantsChart(text) || /dashboard|kpi|indicatori/.test(n)) return chartResponse(reply, chartObject('bar', `KPI economici · ${scope}`, rows, { unit:'EUR', seriesName:'Importo' }), quick);
    return response(reply, null, ['Grafico KPI','Grafico ricavi','Top clienti','Top prestazioni']);
  }

  if (/\bconfront|trend|andamento|vs\b|rispetto/.test(n)) {
    const prev = periodForPrevious(filters.period);
    const prevInts = prev ? filterInterventions(ctx, { ...filters, period: prev }) : [];
    const prevTot = interventionTotal(prevInts);
    const delta = ricavi - prevTot;
    const sign = delta >= 0 ? '+' : '';
    const reply = `Confronto ${scope}:\nPeriodo attuale: ${euro(ricavi)} (${ints.length} interventi).\n${prev ? 'Periodo precedente: ' + euro(prevTot) + ' (' + prevInts.length + ' interventi).' : 'Periodo precedente non calcolabile.'}\nDifferenza: ${sign}${euro(delta)}${prevTot ? ' · ' + sign + pct(delta, prevTot) : ''}.`;
    const chart = chartObject('bar', `Confronto ricavi · ${scope}`, [
      { label:'Periodo precedente', value:prevTot, count:prevInts.length, unit:'EUR' },
      { label:'Periodo attuale', value:ricavi, count:ints.length, unit:'EUR' }
    ], { unit:'EUR', seriesName:'Ricavi' });
    return wantsChart(text) || /trend|andamento/.test(n) ? chartResponse(reply, chart, ['Grafico mensile','Top clienti','KPI periodo']) : response(reply, null, ['Grafico confronto','KPI periodo']);
  }

  if (/\bda fatturare\b|\bnon fatturat/.test(n)) return response(`Da fatturare ${scope}: ${euro(daFatturare)} (${notInvoicedInts.length} interventi).`, null, ['Dettaglio interventi','Grafico ricavi','Fatture aperte']);
  if (/\bda pagare\b|\bnon pagat|\baperte\b/.test(n)) return response(`Da pagare ${scope}: ${euro(aperte)} (${invUnpaid.length} fatture aperte).`, null, ['Fatture scadute','Incassato','Riepilogo economico']);
  if (/\bincass|\bpagat/.test(n) && !/fatturato/.test(n)) return response(`Incassato ${scope}: ${euro(incassato)} (${invPaid.length} fatture pagate).`, null, ['Fatture aperte','Grafico ricavi','KPI periodo']);
  if (/\bfatture\b|\bfattura\b/.test(n) && (/\bmostra\b|\belenca\b|\blista\b|\bdammi\b/.test(n))) {
    if (!invs.length) return response(`Non trovo fatture per ${scope}.`, null, ['Cambia periodo','Da fatturare']);
    return response(`Fatture ${scope}: ${invs.length}, totale ${euro(fattureEmesse)}.\n` + invs.slice(0, 15).map(f => `- ${formatInvoice(f)}`).join('\n') + (invs.length > 15 ? `\n+ altre ${invs.length - 15}` : ''), null, ['Fatture aperte','Incassato','Grafico ricavi']);
  }

  const monthlyRows = monthRowsForInterventions(ints);
  const reply = `Riepilogo economico ${scope}:\nRicavi interventi: ${euro(ricavi)} (${ints.length} interventi).\nGià fatturati: ${euro(giaFatturati)} · Da fatturare: ${euro(daFatturare)}.\nFatture emesse: ${euro(fattureEmesse)} (${invs.length}) · Imponibile: ${euro(imponibile)} · IVA: ${euro(iva)}.\nIncassato: ${euro(incassato)} · Da pagare: ${euro(aperte)}${scadute.length ? ' · Scadute: ' + euro(invoiceTotal(scadute)) : ''}.`;
  if (wantsChart(text) && monthlyRows.length) return chartResponse(reply, chartObject('line', `Andamento ricavi · ${scope}`, monthlyRows, { unit:'EUR', seriesName:'Ricavi' }), quick);
  return response(reply, null, quick);
}
function parseClientFields(text) {
  const raw = safeText(text, 4000);
  const fields = {};
  const set = (key, rx) => { const m = raw.match(rx); if (m && m[1]) fields[key] = safeText(m[1].replace(/[;,]+$/,'').trim(), 260); };
  set('piva', /(?:p\.?iva|partita iva)\s*(?:e|è|=|:|a|in)?\s*([A-Z0-9]{8,16})/i);
  set('cf', /(?:codice fiscale|\bcf\b)\s*(?:e|è|=|:|a|in)?\s*([A-Z0-9]{8,20})/i);
  set('sdi', /(?:sdi|codice destinatario)\s*(?:e|è|=|:|a|in)?\s*([A-Z0-9]{6,8})/i);
  set('tel', /(?:telefono|tel|cellulare)\s*(?:e|è|=|:|a|in)?\s*([^,;.]+)/i);
  set('email', /(?:email|mail|pec)\s*(?:e|è|=|:|a|in)?\s*([^,;.\s]+@[^,;.\s]+)/i);
  set('ragioneSociale', /(?:ragione sociale|rag sociale)\s*(?:e|è|=|:|a|in)?\s*([^;.]+)/i);
  set('address', /(?:indirizzo|via|strada|localita|località|sede)\s*(?:e|è|=|:|a|in)?\s*([^;]+)/i);
  set('comune', /(?:comune)\s*(?:e|è|=|:|a|in)?\s*([^,;.]+)/i);
  set('cap', /\bcap\s*(?:e|è|=|:|a|in)?\s*(\d{5})/i);
  set('provincia', /(?:provincia|prov\.)\s*(?:e|è|=|:|a|in)?\s*([A-Z]{2}|[^,;.]+)/i);
  const km = raw.match(/(?:km|chilometri|distanza)\s*(?:e|è|=|:|a|in)?\s*(\d+(?:[.,]\d+)?)/i);
  if (km) fields.km = num(km[1], 0);
  const tailCode = raw.match(/\b(?:a|in|=|:)\s*([A-Z0-9]{6,20})\s*$/i);
  if (tailCode) {
    const code = safeText(tailCode[1], 24).toUpperCase();
    if (!fields.piva && /\b(p\.?iva|partita iva)\b/i.test(raw) && /^\d{8,16}$/.test(code)) fields.piva = code;
    if (!fields.cf && /\b(cf|codice fiscale)\b/i.test(raw) && /^[A-Z0-9]{8,20}$/.test(code)) fields.cf = code;
    if (!fields.sdi && /\b(sdi|codice destinatario)\b/i.test(raw) && /^[A-Z0-9]{6,8}$/.test(code)) fields.sdi = code;
  }
  const addrTail = raw.match(/(?:indirizzo|sede|via|strada|localita|località).*?\b(?:a|in|=|:)\s+([^;]+)$/i);
  if (addrTail) fields.address = safeText(addrTail[1].replace(/[;,]+$/,'').trim(), 260);
  const telTail = raw.match(/(?:telefono|tel|cellulare).*?\b(?:a|in|=|:)\s+([+\d\s/.-]{5,30})\s*$/i);
  if (telTail) fields.tel = safeText(telTail[1].trim(), 80);
  return fields;
}
function companyMutationRequest(text, ctx) {
  const n = norm(text);
  if (isCreateClientRequest(text)) return null;
  const isDelete = /\b(elimina|cancella|rimuovi|togli|archivia)\b/.test(n) && /\b(cliente|azienda)\b/.test(n);
  const isUpdate = /\b(modifica|cambia|aggiorna|correggi|imposta|metti|porta)\b/.test(n) && /\b(cliente|azienda|piva|partita iva|codice fiscale|cf|sdi|indirizzo|telefono|email|mail|ragione sociale|km)\b/.test(n);
  if (!isDelete && !isUpdate) return null;
  const found = resolveCompany(text, ctx.companies, { allowWeak: true });
  if (!found.match) {
    if (found.alternatives.length) return response('Ho trovato più clienti possibili:\n' + found.alternatives.map((a,i)=>`${i+1}) ${a.nome}${a.comune ? ' · ' + a.comune : ''}`).join('\n') + '\nQuale intendi?');
    return response('Non trovo il cliente da modificare nel gestionale. Dimmi il nome esatto come appare in Aziende.');
  }
  if (isDelete) return response(`Ho preparato l'eliminazione del cliente ${found.match.nome}. Scrivi ELIMINA per cancellarlo dal gestionale.`, { type:'delete_client', companyId: found.match.id, companyName: found.match.nome, query:text }, actionButtons('delete'));
  const fields = parseClientFields(text);
  if (!Object.keys(fields).length) return response(`Posso modificare ${found.match.nome}. Dimmi quale campo cambiare: P.IVA, CF, SDI, indirizzo, telefono, email, km o ragione sociale.`);
  const lines = Object.entries(fields).map(([k,v])=>`${k}: ${v}`).join('\n');
  return response(`Ho preparato la modifica cliente ${found.match.nome}:\n${lines}\nScrivi SALVA per aggiornare l'anagrafica.`, { type:'update_client', companyId: found.match.id, companyName: found.match.nome, fields, query:text }, actionButtons('save'));
}
function serviceMutationRequest(text, ctx) {
  const n = norm(text);
  const isCreate = /\b(crea|aggiungi|nuova|nuovo|inserisci)\b/.test(n) && /\b(prestazione|voce listino|farmaco|fiala|servizio)\b/.test(n);
  const isDelete = /\b(elimina|cancella|rimuovi|togli)\b/.test(n) && /\b(prestazione|voce listino|listino|farmaco|fiala)\b/.test(n);
  const amount = firstMoney(text);
  const isUpdate = (/\b(modifica|cambia|aggiorna|correggi|imposta|metti|porta)\b/.test(n) && /\b(prezzo|listino|prestazione|farmaco|fiala)\b/.test(n)) || (/\bprezzo\b/.test(n) && Number.isFinite(amount) && /\b(a|=|euro|eur)\b/.test(n));
  if (!isCreate && !isDelete && !isUpdate) return null;
  if (isCreate) {
    let name = textAfter(text, /(?:crea|aggiungi|nuova|nuovo|inserisci)\s+(?:prestazione|voce listino|farmaco|fiala|servizio)\s+(.+?)(?:\s+(?:prezzo|a|da)\s+\d|$)/i);
    if (!name) name = textAfter(text, /(?:prestazione|voce listino|farmaco|fiala|servizio)\s+(.+?)(?:\s+(?:prezzo|a|da)\s+\d|$)/i);
    if (!name) return response('Dimmi il nome della nuova voce listino e possibilmente il prezzo. Esempio: crea prestazione Controllo podale prezzo 45.');
    const cat = textAfter(text, /categoria\s*[:=]?\s*([^,;.]+)/i) || 'Listino Rural Vet AI';
    const tipo = /\bfarmaco\b/.test(n) ? 'Farmaco' : (/\bfiala\b/.test(n) ? 'Fiala' : 'Prestazione');
    return response(`Ho preparato la nuova voce listino:\n${name}\nTipo: ${tipo} · Categoria: ${cat} · Prezzo: ${Number.isFinite(amount) ? euro(amount) : '0,00 €'}\nScrivi SALVA per crearla.`, { type:'create_service', name, cat, tipo, price:Number.isFinite(amount)?amount:0, query:text }, actionButtons('save'));
  }
  const serviceText = serviceTextFromRequest(text) || text;
  const svc = resolveServices(serviceText, ctx.services);
  const list = svc.alternatives.length ? svc.alternatives : svc.matches;
  if (!list.length) return response('Non trovo la voce listino da modificare. Scrivimi il nome più preciso della prestazione/farmaco/fiala.');
  if (svc.ambiguous && list.length > 1) return response('Ho trovato più voci listino possibili:\n' + list.map((p,i)=>`${i+1}) ${p.nome}${p.price ? ' · ' + euro(p.price) : ''}`).join('\n') + '\nQuale devo usare?');
  const service = list[0];
  if (isDelete) return response(`Ho preparato l'eliminazione della voce listino ${service.nome}. Scrivi ELIMINA per cancellarla.`, { type:'delete_service', serviceId: service.id, serviceName: service.nome, query:text }, actionButtons('delete'));
  if (!Number.isFinite(amount)) return response(`Che prezzo devo impostare per ${service.nome}? Scrivimi ad esempio: prezzo ${service.nome} a 45 euro.`);
  const companyRes = /\b(per|da|azienda|cliente)\b/.test(n) ? resolveCompany(text, ctx.companies, { allowWeak: true }) : { match:null };
  const action = { type:'update_service', serviceId: service.id, serviceName: service.nome, fields:{ price: amount }, companyId: companyRes.match?.id || '', companyName: companyRes.match?.nome || '', query:text };
  return response(`Ho preparato il nuovo prezzo ${companyRes.match ? 'specifico per ' + companyRes.match.nome : 'base'}:\n${service.nome}: ${euro(amount)}\nScrivi SALVA per aggiornare il listino.`, action, actionButtons('save'));
}
function invoiceCandidates(text, ctx) {
  const n = norm(text);
  const numMatch = safeText(text).match(/(?:fattura\s*(?:n\.?|numero)?\s*|n\.?\s*)(\d{1,8})/i);
  const filters = managementFilters(text, ctx, /\boggi\b/.test(n) ? 'today' : 'all');
  return ctx.invoices.filter(f => {
    if (numMatch && String(f.numero || f.id) !== String(numMatch[1]) && String(f.id) !== String(numMatch[1])) return false;
    if (filters.period && !inRange(f.data, filters.period)) return false;
    if (filters.company && String(f.aziendaId) !== String(filters.company.id) && norm(f.azienda) !== norm(filters.company.nome)) return false;
    return true;
  }).sort((a,b)=>String(b.data).localeCompare(String(a.data)) || String(b.numero||b.id).localeCompare(String(a.numero||a.id))).slice(0, 12);
}
function invoiceMutationRequest(text, ctx) {
  const n = norm(text);
  if (!/\bfattur/.test(n)) return null;
  const create = /\b(emetti|genera|crea|prepara|fai)\b/.test(n) && /\bfattura\b/.test(n);
  const paid = /\b(segna|marca|metti|imposta|cambia)\b/.test(n) && /\b(pagata|pagato|incassata|incassato|non pagata|da pagare)\b/.test(n);
  const del = /\b(annulla|elimina|cancella|rimuovi)\b/.test(n) && /\bfattura\b/.test(n);
  if (!create && !paid && !del) return null;
  if (create) {
    const cRes = resolveCompany(text, ctx.companies, { allowWeak: true });
    if (!cRes.match) return response('Per emettere una fattura dimmi il cliente esatto. Esempio: emetti fattura per Allevamento Rossi.');
    const openInts = ctx.interventions.filter(i => String(i.aziendaId) === String(cRes.match.id) && !i.fatt);
    if (!openInts.length) return response(`Non trovo interventi da fatturare per ${cRes.match.nome}.`);
    return response(`Ho trovato ${openInts.length} interventi da fatturare per ${cRes.match.nome}, totale imponibile interventi ${euro(interventionTotal(openInts))}. Scrivi SALVA per emettere la fattura.`, { type:'create_invoice', companyId:cRes.match.id, companyName:cRes.match.nome, query:text }, actionButtons('save'));
  }
  const items = invoiceCandidates(text, ctx);
  if (!items.length) return response('Non trovo la fattura. Dimmi numero fattura, cliente o periodo.');
  if (items.length > 1) return response('Ho trovato più fatture possibili. Scegli il numero:\n' + items.map((f,i)=>`${i+1}) ${formatInvoice(f)}`).join('\n'), { type: del ? 'delete_invoice' : 'update_invoice', query:text, fields: paid ? { pagata: !/non pagata|da pagare/.test(n) } : {}, options: items.map(f=>({ invoiceId:f.id })) }, []);
  if (del) return response(`Ho preparato l'annullamento della fattura:\n- ${formatInvoice(items[0])}\nScrivi ELIMINA per annullarla e riportare gli interventi da fatturare.`, { type:'delete_invoice', invoiceId:items[0].id, query:text }, actionButtons('delete'));
  return response(`Ho preparato la modifica fattura:\n- ${formatInvoice(items[0])}\nNuovo stato: ${/non pagata|da pagare/.test(n) ? 'da pagare' : 'pagata'}\nScrivi SALVA per aggiornare.`, { type:'update_invoice', invoiceId:items[0].id, fields:{ pagata: !/non pagata|da pagare/.test(n) }, query:text }, actionButtons('save'));
}
function parseInterventionUpdates(text, ctx) {
  const n = norm(text);
  const updates = {};
  const when = parseWhen(text, ctx.now);
  if (when.date) updates.date = when.date;
  if (when.time) updates.time = when.time;
  if (when.session) updates.session = when.session;
  if (/\bfatturat[oa]\b|\bsegna.*fatturat/.test(n)) updates.fatt = true;
  if (/\bnon fatturat|\bda fatturare\b/.test(n)) updates.fatt = false;
  const note = textAfter(text, /(?:nota|note|appunto|aggiungi nota)\s*[:=]?\s*(.+)$/i);
  if (note && !/^(oggi|ieri|domani|alle|ore)\b/i.test(note)) updates.note = note;
  const companyText = textAfter(text, /(?:cambia|modifica|sposta).{0,30}(?:azienda|cliente)\s+(?:in|a|con|da)\s+(.+?)(?:\s+(?:oggi|ieri|alle|ore|e|con|prestazione)|$)/i);
  if (companyText) {
    const cRes = resolveCompany(companyText, ctx.companies, { allowWeak: true });
    if (cRes.match) { updates.companyId = cRes.match.id; updates.companyName = cRes.match.nome; }
  }
  let servicePart = textAfter(text, /(?:cambia|modifica|sostituisci).{0,40}(?:prestazione|voce|servizio).{0,20}(?:in|con|a)\s+(.+?)(?:\s+(?:oggi|ieri|alle|ore|note?|cliente|azienda)|$)/i);
  if (!servicePart && /\baggiungi\b.*\b(prestazione|farmaco|fiala|servizio)\b/.test(n)) servicePart = textAfter(text, /aggiungi\s+(?:prestazione|farmaco|fiala|servizio)?\s*(.+?)(?:\s+(?:oggi|ieri|alle|ore|note?)|$)/i);
  if (servicePart) {
    const sv = detectRequestedServices(servicePart, ctx.services, { max: 8 });
    if (sv.length) updates.services = sv.map(s => ({ id:s.id, name:s.nome || s.name, qty:s.qty || 1 }));
  }
  // "Cambia il cesareo (di Rossi) in visita clinica" → sostituzione puntuale di una prestazione
  if (!updates.services && !updates.companyId) {
    const swap = safeText(text).match(/\b(?:cambia|sostituisci|trasforma|converti)\b(?:\s+(?:il|la|lo|l['’]|un[oa]?))?\s+(.+?)\s+(?:in|con)\s+(?:una?\s+|il\s+|la\s+)?(.+?)\s*$/i);
    if (swap) {
      const fromCands = detectRequestedServices(swap[1], ctx.services, { max: 3 });
      const toCands = detectRequestedServices(swap[2], ctx.services, { max: 3 });
      const from = fromCands[0], to = toCands[0];
      if (from && to && String(from.id) !== String(to.id)) {
        updates.replaceService = { fromId: from.id, fromName: from.nome || from.name, toId: to.id, toName: to.nome || to.name };
      }
    }
  }
  return updates;
}
function interventionUpdateLabel(key, value, target = null) {
  const sessName = s => ({ m:'mattina', p:'pomeriggio', n:'sera' }[String(s).toLowerCase()] || s);
  if (key === 'date') return `Data: ${value}`;
  if (key === 'time') return `Ora: ${value}`;
  if (key === 'session') return `Sessione: ${sessName(value)}`;
  if (key === 'fatt') return `Fatturato: ${value ? 'sì' : 'no'}`;
  if (key === 'note') return `Nota: ${value}`;
  if (key === 'companyName') return `Cliente: ${value}`;
  if (key === 'companyId') return '';
  if (key === 'replaceService') return `Prestazione: ${value.fromName} → ${value.toName}`;
  if (key === 'services') return `Prestazioni: ${(Array.isArray(value) ? value : []).map(x => `${x.name || x.nome} x${x.qty || 1}`).join(', ')}`;
  return `${key}: ${value}`;
}
function isUpdateInterventionRequest(text) {
  const n = norm(text);
  return /\b(modifica|cambia|aggiorna|correggi|sposta|segna|marca|metti|aggiungi nota|nota)\b/.test(n) && /\b(intervento|prestazione|visita|cesar|fecond|insemin|ecograf|mastit|metrit|fatturat|nota|ore|ora|giorno|data)\b/.test(n);
}
function updateInterventionRequest(text, ctx) {
  if (!isUpdateInterventionRequest(text)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b/.test(norm(text)) ? 'today' : 'ytd');
  let items = filterInterventions(ctx, filters).sort((a,b)=>String(b.data).localeCompare(String(a.data)) || String(b.ora).localeCompare(String(a.ora))).slice(0,12);
  const updates = parseInterventionUpdates(text, ctx);
  if (!Object.keys(updates).length) return response('Che cosa devo cambiare dell’intervento? Posso modificare data, ora, cliente, prestazioni, note o stato fatturato.');
  // Se è una sostituzione ("cambia il cesareo in visita clinica"), considera solo gli interventi che contengono la prestazione di partenza
  if (updates.replaceService) {
    const withFrom = items.filter(i => (i.prestazioni || []).some(p => String(p.id) === String(updates.replaceService.fromId)));
    if (withFrom.length) items = withFrom;
  }
  if (!items.length) return response(`Non trovo l'intervento da modificare per ${displayScope(filters) || periodLabel(filters.period)}. Dimmi cliente, giorno e prestazione.`);
  const summaryUpdates = { ...updates };
  if (items.length === 1) {
    // Non mostrare come "modifiche" i campi che coincidono già con l'intervento (es. "di ieri" usato solo per individuarlo)
    const t = items[0];
    if (summaryUpdates.date && String(summaryUpdates.date) === String(t.data)) delete summaryUpdates.date;
    if (summaryUpdates.time && String(summaryUpdates.time) === String(t.ora)) delete summaryUpdates.time;
    if (summaryUpdates.session && String(summaryUpdates.session) === String(t.sess)) delete summaryUpdates.session;
    if (summaryUpdates.fatt !== undefined && Boolean(summaryUpdates.fatt) === Boolean(t.fatt)) delete summaryUpdates.fatt;
    if (!Object.keys(summaryUpdates).length) return response(`L'intervento è già così:\n- ${formatIntervention(t)}\nNon c'è nulla da cambiare.`);
  }
  const lines = Object.entries(summaryUpdates).map(([k,v]) => interventionUpdateLabel(k, v)).filter(Boolean).join('\n');
  if (items.length === 1) return response(`Ho preparato questa modifica:\n- ${formatIntervention(items[0])}\n${lines}\nScrivi SALVA per applicarla.`, { type:'update_intervention', interventionId:items[0].id, updates:summaryUpdates, query:text }, actionButtons('save'));
  return response(`Ho trovato più interventi possibili. Scegli il numero:\n` + items.map((i,idx)=>`${idx+1}) ${formatIntervention(i)}`).join('\n'), { type:'update_intervention', query:text, updates, options:items.map(i=>({interventionId:i.id})) }, []);
}
function settingsMutationRequest(text, ctx) {
  const n = norm(text);
  if (!/\b(iva|km|chilometri|tariffa|rimborso|casa|indirizzo di casa|email|telefono|cellulare|impostazioni|configurazione)\b/.test(n)) return null;
  if (!/\b(imposta|metti|cambia|modifica|aggiorna|porta)\b/.test(n)) return null;
  const fields = {};
  const iva = safeText(text).match(/\biva\b\s*(?:al|a|=|:)?\s*(0|4|5|10|22)\s*%?/i);
  if (iva) fields.iva = Number(iva[1]);
  const km = safeText(text).match(/(?:tariffa|rimborso|km|chilometri).{0,40}?(\d+(?:[.,]\d{1,2}))/i);
  const user = resolveUser(text, ctx.users, ctx.currentUser);
  if (km && user) fields.kmRate = { userId:user.id, userName:user.name, value:num(km[1], 0) };
  const home = textAfter(text, /(?:casa|indirizzo di casa)\s+(?:di\s+\w+\s+)?(?:e|è|=|:|a|in)?\s*(.+)$/i);
  if (home && user) fields.home = { userId:user.id, userName:user.name, value:home };
  const email = safeText(text).match(/(?:email|mail)\s*(?:e|è|=|:|a|in)?\s*([^,;.\s]+@[^,;.\s]+)/i);
  if (email && user) fields.email = { userId:user.id, userName:user.name, value:email[1] };
  const tel = textAfter(text, /(?:telefono|cellulare|tel)\s*(?:e|è|=|:|a|in)?\s*([^,;.]+)/i);
  if (tel && user) fields.tel = { userId:user.id, userName:user.name, value:tel };
  if (!Object.keys(fields).length) return null;
  const lines = Object.entries(fields).map(([k,v]) => typeof v === 'object' ? `${k} ${v.userName}: ${v.value}` : `${k}: ${v}`).join('\n');
  return response(`Ho preparato la modifica impostazioni:\n${lines}\nScrivi SALVA per applicarla.`, { type:'update_settings', fields, query:text }, actionButtons('save'));
}

async function openAIJson(messages, maxTimeout = OPENAI_TIMEOUT_MS) {
  // OpenAI richiede che, quando si usa response_format json_object,
  // almeno un messaggio contenga esplicitamente la parola "json".
  const hasJsonWord = messages.some(m => {
    const c = Array.isArray(m.content) ? m.content.map(x => x.text || '').join(' ') : String(m.content || '');
    return /json/i.test(c);
  });
  const safeMessages = hasJsonWord
    ? messages
    : [{ role: 'system', content: 'Rispondi sempre e solo in JSON valido.' }, ...messages];

  const completionPromise = openai.chat.completions.create({ model: MODEL, temperature: 0.05, response_format: { type: 'json_object' }, messages: safeMessages });
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout OpenAI')), maxTimeout));
  const completion = await Promise.race([completionPromise, timeoutPromise]);
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return { parsed: cleanJson(raw), usage: completion.usage || null };
}
function cleanJson(raw) {
  const text = safeText(raw, 120000).trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{'); const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(text.slice(first, last + 1)); } catch {} }
  return { reply: text || 'Non ho capito.', action: null, actions: [], learn: [] };
}

function clientLookup(text, ctx) {
  const n = norm(text);
  let fields = requestedFields(text);
  // "Km percorsi oggi/questa settimana" è una domanda sui KM di viaggio, non sull'anagrafica di un cliente
  if (fields.includes('km') && /\b(percorsi|percorso|fatti|totali|totale|rimborso|rimborsi|oggi|ieri|settimana|mese|anno|efficienza)\b/.test(n) && !/\b(cliente|azienda)\b/.test(n)) fields = fields.filter(f => f !== 'km');
  if (!fields.length) return null;
  const found = resolveCompany(text, ctx.companies);
  if (!found.match) {
    if (found.alternatives.length) return { reply: 'Ho trovato più clienti possibili:\n' + found.alternatives.map((a,i)=>`${i+1}) ${a.nome}${a.ragioneSociale ? ' · ' + a.ragioneSociale : ''}`).join('\n') + '\nQuale intendi?', action: null, actions: [], learn: [] };
    // Rispondo "non trovato" solo se la frase parla davvero di un cliente/azienda; altrimenti lascio rispondere gli altri handler (es. kmQuery)
    if (/\b(cliente|azienda)\b/.test(n) || /\bdi\s+[a-z]{3,}\b/.test(n)) return { reply: 'Non trovo quel cliente nel gestionale. Scrivimi il nome esatto come appare in Aziende.', action: null, actions: [], learn: [] };
    return null;
  }
  const c = found.match;
  const lines = [];
  for (const f of fields) {
    if (f === 'piva') lines.push(`P.IVA: ${c.piva || 'non presente'}`);
    if (f === 'cf') lines.push(`CF: ${c.cf || 'non presente'}`);
    if (f === 'sdi') lines.push(`SDI: ${c.sdi || 'non presente'}`);
    if (f === 'ragioneSociale') lines.push(`Ragione sociale: ${c.ragioneSociale || c.nome || 'non presente'}`);
    if (f === 'address') lines.push(`Indirizzo: ${[c.addr, c.cap, c.comune, c.provincia].filter(Boolean).join(', ') || 'non presente'}`);
    if (f === 'tel') lines.push(`Telefono: ${c.tel || 'non presente'}`);
    if (f === 'email') lines.push(`Email: ${c.email || 'non presente'}`);
    if (f === 'km') lines.push(`Km fallback: ${c.km ? c.km.toFixed(1) + ' km' : 'non presente'}`);
  }
  return { reply: `${c.nome}\n${lines.join('\n')}`, action: null, actions: [], learn: [] };
}
function countClients(text, ctx) {
  const n = norm(text);
  if (/\bquanti\b.*\b(clienti|aziende)\b|\bnumero\b.*\b(clienti|aziende)\b/.test(n)) return response(`Nel gestionale ci sono ${ctx.companies.length} clienti.`, null, ['Elenca clienti','Top clienti','Clienti senza P.IVA']);
  if (/\b(anagrafica|anagrafiche|clienti|aziende)\b/.test(n) && (/\belenca\b|\blista\b|\bmostra\b|\bdammi\b|\briepilogo\b|\bcerca\b|\bcomplet/i.test(n) || /\banagrafica\b/.test(n))) {
    let arr = ctx.companies.slice();
    if (/senza\s+piva|piva\s+manc/.test(n)) arr = arr.filter(c => !c.piva);
    if (/senza\s+(telefono|tel)/.test(n)) arr = arr.filter(c => !c.tel);
    if (/senza\s+(email|mail)/.test(n)) arr = arr.filter(c => !c.email);
    if (/senza\s+(indirizzo|sede)/.test(n)) arr = arr.filter(c => !c.addr && !c.indirizzo);
    const missingPiva = ctx.companies.filter(c => !c.piva).length;
    const missingAddr = ctx.companies.filter(c => !c.addr && !c.indirizzo).length;
    const reply = `Anagrafica clienti: ${ctx.companies.length} clienti. P.IVA mancante: ${missingPiva}. Indirizzo mancante: ${missingAddr}.\n` + arr.slice(0, 25).map(c => `- ${c.nome}${c.ragioneSociale && c.ragioneSociale !== c.nome ? ' · ' + c.ragioneSociale : ''}${c.comune ? ' · ' + c.comune : ''}${c.piva ? ' · P.IVA ' + c.piva : ''}`).join('\n') + (arr.length > 25 ? `\n+ altri ${arr.length - 25}` : '');
    return response(reply, null, ['Clienti senza P.IVA','Clienti senza indirizzo','Top clienti','Ricavi per cliente']);
  }
  return null;
}
function serviceLookup(text, ctx) {
  const n = norm(text);
  if (!/\b(prezzo|listino|quanto costa|costo|tariffa)\b/.test(n)) return null;
  const serviceText = serviceTextFromRequest(text) || text;
  const res = resolveServices(serviceText, ctx.services);
  const list = res.alternatives.length ? res.alternatives : res.matches;
  if (!list.length) return { reply: 'Non trovo quella prestazione nel listino. Scrivimi il nome esatto o una parola più specifica.', action: null, actions: [], learn: [] };
  return { reply: list.slice(0, 10).map(p => `${p.nome}: ${p.price ? euro(p.price) : 'prezzo non presente'}${p.cat ? ' · ' + p.cat : ''}`).join('\n'), action: null, actions: [], learn: [] };
}
function managementFilters(text, ctx, defaultPeriod = 'ytd') {
  const period = parsePeriod(text, ctx.now, defaultPeriod);
  const user = resolveUser(text, ctx.users, ctx.currentUser);
  const cRes = resolveCompany(text, ctx.companies, { allowWeak: true });
  const company = cRes.match;
  const serviceText = extractServiceFilter(text, ctx);
  return { period, user, company, companyResult: cRes, serviceText };
}
function interventionQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(interventi|intervento|prestazioni|prestazione|giornata|attivita|attività|riepilogo|fatto|fatti)\b/.test(n) && !/\bquanti\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b|\bgiornata\b/.test(n) ? 'today' : 'ytd');
  if (filters.companyResult.ambiguous) {
    const buttons = filters.companyResult.alternatives.slice(0,8).map(a => ({ label: candidateButtonLabel(a, 'company'), value: a.nome }));
    return response('Ho trovato più clienti possibili. Quale intendi?', null, buttons, aiUi('analytics', 'company_choice', null, false));
  }
  const items = filterInterventions(ctx, filters).sort((a,b) => String(a.data).localeCompare(String(b.data)) || String(a.ora).localeCompare(String(b.ora)));
  const countOnly = /\bquanti\b|\bnumero\b/.test(n) && !/\bmostra\b|\belenca\b|\bdammi\b|\briepilogo\b|\bgiornata\b/.test(n);
  const scope = displayScope(filters);
  if (!items.length) return response(`Non trovo interventi per ${scope || periodLabel(filters.period)}.`, null, ['Cambia periodo','Inserisci intervento']);
  const total = interventionTotal(items);
  const prestQty = items.reduce((s,i)=>s+(i.prestazioni||[]).reduce((q,p)=>q+num(p.qty,1),0),0);
  const quick = ['Grafico interventi','Ricavi periodo','Top prestazioni','Top clienti'];
  if (countOnly) return response(`Interventi ${scope}: ${items.length}. Prestazioni: ${prestQty}. Totale: ${euro(total)}.`, null, quick);
  if (wantsChart(text) || /andamento|trend|per\s+(giorno|mese|prestaz|cliente|azienda)/.test(n)) {
    let rows;
    let title;
    let type = 'bar';
    if (/per\s+prestaz|prestaz/.test(n)) { rows = serviceTotalRows(items).map(r => ({ label:r.key, value:r.qty, count:r.count, unit:'prestazioni' })); title = `Numero prestazioni · ${scope || periodLabel(filters.period)}`; }
    else if (/per\s+(cliente|azienda)|clienti|aziende/.test(n)) { rows = groupMap(items, i => i.azienda || 'Cliente', () => 1).map(r => ({ label:r.key, value:r.count, count:r.count, unit:'interventi' })); title = `Interventi per cliente · ${scope || periodLabel(filters.period)}`; }
    else if (/per\s+mese|mensil|mese/.test(n)) { rows = groupMap(items, i => monthKey(i.data), () => 1).sort((a,b)=>String(a.key).localeCompare(String(b.key))).map(r => ({ label:r.key, value:r.count, count:r.count, unit:'interventi' })); title = `Interventi mensili · ${scope || periodLabel(filters.period)}`; type = 'line'; }
    else { rows = groupMap(items, i => dayKey(i.data), () => 1).sort((a,b)=>String(a.key).localeCompare(String(b.key))).map(r => ({ label:r.key, value:r.count, count:r.count, unit:'interventi' })); title = `Interventi per giorno · ${scope || periodLabel(filters.period)}`; type = rows.length > 8 ? 'line' : 'bar'; }
    const reply = `${title}: ${items.length} interventi, ${prestQty} prestazioni, totale ${euro(total)}.`;
    return chartResponse(reply, chartObject(type, title, rows, { unit: rows[0]?.unit || 'interventi', seriesName: rows[0]?.unit === 'prestazioni' ? 'Prestazioni' : 'Interventi' }), ['Ricavi periodo','Top prestazioni','KPI periodo']);
  }
  const lines = items.slice(0, 18).map(i => `- ${formatIntervention(i)}`);
  return response(`Interventi ${scope}: ${items.length}, prestazioni ${prestQty}, totale ${euro(total)}.\n${lines.join('\n')}${items.length > 18 ? `\n+ altri ${items.length - 18}` : ''}`, null, quick);
}
function revenueQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(fatturato|fatturare|fatture|fattura|ricavi|ricavo|incassato|incassi|incasso|guadagnato|guadagni|guadagno|entrate|pagato|pagata|da pagare|non pagate|aperte|dashboard|economico|totale)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, 'ytd');
  if (filters.companyResult.ambiguous) return { reply: 'Ho trovato più clienti possibili:\n' + filters.companyResult.alternatives.map((a,i)=>`${i+1}) ${a.nome}`).join('\n') + '\nQuale intendi?', action: null, actions: [], learn: [] };
  const ints = filterInterventions(ctx, filters);
  const invs = filterInvoices(ctx, filters);
  const invPaid = invs.filter(f => f.pagata);
  const invUnpaid = invs.filter(f => !f.pagata);
  const invoicedInts = ints.filter(i => i.fatt);
  const notInvoicedInts = ints.filter(i => !i.fatt);
  const scope = displayScope(filters);
  if (/\bda fatturare\b|\bnon fatturat/.test(n)) return { reply: `Da fatturare ${scope}: ${euro(interventionTotal(notInvoicedInts))} (${notInvoicedInts.length} interventi).`, action: null, actions: [], learn: [] };
  if (/\bda pagare\b|\bnon pagat|\baperte\b/.test(n)) return { reply: `Da pagare ${scope}: ${euro(invoiceTotal(invUnpaid))} (${invUnpaid.length} fatture aperte).`, action: null, actions: [], learn: [] };
  if (/\bincass|\bpagat/.test(n) && !/fatturato/.test(n)) return { reply: `Incassato ${scope}: ${euro(invoiceTotal(invPaid))} (${invPaid.length} fatture pagate).`, action: null, actions: [], learn: [] };
  if (/\bfatture\b|\bfattura\b/.test(n) && (/\bmostra\b|\belenca\b|\blista\b|\bdammi\b/.test(n))) {
    if (!invs.length) return { reply: `Non trovo fatture per ${scope}.`, action: null, actions: [], learn: [] };
    return { reply: `Fatture ${scope}: ${invs.length}, totale ${euro(invoiceTotal(invs))}.\n` + invs.slice(0, 15).map(f => `- ${formatInvoice(f)}`).join('\n') + (invs.length > 15 ? `\n+ altre ${invs.length - 15}` : ''), action: null, actions: [], learn: [] };
  }
  const ricavi = interventionTotal(ints);
  const giaFatturati = interventionTotal(invoicedInts);
  const daFatturare = interventionTotal(notInvoicedInts);
  const fattureEmesse = invoiceTotal(invs);
  const fatturePagate = invoiceTotal(invPaid);
  const fattureAperte = invoiceTotal(invUnpaid);
  return { reply: `Riepilogo economico ${scope}:\nRicavi interventi: ${euro(ricavi)} (${ints.length} interventi).\nGià fatturati: ${euro(giaFatturati)} · Da fatturare: ${euro(daFatturare)}.\nFatture emesse: ${euro(fattureEmesse)} · Incassato: ${euro(fatturePagate)} · Da pagare: ${euro(fattureAperte)}.`, action: null, actions: [], learn: [] };
}
function kmQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(km|chilometri|rimborso|rimborsi)\b/.test(n)) return null;
  const filters = managementFilters(text, ctx, /oggi/.test(n) ? 'today' : (/settimana|settiman/.test(n) ? 'week' : 'ytd'));
  const pack = kmRowsFromContext(ctx, filters);
  const scope = displayScope(filters) || periodLabel(filters.period);
  if (!pack.rows.length) return response(`Non ho dati KM nel contesto per ${scope}. Posso usare tratte KM calcolate o KM salvati negli interventi.`, null, ['Efficienza KM','Interventi periodo','Cockpit Rural Vet AI']);
  const kmTot = pack.rows.reduce((s,k)=>s+num(k.km),0);
  const amount = pack.rows.reduce((s,k)=>s+num(k.amount),0);
  const byUser = /per\s+(veterinario|collaboratore|utente)|team/.test(n);
  const byCompany = /per\s+(cliente|azienda)|clienti|aziende/.test(n);
  const rows = groupMap(pack.rows, k => byUser ? (k.userName || k.userId || 'Utente') : (byCompany ? (k.company || 'Cliente') : dayKey(k.data)), k => k.km)
    .sort((a,b)=> byUser || byCompany ? b.total-a.total : String(a.key).localeCompare(String(b.key)))
    .map(r => ({ label:r.key, value:r.total, count:r.count, unit:'km' }));
  const reply = `KM ${scope}: ${kmTot.toFixed(1).replace('.', ',')} km${amount ? ' · rimborso ' + euro(amount) : ''}.\nFonte: ${pack.source}.\n` + pack.rows.slice(0,12).map(k => `- ${k.data || '?'} · ${k.userName || '?'} · ${k.company || '?'}: ${num(k.km).toFixed(1).replace('.', ',')} km`).join('\n');
  if (wantsChart(text) || /andamento|trend|per\s+(giorno|veterinario|collaboratore|utente|cliente|azienda)|clienti|aziende/.test(n)) {
    return chartResponse(reply, chartObject(rows.length > 8 ? 'line' : 'bar', `KM · ${scope}`, rows, { unit:'km', seriesName:'KM' }), ['Efficienza KM','Ricavi periodo','KPI periodo','Interventi periodo']);
  }
  return response(reply, null, ['Grafico KM','Efficienza KM','Ricavi periodo','KPI periodo']);
}
function dashboardQuery(text, ctx) {
  if (!/\bdashboard\b|\bquadro\b|\briassunto\b/.test(norm(text))) return null;
  return revenueQuery('dashboard ' + text, ctx);
}
function learnQuery(text, ctx) {
  const n = norm(text);
  if (!/^\s*(ricorda|memorizza|impara|salva come appunto)\b/i.test(text)) return null;
  const content = safeText(text.replace(/^\s*(ricorda|memorizza|impara|salva come appunto)\s*:?\s*/i, ''), 1200);
  if (!content) return { reply: 'Cosa devo ricordare?', action: null, actions: [], learn: [] };
  return { reply: 'Ok, lo salvo nella memoria Rural Vet AI.', action: null, actions: [], learn: [{ kind: 'istruzione', text: content, userId: ctx.currentUser?.id || '', userName: ctx.currentUser?.name || '' }] };
}

function aiUi(mode = 'none', awaiting = null, draft = null, safeToApply = false, extras = {}) {
  return Object.assign({ mode, awaiting, draftId: draft?.draftId || '', safeToApply: !!safeToApply }, extras || {});
}
function guidedResponse(reply, action = null, quickReplies = [], ui = null) {
  return { reply, action, actions: [], learn: [], quickReplies: quickReplies.slice(0, 8), ui: ui || aiUi() };
}
function draftAction(draft) {
  return { type: 'continue_intervention_draft', draft, awaiting: draft.awaiting };
}
function candidateButtonLabel(item, kind) {
  if (kind === 'company') return [item.nome, item.comune || item.provincia || item.addr].filter(Boolean).join(' · ').slice(0, 64);
  return safeText(item.nome || item.name, 64);
}
function wordQty(w) {
  const n = norm(w);
  if (/^\d+$/.test(n)) return Number(n);
  if (NUMBER_WORDS.has(n)) return NUMBER_WORDS.get(n);
  if (n === 'doppia') return 2;
  if (n === 'tripla') return 3;
  return 1;
}
function serviceSynonymText(text) {
  let n = canonicalServiceText(text);
  n = n.replace(/\bfa\b/g, ' fecondazione inseminazione ');
  n = n.replace(/\bseme\b|\bsessat[oa]\b/g, ' seme sessato fecondazione inseminazione ');
  n = n.replace(/\bgravidanz[ae]\b|\bgravide\b/g, ' gravidanza ecografia diagnosi ');
  n = n.replace(/\bpost parto\b|\bpuerperi[oa]\b/g, ' post parto puerperio metrite visita controllo ');
  n = n.replace(/\bflebo\b|\bendovena\b/g, ' terapia endovenosa flebo ');
  n = n.replace(/\bpodal[ei]\b|\bzoppi[ae]\b/g, ' podale pareggio zoppia ');
  n = n.replace(/\bparto\b/g, ' parto assistenza ');
  return n;
}
function scoreServiceCandidate(raw, svc) {
  const q = serviceSynonymText(raw);
  const t = serviceSynonymText([svc.nome, svc.cat, svc.tipo].filter(Boolean).join(' '));
  let score = tokenScore(q, t, { strong: true });
  const qTokens = meaningfulTokens(q);
  const tTokens = meaningfulTokens(t);
  const hits = qTokens.filter(qt => tTokens.some(tt => tt === qt || tt.startsWith(qt) || qt.startsWith(tt))).length;
  return score + hits * 6 + (norm(svc.nome) === norm(raw) ? 80 : 0);
}

function findServiceCandidates(rawServiceText, services, { limit = 8 } = {}) {
  const raw = safeText(rawServiceText, 260);
  if (!raw) return [];
  return services.map(s => ({ item: s, score: scoreServiceCandidate(raw, s) }))
    .filter(x => x.score >= 24)
    .sort((a,b) => b.score - a.score || String(a.item.nome).localeCompare(String(b.item.nome), 'it'))
    .slice(0, limit)
    .map(x => ({ ...x.item, score: x.score }));
}
function scoreCompanyCandidate(raw, c) {
  const fields = [c.nome, c.ragioneSociale, c.comune, c.provincia, c.addr, c.piva, c.cf, c.sdi].filter(Boolean);
  return Math.max(0, ...fields.map((f, idx) => tokenScore(raw, f, { strong: idx < 2 }) - (idx > 3 ? 8 : 0)));
}
function findCompanyCandidates(rawCompanyText, companies, { limit = 8 } = {}) {
  const raw = safeText(rawCompanyText, 260);
  if (!raw) return [];
  return companies.map(c => ({ item: c, score: scoreCompanyCandidate(raw, c) }))
    .filter(x => x.score >= 18)
    .sort((a,b) => b.score - a.score || String(a.item.nome).localeCompare(String(b.item.nome), 'it'))
    .slice(0, limit)
    .map(x => ({ ...x.item, score: x.score }));
}
function extractCompanyRaw(text) {
  const raw = safeText(text, 1000);
  const m = raw.match(/\b(?:da|presso|cliente|azienda)\s+(.+?)(?:\s+(?:oggi|ieri|domani|alle|ore|mattina|pomeriggio|sera|notte|con|nota|vacca|manza)\b|$)/i);
  if (m) return safeText(m[1].replace(/[,.]+$/,''), 180).trim();
  return '';
}
function stripKnownWhenCompany(text) {
  return safeText(text, 1000)
    .replace(/\b(?:da|presso|cliente|azienda)\s+.+?(?=\s+(?:oggi|ieri|domani|alle|ore|mattina|pomeriggio|sera|notte|con|nota|vacca|manza)\b|$)/ig, ' ')
    .replace(/\b(oggi|ieri|domani|adesso|ora|stamattina|mattina|pomeriggio|sera|notte)\b/ig, ' ')
    .replace(/\b(?:alle|ore)\s*\d{1,2}(?::|\.)?\d{0,2}\b/ig, ' ')
    .replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g, ' ')
    .trim();
}
function extractRawServices(text, ctx) {
  let raw = stripKnownWhenCompany(text);
  raw = raw.replace(/\b(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti|intervento|prestazione|prestazioni)\b/ig, ' ');
  raw = raw.replace(/\b(vacca|manza|bovina?)\s+\d+.*$/i, ' ');
  const parts = raw.split(/[,;+]|\s+(?:e|piu|più|con)\s+/i).map(x => x.trim()).filter(x => x.length > 1);
  const out = [];
  for (const part of parts.length ? parts : [raw]) {
    const m = part.match(/\b(\d+|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|doppia|tripla|x\d+)\s+(.+)$/i);
    let qty = 1, name = part;
    if (m) { qty = String(m[1]).toLowerCase().startsWith('x') ? Number(String(m[1]).slice(1)) : wordQty(m[1]); name = m[2]; }
    const serviceHint = serviceTextFromRequest(name) || name;
    if (norm(serviceHint)) out.push({ rawText: safeText(serviceHint, 180), qty: Math.max(1, qty || 1), serviceId: null, serviceName: null, alternatives: [] });
  }
  return out.slice(0, 8);
}
function extractDraftNote(text) {
  const raw = safeText(text, 1000);
  const m = raw.match(/\b(vacca|manza|vitello|animale|nota|note|quarto|parto difficile|controllare|richiamare|urgenza)\b(.+)?$/i);
  return m ? safeText(raw.slice(m.index), 500) : '';
}
function parseInterventionDraft(text, ctx) {
  const when = parseWhen(text, ctx.now);
  const companyRaw = extractCompanyRaw(text);
  const services = extractRawServices(text, ctx);
  const draft = {
    type: 'intervention_draft', draftId: 'draft_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7), originalText: safeText(text, 1000),
    company: null, companyRaw, companyAlternatives: [], services,
    date: when.date || null, time: when.time || null, session: when.session || null,
    userId: ctx.currentUser?.id || null, userName: ctx.currentUser?.name || null,
    note: extractDraftNote(text), awaiting: null, missing: []
  };
  for (const svc of draft.services) {
    const cands = findServiceCandidates(svc.rawText, ctx.services, { limit: 8 });
    svc.alternatives = cands.map(s => ({ id: s.id, nome: s.nome, name: s.nome, price: s.price, score: s.score }));
    if (cands.length === 1 || (cands[0] && cands[0].score >= 100 && (!cands[1] || cands[1].score < cands[0].score - 22))) {
      svc.serviceId = cands[0].id; svc.serviceName = cands[0].nome; svc.price = cands[0].price;
    }
  }
  if (companyRaw) {
    const cands = findCompanyCandidates(companyRaw, ctx.companies, { limit: 8 });
    draft.companyAlternatives = cands.map(c => ({ id: c.id, nome: c.nome, ragioneSociale: c.ragioneSociale, comune: c.comune, provincia: c.provincia, addr: c.addr, score: c.score }));
    if (cands.length === 1 || (cands[0] && cands[0].score >= 90 && (!cands[1] || cands[1].score < cands[0].score - 18))) draft.company = { id: cands[0].id, nome: cands[0].nome, comune: cands[0].comune, provincia: cands[0].provincia };
  }
  return resolveNextInterventionStep(draft, ctx);
}
function unresolvedService(draft) { return (draft.services || []).find(s => !s.serviceId); }
function quickChoiceObjects(items, kind) {
  return (items || []).map(item => {
    const label = candidateButtonLabel(item, kind);
    const value = kind === 'company' ? (item.nome || label) : (item.nome || item.name || label);
    return label && value ? { label, value } : null;
  }).filter(Boolean).slice(0, 7);
}
function draftProgressLine(draft) {
  const okServices = (draft.services || []).filter(s => s.serviceId).length;
  const allServices = (draft.services || []).length;
  const parts = [
    draft.company?.nome ? 'azienda OK' : 'azienda mancante',
    allServices ? `prestazioni ${okServices}/${allServices}` : 'prestazioni mancanti',
    draft.date && (draft.time || draft.session) ? 'data/ora OK' : 'data/ora mancante'
  ];
  return 'Avanzamento: ' + parts.join(' · ');
}
function buildServiceChoiceReply(draft, unresolved) {
  const choices = quickChoiceObjects(unresolved.alternatives || [], 'service');
  const buttons = choices.length ? [...choices, 'Scrivi altro nome', 'Annulla'].slice(0, 8) : ['Scrivi nome prestazione', 'Annulla'];
  const label = unresolved.rawText ? `“${unresolved.rawText}”` : 'questa voce';
  return guidedResponse(`${draftProgressLine(draft)}
Quale prestazione vuoi inserire per ${label}?`, draftAction(draft), buttons, aiUi('intervention_wizard', 'service_choice', draft, false));
}
function buildCompanyChoiceReply(draft) {
  const choices = quickChoiceObjects(draft.companyAlternatives || [], 'company');
  const buttons = choices.length ? [...choices, 'Scrivi altro nome', 'Annulla'].slice(0, 8) : ['Scrivi nome azienda', 'Crea nuova azienda', 'Annulla'];
  const name = draft.companyRaw ? ` “${draft.companyRaw}”` : '';
  return guidedResponse(`${draftProgressLine(draft)}
${choices.length ? `Quale azienda${name} intendi?` : 'Per quale azienda?'}`, draftAction(draft), buttons, aiUi('intervention_wizard', 'company_choice', draft, false));
}
function buildDateTimeChoiceReply(draft) {
  return guidedResponse(`${draftProgressLine(draft)}
Quando lo registro?`, draftAction(draft), ['ADESSO','oggi 14:30','ieri 09:00','Solo mattina','Solo pomeriggio','Annulla'], aiUi('intervention_wizard', 'datetime_choice', draft, false));
}
function buildQuantityChoiceReply(draft) {
  const first = (draft.services || [])[0];
  const current = Math.max(1, num(first?.qty, 1));
  const title = first?.serviceName || first?.rawText || 'prima prestazione';
  return guidedResponse(`Quantità attuale per ${title}: ${current}. Che quantità imposto?`, draftAction(draft), ['x1','x2','x3','+1','-1','Conferma','Annulla'], aiUi('intervention_wizard','qty_choice',draft,false));
}
function isInterventionReady(draft) {
  return !!(draft?.company?.id && (draft.services || []).length && !(draft.services || []).some(s => !s.serviceId) && draft.date && (draft.time || draft.session) && draft.userId);
}
function buildFinalInterventionAction(draft, ctx) {
  return { type: 'create_intervention', companyId: draft.company.id, companyName: draft.company.nome, services: (draft.services || []).map(s => ({ id: s.serviceId, name: s.serviceName, qty: Math.max(1, num(s.qty, 1)), price: num(s.price, 0) })), date: draft.date, time: draft.time || '', session: draft.session || sessionFromText('', draft.time || ''), userId: draft.userId || ctx.currentUser?.id || '', userName: draft.userName || ctx.currentUser?.name || '', note: safeText(draft.note || 'Preparato da Rural Vet AI', 600) };
}
function validateInterventionAction(action, ctx) {
  const errors = [];
  if (!action || action.type !== 'create_intervention') return { ok: false, errors: ['azione non valida'] };
  if (!action.companyId || !ctx.companies.some(c => String(c.id) === String(action.companyId))) errors.push('azienda');
  if (!Array.isArray(action.services) || !action.services.length) errors.push('prestazioni');
  for (const s of action.services || []) {
    if (!s.id || !ctx.services.some(p => String(p.id) === String(s.id))) errors.push('prestazione ' + (s.name || ''));
    if (num(s.qty, 0) < 1) errors.push('quantita');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(action.date || ''))) errors.push('data');
  if (!action.time && !action.session) errors.push('ora/sessione');
  return { ok: !errors.length, errors: [...new Set(errors)] };
}
function interventionDraftToReply(draft, ctx) {
  const action = buildFinalInterventionAction(draft, ctx);
  const val = validateInterventionAction(action, ctx);
  if (!val.ok) return guidedResponse('Mi manca: ' + val.errors.join(', ') + '.', draftAction(draft), ['Annulla'], aiUi('intervention_wizard', draft.awaiting, draft, false));
  const total = action.services.reduce((s, x) => s + num(x.price, 0) * num(x.qty, 1), 0);
  const lines = [
    'Ho preparato l’intervento:',
    '- Azienda: ' + action.companyName,
    '- Prestazioni: ' + action.services.map(s => `${s.name}${s.qty > 1 ? ' x' + s.qty : ''}`).join(', '),
    '- Data/ora: ' + action.date + (action.time ? ' ' + action.time : ' ' + action.session),
    total ? '- Totale stimato: ' + euro(total) : '',
    'Vuoi salvarlo?'
  ].filter(Boolean).join('\n');
  draft.awaiting = 'confirm';
  return guidedResponse(lines, action, ['SALVA','Aggiungi prestazione','Modifica prestazione','Modifica quantità','Modifica azienda','Modifica data/ora','Aggiungi nota','Annulla'], aiUi('intervention_wizard', 'confirm', draft, true));
}
function resolveNextInterventionStep(draft, ctx) {
  if (!Array.isArray(draft.services) || !draft.services.length) {
    draft.services = [{ rawText: '', qty: 1, serviceId: null, serviceName: null, alternatives: [] }];
    draft.awaiting = 'service_choice';
    return buildServiceChoiceReply(draft, draft.services[0]);
  }
  const u = unresolvedService(draft);
  if (u) { draft.awaiting = 'service_choice'; return buildServiceChoiceReply(draft, u); }
  if (!draft.company?.id) { draft.awaiting = 'company_choice'; return buildCompanyChoiceReply(draft); }
  if (!draft.date || (!draft.time && !draft.session)) { draft.awaiting = 'datetime_choice'; return buildDateTimeChoiceReply(draft); }
  return interventionDraftToReply(draft, ctx);
}
function selectByButtonLabel(label, alternatives, kind) {
  const n = norm(label).replace(/\s+(pc|pr|cr|lo|rm|mi|pv|mn|bs|bg)$/,'').trim();
  return (alternatives || []).find(x => norm(candidateButtonLabel(x, kind)) === n || norm(x.nome || x.name) === n || norm(candidateButtonLabel(x, kind)).startsWith(n) || n.startsWith(norm(x.nome || x.name)));
}
function continuePendingInterventionDraft(userText, pendingDraft, ctx) {
  const text = safeText(userText, 1000);
  const n = norm(text);
  const draft = JSON.parse(JSON.stringify(pendingDraft || {}));
  if (!draft || draft.type !== 'intervention_draft') return null;
  if (/^(annulla|cancella|reset|stop)$/.test(n)) return guidedResponse('Ok, ho annullato la bozza intervento.', null, [], aiUi('none', null, null, false));
  if (/modifica prestazione/.test(n)) { const first = (draft.services || [])[0]; if (first) { first.serviceId = null; first.serviceName = null; } return resolveNextInterventionStep(draft, ctx); }
  if (/modifica azienda/.test(n)) { draft.company = null; draft.companyRaw = ''; draft.companyAlternatives = []; return buildCompanyChoiceReply(draft); }
  if (/modifica data|modifica ora/.test(n)) { draft.date = null; draft.time = null; draft.session = null; return buildDateTimeChoiceReply(draft); }
  if (/modifica quantita|quantita/.test(n)) { draft.awaiting = 'qty_choice'; return buildQuantityChoiceReply(draft); }
  if (/aggiungi nota/.test(n)) { draft.awaiting = 'note_choice'; return guidedResponse('Che nota aggiungo?', draftAction(draft), ['Annulla'], aiUi('intervention_wizard','note_choice',draft,false)); }
  if (draft.awaiting === 'note_choice') { draft.note = [draft.note, text].filter(Boolean).join(' | '); return resolveNextInterventionStep(draft, ctx); }
  if (/aggiungi prestazione|aggiungi un altra|aggiungi un'altra|altra prestazione/.test(n)) { draft.services.push({ rawText: '', qty: 1, serviceId: null, serviceName: null, alternatives: [] }); draft.awaiting = 'service_choice'; return buildServiceChoiceReply(draft, draft.services[draft.services.length - 1]); }
  if (draft.awaiting === 'qty_choice') {
    const first = (draft.services || [])[0];
    if (!first) return resolveNextInterventionStep(draft, ctx);
    const m = n.match(/^(?:x\s*)?(\d+)$/) || n.match(/\bquantita\s*(\d+)\b/);
    if (m) first.qty = Math.max(1, Number(m[1]) || 1);
    else if (/^\+1$|aggiungi uno|piu uno/.test(n)) first.qty = Math.max(1, num(first.qty, 1) + 1);
    else if (/^-1$|togli uno|meno uno/.test(n)) first.qty = Math.max(1, num(first.qty, 1) - 1);
    else if (!/conferma|ok/.test(n)) return buildQuantityChoiceReply(draft);
    return resolveNextInterventionStep(draft, ctx);
  }
  if (draft.awaiting === 'service_choice') {
    let target = unresolvedService(draft) || (draft.services || [])[0];
    let chosen = selectByButtonLabel(text, target?.alternatives || [], 'service');
    if (!chosen) {
      const cands = findServiceCandidates(text, ctx.services, { limit: 8 });
      if (target) target.alternatives = cands.map(s => ({ id:s.id, nome:s.nome, name:s.nome, price:s.price, score:s.score }));
      if (cands.length === 1) chosen = cands[0];
      else if (target) return buildServiceChoiceReply(draft, target);
    }
    if (target && chosen) { target.serviceId = chosen.id; target.serviceName = chosen.nome || chosen.name; target.price = chosen.price; }
    return resolveNextInterventionStep(draft, ctx);
  }
  if (draft.awaiting === 'company_choice') {
    let chosen = selectByButtonLabel(text, draft.companyAlternatives || [], 'company');
    if (!chosen) {
      const cands = findCompanyCandidates(text, ctx.companies, { limit: 8 });
      draft.companyRaw = text;
      draft.companyAlternatives = cands.map(c => ({ id:c.id, nome:c.nome, ragioneSociale:c.ragioneSociale, comune:c.comune, provincia:c.provincia, addr:c.addr, score:c.score }));
      if (cands.length === 1) chosen = cands[0];
      else return buildCompanyChoiceReply(draft);
    }
    draft.company = { id: chosen.id, nome: chosen.nome, comune: chosen.comune, provincia: chosen.provincia };
    return resolveNextInterventionStep(draft, ctx);
  }
  if (draft.awaiting === 'datetime_choice') {
    const when = parseWhen(text, ctx.now);
    if (/solo mattina/.test(n)) { draft.date = draft.date || isoDate(ctx.now); draft.session = 'm'; }
    else if (/solo pomeriggio/.test(n)) { draft.date = draft.date || isoDate(ctx.now); draft.session = 'p'; }
    else { draft.date = when.date || draft.date; draft.time = when.time || draft.time; draft.session = when.session || draft.session; }
    return resolveNextInterventionStep(draft, ctx);
  }
  return resolveNextInterventionStep(draft, ctx);
}
function isInterventionDraftStart(text, ctx) {
  const n = norm(text);
  if (/\b(prezzo|quanto costa|listino|piva|fattura|fatture|ricavi|top|dashboard)\b/.test(n)) return false;
  // Domande cliniche o conoscitive NON sono inserimenti: "Come si cura la mastite?", "Che terapia consigli?"
  const actionVerb = /\b(ho fatto|ho eseguito|abbiamo fatto|registra|inserisci|segna|aggiungi|metti)\b/.test(n);
  if (!actionVerb) {
    if (/\?\s*$/.test(safeText(text, 500))) return false;
    if (/\b(come|cosa|che cosa|perche|quale|quali|quanti|quante|quanta|quanto|sintomi|sintomo|terapia|terapie|cura|curare|trattare|trattamento|dosaggio|posologia|protocollo|farmaco|farmaci|consigli|consiglio|conviene|meglio|differenza)\b/.test(n)) return false;
  }
  if (isCreateInterventionRequest(text)) return true;
  if (/\b(\d+|un|una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+\w+/.test(n) && extractRawServices(text, ctx).length) return true;
  return false;
}
function buildCreateClientAction(text) {
  const raw = safeText(text, 4000);
  const after = raw.replace(/^.*?(?:crea|aggiungi|nuovo|inserisci)\s+(?:cliente|azienda)\s*/i, '').trim();
  const nameMatch = after.match(/^([^,;.]+)/);
  const name = safeText(nameMatch?.[1] || '', 180);
  const piva = (raw.match(/(?:piva|partita iva)\s*[:=]?\s*([A-Z0-9]{8,16})/i) || [])[1] || '';
  const cf = (raw.match(/(?:cf|codice fiscale)\s*[:=]?\s*([A-Z0-9]{8,20})/i) || [])[1] || '';
  const sdi = (raw.match(/(?:sdi|codice destinatario)\s*[:=]?\s*([A-Z0-9]{6,8})/i) || [])[1] || '';
  const rag = (raw.match(/ragione sociale\s*[:=]?\s*([^,;.]+)/i) || [])[1] || '';
  const comune = (raw.match(/comune\s*[:=]?\s*([^,;.]+)/i) || [])[1] || '';
  const cap = (raw.match(/\bcap\s*[:=]?\s*(\d{5})/i) || [])[1] || '';
  const provincia = (raw.match(/provincia\s*[:=]?\s*([A-Z]{2}|[^,;.]+)/i) || [])[1] || '';
  const address = (raw.match(/(?:indirizzo|via|strada|loc\.?|localita)\s*[:=]?\s*([^;]+)/i) || [])[1] || '';
  return { type: 'create_client', name, ragioneSociale: safeText(rag || name, 220), address: safeText(address, 260), comune: safeText(comune, 120), cap, provincia: safeText(provincia, 40), piva, cf, sdi };
}
function createClientRequest(text, ctx) {
  if (!isCreateClientRequest(text)) return null;
  const action = buildCreateClientAction(text);
  const missing = [];
  if (!action.name) missing.push('nome gestionale');
  if (!action.ragioneSociale) missing.push('ragione sociale');
  if (!action.address) missing.push('indirizzo');
  if (!action.comune) missing.push('comune');
  if (missing.length) return { reply: `Posso creare il cliente, ma mi mancano: ${missing.join(', ')}. Scrivimi ad esempio: nome, ragione sociale, indirizzo, comune, CAP, provincia, P.IVA.`, action: null, actions: [], learn: [] };
  return { reply: `Ho preparato il nuovo cliente: ${action.name}.\nRagione sociale: ${action.ragioneSociale || '-'}\nIndirizzo: ${[action.address, action.cap, action.comune, action.provincia].filter(Boolean).join(', ')}\nConfermi la creazione?`, action, actions: [], learn: [] };
}
function createInterventionRequest(text, ctx) {
  if (!isInterventionDraftStart(text, ctx)) return null;
  const pending = ctx.raw?.pendingInterventionDraft;
  if (pending && pending.type === 'intervention_draft') return continuePendingInterventionDraft(text, pending, ctx);
  return parseInterventionDraft(text, ctx);
}
function deleteInterventionRequest(text, ctx) {
  if (!isDeleteRequest(text)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b/.test(norm(text)) ? 'today' : 'ytd');
  const items = filterInterventions(ctx, filters).sort((a,b) => String(b.data).localeCompare(String(a.data)) || String(b.ora).localeCompare(String(a.ora)));
  if (!items.length) return { reply: `Non trovo interventi da eliminare per ${displayScope(filters) || periodLabel(filters.period)}. Dimmi cliente, giorno e prestazione.`, action: null, actions: [], learn: [] };
  if (items.length === 1) return { reply: `Ho trovato questo intervento:\n- ${formatIntervention(items[0])}\nScrivi ELIMINA per cancellarlo.`, action: { type: 'delete_intervention', interventionId: items[0].id, query: text, note: 'Richiesta eliminazione da Rural Vet AI' }, actions: [], learn: [] };
  return { reply: `Ho trovato più interventi possibili. Scegli il numero:\n` + items.slice(0, 12).map((i,idx)=>`${idx+1}) ${formatIntervention(i)}`).join('\n'), action: { type: 'delete_intervention', query: text, note: 'Scelta tra più interventi' }, actions: [], learn: [] };
}
function deterministicRouter(text, ctx) {
  if (ctx.raw?.pendingInterventionDraft?.type === 'intervention_draft') return continuePendingInterventionDraft(text, ctx.raw.pendingInterventionDraft, ctx);
  const handlers = [smallTalkQuery, managementHelpQuery, learnQuery, settingsMutationRequest, invoiceMutationRequest, serviceMutationRequest, companyMutationRequest, createClientRequest, updateInterventionRequest, deleteInterventionRequest, createInterventionRequest, clientLookup, countClients, serviceLookup, ruralVetAiSelfTestQuery, uploadPreflightQuery, ruralVetAiCockpitQuery, weeklyDigestQuery, performanceVeterinariQuery, kmEfficiencyQuery, dailyClosureQuery, monthProjectionQuery, auditGestionaleQuery, cashflowQuery, interventionAnomaliesQuery, listinoQualityQuery, smartSuggestionsQuery, nextActionsQuery, dataQualityQuery, inactiveClientsQuery, ruralVetAiBriefingQuery, kmQuery, analyticsQuery, revenueQuery, interventionQuery, dashboardQuery];
  for (const h of handlers) {
    const ans = h(text, ctx);
    if (ans) return ans;
  }
  return null;
}

function catalogDigest(ctx) {
  const companies = ctx.companies.slice(0, 250).map(c => ({ id: c.id, nome: c.nome, ragioneSociale: c.ragioneSociale, comune: c.comune, piva: c.piva, cf: c.cf, sdi: c.sdi }));
  const services = ctx.services.slice(0, 250).map(s => ({ id: s.id, nome: s.nome, cat: s.cat, price: s.price }));
  const users = ctx.users.map(u => ({ id: u.id, name: u.name }));
  return { companies, services, users, counts: { companies: ctx.companies.length, services: ctx.services.length, interventions: ctx.interventions.length, invoices: ctx.invoices.length } };
}
async function planner(text, ctx) {
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = `Sei un router di intenti per il gestionale Rural Vet. Non rispondere all'utente. Devi solo trasformare la richiesta in JSON.
Intenti possibili: client_lookup, client_count, service_lookup, intervention_query, revenue_query, analytics_query, invoice_query, km_query, audit_gestionale_query, cashflow_query, intervention_anomalies_query, listino_quality_query, smart_suggestions_query, data_quality_query, inactive_clients_query, next_actions_query, rural_vet_ai_cockpit_query, daily_closure_query, month_projection_query, upload_preflight_query, rural_vet_ai_self_test_query, km_efficiency_query, performance_veterinari_query, weekly_digest_query, create_intervention, update_intervention, delete_intervention, create_client, update_client, delete_client, create_service, update_service, delete_service, create_invoice, update_invoice, delete_invoice, update_settings, learn, clinical, general.
Campi: companyText, userText, serviceText, periodText, fields, paidStatus.
Rispondi solo JSON valido con schema: {"intent":"...","companyText":"","userText":"","serviceText":"","periodText":"","fields":[],"paidStatus":"","confidence":0.0}`;
  const data = { request: safeText(text, MAX_INPUT_CHARS), catalog: catalogDigest(ctx), currentUser: ctx.currentUser };
  const { parsed } = await openAIJson([
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify(data) }
  ], Math.min(OPENAI_TIMEOUT_MS, 12000));
  return parsed;
}
function executePlan(plan, text, ctx) {
  if (!plan || !plan.intent) return null;
  const intent = safeText(plan.intent, 60);
  const pText = [plan.companyText, plan.userText, plan.serviceText, plan.periodText, text].filter(Boolean).join(' ');
  if (intent === 'client_lookup') return clientLookup([text, safeText(plan.companyText, 200), asArray(plan.fields).join(' ')].join(' '), ctx);
  if (intent === 'client_count') return countClients('quanti clienti', ctx);
  if (intent === 'service_lookup') return serviceLookup([text, safeText(plan.serviceText, 200), 'prezzo listino'].join(' '), ctx);
  if (intent === 'intervention_query') return interventionQuery(pText + ' interventi riepilogo', ctx);
  if (intent === 'revenue_query' || intent === 'invoice_query' || intent === 'analytics_query') return analyticsQuery(pText + ' fatturato ricavi fatture analisi', ctx) || revenueQuery(pText + ' fatturato ricavi fatture', ctx);
  if (intent === 'km_query') return kmQuery(pText + ' km', ctx);
  if (intent === 'audit_gestionale_query') return auditGestionaleQuery(text, ctx);
  if (intent === 'cashflow_query') return cashflowQuery(text, ctx);
  if (intent === 'intervention_anomalies_query') return interventionAnomaliesQuery(text, ctx);
  if (intent === 'listino_quality_query') return listinoQualityQuery(text, ctx);
  if (intent === 'smart_suggestions_query') return smartSuggestionsQuery(text, ctx);
  if (intent === 'rural_vet_ai_cockpit_query') return ruralVetAiCockpitQuery(text, ctx);
  if (intent === 'daily_closure_query') return dailyClosureQuery(text, ctx);
  if (intent === 'month_projection_query') return monthProjectionQuery(text, ctx);
  if (intent === 'upload_preflight_query') return uploadPreflightQuery(text, ctx);
  if (intent === 'rural_vet_ai_self_test_query') return ruralVetAiSelfTestQuery(text, ctx);
  if (intent === 'km_efficiency_query') return kmEfficiencyQuery(text, ctx);
  if (intent === 'performance_veterinari_query') return performanceVeterinariQuery(text, ctx);
  if (intent === 'weekly_digest_query') return weeklyDigestQuery(text, ctx);
  if (intent === 'create_intervention') return createInterventionRequest(text, ctx);
  if (intent === 'update_intervention') return updateInterventionRequest(text, ctx);
  if (intent === 'delete_intervention') return deleteInterventionRequest(text, ctx);
  if (intent === 'create_client') return createClientRequest(text, ctx);
  if (intent === 'update_client' || intent === 'delete_client') return companyMutationRequest(text, ctx);
  if (intent === 'create_service' || intent === 'update_service' || intent === 'delete_service') return serviceMutationRequest(text, ctx);
  if (intent === 'create_invoice' || intent === 'update_invoice' || intent === 'delete_invoice') return invoiceMutationRequest(text, ctx);
  if (intent === 'update_settings') return settingsMutationRequest(text, ctx);
  if (intent === 'learn') return learnQuery(text, ctx);
  return null;
}

function buildGeneralPrompt() {
  return `Sei Rural Vet AI, assistente operativo interno del gestionale veterinario Rural Vet.
Non sei una chat generica e non devi divagare: il tuo valore è far lavorare più velocemente il veterinario dentro il gestionale.

MISSIONE PRIORITARIA
Devi essere eccellente e prevedibile in due aree:
1) lettura dei dati gestionali con KPI, riepiloghi, grafici e indicatori;
2) gestione sicura degli interventi: aggiungere, modificare, eliminare.

REGOLE GENERALI
- Rispondi sempre in italiano, con tono pratico e breve.
- Non inventare mai dati. Usa solo il payload del gestionale, gli strumenti deterministici e gli action JSON disponibili.
- Se un dato non è presente, dillo chiaramente e proponi il prossimo passo più semplice.
- Evita risposte lunghe: prima il dato/azione principale, poi massimo 2-4 righe utili.
- Usa quickReplies quando l'utente deve scegliere periodo, cliente, prestazione, campo da modificare o confermare.
- Non usare mai “fatto”, “salvato”, “eliminato” prima che il frontend abbia applicato l'action.

AREA 1 · DATI, KPI E GRAFICI
Quando l'utente chiede ricavi, KM, numero prestazioni, interventi, clienti, fatture, incassi, da fatturare, trend o dashboard:
- calcola solo dai dati del gestionale;
- specifica sempre il periodo;
- mostra il dato principale in prima riga;
- quando utile aggiungi insight pratici: da fatturare alto, fatture aperte/scadute, trend rispetto al periodo precedente, km/intervento, cliente o prestazione dominante;
- per grafici usa ui.mode="chart" e ui.chart con type "bar" o "line" salvo composizioni semplici;
- per cockpit/check-up/cash flow/chiusura giornata/proiezione/report settimanali usa ui.insights con card sintetiche e quick replies operative;
- per KM usa sia tratte calcolate sia KM salvati sugli interventi; quando richiesto calcola km/intervento e ricavi/km;
- per performance team confronta veterinari/collaboratori su ricavi, interventi, prestazioni e KM senza giudizi personali;
- segnala sempre problemi azionabili: fatture scadute, da fatturare, interventi anomali, dati mancanti, listino incompleto, clienti fermi;
- per "cockpit", "cosa devo fare", "priorità", "chiusura giornata", "proiezione mese", "dati mancanti", "clienti fermi" restituisci controlli operativi e azioni consigliate, non testo generico;
- serie temporali: usa line; classifiche: usa bar;
- proponi quickReplies come “Grafico ricavi”, “Top clienti”, “Top prestazioni”, “KPI periodo”, “Da fatturare”, “KM periodo”.

AREA 2 · INTERVENTI
Per creare un intervento:
- crea o continua una bozza progressiva;
- raccogli azienda reale, prestazioni reali, quantità, data, ora/sessione, note e km se presenti;
- se azienda o prestazione è ambigua, proponi alternative cliccabili;
- se manca un campo, chiedi solo quel campo;
- prima del salvataggio mostra riepilogo chiaro;
- SALVA è consentito solo se la bozza è completa.

Per modificare un intervento:
- identifica l'intervento usando data, cliente, prestazione, veterinario, note o stato;
- se ci sono più risultati, proponi una scelta numerata/cliccabile;
- raccogli il campo da cambiare: data, ora, sessione, cliente, prestazioni, quantità, note, stato fatturato;
- mostra riepilogo e chiedi SALVA.

Per eliminare un intervento:
- identifica prima l'intervento;
- se ce ne sono più di uno, proponi scelta;
- mostra sempre riepilogo;
- ELIMINA è consentito solo dopo conferma esplicita.

FORMATO OBBLIGATORIO
Rispondi sempre con JSON valido contenente:
{
  "reply": "testo breve per l'utente",
  "action": null,
  "actions": [],
  "learn": [],
  "quickReplies": [],
  "ui": {
    "mode": "none|analytics|chart|intervention_wizard|intervention_edit|intervention_delete|confirm",
    "awaiting": "none|period_choice|metric_choice|company_choice|service_choice|datetime_choice|quantity_choice|intervention_choice|field_choice|confirm",
    "safeToApply": false,
    "chart": null
  }
}

Azioni supportate: create_intervention, update_intervention, delete_intervention, create_client, update_client, delete_client, create_service, update_service, delete_service, create_invoice, update_invoice, delete_invoice, update_settings, continue_intervention_draft.

SICUREZZA
ui.safeToApply=true solo quando l'azione è completa, usa entità reali del gestionale, non ha ambiguità e l'utente ha confermato esplicitamente.
Per delete/update safeToApply resta false finché l'utente non vede il riepilogo e conferma.
Se non sei sicura, non applicare: fai una domanda breve o proponi pulsanti.`;
}

function generalPayload(body, ctx) {
  return {
    richiesta: safeText(body.input, MAX_INPUT_CHARS),
    utente_corrente: ctx.currentUser,
    conteggi_gestionale: { clienti: ctx.companies.length, prestazioni: ctx.services.length, interventi: ctx.interventions.length, fatture: ctx.invoices.length, km: ctx.kmRoutes.length },
    appunti: safeText(body.system, 12000),
    memoria_recente: ctx.memory.slice(0, 40),
    esempi_clienti: ctx.companies.slice(0, 40).map(c => c.nome),
    esempi_prestazioni: ctx.services.slice(0, 80).map(s => s.nome)
  };
}
function toOpenAIContent(payload, image) {
  if (!image || !image.dataUrl) return JSON.stringify(payload);
  return [ { type: 'text', text: JSON.stringify(payload) }, { type: 'image_url', image_url: { url: image.dataUrl } } ];
}
async function safeGeneralAnswer(body, ctx) {
  const offlineQr = ['Cockpit Rural Vet AI', 'KPI periodo', 'Inserisci intervento', 'Aiuto'];
  if (!process.env.OPENAI_API_KEY) {
    return { reply: 'Per le domande libere (es. casi clinici) serve la chiave OpenAI sul backend, che ora manca. Tutte le funzioni del gestionale però funzionano lo stesso: dati, KPI, grafici, interventi, fatture. Prova con uno di questi:', action: null, actions: [], learn: [], quickReplies: offlineQr, source: 'openai-missing-key' };
  }
  try {
    return await generalAnswer(body, ctx);
  } catch (err) {
    console.error('OpenAI generalAnswer non riuscita:', err);
    return { reply: 'Non riesco a rispondere alla domanda libera in questo momento (OpenAI non raggiungibile). Le funzioni del gestionale però funzionano: dati, KPI, grafici, interventi e fatture. Riprova tra poco oppure scegli qui sotto.', action: null, actions: [], learn: [], quickReplies: offlineQr, source: 'openai-error', error: err.message };
  }
}
async function generalAnswer(body, ctx) {
  const history = asArray(body.conversation).slice(-4).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: safeText(m.content || m.text, 1200) })).filter(m => m.content);
  const messages = [
    { role: 'system', content: buildGeneralPrompt() },
    ...history,
    { role: 'user', content: toOpenAIContent(generalPayload(body, ctx), body.image) }
  ];
  const { parsed, usage } = await openAIJson(messages);
  const ui = parsed.ui && typeof parsed.ui === 'object' ? parsed.ui : aiUi();
  const chart = parsed.chart || ui.chart || null;
  return { reply: safeText(parsed.reply || parsed.answer || parsed.message || 'Dimmi meglio cosa vuoi fare.', 3500), action: parsed.action || null, actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [], learn: Array.isArray(parsed.learn) ? parsed.learn.slice(0, 8) : [], quickReplies: Array.isArray(parsed.quickReplies) ? parsed.quickReplies.slice(0, 8) : [], ui, chart, usage, source: 'openai-general' };
}
function validateAction(result, ctx) {
  if (!result) return result;
  if (!result.ui) result.ui = aiUi();
  const all = [];
  if (result.action) all.push(result.action);
  if (Array.isArray(result.actions)) all.push(...result.actions);
  let safe = !!result.ui.safeToApply;
  for (const a of all) {
    if (!a || typeof a !== 'object') { safe = false; continue; }
    if (a.type === 'create_intervention') {
      const v = validateInterventionAction(a, ctx);
      if (!v.ok) {
        safe = false;
        result.quickReplies = (result.quickReplies || []).filter(q => String(q).toUpperCase() !== 'SALVA');
        result.reply = result.reply || ('Non salvo ancora: mi manca ' + v.errors.join(', ') + '.');
      }
    }
    if ((a.type === 'delete_intervention' || a.type === 'update_intervention') && a.interventionId && !ctx.interventions.some(i => String(i.id) === String(a.interventionId))) { a.interventionId = ''; safe = false; }
    if ((a.type === 'update_client' || a.type === 'delete_client' || a.type === 'create_invoice') && a.companyId && !ctx.companies.some(c => String(c.id) === String(a.companyId))) { a.companyId = ''; safe = false; }
    if ((a.type === 'update_service' || a.type === 'delete_service') && a.serviceId && !ctx.services.some(p => String(p.id) === String(a.serviceId))) { a.serviceId = ''; safe = false; }
    if ((a.type === 'update_invoice' || a.type === 'delete_invoice') && a.invoiceId && !ctx.invoices.some(f => String(f.id) === String(a.invoiceId))) { a.invoiceId = ''; safe = false; }
  }
  if (result.ui.mode === 'intervention_wizard' && result.ui.awaiting !== 'confirm') safe = false;
  result.ui.safeToApply = safe;
  return result;
}

app.get('/', (req, res) => res.json({ ok: true, name: 'Rural Vet AI backend', version: VERSION, model: MODEL }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'rural-vet-ai', version: VERSION, model: MODEL, time: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Cloud DB proxy (v8.9): la chiave JSONBin sta SOLO qui, in variabili ambiente.
// Il frontend chiama questi endpoint invece di parlare direttamente con JSONBin
// con la master key incorporata nell'HTML (grave rischio: chiunque apra il
// sorgente della pagina potrebbe leggere/sovrascrivere/cancellare tutti i dati).
// Env richieste su Render: JSONBIN_BIN_ID, JSONBIN_API_KEY.
// ---------------------------------------------------------------------------
const JSONBIN_BIN_ID = safeText(process.env.JSONBIN_BIN_ID || '', 80).trim();
const JSONBIN_API_KEY = safeText(process.env.JSONBIN_API_KEY || '', 200).trim();
const DB_PROXY_READY = Boolean(JSONBIN_BIN_ID && JSONBIN_API_KEY && typeof fetch === 'function');
const MAX_DB_BYTES = Number(process.env.MAX_DB_BYTES || 8 * 1024 * 1024);

function looksLikeRuralVetDb(record) {
  return record && typeof record === 'object' && !Array.isArray(record) && Array.isArray(record.aziende) && Array.isArray(record.int) && Array.isArray(record.prest);
}

app.get('/api/db/ping', (req, res) => {
  res.json({ ok: true, configured: DB_PROXY_READY, version: VERSION });
});

app.get('/api/db/load', async (req, res) => {
  if (!DB_PROXY_READY) return res.status(503).json({ ok: false, error: 'Cloud DB non configurato sul backend (JSONBIN_BIN_ID / JSONBIN_API_KEY mancanti).' });
  try {
    const r = await fetch(`https://api.jsonbin.io/v3/b/${encodeURIComponent(JSONBIN_BIN_ID)}/latest`, { headers: { 'X-Master-Key': JSONBIN_API_KEY } });
    if (!r.ok) return res.status(502).json({ ok: false, error: `JSONBin load ${r.status}` });
    const j = await r.json();
    if (!looksLikeRuralVetDb(j?.record)) return res.status(502).json({ ok: false, error: 'Record cloud non valido o vuoto.' });
    return res.json({ ok: true, record: j.record });
  } catch (err) {
    console.error('Errore /api/db/load', err);
    return res.status(502).json({ ok: false, error: 'Cloud non raggiungibile: ' + err.message });
  }
});

app.post('/api/db/save', async (req, res) => {
  if (!DB_PROXY_READY) return res.status(503).json({ ok: false, error: 'Cloud DB non configurato sul backend (JSONBIN_BIN_ID / JSONBIN_API_KEY mancanti).' });
  try {
    const record = req.body && req.body.db ? req.body.db : req.body;
    if (!looksLikeRuralVetDb(record)) return res.status(400).json({ ok: false, error: 'Payload non valido: mi aspetto il db Rural Vet completo (aziende/int/prest). Salvataggio rifiutato per proteggere i dati.' });
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body, 'utf8') > MAX_DB_BYTES) return res.status(413).json({ ok: false, error: 'DB troppo grande per il salvataggio cloud.' });
    const r = await fetch(`https://api.jsonbin.io/v3/b/${encodeURIComponent(JSONBIN_BIN_ID)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_API_KEY }, body });
    if (!r.ok) return res.status(502).json({ ok: false, error: `JSONBin save ${r.status}` });
    return res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Errore /api/db/save', err);
    return res.status(502).json({ ok: false, error: 'Cloud non raggiungibile: ' + err.message });
  }
});

app.post('/api/debug-context', (req, res) => {
  const ctx = buildContext(req.body || {});
  res.json({ ok: true, version: VERSION, counts: { users: ctx.users.length, companies: ctx.companies.length, services: ctx.services.length, interventions: ctx.interventions.length, invoices: ctx.invoices.length, km: ctx.kmRoutes.length }, currentUser: ctx.currentUser, sampleCompanies: ctx.companies.slice(0, 5).map(c => c.nome), sampleServices: ctx.services.slice(0, 5).map(s => s.nome), sampleInterventions: ctx.interventions.slice(0, 3), sampleInvoices: ctx.invoices.slice(0, 3) });
});

app.post('/api/vet-ai-chat', async (req, res) => {
  try {
    const body = req.body || {};
    const text = safeText(body.input, MAX_INPUT_CHARS);
    const ctx = buildContext(body);
    if (!text.trim()) return res.json({ reply: 'Scrivimi cosa vuoi sapere o fare nel gestionale.', action: null, actions: [], learn: [], source: 'empty' });

    let result = deterministicRouter(text, ctx);
    let source = 'deterministic-v8';

    if (!result && looksManagement(text)) {
      try {
        const plan = await planner(text, ctx);
        result = executePlan(plan, text, ctx);
        source = 'planner-v8';
      } catch (err) {
        console.warn('Planner non riuscito:', err.message);
      }
      if (!result) {
        result = { reply: 'Non sono riuscito a trovare quel dato nel gestionale con sicurezza. Dimmi cliente/prestazione/periodo in modo più preciso oppure aggiorna il gestionale e riprova.', action: null, actions: [], learn: [] };
        source = 'safe-no-data-v8';
      }
    }

    if (!result) {
      result = await safeGeneralAnswer(body, ctx);
      source = result.source || 'openai-general';
    }

    result = validateAction(result, ctx);
    if (String(process.env.AI_DEBUG || '').toLowerCase() === 'true') console.log('[AI_DEBUG]', JSON.stringify({ input:text, source, awaiting:result.ui?.awaiting || null, draftId:result.ui?.draftId || '', actionType:result.action?.type || '', safeToApply:!!result.ui?.safeToApply, counts:{companies:ctx.companies.length, services:ctx.services.length} }));
    res.json({ reply: safeText(result.reply || 'Dimmi meglio cosa vuoi fare.', 5000), action: result.action || null, actions: Array.isArray(result.actions) ? result.actions.slice(0, 12) : [], learn: Array.isArray(result.learn) ? result.learn.slice(0, 12) : [], quickReplies: Array.isArray(result.quickReplies) ? result.quickReplies.slice(0, 12) : [], ui: result.ui || aiUi(), chart: result.chart || result.ui?.chart || null, source, model: source.includes('openai') || source.includes('planner') ? MODEL : 'rural-vet-deterministic-v8', debug: { counts: { clienti: ctx.companies.length, prestazioni: ctx.services.length, interventi: ctx.interventions.length, fatture: ctx.invoices.length, km: ctx.kmRoutes.length }, currentUser: ctx.currentUser?.name || '' } });
  } catch (err) {
    console.error('Errore /api/vet-ai-chat', err);
    res.status(200).json({ ok: false, reply: 'Errore backend AI. Non rispondo a caso: controlla log Render e riprova.', action: null, actions: [], learn: [], error: err.message, source: 'error-v8' });
  }
});

app.post(['/api/ai', '/api/chat'], (req, res, next) => {
  req.url = '/api/vet-ai-chat';
  app._router.handle(req, res, next);
});

if (process.env.NODE_ENV !== 'test') app.listen(PORT, () => console.log(`Rural Vet AI backend v${VERSION} attivo sulla porta ${PORT} con modello ${MODEL}`));

export { app, buildContext, deterministicRouter, parseInterventionDraft, continuePendingInterventionDraft, validateInterventionAction, findServiceCandidates, findCompanyCandidates };
