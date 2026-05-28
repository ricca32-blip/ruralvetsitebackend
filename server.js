import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.use(express.json({ limit: '25mb' }));

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function norm(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function nnum(v) { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; }
function pad2(v) { return String(v).padStart(2, '0'); }
function iso(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseDateObj(s) { const d = new Date(String(s || '') + 'T12:00:00'); return Number.isNaN(d.getTime()) ? null : d; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
function eur(v) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(nnum(v)); }
function kmFmt(v) { return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(nnum(v)); }
function pct(v) { return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(nnum(v)) + '%'; }
function titleCase(s) { return String(s || '').trim().replace(/\b\w/g, c => c.toUpperCase()); }
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const months = {
  gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
  luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11
};
function parsePeriod(input, ctx = {}) {
  const raw = String(input || '');
  const t = norm(raw);
  const base = ctx.date ? new Date(ctx.date) : new Date();
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  let start = null, end = null, label = '';

  const dateMatches = [...raw.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/g)];
  if (dateMatches.length >= 2) {
    const conv = (m) => { let y = m[3] ? Number(m[3]) : today.getFullYear(); if (y < 100) y += 2000; return `${y}-${pad2(m[2])}-${pad2(m[1])}`; };
    start = conv(dateMatches[0]); end = conv(dateMatches[1]); label = `dal ${start} al ${end}`;
  } else if (dateMatches.length === 1) {
    let y = dateMatches[0][3] ? Number(dateMatches[0][3]) : today.getFullYear(); if (y < 100) y += 2000;
    start = end = `${y}-${pad2(dateMatches[0][2])}-${pad2(dateMatches[0][1])}`; label = start;
  }

  if (!start) {
    const yearMatch = t.match(/\b(20\d{2}|19\d{2})\b/);
    const monthName = Object.keys(months).find(m => new RegExp(`\\b${m}\\b`).test(t));
    if (monthName) {
      const y = yearMatch ? Number(yearMatch[1]) : today.getFullYear();
      const m = months[monthName];
      start = iso(new Date(y, m, 1)); end = iso(new Date(y, m + 1, 0)); label = monthName + ' ' + y;
    }
  }
  if (!start && /\bytd\b|da inizio anno|dall inizio anno|inizio anno/.test(t)) {
    start = `${today.getFullYear()}-01-01`; end = iso(today); label = 'da inizio anno';
  } else if (!start && /\boggi\b/.test(t)) {
    start = end = iso(today); label = 'oggi';
  } else if (!start && /\bieri\b/.test(t)) {
    const d = addDays(today, -1); start = end = iso(d); label = 'ieri';
  } else if (!start && /settimana scorsa/.test(t)) {
    const s = addDays(startOfWeek(today), -7); const e = addDays(s, 6); start = iso(s); end = iso(e); label = 'settimana scorsa';
  } else if (!start && /questa settimana|settimana corrente/.test(t)) {
    const s = startOfWeek(today); start = iso(s); end = iso(today); label = 'questa settimana';
  } else if (!start && /mese scorso/.test(t)) {
    const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const m = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    start = iso(new Date(y, m, 1)); end = iso(new Date(y, m + 1, 0)); label = 'mese scorso';
  } else if (!start && /ultimo mese|ultimi 30 giorni/.test(t)) {
    start = iso(addDays(today, -30)); end = iso(today); label = 'ultimo mese';
  } else if (!start && /questo mese|mese corrente/.test(t)) {
    start = iso(new Date(today.getFullYear(), today.getMonth(), 1)); end = iso(today); label = 'questo mese';
  } else if (!start && /\b(20\d{2}|19\d{2})\b/.test(t)) {
    const y = Number(t.match(/\b(20\d{2}|19\d{2})\b/)[1]); start = `${y}-01-01`; end = `${y}-12-31`; label = String(y);
  }
  if (!start) { start = iso(today); end = iso(today); label = 'oggi'; }
  if (start > end) [start, end] = [end, start];
  return { start, end, label };
}
function inRange(date, p) { return String(date || '') >= p.start && String(date || '') <= p.end; }
function serviceTotal(i) { return Array.isArray(i.prestazioni) ? i.prestazioni.reduce((s, p) => s + nnum(p.total || (nnum(p.price) * nnum(p.qty || 1))), 0) : 0; }
function interventionTotal(i) { return nnum(i.tot || i.total) || serviceTotal(i); }
function interventions(ctx, p) { return (ctx.interventi || []).filter(i => inRange(i.data, p)); }
function serviceNameAliases(name) {
  const n = norm(name).replace(/\b(parti)\b/g, 'parto').replace(/\b(cesarei)\b/g, 'cesareo').replace(/\b(fecondazioni)\b/g, 'fecondazione').replace(/\b(ecografie)\b/g, 'ecografia').replace(/\b(visite)\b/g, 'visita');
  return n;
}
function findServiceMention(input, ctx) {
  const t = serviceNameAliases(input);
  const services = (ctx.prestazioni || []).slice().sort((a,b) => String(b.nome||'').length - String(a.nome||'').length);
  for (const s of services) {
    const ns = serviceNameAliases(s.nome);
    if (ns && (t.includes(ns) || ns.includes(t))) return s;
  }
  const common = ['parto','cesareo','fecondazione','visita clinica','visita','ecografia','vaccino','mastite','metrite'];
  for (const c of common) if (t.includes(serviceNameAliases(c))) return { nome: titleCase(c) };
  return null;
}
function serviceMatches(p, s) {
  if (!p || !s) return false;
  const a = serviceNameAliases(p.nome || p.name); const b = serviceNameAliases(s.nome || s.name);
  return a === b || a.includes(b) || b.includes(a);
}
function companyName(i) { return i.azienda || i.company || i.aziendaNome || 'Azienda non indicata'; }
function flattenServices(ints) {
  const out = [];
  for (const i of ints) {
    const rows = Array.isArray(i.prestazioni) ? i.prestazioni : [];
    for (const p of rows) out.push({ intervention: i, nome: p.nome || p.name || '', qty: nnum(p.qty || p.quantita || 1) || 1, revenue: nnum(p.total || (nnum(p.price) * nnum(p.qty || 1))) });
  }
  return out;
}

function handleKmReport(input, ctx) {
  const p = parsePeriod(input, ctx);
  const rowsAll = Array.isArray(ctx.kmRows) ? ctx.kmRows : (Array.isArray(ctx.km) ? ctx.km : []);
  const rows = rowsAll.filter(r => inRange(r.data, p));
  if (!rows.length) return { reply: `Non ho ricevuto dal gestionale righe KM del tab KM per ${p.label}. Per rispondere devo ricevere kmRows/spostamenti del tab KM.` };
  const detailRows = rows.filter(r => r.tipo !== 'totale_giorno' && (r.km !== undefined || r.partenza || r.arrivo));
  const usable = detailRows.length ? detailRows : rows;
  const totalKm = usable.reduce((s, r) => s + nnum(r.km !== undefined ? r.km : r.kmTotali), 0);
  const reimbursement = usable.reduce((s, r) => s + (r.rimborso !== undefined ? nnum(r.rimborso) : nnum(r.km || r.kmTotali) * nnum(r.rate)), 0);
  const segments = usable.filter(r => nnum(r.km || r.kmTotali) > 0).length;
  const byUser = new Map();
  for (const r of usable) {
    const k = r.collaboratore || r.userName || 'Non indicato';
    const cur = byUser.get(k) || { km: 0, rimborso: 0, n: 0 };
    cur.km += nnum(r.km !== undefined ? r.km : r.kmTotali);
    cur.rimborso += r.rimborso !== undefined ? nnum(r.rimborso) : nnum(r.km || r.kmTotali) * nnum(r.rate);
    cur.n += nnum(r.km || r.kmTotali) > 0 ? 1 : 0;
    byUser.set(k, cur);
  }
  let reply = `${p.label.charAt(0).toUpperCase() + p.label.slice(1)} hai fatto ${kmFmt(totalKm)} km.`;
  reply += `\nSpostamenti/tratte registrate: ${segments}.`;
  if (reimbursement) reply += `\nRimborso km: ${eur(reimbursement)}.`;
  if (byUser.size > 1) {
    reply += '\n\nDettaglio per collaboratore:';
    [...byUser.entries()].sort((a,b)=>b[1].km-a[1].km).forEach(([name, v]) => { reply += `\n- ${name}: ${kmFmt(v.km)} km${v.rimborso ? `, ${eur(v.rimborso)}` : ''}`; });
  }
  reply += '\nCalcolo basato sul tab KM del gestionale.';
  return { reply };
}
function handleInterventionSummary(input, ctx) {
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  if (!ints.length) return { reply: `Nel periodo ${p.label} non risultano interventi registrati.` };
  const byCompany = new Map();
  let totalRevenue = 0, totalPrest = 0;
  for (const i of ints) {
    const name = companyName(i);
    const cur = byCompany.get(name) || { revenue: 0, interventions: 0, services: new Map() };
    const rev = interventionTotal(i); cur.revenue += rev; totalRevenue += rev; cur.interventions += 1;
    for (const p of (i.prestazioni || [])) {
      const pn = p.nome || p.name || 'Prestazione'; const q = nnum(p.qty || 1) || 1; totalPrest += q;
      cur.services.set(pn, (cur.services.get(pn) || 0) + q);
    }
    byCompany.set(name, cur);
  }
  let reply = `${p.label.charAt(0).toUpperCase() + p.label.slice(1)} hai visitato ${byCompany.size} aziende.`;
  [...byCompany.entries()].sort((a,b)=>b[1].revenue-a[1].revenue).forEach(([name, v], idx) => {
    reply += `\n\n${idx+1}. ${name}\nPrestazioni:`;
    if (v.services.size) [...v.services.entries()].forEach(([sn, q]) => { reply += `\n- ${sn} x${q}`; });
    else reply += '\n- Nessuna prestazione dettagliata';
    reply += `\nRicavi: ${eur(v.revenue)}`;
  });
  reply += `\n\nTotale ricavi: ${eur(totalRevenue)}\nAziende visitate: ${byCompany.size}\nInterventi: ${ints.length}\nPrestazioni/servizi totali: ${totalPrest}`;
  return { reply };
}
function handleCountService(input, ctx) {
  const p = parsePeriod(input, ctx);
  const service = findServiceMention(input, ctx);
  if (!service) return null;
  const ints = interventions(ctx, p);
  let qty = 0, revenue = 0; const companies = new Set(); const interventionIds = new Set();
  for (const i of ints) {
    for (const row of (i.prestazioni || [])) {
      if (serviceMatches(row, service)) { qty += nnum(row.qty || 1) || 1; revenue += nnum(row.total || nnum(row.price) * nnum(row.qty || 1)); companies.add(companyName(i)); interventionIds.add(i.id || `${i.data}-${companyName(i)}`); }
    }
  }
  const sn = service.nome || service.name || 'prestazione';
  if (!qty) return { reply: `Nel periodo ${p.label} non risultano prestazioni '${sn}' registrate.` };
  let reply = `${p.label.charAt(0).toUpperCase() + p.label.slice(1)} hai fatto ${qty} ${sn}.`;
  if (revenue) reply += `\nRicavi generati da ${sn}: ${eur(revenue)}.`;
  reply += `\nDistribuiti su ${interventionIds.size} interventi e ${companies.size} aziende.`;
  return { reply };
}
function handleRevenueByCustomer(input, ctx) {
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  if (!ints.length) return { reply: `Nel periodo ${p.label} non risultano ricavi registrati.` };
  const by = new Map(); let total = 0;
  for (const i of ints) { const name = companyName(i); const rev = interventionTotal(i); total += rev; by.set(name, (by.get(name) || 0) + rev); }
  const arr = [...by.entries()].sort((a,b)=>b[1]-a[1]);
  const [topName, topVal] = arr[0];
  let reply = `${p.label.charAt(0).toUpperCase() + p.label.slice(1)} l'azienda che ti ha dato più ricavi è ${topName} con ${eur(topVal)}, pari al ${pct(total ? topVal/total*100 : 0)} del totale ricavi del periodo.`;
  reply += '\n\nTop aziende:';
  arr.slice(0, 10).forEach(([name, val], idx) => { reply += `\n${idx+1}. ${name} — ${eur(val)} — ${pct(total ? val/total*100 : 0)}`; });
  reply += `\n\nTotale ricavi periodo: ${eur(total)}.`;
  return { reply };
}
function handlePriceLookup(input, ctx) {
  const service = findServiceMention(input, ctx);
  if (!service) return { reply: 'Non trovo una voce listino corrispondente. Dimmi il nome esatto della prestazione.' };
  const price = nnum(service.price || service.prezzo);
  if (!price) return { reply: `Non trovo un prezzo di listino salvato per '${service.nome || service.name}'.` };
  return { reply: `Nel listino la prestazione ${service.nome || service.name} costa ${eur(price)}.` };
}
const qtyWords = { un:1, uno:1, una:1, due:2, tre:3, quattro:4, cinque:5, sei:6, sette:7, otto:8, nove:9, dieci:10 };
function findCompanyMention(input, ctx) {
  const t = norm(input);
  const companies = (ctx.aziende || []).slice().sort((a,b)=>String(b.nome||'').length-String(a.nome||'').length);
  return companies.find(c => norm(c.nome).length > 2 && t.includes(norm(c.nome))) || null;
}
function detectServicesForAction(input, ctx) {
  const raw = String(input || ''); const t = norm(raw); const out = [];
  const services = (ctx.prestazioni || []).slice().sort((a,b)=>String(b.nome||'').length-String(a.nome||'').length);
  for (const s of services) {
    const ns = serviceNameAliases(s.nome);
    if (!ns || !t.includes(ns)) continue;
    let qty = 1;
    const before = new RegExp(`(?:x\\s*)?(\\d{1,2})\\s+${escapeRegex(ns)}|(${Object.keys(qtyWords).join('|')})\\s+${escapeRegex(ns)}`).exec(t);
    const after = new RegExp(`${escapeRegex(ns)}\\s*(?:x|per|n\\.?|numero)?\\s*(\\d{1,2})`).exec(t);
    if (after) qty = Number(after[1]);
    else if (before) qty = before[1] ? Number(before[1]) : qtyWords[before[2]] || 1;
    out.push({ name: s.nome, qty });
  }
  return out;
}
function parseWhenForAction(input, ctx) {
  const t = norm(input); const base = ctx.date ? new Date(ctx.date) : new Date(); const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  let date = '', time = '', session = '';
  if (/\boggi\b|stamattina|stasera|stanotte|questa mattina|questo pomeriggio|questa sera|in mattinata|nel pomeriggio|in serata|in nottata/.test(t)) date = iso(today);
  if (/\bieri\b/.test(t)) date = iso(addDays(today, -1));
  const dm = String(input).match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/); if (dm) { let y = dm[3] ? Number(dm[3]) : today.getFullYear(); if (y < 100) y += 2000; date = `${y}-${pad2(dm[2])}-${pad2(dm[1])}`; }
  const tm = String(input).match(/(?:alle|ore)?\s*(\d{1,2})[:.](\d{2})\b/i) || String(input).match(/(?:alle|ore)\s*(\d{1,2})\b/i); if (tm) time = `${pad2(tm[1])}:${pad2(tm[2] || '00')}`;
  if (/mattina|stamattina|mattinata|prima di pranzo/.test(t)) session = 'm'; else if (/pomeriggio|dopo pranzo/.test(t)) session = 'p'; else if (/sera|stasera|serata|notte|stanotte|nottata/.test(t)) session = 'n';
  if (!date && (session || time)) date = iso(today);
  return { date, time, session };
}
function handleAddIntervention(input, ctx) {
  const t = norm(input);
  if (!/(segnami|segna|ho fatto|aggiungi|inserisci|registra|metti|carica|scrivi|annota|salvami|mi registri)/.test(t)) return null;
  const company = findCompanyMention(input, ctx);
  const services = detectServicesForAction(input, ctx);
  if (!company || !services.length) return null;
  const when = parseWhenForAction(input, ctx);
  const reply = `Ho capito:\n${services.map(s => `${s.name} x${s.qty}`).join(', ')} da ${company.nome}${when.date ? ' - ' + when.date : ''}${when.time ? ' ore ' + when.time : (when.session ? ' sessione ' + ({m:'mattina',p:'pomeriggio',n:'sera/notte'}[when.session] || when.session) : '')}\nScrivi SALVA per registrare nel gestionale, oppure correggimi.`;
  return { reply, action: { type: 'create_intervention', companyName: company.nome, services, date: when.date, time: when.time, session: when.session }, quickReplies: ['SALVA','Annulla'] };
}

