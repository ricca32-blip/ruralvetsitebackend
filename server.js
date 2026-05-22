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
const VERSION = '6.0.0';

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
  return /\b(piva|partita iva|codice fiscale|\bcf\b|sdi|indirizzo|ragione sociale|cliente|clienti|azienda|aziende|fatturato|fatture|fattura|ricavi|ricavo|incassato|pagato|pagata|da pagare|da fatturare|intervento|interventi|prestazione|prestazioni|giornata|dashboard|km|chilometri|rimborso|listino|prezzo|quanto|quanti|quale|mostra|dammi|cerca|elenca|telefono|email|mail|costo)\b/.test(n) || looksAction(text);
}
function looksAction(text) {
  const n = norm(text);
  return /\b(ho fatto|ho eseguito|segna|registra|inserisci|aggiungi|metti|salva|elimina|cancella|rimuovi|togli|annulla|crea cliente|nuovo cliente|aggiungi cliente)\b/.test(n);
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

async function openAIJson(messages, maxTimeout = OPENAI_TIMEOUT_MS) {
  const completionPromise = openai.chat.completions.create({ model: MODEL, temperature: 0.05, response_format: { type: 'json_object' }, messages });
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
  const serviceText = serviceTextFromRequest(text);
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
  const serviceText = serviceTextFromRequest(text) || text;
  const serviceRes = resolveServices(serviceText, ctx.services);
  if (serviceRes.ambiguous) return { reply: 'Ho trovato più prestazioni possibili:\n' + serviceRes.alternatives.map((s,i)=>`${i+1}) ${s.nome}${s.price ? ' · ' + euro(s.price) : ''}`).join('\n') + '\nQuale devo usare?', action: null, actions: [], learn: [] };
  if (!serviceRes.matches.length) return { reply: 'Non ho riconosciuto la prestazione. Scrivimi il nome come nel listino oppure dimmi quale voce usare.', action: null, actions: [], learn: [] };
  const when = parseWhen(text, ctx.now);
  const services = serviceRes.matches.map(s => ({ name: s.nome, id: s.id, qty: qtyNearService(text, s.nome) }));
  const action = { type: 'create_intervention', companyName: companyRes.match.nome, companyId: companyRes.match.id || '', services, date: when.date || '', time: when.time || '', session: when.session || '', note: 'Preparato da Rural Vet AI' };
  const line = services.map(s => `${s.name}${s.qty > 1 ? ' x' + s.qty : ''}`).join(', ');
  if (!action.date || !action.time) return { reply: `Ho capito: ${line} da ${companyRes.match.nome}.\nQuando lo registro? Scrivi ADESSO oppure data e ora, esempio: oggi 14:30.`, action, actions: [], learn: [] };
  return { reply: `Ho capito: ${line} da ${companyRes.match.nome}, ${action.date} ore ${action.time}.\nScrivi SALVA per registrare nel gestionale.`, action, actions: [], learn: [] };
}
function deleteInterventionRequest(text, ctx) {
  if (!isDeleteRequest(text)) return null;
  const filters = managementFilters(text, ctx, /\boggi\b/.test(norm(text)) ? 'today' : 'ytd');
  const items = filterInterventions(ctx, filters).sort((a,b) => String(b.data).localeCompare(String(a.data)) || String(b.ora).localeCompare(String(a.ora)));
  if (!items.length) return { reply: `Non trovo interventi da eliminare per ${displayScope(filters) || periodLabel(filters.period)}. Dimmi cliente, giorno e prestazione.`, action: null, actions: [], learn: [] };
  if (items.length === 1) return { reply: `Ho trovato questo intervento:\n- ${formatIntervention(items[0])}\nScrivi ELIMINA per cancellarlo.`, action: { type: 'delete_intervention', interventionId: items[0].id, query: text, note: 'Richiesta eliminazione da AI' }, actions: [], learn: [] };
  return { reply: `Ho trovato più interventi possibili. Scegli il numero:\n` + items.slice(0, 12).map((i,idx)=>`${idx+1}) ${formatIntervention(i)}`).join('\n'), action: { type: 'delete_intervention', query: text, note: 'Scelta tra più interventi' }, actions: [], learn: [] };
}
function deterministicRouter(text, ctx) {
  const handlers = [learnQuery, createClientRequest, deleteInterventionRequest, createInterventionRequest, clientLookup, countClients, serviceLookup, kmQuery, revenueQuery, interventionQuery, dashboardQuery];
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
Intenti possibili: client_lookup, client_count, service_lookup, intervention_query, revenue_query, invoice_query, km_query, create_intervention, delete_intervention, create_client, learn, clinical, general.
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
  if (intent === 'revenue_query' || intent === 'invoice_query') return revenueQuery(pText + ' fatturato ricavi fatture', ctx);
  if (intent === 'km_query') return kmQuery(pText + ' km', ctx);
  if (intent === 'create_intervention') return createInterventionRequest(text, ctx);
  if (intent === 'delete_intervention') return deleteInterventionRequest(text, ctx);
  if (intent === 'create_client') return createClientRequest(text, ctx);
  if (intent === 'learn') return learnQuery(text, ctx);
  return null;
}

function buildGeneralPrompt() {
  return `Sei Rural Vet AI dentro un gestionale veterinario buiatrico.
Rispondi in italiano, breve e operativo.
Non inventare dati del gestionale: se chiede numeri, clienti, fatture, P.IVA, interventi o km e non li hai nei dati, dillo.
Per clinica buiatrica: diagnosi probabile se possibile, massimo 2 differenziali, massimo 3 domande mirate. Non fare spiegoni.`;
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
    if (a.type === 'delete_intervention' && a.interventionId && !ctx.interventions.some(i => String(i.id) === String(a.interventionId))) a.interventionId = '';
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
    let source = 'deterministic-v6';

    if (!result && looksManagement(text)) {
      try {
        const plan = await planner(text, ctx);
        result = executePlan(plan, text, ctx);
        source = 'planner-v6';
      } catch (err) {
        console.warn('Planner non riuscito:', err.message);
      }
      if (!result) {
        result = { reply: 'Non sono riuscito a trovare quel dato nel gestionale con sicurezza. Dimmi cliente/prestazione/periodo in modo più preciso oppure aggiorna il gestionale e riprova.', action: null, actions: [], learn: [] };
        source = 'safe-no-data-v6';
      }
    }

    if (!result) {
      result = await safeGeneralAnswer(body, ctx);
      source = result.source || 'openai-general';
    }

    result = validateAction(result, ctx);
    res.json({ reply: safeText(result.reply || 'Dimmi meglio cosa vuoi fare.', 4000), action: result.action || null, actions: Array.isArray(result.actions) ? result.actions.slice(0, 12) : [], learn: Array.isArray(result.learn) ? result.learn.slice(0, 12) : [], source, model: source.includes('openai') || source.includes('planner') ? MODEL : 'rural-vet-deterministic-v6', debug: { counts: { clienti: ctx.companies.length, prestazioni: ctx.services.length, interventi: ctx.interventions.length, fatture: ctx.invoices.length, km: ctx.kmRoutes.length }, currentUser: ctx.currentUser?.name || '' } });
  } catch (err) {
    console.error('Errore /api/vet-ai-chat', err);
    res.status(200).json({ ok: false, reply: 'Errore backend AI. Non rispondo a caso: controlla log Render e riprova.', action: null, actions: [], learn: [], error: err.message, source: 'error-v6' });
  }
});

app.post(['/api/ai', '/api/chat'], (req, res, next) => {
  req.url = '/api/vet-ai-chat';
  app._router.handle(req, res, next);
});

app.listen(PORT, () => console.log(`Rural Vet AI backend v${VERSION} attivo sulla porta ${PORT} con modello ${MODEL}`));
