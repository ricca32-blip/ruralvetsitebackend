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
const VERSION = '8.1.0-stateful';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-key' });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '60mb' }));
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
  const raw = [...asArray(context.interventi), ...asArray(context.interventiRecenti), ...asArray(context.activities), ...asArray(context.int)];
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
  if (/\bpiva\b|\bpartita iva\b/.test(n)) fields.push('piva');
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
  return /\b(piva|partita iva|codice fiscale|\bcf\b|sdi|indirizzo|ragione sociale|cliente|clienti|azienda|aziende|fatturato|fatture|fattura|ricavi|ricavo|incassato|incassi|pagato|pagata|da pagare|da fatturare|intervento|interventi|prestazione|prestazioni|giornata|dashboard|km|chilometri|rimborso|listino|prezzo|quanto|quanti|quale|mostra|dammi|cerca|elenca|telefono|email|mail|costo|media|top|classifica|trend|confronta|confronto|iva|imponibile|scadenza|scadute|scaduti|configurazione|impostazioni|collaboratore|utente|tariffa)\b/.test(n) || looksAction(text);
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
function pct(part, total) { return total ? `${((num(part) / num(total)) * 100).toFixed(1).replace('.', ',')}%` : '0%'; }
function avg(total, count) { return count ? num(total) / count : 0; }
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
function response(reply, action = null, quickReplies = []) {
  return { reply, action, actions: [], learn: [], quickReplies };
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
  return response(`Posso controllare quasi tutto il gestionale da chat:\n• interventi: inserire, cercare, contare, modificare data/ora/cliente/prestazioni/note/fatturato, eliminare;\n• aziende: cercare dati fiscali, creare, modificare P.IVA/CF/SDI/indirizzo/tel/km, eliminare;\n• listino: cercare prezzi, creare voci, cambiare prezzi base o prezzi specifici per azienda;\n• fatture: elencare, emettere per cliente, segnare pagate/non pagate, annullare;\n• analisi: ricavi per giorno/mese/anno/YTD, da fatturare, incassato, fatture aperte/scadute, top clienti, top prestazioni, ricavi per veterinario, medie e confronti;\n• impostazioni: IVA, tariffe km, casa/email/tel dei collaboratori.\nPer ogni modifica preparo l'azione e ti chiedo SALVA o ELIMINA prima di toccare i dati.`, null, ['Inserisci intervento', 'Ricavi da inizio anno', 'Top clienti mese', 'Aiutami con un caso clinico']);
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
function analyticsQuery(text, ctx) {
  const n = norm(text);
  const wants = /\b(ricavi|ricavo|fatturato|fatturati|fatture|fattura|incassato|incassi|pagato|pagata|da pagare|da fatturare|economico|totale|top|classifica|miglior|peggior|media|medie|trend|per cliente|per azienda|per veterinario|per collaboratore|per prestazione|per mese|per giorno|scadut|aperte|imponibile|iva|ytd|inizio anno|anno|mese|settimana)\b/.test(n);
  if (!wants) return null;
  const filters = managementFilters(text, ctx, /\boggi\b|\bgiorno\b/.test(n) ? 'today' : 'ytd');
  if (filters.companyResult.ambiguous) return response('Ho trovato più clienti possibili:\n' + filters.companyResult.alternatives.map((a,i)=>`${i+1}) ${a.nome}`).join('\n') + '\nQuale intendi?');
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
  const imponibile = invs.reduce((s,f)=>s+num(f.imponibile, 0),0);
  const iva = invs.reduce((s,f)=>s+num(f.iva, 0),0);
  const todayIso = isoDate(ctx.now);
  const scadute = invUnpaid.filter(f => f.scadenza && f.scadenza < todayIso);

  if (/\bscadut/.test(n)) {
    if (!scadute.length) return response(`Non risultano fatture scadute per ${scope}.`);
    return response(`Fatture scadute ${scope}: ${scadute.length}, totale ${euro(invoiceTotal(scadute))}.\n` + scadute.slice(0,15).map(f => `- ${formatInvoice(f)}${f.scadenza ? ' · scad. ' + f.scadenza : ''}`).join('\n'));
  }
  if (/\btop\b|\bclassifica\b|\bmiglior/.test(n) || /per\s+(cliente|azienda|veterinario|collaboratore|prestazione|mese|giorno)/.test(n)) {
    let rows = [];
    const byService = /per\s+prestaz|top\s+prestaz|classifica\s+prestaz|miglior[ie]?\s+prestaz/.test(n);
    const byUser = /per\s+(veterinario|collaboratore|utente)|top\s+(veterinari|collaboratori|utenti)|classifica\s+(veterinari|collaboratori|utenti)/.test(n);
    const byMonth = /per\s+mese|mese\s+per\s+mese|mensil/.test(n);
    const byDay = /per\s+(giorno|giornata|data)|giorno\s+per\s+giorno|giornalier/.test(n);
    if (byService) rows = serviceTotalRows(ints).map(r => ({ key: r.key, count: r.qty, total: r.total, detail: `${r.qty} q.tà · ${r.count} interventi` }));
    else if (byUser) rows = groupMap(ints, i => i.userName || i.userId || 'Utente').map(r => ({...r, detail: `${r.count} interventi`}));
    else if (byMonth) rows = groupMap(ints, i => monthKey(i.data)).map(r => ({...r, detail: `${r.count} interventi`}));
    else if (byDay) rows = groupMap(ints, i => dayKey(i.data)).map(r => ({...r, detail: `${r.count} interventi`}));
    else rows = groupMap(ints, i => i.azienda || 'Cliente').map(r => ({...r, detail: `${r.count} interventi`}));
    if (!rows.length) return response(`Non ho dati per fare la classifica ${scope}.`);
    return response(`Classifica ${scope}:\n` + rows.slice(0,12).map((r,i)=>`${i+1}) ${r.key}: ${euro(r.total)} · ${r.detail || (r.count + ' interventi')} · ${pct(r.total, ricavi)}`).join('\n'));
  }
  if (/\bmedia|medie|ticket medio|valore medio/.test(n)) {
    const byDay = groupMap(ints, i => dayKey(i.data));
    const activeDays = byDay.length;
    return response(`Medie ${scope}:\nRicavo medio/intervento: ${euro(avg(ricavi, ints.length))}.\nInterventi medi/giorno attivo: ${activeDays ? (ints.length / activeDays).toFixed(1).replace('.', ',') : '0'}.\nRicavo medio/giorno attivo: ${euro(avg(ricavi, activeDays))}.\nFattura media emessa: ${euro(avg(fattureEmesse, invs.length))}.`);
  }
  if (/\bconfront|trend|vs\b|rispetto/.test(n)) {
    const prev = periodForPrevious(filters.period);
    const prevInts = prev ? filterInterventions(ctx, { ...filters, period: prev }) : [];
    const prevTot = interventionTotal(prevInts);
    const delta = ricavi - prevTot;
    const sign = delta >= 0 ? '+' : '';
    return response(`Confronto ${scope}:\nPeriodo attuale: ${euro(ricavi)} (${ints.length} interventi).\n${prev ? 'Periodo precedente: ' + euro(prevTot) + ' (' + prevInts.length + ' interventi).' : 'Periodo precedente non calcolabile.'}\nDifferenza: ${sign}${euro(delta)}${prevTot ? ' · ' + sign + pct(delta, prevTot) : ''}.`);
  }
  if (/\bda fatturare\b|\bnon fatturat/.test(n)) return response(`Da fatturare ${scope}: ${euro(daFatturare)} (${notInvoicedInts.length} interventi).`);
  if (/\bda pagare\b|\bnon pagat|\baperte\b/.test(n)) return response(`Da pagare ${scope}: ${euro(aperte)} (${invUnpaid.length} fatture aperte).`);
  if (/\bincass|\bpagat/.test(n) && !/fatturato/.test(n)) return response(`Incassato ${scope}: ${euro(incassato)} (${invPaid.length} fatture pagate).`);
  if (/\bfatture\b|\bfattura\b/.test(n) && (/\bmostra\b|\belenca\b|\blista\b|\bdammi\b/.test(n))) {
    if (!invs.length) return response(`Non trovo fatture per ${scope}.`);
    return response(`Fatture ${scope}: ${invs.length}, totale ${euro(fattureEmesse)}.\n` + invs.slice(0, 15).map(f => `- ${formatInvoice(f)}`).join('\n') + (invs.length > 15 ? `\n+ altre ${invs.length - 15}` : ''));
  }
  return response(`Riepilogo economico ${scope}:\nRicavi interventi: ${euro(ricavi)} (${ints.length} interventi).\nGià fatturati: ${euro(interventionTotal(invoicedInts))} · Da fatturare: ${euro(daFatturare)}.\nFatture emesse: ${euro(fattureEmesse)} (${invs.length}) · Imponibile: ${euro(imponibile)} · IVA: ${euro(iva)}.\nIncassato: ${euro(incassato)} · Da pagare: ${euro(aperte)}${scadute.length ? ' · Scadute: ' + euro(invoiceTotal(scadute)) : ''}.`, null, ['Top clienti', 'Da fatturare', 'Fatture aperte', 'Ricavi per prestazione']);
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
    const cat = textAfter(text, /categoria\s*[:=]?\s*([^,;.]+)/i) || 'Listino AI';
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
  return updates;
}
function isUpdateInterventionRequest(text) {
  const n = norm(text);
  return /\b(modifica|cambia|aggiorna|correggi|sposta|segna|marca|metti|aggiungi nota|nota)\b/.test(n) && /\b(intervento|prestazione|visita|cesar|fecond|insemin|ecograf|mastit|metrit|fatturat|nota|ore|ora|giorno|data)\b/.test(n);
}
function updateInterventionRequest(text, ctx) {
  if (!isUpdateInterventionRequest(text)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b/.test(norm(text)) ? 'today' : 'ytd');
  const items = filterInterventions(ctx, filters).sort((a,b)=>String(b.data).localeCompare(String(a.data)) || String(b.ora).localeCompare(String(a.ora))).slice(0,12);
  const updates = parseInterventionUpdates(text, ctx);
  if (!Object.keys(updates).length) return response('Che cosa devo cambiare dell’intervento? Posso modificare data, ora, cliente, prestazioni, note o stato fatturato.');
  if (!items.length) return response(`Non trovo l'intervento da modificare per ${displayScope(filters) || periodLabel(filters.period)}. Dimmi cliente, giorno e prestazione.`);
  const lines = Object.entries(updates).map(([k,v]) => `${k}: ${Array.isArray(v) ? v.map(x=>`${x.name || x.nome} x${x.qty || 1}`).join(', ') : v}`).join('\n');
  if (items.length === 1) return response(`Ho preparato questa modifica:\n- ${formatIntervention(items[0])}\n${lines}\nScrivi SALVA per applicarla.`, { type:'update_intervention', interventionId:items[0].id, updates, query:text }, actionButtons('save'));
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
  const fields = requestedFields(text);
  if (!fields.length) return null;
  const found = resolveCompany(text, ctx.companies);
  if (!found.match) {
    if (found.alternatives.length) return { reply: 'Ho trovato più clienti possibili:\n' + found.alternatives.map((a,i)=>`${i+1}) ${a.nome}${a.ragioneSociale ? ' · ' + a.ragioneSociale : ''}`).join('\n') + '\nQuale intendi?', action: null, actions: [], learn: [] };
    return { reply: 'Non trovo quel cliente nel gestionale. Scrivimi il nome esatto come appare in Aziende.', action: null, actions: [], learn: [] };
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
  if (/\bquanti\b.*\b(clienti|aziende)\b|\bnumero\b.*\b(clienti|aziende)\b/.test(n)) return { reply: `Nel gestionale ci sono ${ctx.companies.length} clienti.`, action: null, actions: [], learn: [] };
  if (/\belenca\b.*\b(clienti|aziende)\b|\blista\b.*\b(clienti|aziende)\b/.test(n)) return { reply: `Clienti (${ctx.companies.length}):\n` + ctx.companies.slice(0, 25).map(c => `- ${c.nome}${c.comune ? ' · ' + c.comune : ''}`).join('\n') + (ctx.companies.length > 25 ? `\n+ altri ${ctx.companies.length - 25}` : ''), action: null, actions: [], learn: [] };
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
  if (filters.companyResult.ambiguous) return { reply: 'Ho trovato più clienti possibili:\n' + filters.companyResult.alternatives.map((a,i)=>`${i+1}) ${a.nome}`).join('\n') + '\nQuale intendi?', action: null, actions: [], learn: [] };
  const items = filterInterventions(ctx, filters).sort((a,b) => String(a.data).localeCompare(String(b.data)) || String(a.ora).localeCompare(String(b.ora)));
  const countOnly = /\bquanti\b|\bnumero\b/.test(n) && !/\bmostra\b|\belenca\b|\bdammi\b|\briepilogo\b|\bgiornata\b/.test(n);
  const scope = displayScope(filters);
  if (!items.length) return { reply: `Non trovo interventi per ${scope || periodLabel(filters.period)}.`, action: null, actions: [], learn: [] };
  const total = interventionTotal(items);
  if (countOnly) return { reply: `Interventi ${scope}: ${items.length}. Totale: ${euro(total)}.`, action: null, actions: [], learn: [] };
  const lines = items.slice(0, 18).map(i => `- ${formatIntervention(i)}`);
  return { reply: `Interventi ${scope}: ${items.length}, totale ${euro(total)}.\n${lines.join('\n')}${items.length > 18 ? `\n+ altri ${items.length - 18}` : ''}`, action: null, actions: [], learn: [] };
}
function revenueQuery(text, ctx) {
  const n = norm(text);
  if (!/\b(fatturato|fatturare|fatture|fattura|ricavi|ricavo|incassato|incassi|pagato|pagata|da pagare|non pagate|aperte|dashboard|economico|totale)\b/.test(n)) return null;
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
  const filters = managementFilters(text, ctx, /\boggi\b/.test(n) ? 'today' : 'ytd');
  const items = ctx.kmRoutes.filter(k => (!filters.period || inRange(k.data, filters.period)) && (!filters.user || String(k.userId) === String(filters.user.id) || norm(k.userName) === norm(filters.user.name)));
  if (!items.length) return { reply: `Non ho tratte KM nel contesto per ${displayScope(filters) || periodLabel(filters.period)}. Apri la pagina KM e calcola/aggiorna i percorsi.`, action: null, actions: [], learn: [] };
  const kmTot = items.reduce((s,k)=>s+num(k.km),0);
  const amount = items.reduce((s,k)=>s+num(k.amount),0);
  return { reply: `KM ${displayScope(filters)}: ${kmTot.toFixed(1)} km. Rimborso: ${euro(amount)}.\n` + items.slice(0,12).map(k => `- ${k.data} · ${k.from || '?'} → ${k.to || '?'}: ${num(k.km).toFixed(1)} km`).join('\n'), action: null, actions: [], learn: [] };
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
  return { reply: 'Ok, lo salvo nella memoria AI.', action: null, actions: [], learn: [{ kind: 'istruzione', text: content, userId: ctx.currentUser?.id || '', userName: ctx.currentUser?.name || '' }] };
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
  if (!isCreateInterventionRequest(text)) return null;
  const companyRes = resolveCompany(text, ctx.companies, { allowWeak: true });
  if (!companyRes.match) {
    if (companyRes.alternatives.length) return { reply: 'Ho trovato più clienti possibili:\n' + companyRes.alternatives.map((c,i)=>`${i+1}) ${c.nome}${c.comune ? ' · ' + c.comune : ''}`).join('\n') + '\nQuale devo usare?', action: null, actions: [], learn: [] };
    const guessed = (safeText(text).match(/\bda\s+(.+?)(?:\s+(?:oggi|ieri|alle|ore|mattina|pomeriggio|sera|notte)|$)/i) || [])[1] || '';
    return { reply: `Non trovo il cliente${guessed ? ' "' + guessed.trim() + '"' : ''} nel gestionale. Vuoi crearlo? Scrivi: CREA CLIENTE con ragione sociale e indirizzo.`, action: { type: 'create_intervention', companyName: guessed.trim(), companyId: '', services: [], date: '', time: '', session: '', note: 'Cliente non riconosciuto' }, actions: [], learn: [] };
  }
  const services = detectRequestedServices(text, ctx.services, { max: 10 });
  if (!services.length) {
    const serviceText = serviceTextFromRequest(text) || text;
    const serviceRes = resolveServices(serviceText, ctx.services);
    if (serviceRes.ambiguous) return response('Ho trovato più prestazioni possibili:\n' + serviceRes.alternatives.map((s,i)=>`${i+1}) ${s.nome}${s.price ? ' · ' + euro(s.price) : ''}`).join('\n') + '\nQuale devo usare?');
    if (serviceRes.matches.length) services.push(...serviceRes.matches.map(s => ({ name:s.nome, nome:s.nome, id:s.id, qty:qtyNearService(text, s.nome) })));
  }
  if (!services.length) return response('Non ho riconosciuto la prestazione. Scrivimi il nome come nel listino oppure dimmi quale voce usare.');
  const when = parseWhen(text, ctx.now);
  const cleanServices = services.map(s => ({ name: s.name || s.nome, id: s.id, qty: Math.max(1, num(s.qty, 1)) }));
  const action = { type: 'create_intervention', companyName: companyRes.match.nome, companyId: companyRes.match.id || '', services: cleanServices, date: when.date || '', time: when.time || '', session: when.session || '', note: 'Preparato da Rural Vet AI' };
  const line = cleanServices.map(s => `${s.name}${s.qty > 1 ? ' x' + s.qty : ''}`).join(', ');
  if (!action.date || !action.time) return response(`Ho capito: ${line} da ${companyRes.match.nome}.\nQuando lo registro?`, action, actionButtons('when'));
  return response(`Ho capito: ${line} da ${companyRes.match.nome}, ${action.date} ore ${action.time}.\nScrivi SALVA per registrare nel gestionale.`, action, actionButtons('save'));
}
function deleteInterventionRequest(text, ctx) {
  if (!isDeleteRequest(text)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b/.test(norm(text)) ? 'today' : 'ytd');
  const items = filterInterventions(ctx, filters).sort((a,b) => String(b.data).localeCompare(String(a.data)) || String(b.ora).localeCompare(String(a.ora)));
  if (!items.length) return { reply: `Non trovo interventi da eliminare per ${displayScope(filters) || periodLabel(filters.period)}. Dimmi cliente, giorno e prestazione.`, action: null, actions: [], learn: [] };
  if (items.length === 1) return { reply: `Ho trovato questo intervento:\n- ${formatIntervention(items[0])}\nScrivi ELIMINA per cancellarlo.`, action: { type: 'delete_intervention', interventionId: items[0].id, query: text, note: 'Richiesta eliminazione da AI' }, actions: [], learn: [] };
  return { reply: `Ho trovato più interventi possibili. Scegli il numero:\n` + items.slice(0, 12).map((i,idx)=>`${idx+1}) ${formatIntervention(i)}`).join('\n'), action: { type: 'delete_intervention', query: text, note: 'Scelta tra più interventi' }, actions: [], learn: [] };
}



// === Rural Vet AI state guard, edit/delete helpers v12 ===
function rvDebug(label, payload = {}) {
  if (process.env.AI_DEBUG !== 'true') return;
  try { console.log('[RV_AI]', label, JSON.stringify(payload).slice(0, 4000)); } catch { console.log('[RV_AI]', label, payload); }
}
function rvFreshDraft(draft, bodySessionId = '') {
  if (!draft || typeof draft !== 'object') return null;
  const now = Date.now();
  const created = Date.parse(draft.createdAt || draft.updatedAt || '') || now;
  const ttl = draft.type === 'delete_intervention_draft' ? 5*60*1000 : draft.type === 'analytics_query' ? 10*60*1000 : 20*60*1000;
  if (now - created > ttl) return null;
  if (bodySessionId && draft.aiSessionId && draft.aiSessionId !== bodySessionId) return null;
  return draft;
}
function rvWithState(result, state = {}) {
  result = result || { reply: 'Dimmi meglio cosa vuoi fare.', action: null, actions: [], learn: [] };
  result.state = {
    pendingInterventionDraft: state.pendingInterventionDraft ?? null,
    pendingEditInterventionDraft: state.pendingEditInterventionDraft ?? null,
    pendingDeleteInterventionDraft: state.pendingDeleteInterventionDraft ?? null,
    pendingAnalyticsQuery: state.pendingAnalyticsQuery ?? null,
    pendingDataQuery: state.pendingDataQuery ?? null
  };
  result.clearState = !!state.clearState;
  return result;
}
function rvActionButtons(kind) {
  if (kind === 'save') return ['SALVA','Modifica ancora','Annulla'];
  if (kind === 'delete') return ['ELIMINA','Annulla'];
  return ['Annulla'];
}
function rvInterventionLabel(i) {
  return `${i.azienda || 'Azienda'} · ${i.data || '?'} ${i.ora || i.sess || ''} · ${asArray(i.prestazioni).map(p => `${p.nome}${p.qty > 1 ? ' x'+p.qty : ''}`).join(' + ') || 'intervento'}`.trim();
}
function rvServiceNameList(services) { return asArray(services).map(s => s.nome || s.name || '').filter(Boolean).join(' + '); }
function rvInterventionCandidates(text, ctx) {
  const n = norm(text);
  const period = parsePeriod(text, ctx.now, /\boggi\b/.test(n) ? 'today' : 'ytd');
  const companyRaw = rvExtractCompanyRaw(text) || textAfter(text, /(?:intervento|prestazione|parto|fecondazione|visita|eco|ecografia|cesareo)\s+(?:di|da|per)?\s*([^,;.]+?)(?:\s+(?:oggi|ieri|alle|ore|del|di|con)|$)/i) || '';
  const compCands = companyRaw ? rvCompanyCandidates(companyRaw, ctx.companies) : [];
  const compIds = new Set(compCands.slice(0, 4).map(c => String(c.id)));
  const servicePhrases = rvExtractServicePhrases(text, ctx).filter(x => !/intervento|prestazione/i.test(x.rawText));
  const serviceCands = servicePhrases.flatMap(x => rvServiceCandidates(x.rawText, ctx.services)).slice(0, 10);
  const serviceNames = serviceCands.map(s => norm(s.name));
  const scored = ctx.interventions.map(i => {
    let score = 0;
    if (period && inRange(i.data, period)) score += 30;
    if (compIds.has(String(i.aziendaId))) score += 55;
    if (companyRaw && tokenScore(companyRaw, i.azienda) > 20) score += 35;
    const ptxt = rvServiceNameList(i.prestazioni);
    if (serviceNames.some(sn => norm(ptxt).includes(sn) || sn.includes(norm(ptxt)))) score += 35;
    for (const sp of servicePhrases) if (tokenScore(sp.rawText, ptxt) > 25) score += 18;
    const when = parseWhen(text, ctx.now);
    if (when.time && i.ora && i.ora.slice(0,2) === when.time.slice(0,2)) score += 15;
    if (/\bieri\b|\boggi\b|\bdomani\b/.test(n) && period && inRange(i.data, period)) score += 12;
    return { item: i, score };
  }).filter(x => x.score >= 20).sort((a,b)=>b.score-a.score || String(b.item.data).localeCompare(String(a.item.data)) || String(b.item.ora).localeCompare(String(a.item.ora))).slice(0, 10);
  return scored.map(x => ({ id: x.item.id, label: rvInterventionLabel(x.item), intervention: x.item, score: x.score }));
}
function rvIsEditInterventionIntent(text) {
  const n = norm(text);
  return /\b(modifica|cambia|sposta|correggi|aggiorna|togli|rimuovi|sostituisci|nota)\b/.test(n) && /\b(intervento|prestazione|parto|fecondazione|visita|ecografia|cesareo|nota|ora|data)\b/.test(n) || (/\baggiungi\b/.test(n) && /\ball\s*intervento|all intervento|intervento di|intervento da|intervento\b/.test(n));
}
function rvIsDeleteInterventionIntent(text) {
  return /\b(elimina|cancella|rimuovi|annulla|togli)\b/.test(norm(text)) && /\b(intervento|prestazione|parto|fecondazione|visita|ecografia|cesareo)\b/.test(norm(text));
}
function rvParseEditChanges(text, ctx) {
  const n = norm(text); const changes = { addServices: [], removeServices: [], replaceServices: [], companyId: null, companyName: '', date: '', time: '', session: '', note: null };
  const when = parseWhen(text, ctx.now); if (when.date) changes.date = when.date; if (when.time) changes.time = when.time; if (when.session) changes.session = when.session;
  const note = textAfter(text, /(?:nota|note|appunto)\s*[:=]?\s*(.+)$/i); if (note) changes.note = note;
  const newCompany = textAfter(text, /(?:cambia|modifica|sposta).{0,30}(?:azienda|cliente)\s+(?:in|a|con|da)\s+(.+?)(?:\s+(?:oggi|ieri|alle|ore|e|con|prestazione)|$)/i);
  if (newCompany) { const c = rvCompanyCandidates(newCompany, ctx.companies)[0]; if (c) { changes.companyId = c.id; changes.companyName = c.name; } }
  if (/\b(aggiungi|metti anche|aggiungi anche)\b/.test(n)) {
    for (const p of rvExtractServicePhrases(text.replace(/^.*?\b(?:aggiungi anche|aggiungi|metti anche)\b/i,''), ctx)) {
      const cand = rvServiceCandidates(p.rawText, ctx.services)[0]; changes.addServices.push({ rawText:p.rawText, qty:p.qty, serviceId:cand?.id||null, serviceName:cand?.name||p.rawText });
    }
  }
  if (/\b(togli|rimuovi|elimina)\b/.test(n)) {
    for (const p of rvExtractServicePhrases(text.replace(/^.*?\b(?:togli|rimuovi|elimina)\b/i,''), ctx)) changes.removeServices.push({ rawText:p.rawText, qty:p.qty });
  }
  return changes;
}
function rvEditDraftResponse(reply, draft, quickReplies = [], extra = {}) { return rvWithState({ reply, action: { type:'edit_intervention_draft', draft }, actions: [], learn: [], quickReplies, ui:{ mode:'edit_intervention', awaiting:draft.awaiting||null, draftId:draft.draftId, safeToApply:false }, ...extra }, { pendingEditInterventionDraft: draft }); }
function rvDeleteDraftResponse(reply, draft, quickReplies = [], extra = {}) { return rvWithState({ reply, action: { type:'delete_intervention_draft', draft }, actions: [], learn: [], quickReplies, ui:{ mode:'delete_intervention', awaiting:draft.awaiting||null, draftId:draft.draftId, safeToApply:false }, ...extra }, { pendingDeleteInterventionDraft: draft }); }
function rvBuildEditAction(draft) { return { type:'update_intervention', interventionId:draft.interventionId, updates:draft.changes, query:draft.originalText }; }
function rvResolveEditDraft(draft, ctx) {
  if (!draft.interventionId) {
    draft.interventionCandidates = rvInterventionCandidates(draft.originalText, ctx);
    if (!draft.interventionCandidates.length) { draft.awaiting='intervention_choice'; return rvEditDraftResponse('Non trovo l’intervento da modificare. Dimmi azienda, giorno e prestazione.', draft, ['Cerca ultimi interventi','Annulla']); }
    if (draft.interventionCandidates.length === 1) { draft.interventionId = draft.interventionCandidates[0].id; }
    else { draft.awaiting='intervention_choice'; return rvEditDraftResponse('Quale intervento vuoi modificare?', draft, draft.interventionCandidates.map(c=>c.label).concat(['Annulla'])); }
  }
  draft.awaiting = 'confirm';
  const target = ctx.interventions.find(i => String(i.id) === String(draft.interventionId));
  const lines = [];
  if (draft.changes.date || draft.changes.time || draft.changes.session) lines.push(`Data/ora: ${[draft.changes.date, draft.changes.time || draft.changes.session].filter(Boolean).join(' ')}`);
  if (draft.changes.addServices?.length) lines.push('Aggiungi: ' + draft.changes.addServices.map(s=>`${s.serviceName || s.rawText} x${s.qty||1}`).join(', '));
  if (draft.changes.removeServices?.length) lines.push('Togli: ' + draft.changes.removeServices.map(s=>s.rawText).join(', '));
  if (draft.changes.companyId) lines.push('Azienda: ' + draft.changes.companyName);
  if (draft.changes.note) lines.push('Nota: ' + draft.changes.note);
  if (!lines.length) lines.push('Modifica richiesta: ' + draft.originalText);
  const action = rvBuildEditAction(draft);
  return rvWithState({ reply:`Ho preparato la modifica:\n- Intervento: ${target ? rvInterventionLabel(target) : draft.interventionId}\n${lines.map(x=>'- '+x).join('\n')}\n\nVuoi salvare?`, action, actions:[], learn:[], quickReplies:rvActionButtons('save'), ui:{ mode:'edit_intervention', awaiting:'confirm', draftId:draft.draftId, safeToApply:true } }, { pendingEditInterventionDraft: draft });
}
function rvNewEditDraft(text, ctx) { const d = { type:'edit_intervention_draft', aiSessionId:ctx.raw?.aiSessionId || '', draftId:'edit_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), originalText:safeText(text,500), interventionCandidates:[], interventionId:null, changes:rvParseEditChanges(text,ctx), awaiting:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }; return rvResolveEditDraft(d, ctx); }
function rvContinueEditDraft(text, draft, ctx) {
  const input = safeText(text,500); const n = norm(input); draft.updatedAt = new Date().toISOString();
  if (/^(annulla|cancella|stop|reset)$/i.test(input)) return rvWithState({ reply:'Ok, modifica annullata.', action:null, actions:[], learn:[], quickReplies:[], clearDraft:true, clearState:true, ui:{mode:'none', awaiting:null, draftId:draft.draftId, safeToApply:false}}, { clearState:true });
  if (draft.awaiting === 'intervention_choice') { const chosen = asArray(draft.interventionCandidates).find(c => norm(c.label) === n || n.includes(norm(c.label)) || norm(c.label).includes(n)); if (chosen) { draft.interventionId = chosen.id; return rvResolveEditDraft(draft, ctx); } }
  const ch = rvParseEditChanges(input, ctx); Object.assign(draft.changes, { ...draft.changes, ...Object.fromEntries(Object.entries(ch).filter(([k,v]) => Array.isArray(v) ? v.length : !!v)) });
  return rvResolveEditDraft(draft, ctx);
}
function rvNewDeleteDraft(text, ctx) { const d = { type:'delete_intervention_draft', aiSessionId:ctx.raw?.aiSessionId || '', draftId:'del_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), originalText:safeText(text,500), interventionCandidates:rvInterventionCandidates(text, ctx), interventionId:null, awaiting:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }; return rvResolveDeleteDraft(d, ctx); }
function rvResolveDeleteDraft(draft, ctx) {
  if (!draft.interventionId) {
    if (!draft.interventionCandidates.length) { draft.awaiting='intervention_choice'; return rvDeleteDraftResponse('Non trovo l’intervento da eliminare. Dimmi azienda, giorno e prestazione.', draft, ['Vedi ultimi interventi','Annulla']); }
    if (draft.interventionCandidates.length === 1) draft.interventionId = draft.interventionCandidates[0].id;
    else { draft.awaiting='intervention_choice'; return rvDeleteDraftResponse('Quale intervento vuoi eliminare?', draft, draft.interventionCandidates.map(c=>c.label).concat(['Annulla'])); }
  }
  draft.awaiting='confirm'; const target = ctx.interventions.find(i => String(i.id) === String(draft.interventionId));
  const action = { type:'delete_intervention', interventionId:draft.interventionId, query:draft.originalText };
  return rvWithState({ reply:`Ho trovato questo intervento:\n- ${target ? rvInterventionLabel(target) : draft.interventionId}\n\nVuoi eliminarlo?`, action, actions:[], learn:[], quickReplies:rvActionButtons('delete'), ui:{ mode:'delete_intervention', awaiting:'confirm', draftId:draft.draftId, safeToApply:true } }, { pendingDeleteInterventionDraft: draft });
}
function rvContinueDeleteDraft(text, draft, ctx) {
  const input = safeText(text,500); const n = norm(input); draft.updatedAt = new Date().toISOString();
  if (/^(annulla|cancella|stop|reset)$/i.test(input)) return rvWithState({ reply:'Ok, eliminazione annullata.', action:null, actions:[], learn:[], quickReplies:[], clearDraft:true, clearState:true, ui:{mode:'none', awaiting:null, draftId:draft.draftId, safeToApply:false}}, { clearState:true });
  if (draft.awaiting === 'intervention_choice') { const chosen = asArray(draft.interventionCandidates).find(c => norm(c.label) === n || n.includes(norm(c.label)) || norm(c.label).includes(n)); if (chosen) { draft.interventionId = chosen.id; return rvResolveDeleteDraft(draft, ctx); } }
  return rvResolveDeleteDraft(draft, ctx);
}
function rvPendingOrPriority(text, ctx) {
  const sid = ctx.raw?.aiSessionId || '';
  const pDel = rvFreshDraft(ctx.raw?.pendingDeleteInterventionDraft, sid);
  const pEdit = rvFreshDraft(ctx.raw?.pendingEditInterventionDraft, sid);
  const pInt = rvFreshDraft(ctx.raw?.pendingInterventionDraft || ctx.raw?.pendingDraft, sid);
  rvDebug('route', { input:text, pendingDelete:!!pDel, pendingEdit:!!pEdit, pendingIntervention:!!pInt, sid });
  if (/^(annulla|cancella|stop|reset)$/i.test(safeText(text,200).trim())) return rvWithState({ reply:'Operazione annullata.', action:null, actions:[], learn:[], quickReplies:[], clearDraft:true, clearState:true, ui:{mode:'none', awaiting:null, safeToApply:false}}, { clearState:true });
  if (pDel) return rvContinueDeleteDraft(text, JSON.parse(JSON.stringify(pDel)), ctx);
  if (pEdit) return rvContinueEditDraft(text, JSON.parse(JSON.stringify(pEdit)), ctx);
  if (pInt) return rvContinueDraft(text, JSON.parse(JSON.stringify(pInt)), ctx);
  if (rvIsDeleteInterventionIntent(text)) return rvNewDeleteDraft(text, ctx);
  if (rvIsEditInterventionIntent(text)) return rvNewEditDraft(text, ctx);
  return null;
}

// === Rural Vet AI intervention wizard v11: safe candidates, persistent draft ===
function rvCleanServiceText(text) {
  let n = norm(text);
  n = n.replace(/\bartif\b|\bartif\.?\b|\bartific\b|\bartific\.?\b/g, 'artificiale');
  n = n.replace(/\bfecondazioni\b/g, 'fecondazione');
  n = n.replace(/\bfecond\b|\bfecond\.?\b|\bfec\b|\bfec\.?\b/g, 'fecondazione');
  n = n.replace(/\bfa\b/g, 'fecondazione artificiale');
  n = n.replace(/\beco\b/g, 'ecografia');
  n = n.replace(/\bcesar\b|\bcesar\.?\b|\bcesario\b/g, 'cesareo');
  n = n.replace(/\bseconda\b/g, 'successiva');
  return n.replace(/\s+/g, ' ').trim();
}
function rvStripDateTime(text) {
  return safeText(text, 4000)
    .replace(/\b(oggi|ieri|domani|stamattina|questa mattina|mattina|pomeriggio|stasera|sera|notte)\b/ig, ' ')
    .replace(/\b(?:alle|ore)\s*\d{1,2}(?::|\.)?\d{0,2}\b/ig, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-](?:20\d{2}|\d{2}))?\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function rvExtractCompanyRaw(text) {
  const raw = safeText(text, 4000).replace(/\s+/g, ' ').trim();
  const m = raw.match(/\b(?:da|presso|cliente|azienda)\s+(.+?)(?=\s+\b(?:oggi|ieri|domani|stamattina|mattina|pomeriggio|sera|notte|alle|ore)\b|\s+\d{1,2}[:.]\d{2}\b|[.;,]|$)/i);
  return m ? safeText(m[1].trim(), 160) : '';
}
function rvRemoveCompanyPart(text) {
  return safeText(text, 4000)
    .replace(/\b(?:da|presso|cliente|azienda)\s+(.+?)(?=\s+\b(?:oggi|ieri|domani|stamattina|mattina|pomeriggio|sera|notte|alle|ore)\b|\s+\d{1,2}[:.]\d{2}\b|[.;,]|$)/i, ' ')
    .replace(/\s+/g, ' ').trim();
}
function rvQtyAndRaw(part) {
  let s = safeText(part, 300).trim();
  s = s.replace(/^\s*(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti|fatto|eseguito)\s+/i, '').trim();
  let qty = 1;
  const m = s.match(/^\s*(\d+|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|x\s*\d+)\s+/i);
  if (m) {
    const w = norm(m[1]).replace(/\s+/g,'');
    qty = /^x?\d+$/.test(w) ? Number(w.replace('x','')) : (NUMBER_WORDS.get(w) || 1);
    s = s.slice(m[0].length).trim();
  }
  s = s.replace(/^\s*(anche|piu|più|con|oltre a|insieme a)\s+/i, '').trim();
  return { rawText: safeText(s, 160), qty: Math.max(1, qty || 1) };
}
function rvExtractServicePhrases(text, ctx) {
  let work = rvRemoveCompanyPart(text);
  work = rvStripDateTime(work);
  work = work.replace(/^\s*(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti|fatto|eseguito)\s+/i, '').trim();
  // Split only on explicit separators in the user text. Do not expand with catalog candidates here.
  const parts = work.split(/\s*(?:\+|,|;|\s+e\s+|\s+piu\s+|\s+più\s+|\s+insieme a\s+|\s+oltre a\s+)\s*/i)
    .map(rvQtyAndRaw)
    .filter(x => x.rawText && x.rawText.length > 1 && !/^da\s+/i.test(x.rawText));
  return parts;
}
function rvServiceCandidates(rawText, services) {
  const q = rvCleanServiceText(rawText);
  if (!q) return [];
  const scored = services.map(s => {
    const sn = rvCleanServiceText(s.nome);
    let score = tokenScore(q, sn, { strong: true });
    if (q === sn) score += 80;
    if (sn.includes(q) && q.length > 2) score += 55;
    if (q.includes(sn) && sn.length > 2) score += 35;
    if (/fecondazione/.test(q) && /fecondazione|inseminazione/.test(sn)) score += 20;
    if (/artificiale/.test(q) && /artificiale|artif/.test(sn)) score += 25;
    if (/prima/.test(q) && /prima/.test(sn)) score += 35;
    if (/successiva/.test(q) && /successiva|seconda/.test(sn)) score += 35;
    if (/parto/.test(q) && /parto/.test(sn)) score += 35;
    if (/cesareo/.test(q) && /cesareo/.test(sn)) score += 35;
    return { id: s.id, name: s.nome, nome: s.nome, price: s.price, score };
  }).filter(x => x.score >= 55).sort((a,b)=>b.score-a.score || String(a.name).localeCompare(String(b.name),'it'));
  return scored.slice(0, 8);
}
function rvCompanyLabel(c) { return [c.nome, c.comune || c.provincia].filter(Boolean).join(' · '); }
function rvCompanyCandidates(rawText, companies) {
  const q = norm(rawText);
  if (!q) return [];
  const qTokens = meaningfulTokens(q);
  const scored = companies.map(c => {
    let score = scoreCompany(q, c);
    const names = [c.nome, c.ragioneSociale, c.comune, c.provincia, c.indirizzo, c.piva, c.cf, c.tel, c.email].filter(Boolean).map(norm);
    for (const field of names) {
      const toks = meaningfulTokens(field);
      for (const qt of qTokens) for (const tt of toks) {
        if (qt.length >= 3 && tt.length >= 3) {
          const d = levenshtein(qt, tt);
          if (d <= 1) score = Math.max(score, 70);
          else if (d <= 2 && Math.max(qt.length, tt.length) >= 5) score = Math.max(score, 58);
          if (tt.startsWith(qt) || qt.startsWith(tt)) score = Math.max(score, 65);
        }
      }
    }
    return { id: c.id, name: c.nome, nome: c.nome, label: rvCompanyLabel(c), company: c, score };
  })
    .filter(x => x.score >= 10)
    .sort((a,b)=>b.score-a.score || String(a.name).localeCompare(String(b.name),'it'));
  return scored.slice(0, 8);
}
function rvIsCreateInterventionIntent(text, ctx) {
  const n = rvCleanServiceText(text);
  if (/\b(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti)\b/.test(n) && ctx.services.some(s => rvServiceCandidates(safeText(text,200), [s]).length)) return true;
  if (/\b(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti)\b/.test(n) && /\b(fecondazione|inseminazione|parto|cesareo|visita|ecografia|mastite|metrite|terapia)\b/.test(n)) return true;
  if (/\b(\d+|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\b/.test(n) && /\b(fecondazione|inseminazione|parto|cesareo|visita|ecografia|mastite|metrite|terapia)\b/.test(n)) return true;
  if (/\bda\b/.test(n) && /\b(fecondazione|inseminazione|parto|cesareo|visita|ecografia|mastite|metrite|terapia)\b/.test(n)) return true;
  return false;
}

function rvNewDraft(text, ctx) {
  const when = parseWhen(text, ctx.now);
  const companyRaw = rvExtractCompanyRaw(text);
  const services = rvExtractServicePhrases(text, ctx).map(x => ({ rawText: x.rawText, qty: x.qty, serviceId: null, serviceName: null, candidates: [], status: 'unresolved' }));
  return { type: 'intervention_draft', aiSessionId: ctx.raw?.aiSessionId || '', draftId: 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), originalText: safeText(text, 500), messages: [safeText(text, 500)], services, companyRaw, companyId: null, companyName: null, companyCandidates: [], date: when.date || '', time: when.time || '', session: when.session || '', note: '', awaiting: null, currentServiceIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function rvDraftResponse(reply, draft, quickReplies = [], extra = {}) {
  return rvWithState({ reply, action: { type: 'intervention_draft', draft }, actions: [], learn: [], quickReplies, ui: { mode: 'intervention_wizard', awaiting: draft.awaiting || null, draftId: draft.draftId, safeToApply: false }, ...extra }, { pendingInterventionDraft: draft });
}
function rvResolveDraft(draft, ctx) {
  draft.services = asArray(draft.services).filter(s => s && s.rawText);
  if (!draft.services.length) {
    draft.awaiting = 'service_choice';
    return rvDraftResponse('Quale prestazione vuoi inserire?', draft, ['Scegli da listino','Annulla']);
  }
  for (let i=0;i<draft.services.length;i++) {
    const s = draft.services[i];
    if (s.serviceId && s.status === 'resolved') continue;
    const cands = rvServiceCandidates(s.rawText, ctx.services);
    s.candidates = cands;
    const top = cands[0], second = cands[1];
    const exact = top && rvCleanServiceText(top.name) === rvCleanServiceText(s.rawText);
    const clear = top && (exact || (!second && top.score >= 90) || (top.score >= 135 && (!second || top.score - second.score >= 18)));
    if (clear) { s.serviceId = top.id; s.serviceName = top.name; s.status = 'resolved'; continue; }
    draft.currentServiceIndex = i;
    draft.awaiting = 'service_choice';
    if (!cands.length) return rvDraftResponse(`Non trovo una prestazione sicura per “${s.rawText}”.`, draft, ['Scegli da listino','Cerca meglio','Annulla']);
    return rvDraftResponse(`Quale prestazione vuoi usare per “${s.rawText}”?`, draft, cands.map(x=>x.name).concat(['Cerca meglio','Annulla']));
  }
  if (!draft.companyId) {
    if (draft.companyRaw) {
      const cands = rvCompanyCandidates(draft.companyRaw, ctx.companies);
      draft.companyCandidates = cands;
      const top = cands[0], second = cands[1];
      const clear = top && top.score >= 85 && (!second || top.score - second.score >= 20);
      if (clear) { draft.companyId = top.id; draft.companyName = top.name; }
      else {
        draft.awaiting = 'company_choice';
        if (cands.length) return rvDraftResponse(`Quale azienda ${draft.companyRaw} intendi?`, draft, cands.map(x=>x.label).concat(['Cerca meglio','Annulla']));
        return rvDraftResponse(`Non ho trovato una corrispondenza sicura per “${draft.companyRaw}”.`, draft, ['Cerca meglio','Crea nuova azienda','Annulla']);
      }
    } else {
      draft.awaiting = 'company_choice';
      return rvDraftResponse('Per quale azienda?', draft, ['Cerca azienda','Annulla']);
    }
  }
  if (!draft.date || (!draft.time && !draft.session)) {
    draft.awaiting = 'datetime_choice';
    return rvDraftResponse('Quando lo registro?', draft, ['ADESSO','oggi 14:30','ieri 09:00','Solo mattina','Solo pomeriggio','Annulla']);
  }
  const action = rvFinalAction(draft, ctx);
  draft.awaiting = 'confirm';
  const lines = action.services.map(s => `- ${s.name} x${s.qty}`);
  return rvWithState({ reply: `Ho preparato l’intervento:\n- Azienda: ${action.companyName}\n- Prestazioni:\n${lines.join('\\n')}\n- Data/ora: ${action.date}${action.time ? ' ' + action.time : ''}\n\nVuoi salvarlo?`, action, actions: [], learn: [], quickReplies: ['SALVA','Modifica prestazioni','Modifica azienda','Modifica data/ora','Aggiungi nota','Annulla'], ui: { mode: 'intervention_wizard', awaiting: 'confirm', draftId: draft.draftId, safeToApply: true } }, { pendingInterventionDraft: draft });
}
function rvFinalAction(draft, ctx) {
  const company = ctx.companies.find(c => String(c.id) === String(draft.companyId));
  const services = asArray(draft.services).filter(s => s.serviceId && s.status === 'resolved').map(s => {
    const svc = ctx.services.find(p => String(p.id) === String(s.serviceId));
    return { id: svc?.id ?? s.serviceId, name: svc?.nome || s.serviceName, qty: Math.max(1, num(s.qty, 1)) };
  });
  return { type: 'create_intervention', companyId: company?.id || draft.companyId, companyName: company?.nome || draft.companyName, services, date: draft.date, time: draft.time, session: draft.session || sessionFromText('', draft.time), note: draft.note || 'Preparato da Rural Vet AI' };
}
function rvContinueDraft(text, draft, ctx) {
  const input = safeText(text, 500).trim();
  const n = norm(input);
  draft.messages = asArray(draft.messages).concat([input]).slice(-20);
  draft.updatedAt = new Date().toISOString();
  if (/^(annulla|cancella|stop|reset)$/i.test(input)) return rvWithState({ reply: 'Ok, ho annullato la bozza intervento.', action: null, actions: [], learn: [], quickReplies: [], clearDraft: true, clearState: true, ui: { mode:'none', awaiting:null, draftId:draft.draftId, safeToApply:false } }, { clearState: true });
  if (draft.awaiting === 'confirm') {
    if (/^modifica prestazioni?$/i.test(input)) { draft.services.forEach(s => { s.serviceId=null; s.serviceName=null; s.status='unresolved'; }); draft.currentServiceIndex = 0; return rvResolveDraft(draft, ctx); }
    if (/^modifica azienda$/i.test(input)) { draft.companyId=null; draft.companyName=''; draft.companyCandidates=[]; draft.awaiting='company_choice'; return rvResolveDraft(draft, ctx); }
    if (/^modifica data\/?ora$|^modifica data$|^modifica ora$/i.test(input)) { draft.date=''; draft.time=''; draft.session=''; return rvResolveDraft(draft, ctx); }
    if (/^aggiungi nota/i.test(input)) { draft.awaiting='note_choice'; return rvDraftResponse('Che nota vuoi aggiungere?', draft, ['Annulla']); }
  }
  if (draft.awaiting === 'note_choice') { draft.note = [draft.note, input.replace(/^nota\s*/i,'')].filter(Boolean).join(' '); return rvResolveDraft(draft, ctx); }
  if (draft.awaiting === 'service_choice') {
    const idx = Math.max(0, Number(draft.currentServiceIndex || 0));
    const s = draft.services[idx];
    const chosen = asArray(s?.candidates).find(c => norm(c.name) === n || n.includes(norm(c.name)) || norm(c.name).includes(n));
    if (chosen && s) { s.serviceId = chosen.id; s.serviceName = chosen.name; s.status = 'resolved'; return rvResolveDraft(draft, ctx); }
    // If the user typed extra information instead of choosing, merge it into the draft.
  }
  if (draft.awaiting === 'company_choice') {
    const chosen = asArray(draft.companyCandidates).find(c => norm(c.label) === n || norm(c.name) === n || n.includes(norm(c.name)));
    if (chosen) { draft.companyId = chosen.id; draft.companyName = chosen.name; return rvResolveDraft(draft, ctx); }
    const cRaw = rvExtractCompanyRaw(input) || input;
    if (cRaw && !/^(cerca meglio|crea nuova azienda)$/i.test(input)) draft.companyRaw = cRaw;
  }
  if (draft.awaiting === 'datetime_choice' || /\b(adesso|oggi|ieri|domani|alle|ore|mattina|pomeriggio|sera|notte)\b/.test(n)) {
    let when = parseWhen(input, ctx.now);
    if (/^solo mattina$/i.test(input)) when = { date: draft.date || isoDate(ctx.now), time: '', session: 'm', explicit: true };
    if (/^solo pomeriggio$/i.test(input)) when = { date: draft.date || isoDate(ctx.now), time: '', session: 'p', explicit: true };
    if (when.date) draft.date = when.date;
    if (when.time) draft.time = when.time;
    if (when.session) draft.session = when.session;
  }
  const addedServices = (/\b(aggiungi anche|anche|piu|più|con)\b/.test(n) || (draft.awaiting === 'confirm' && rvIsCreateInterventionIntent('aggiungi '+input, ctx))) ? rvExtractServicePhrases(input, ctx) : [];
  for (const x of addedServices) draft.services.push({ rawText: x.rawText, qty: x.qty, serviceId: null, serviceName: null, candidates: [], status: 'unresolved' });
  const cRaw = rvExtractCompanyRaw(input);
  if (cRaw) draft.companyRaw = cRaw;
  return rvResolveDraft(draft, ctx);
}
function rvCreateInterventionRequest(text, ctx) {
  const pending = rvFreshDraft(ctx.raw?.pendingInterventionDraft || ctx.raw?.pendingDraft, ctx.raw?.aiSessionId || '');
  if (pending && pending.type === 'intervention_draft') return rvContinueDraft(text, JSON.parse(JSON.stringify(pending)), ctx);
  if (!rvIsCreateInterventionIntent(text, ctx)) return null;
  const draft = rvNewDraft(text, ctx);
  return rvResolveDraft(draft, ctx);
}

function deterministicRouter(text, ctx) {
  const priority = rvPendingOrPriority(text, ctx);
  if (priority) return priority;
  const handlers = [managementHelpQuery, learnQuery, settingsMutationRequest, invoiceMutationRequest, serviceMutationRequest, companyMutationRequest, createClientRequest, rvCreateInterventionRequest, clientLookup, countClients, serviceLookup, kmQuery, analyticsQuery, revenueQuery, interventionQuery, dashboardQuery, updateInterventionRequest, deleteInterventionRequest];
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
Intenti possibili: client_lookup, client_count, service_lookup, intervention_query, revenue_query, analytics_query, invoice_query, km_query, create_intervention, update_intervention, delete_intervention, create_client, update_client, delete_client, create_service, update_service, delete_service, create_invoice, update_invoice, delete_invoice, update_settings, learn, clinical, general.
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
  if (intent === 'create_intervention') return rvCreateInterventionRequest(text, ctx);
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
  return `Sei Rural Vet AI dentro un gestionale veterinario buiatrico.
Rispondi in italiano, breve, pratico e intelligente. Restituisci sempre JSON valido con almeno il campo reply.
Quando l'utente chiede dati gestionali non inventare: usa solo il contesto ricevuto.
Quando propone una modifica al gestionale, se non sei sicuro non eseguire e chiedi il campo mancante. Le modifiche devono essere restituite come action JSON e verranno salvate solo dopo SALVA/ELIMINA.
Azioni supportate: create_intervention, update_intervention, delete_intervention, create_client, update_client, delete_client, create_service, update_service, delete_service, create_invoice, update_invoice, delete_invoice, update_settings.
Per clinica buiatrica: diagnosi probabile, 2-4 differenziali se utili, urgenza/triage, cosa controllare subito, terapia solo come orientamento clinico prudente, massimo 3 domande mirate. Non sostituire visita, ricetta e tempi di sospensione.`;
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
  if (!process.env.OPENAI_API_KEY) {
    return { reply: 'Backend attivo, ma manca OPENAI_API_KEY su Render.', action: null, actions: [], learn: [], source: 'missing-key' };
  }
  try {
    return await generalAnswer(body, ctx);
  } catch (err) {
    console.error('OpenAI generalAnswer non riuscita:', err);
    return { reply: 'Il backend è raggiungibile, ma OpenAI non ha risposto correttamente. Controlla OPENAI_API_KEY, OPENAI_MODEL e quota/limiti API su Render.', action: null, actions: [], learn: [], source: 'openai-error', error: err.message };
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
  return { reply: safeText(parsed.reply || parsed.answer || parsed.message || 'Dimmi meglio cosa vuoi fare.', 3500), action: parsed.action || null, actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [], learn: Array.isArray(parsed.learn) ? parsed.learn.slice(0, 8) : [], usage, source: 'openai-general' };
}
function validateAction(result, ctx) {
  if (!result) return result;
  const all = [];
  if (result.action) all.push(result.action);
  if (Array.isArray(result.actions)) all.push(...result.actions);
  for (const a of all) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'create_intervention') {
      if (a.companyId && !ctx.companies.some(c => String(c.id) === String(a.companyId))) a.companyId = '';
      if (Array.isArray(a.services)) {
        for (const s of a.services) if (s.id && !ctx.services.some(p => String(p.id) === String(s.id))) s.id = '';
      }
    }
    if ((a.type === 'delete_intervention' || a.type === 'update_intervention') && a.interventionId && !ctx.interventions.some(i => String(i.id) === String(a.interventionId))) a.interventionId = '';
    if ((a.type === 'update_client' || a.type === 'delete_client' || a.type === 'create_invoice') && a.companyId && !ctx.companies.some(c => String(c.id) === String(a.companyId))) a.companyId = '';
    if ((a.type === 'update_service' || a.type === 'delete_service') && a.serviceId && !ctx.services.some(p => String(p.id) === String(a.serviceId))) a.serviceId = '';
    if ((a.type === 'update_invoice' || a.type === 'delete_invoice') && a.invoiceId && !ctx.invoices.some(f => String(f.id) === String(a.invoiceId))) a.invoiceId = '';
  }
  return result;
}

app.get('/', (req, res) => res.json({ ok: true, name: 'Rural Vet AI backend', version: VERSION, model: MODEL }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'rural-vet-ai', version: VERSION, model: MODEL, time: new Date().toISOString() }));
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
    res.json({ reply: safeText(result.reply || 'Dimmi meglio cosa vuoi fare.', 5000), action: result.action || null, actions: Array.isArray(result.actions) ? result.actions.slice(0, 12) : [], learn: Array.isArray(result.learn) ? result.learn.slice(0, 12) : [], quickReplies: Array.isArray(result.quickReplies) ? result.quickReplies.slice(0, 12) : [], ui: result.ui || null, state: result.state || null, clearDraft: !!result.clearDraft, clearState: !!result.clearState, source, model: source.includes('openai') || source.includes('planner') ? MODEL : 'rural-vet-deterministic-v8', debug: { counts: { clienti: ctx.companies.length, prestazioni: ctx.services.length, interventi: ctx.interventions.length, fatture: ctx.invoices.length, km: ctx.kmRoutes.length }, currentUser: ctx.currentUser?.name || '' } });
  } catch (err) {
    console.error('Errore /api/vet-ai-chat', err);
    res.status(200).json({ ok: false, reply: 'Errore backend AI. Non rispondo a caso: controlla log Render e riprova.', action: null, actions: [], learn: [], error: err.message, source: 'error-v8' });
  }
});

app.post(['/api/ai', '/api/chat'], (req, res, next) => {
  req.url = '/api/vet-ai-chat';
  app._router.handle(req, res, next);
});

if (!process.env.RV_AI_TEST) app.listen(PORT, () => console.log(`Rural Vet AI backend v${VERSION} attivo sulla porta ${PORT} con modello ${MODEL}`));
export { buildContext, deterministicRouter, rvCreateInterventionRequest, rvExtractServicePhrases, rvServiceCandidates, rvCompanyCandidates, rvResolveDraft, rvContinueDraft, rvInterventionCandidates, rvNewEditDraft, rvNewDeleteDraft, rvPendingOrPriority, parsePeriod, analyticsQuery };