function detectAndHandle(input, ctx = {}) {
  const t = norm(input);
  const isKm = /(\bkm\b|chilometr|kilometr|strada|spostament|tratt|rimbors)/.test(t);
  if (isKm) return handleKmReport(input, ctx);
  if (/(quanto costa|prezzo|listino|tariffario|costo)/.test(t)) return handlePriceLookup(input, ctx);
  const add = handleAddIntervention(input, ctx); if (add) return add;
  if (/(dove sono stato|quali interventi|che interventi|cosa ho fatto|aziende ho visitato|riepilogo interventi|riassunto giornata)/.test(t)) return handleInterventionSummary(input, ctx);
  if (/(quale azienda|top aziende|migliori clienti|cliente.*fattur|azienda.*ricavi|piu ricavi|piu fattur)/.test(t)) return handleRevenueByCustomer(input, ctx);
  if (/\bquanti\b|\bquante\b|numero/.test(t)) { const out = handleCountService(input, ctx); if (out) return out; }
  if (/(servizi|prestazioni).*(ricavi|reso|redditiz|fattur)|ricavi per prestazione|top prestazioni|top servizi/.test(t)) return handleRevenueByService(input, ctx);
  return null;
}
function handleRevenueByService(input, ctx) {
  const p = parsePeriod(input, ctx); const ints = interventions(ctx, p); const rows = flattenServices(ints);
  if (!rows.length) return { reply: `Nel periodo ${p.label} non risultano prestazioni con ricavi registrati nel gestionale.` };
  const by = new Map(); let total = 0;
  for (const r of rows) { const cur = by.get(r.nome) || { qty: 0, revenue: 0 }; cur.qty += r.qty; cur.revenue += r.revenue; total += r.revenue; by.set(r.nome, cur); }
  const arr = [...by.entries()].sort((a,b)=>b[1].revenue-a[1].revenue);
  let reply = `${p.label.charAt(0).toUpperCase() + p.label.slice(1)} le prestazioni con più ricavi sono:`;
  arr.slice(0, 10).forEach(([name, v], idx) => { reply += `\n${idx+1}. ${name} — ${eur(v.revenue)} — ${pct(total ? v.revenue/total*100 : 0)} del totale — ${v.qty} prestazioni`; });
  reply += `\n\nTotale ricavi periodo: ${eur(total)}.`;
  return { reply };
}

app.get('/', (req, res) => res.json({ ok: true, service: 'Rural Vet AI backend', health: '/api/health', chat: '/api/vet-ai-chat' }));
app.get('/api/health', (req, res) => res.json({ ok: true, version: '8.1.0-rm-ai-km', model: MODEL }));
app.post('/api/debug-context', (req, res) => res.json({ ok: true, keys: Object.keys(req.body?.context || req.body || {}), receivedAt: new Date().toISOString() }));

app.post('/api/vet-ai-chat', async (req, res) => {
  try {
    const { input = '', context = {}, system = '', conversation = [], image = null } = req.body || {};
    const deterministic = detectAndHandle(input, context);
    if (deterministic) return res.json(deterministic);
    if (!openai) return res.json({ reply: 'Backend AI attivo, ma manca OPENAI_API_KEY su Render. Posso rispondere solo alle analisi gestionali deterministiche già coperte.' });
    const messages = [
      { role: 'system', content: system || 'Sei Rural Vet AI. Rispondi in italiano, usando i dati gestionali forniti e senza inventare.' },
      { role: 'system', content: 'CONTESTO GESTIONALE JSON: ' + JSON.stringify(context).slice(0, 70000) },
      ...conversation.slice(-8).map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: String(m.content || m.text || '') })),
      { role: 'user', content: image ? `${input}\n[Immagine allegata: ${image.name || 'foto'}]` : input }
    ];
    const completion = await openai.chat.completions.create({ model: MODEL, messages, temperature: 0.2, response_format: { type: 'json_object' } });
    let content = completion.choices?.[0]?.message?.content || '{}';
    let data;
    try { data = JSON.parse(content); } catch { data = { reply: content }; }
    if (!data.reply && !data.answer && !data.message) data.reply = String(content || '').trim();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI backend error', message: err?.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Rural Vet AI backend listening on ${PORT}`));
