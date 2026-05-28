import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.use(express.json({ limit: '50mb' }));

function norm(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function nnum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const x = Number(String(v ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(x) ? x : 0;
}
function pad2(v) { return String(v).padStart(2, '0'); }
function iso(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
function eur(v) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(nnum(v)); }
function kmFmt(v) { return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(nnum(v)); }
function pct(v) { return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(nnum(v)) + '%'; }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
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
  let start = null;
  let end = null;
  let label = '';

  const dateMatches = [...raw.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/g)];
  if (dateMatches.length >= 2) {
    const conv = (m) => {
      let y = m[3] ? Number(m[3]) : today.getFullYear();
      if (y < 100) y += 2000;
      return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
    };
    start = conv(dateMatches[0]);
    end = conv(dateMatches[1]);
    label = `dal ${start} al ${end}`;
  } else if (dateMatches.length === 1) {
    let y = dateMatches[0][3] ? Number(dateMatches[0][3]) : today.getFullYear();
    if (y < 100) y += 2000;
    start = end = `${y}-${pad2(dateMatches[0][2])}-${pad2(dateMatches[0][1])}`;
    label = start;
  }

  if (!start) {
    const yearMatch = t.match(/\b(20\d{2}|19\d{2})\b/);
    const monthName = Object.keys(months).find(m => new RegExp(`\\b${m}\\b`).test(t));
    if (monthName) {
      const y = yearMatch ? Number(yearMatch[1]) : today.getFullYear();
      const m = months[monthName];
      start = iso(new Date(y, m, 1));
      end = iso(new Date(y, m + 1, 0));
      label = `${monthName} ${y}`;
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
    const y = Number(t.match(/\b(20\d{2}|19\d{2})\b/)[1]);
    start = `${y}-01-01`; end = `${y}-12-31`; label = String(y);
  }

  if (!start) { start = iso(today); end = iso(today); label = 'oggi'; }
  if (start > end) [start, end] = [end, start];
  return { start, end, label };
}
function inRange(date, p) { return String(date || '') >= p.start && String(date || '') <= p.end; }

function serviceAliases(s) {
  return norm(s)
    .replace(/\bparti\b/g, 'parto')
    .replace(/\bcesarei\b/g, 'cesareo')
    .replace(/\bfecondazioni\b/g, 'fecondazione')
    .replace(/\becografie\b/g, 'ecografia')
    .replace(/\bvisite\b/g, 'visita')
    .replace(/\bservizi\b/g, 'prestazioni')
    .trim();
}
function companyName(i) { return i.azienda || i.company || i.aziendaNome || i.cliente || 'Azienda non indicata'; }
function serviceRows(i) {
  if (Array.isArray(i.prestazioni)) return i.prestazioni;
  if (Array.isArray(i.servs)) return i.servs;
  if (Array.isArray(i.services)) return i.services;
  return [];
}
function interventionTotal(i) {
  const direct = nnum(i.tot ?? i.total ?? i.importo ?? i.amount);
  if (direct) return direct;
  return serviceRows(i).reduce((sum, p) => sum + nnum(p.total ?? p.totale ?? (nnum(p.price ?? p.prezzo) * (nnum(p.qty ?? p.quantita ?? 1) || 1))), 0);
}
function interventions(ctx, p) {
  const rows = Array.isArray(ctx.interventi) ? ctx.interventi : [];
  return rows.filter(i => inRange(i.data, p));
}
function allServices(ctx) { return Array.isArray(ctx.prestazioni) ? ctx.prestazioni : []; }
function findServiceMention(input, ctx) {
  const t = serviceAliases(input);
  const services = allServices(ctx).slice().sort((a, b) => String(b.nome || b.name || '').length - String(a.nome || a.name || '').length);
  for (const s of services) {
    const name = s.nome || s.name || '';
    const ns = serviceAliases(name);
    if (ns && (new RegExp(`\\b${escapeRegex(ns)}\\b`).test(t) || t.includes(ns))) return s;
  }
  const common = ['parto', 'cesareo', 'fecondazione', 'visita clinica', 'visita', 'ecografia', 'vaccino', 'mastite', 'metrite'];
  for (const c of common) if (new RegExp(`\\b${escapeRegex(serviceAliases(c))}\\b`).test(t)) return { nome: c.charAt(0).toUpperCase() + c.slice(1) };
  return null;
}
function serviceMatches(row, svc) {
  const a = serviceAliases(row?.nome || row?.name || row?.prestazione || '');
  const b = serviceAliases(svc?.nome || svc?.name || '');
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}
function flattenServices(ints) {
  const out = [];
  for (const i of ints) {
    for (const p of serviceRows(i)) {
      const qty = nnum(p.qty ?? p.quantita ?? 1) || 1;
      const price = nnum(p.price ?? p.prezzo ?? 0);
      const revenue = nnum(p.total ?? p.totale ?? (price * qty));
      out.push({ intervention: i, nome: p.nome || p.name || p.prestazione || 'Prestazione', qty, revenue });
    }
  }
  return out;
}
function findCompanyMention(input, ctx) {
  const t = norm(input);
  const companies = (Array.isArray(ctx.aziende) ? ctx.aziende : []).slice().sort((a,b)=>String(b.nome||b.name||'').length - String(a.nome||a.name||'').length);
  return companies.find(c => {
    const n = norm(c.nome || c.name || c.ragioneSociale || '');
    return n.length > 2 && t.includes(n);
  }) || null;
}

function handleKmReport(input, ctx) {
  const p = parsePeriod(input, ctx);
  const hasKmRows = Array.isArray(ctx.kmRows) || Array.isArray(ctx.km);
  const rowsAll = Array.isArray(ctx.kmRows) ? ctx.kmRows : (Array.isArray(ctx.km) ? ctx.km : []);
  if (!hasKmRows) return { reply: `Non ho ricevuto dal gestionale i dati del tab KM per ${p.label}. Devo ricevere kmRows/spostamenti del tab KM.` };
  const rows = rowsAll.filter(r => inRange(r.data, p));
  if (!rows.length) {
    if (ctx.kmRowsComputed || ctx.kmSource === 'tab_km') {
      return { reply: `${cap(p.label)} risultano 0 km nel tab KM del gestionale.\nSpostamenti/tratte registrate: 0.\nRimborso km: ${eur(0)}.` };
    }
    return { reply: `Non ho ricevuto righe KM del tab KM per ${p.label}. Devo ricevere kmRows/spostamenti del tab KM.` };
  }
  const usable = rows.filter(r => r.tipo !== 'partenza' && r.tipo !== 'totale_giorno');
  const source = usable.length ? usable : rows;
  const totalKm = source.reduce((s, r) => s + nnum(r.km ?? r.kmTotali), 0);
  const reimbursement = source.reduce((s, r) => s + (r.rimborso !== undefined ? nnum(r.rimborso) : nnum(r.km ?? r.kmTotali) * nnum(r.rate ?? r.tariffaKm)), 0);
  const segments = source.filter(r => nnum(r.km ?? r.kmTotali) > 0).length;
  const byUser = new Map();
  for (const r of source) {
    const k = r.collaboratore || r.userName || r.veterinario || 'Non indicato';
    const cur = byUser.get(k) || { km: 0, rimborso: 0, n: 0 };
    const km = nnum(r.km ?? r.kmTotali);
    cur.km += km;
    cur.rimborso += r.rimborso !== undefined ? nnum(r.rimborso) : km * nnum(r.rate ?? r.tariffaKm);
    cur.n += km > 0 ? 1 : 0;
    byUser.set(k, cur);
  }
  let reply = `${cap(p.label)} hai fatto ${kmFmt(totalKm)} km.`;
  reply += `\nSpostamenti/tratte registrate: ${segments}.`;
  reply += `\nRimborso km: ${eur(reimbursement)}.`;
  if (byUser.size > 1) {
    reply += '\n\nDettaglio per collaboratore:';
    [...byUser.entries()].sort((a,b)=>b[1].km-a[1].km).forEach(([name, v]) => { reply += `\n- ${name}: ${kmFmt(v.km)} km, ${eur(v.rimborso)}`; });
  }
  reply += '\nCalcolo basato sul tab KM del gestionale.';
  return { reply };
}

function handleInterventionSummary(input, ctx) {
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  if (!ints.length) return { reply: `Nel periodo ${p.label} non risultano interventi registrati.` };
  const byCompany = new Map();
  let totalRevenue = 0;
  let totalPrest = 0;
  for (const i of ints) {
    const name = companyName(i);
    const cur = byCompany.get(name) || { revenue: 0, interventions: 0, services: new Map() };
    const rev = interventionTotal(i);
    cur.revenue += rev;
    totalRevenue += rev;
    cur.interventions += 1;
    for (const pRow of serviceRows(i)) {
      const pn = pRow.nome || pRow.name || pRow.prestazione || 'Prestazione';
      const q = nnum(pRow.qty ?? pRow.quantita ?? 1) || 1;
      totalPrest += q;
      cur.services.set(pn, (cur.services.get(pn) || 0) + q);
    }
    byCompany.set(name, cur);
  }
  let reply = `${cap(p.label)} hai visitato ${byCompany.size} aziende.`;
  [...byCompany.entries()].sort((a,b)=>b[1].revenue-a[1].revenue).forEach(([name, v], idx) => {
    reply += `\n\n${idx + 1}. ${name}\nPrestazioni:`;
    if (v.services.size) [...v.services.entries()].forEach(([sn, q]) => { reply += `\n- ${sn} x${q}`; });
    else reply += '\n- Nessuna prestazione dettagliata';
    reply += `\nRicavi: ${eur(v.revenue)}`;
  });
  reply += `\n\nTotale ricavi: ${eur(totalRevenue)}\nAziende visitate: ${byCompany.size}\nInterventi: ${ints.length}\nPrestazioni/servizi totali: ${totalPrest}`;
  return { reply };
}

function handleCountService(input, ctx) {
  const service = findServiceMention(input, ctx);
  if (!service) return null;
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  let qty = 0;
  let revenue = 0;
  const companies = new Set();
  const interventionIds = new Set();
  for (const i of ints) {
    for (const row of serviceRows(i)) {
      if (serviceMatches(row, service)) {
        const q = nnum(row.qty ?? row.quantita ?? 1) || 1;
        qty += q;
        revenue += nnum(row.total ?? row.totale ?? nnum(row.price ?? row.prezzo) * q);
        companies.add(companyName(i));
        interventionIds.add(i.id || `${i.data}-${companyName(i)}`);
      }
    }
  }
  const sn = service.nome || service.name || 'prestazione';
  if (!qty) return { reply: `Nel periodo ${p.label} non risultano prestazioni '${sn}' registrate.` };
  let reply = `${cap(p.label)} hai fatto ${qty} ${sn}.`;
  if (revenue) reply += `\nRicavi generati da ${sn}: ${eur(revenue)}.`;
  reply += `\nDistribuiti su ${interventionIds.size} interventi e ${companies.size} aziende.`;
  return { reply };
}

function handleRevenueByService(input, ctx) {
  const p = parsePeriod(input, ctx);
  const rows = flattenServices(interventions(ctx, p));
  if (!rows.length) return { reply: `Nel periodo ${p.label} non risultano prestazioni con ricavi registrati nel gestionale.` };
  const by = new Map();
  let total = 0;
  for (const r of rows) {
    const cur = by.get(r.nome) || { qty: 0, revenue: 0 };
    cur.qty += r.qty;
    cur.revenue += r.revenue;
    total += r.revenue;
    by.set(r.nome, cur);
  }
  const arr = [...by.entries()].sort((a,b)=>b[1].revenue-a[1].revenue);
  let reply = `${cap(p.label)} le prestazioni con più ricavi sono:`;
  arr.slice(0, 12).forEach(([name, v], idx) => { reply += `\n${idx + 1}. ${name} — ${eur(v.revenue)} — ${pct(total ? v.revenue / total * 100 : 0)} del totale — ${v.qty} prestazioni`; });
  reply += `\n\nTotale ricavi periodo: ${eur(total)}.`;
  return { reply };
}

function handleRevenueByCustomer(input, ctx) {
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  if (!ints.length) return { reply: `Nel periodo ${p.label} non risultano ricavi registrati.` };
  const by = new Map();
  let total = 0;
  for (const i of ints) {
    const name = companyName(i);
    const rev = interventionTotal(i);
    total += rev;
    by.set(name, (by.get(name) || 0) + rev);
  }
  const arr = [...by.entries()].sort((a,b)=>b[1]-a[1]);
  const [topName, topVal] = arr[0];
  let reply = `${cap(p.label)} l'azienda che ti ha dato più ricavi è ${topName} con ${eur(topVal)}, pari al ${pct(total ? topVal / total * 100 : 0)} del totale ricavi del periodo.`;
  reply += '\n\nTop aziende:';
  arr.slice(0, 10).forEach(([name, val], idx) => { reply += `\n${idx + 1}. ${name} — ${eur(val)} — ${pct(total ? val / total * 100 : 0)}`; });
  reply += `\n\nTotale ricavi periodo: ${eur(total)}.`;
  return { reply };
}

function handlePriceLookup(input, ctx) {
  const service = findServiceMention(input, ctx);
  if (!service) return { reply: 'Non trovo una voce listino corrispondente. Dimmi il nome esatto della prestazione.' };
  const company = findCompanyMention(input, ctx);
  const id = service.id;
  const basePrice = nnum(service.price ?? service.prezzo);
  const custom = company && company.prezzi && id !== undefined && company.prezzi[id] !== undefined ? nnum(company.prezzi[id]) : null;
  const sn = service.nome || service.name || 'prestazione';
  if (company && custom !== null) return { reply: `Per ${company.nome || company.name} la prestazione ${sn} costa ${eur(custom)}.${basePrice ? ` Prezzo base listino: ${eur(basePrice)}.` : ''}` };
  if (basePrice) return { reply: `Nel listino la prestazione ${sn} costa ${eur(basePrice)}.` };
  return { reply: `Non trovo un prezzo di listino salvato per '${sn}'.` };
}

function handleFiscalLookup(input, ctx) {
  const t = norm(input);
  const wantsPiva = /p iva|piva|partita iva|numero iva|dati fiscali iva/.test(t);
  const wantsCf = /codice fiscale|\bcf\b|c f/.test(t);
  const wantsSdi = /\bsdi\b|codice destinatario|codice fatturazione/.test(t);
  if (!wantsPiva && !wantsCf && !wantsSdi) return null;
  const company = findCompanyMention(input, ctx);
  if (!company) return { reply: 'Dimmi per quale azienda/cliente vuoi il dato fiscale.' };
  const name = company.nome || company.name || 'azienda';
  if (wantsPiva) return { reply: company.piva ? `Per ${name} la P.IVA è ${company.piva}.` : `Per ${name} non risulta una P.IVA salvata nel gestionale.` };
  if (wantsCf) return { reply: company.cf ? `Per ${name} il codice fiscale è ${company.cf}.` : `Per ${name} non risulta un codice fiscale salvato nel gestionale.` };
  if (wantsSdi) return { reply: company.sdi ? `Per ${name} il codice SDI è ${company.sdi}.` : `Per ${name} non risulta un codice SDI salvato nel gestionale.` };
  return null;
}

const qtyWords = { un:1, uno:1, una:1, due:2, tre:3, quattro:4, cinque:5, sei:6, sette:7, otto:8, nove:9, dieci:10 };
function detectServicesForAction(input, ctx) {
  const t = serviceAliases(input);
  const out = [];
  const services = allServices(ctx).slice().sort((a,b)=>String(b.nome||b.name||'').length - String(a.nome||a.name||'').length);
  for (const s of services) {
    const name = s.nome || s.name || '';
    const ns = serviceAliases(name);
    if (!ns || !new RegExp(`\\b${escapeRegex(ns)}\\b`).test(t)) continue;
    let qty = 1;
    const after = new RegExp(`${escapeRegex(ns)}\\s*(?:x|per|n\\.?|numero)?\\s*(\\d{1,3})`).exec(t);
    const before = new RegExp(`(?:x\\s*)?(\\d{1,3})\\s+${escapeRegex(ns)}|(${Object.keys(qtyWords).join('|')})\\s+${escapeRegex(ns)}`).exec(t);
    if (after) qty = Number(after[1]);
    else if (before) qty = before[1] ? Number(before[1]) : qtyWords[before[2]] || 1;
    out.push({ id: s.id, name, qty });
  }
  return out;
}
function parseWhenForAction(input, ctx) {
  const t = norm(input);
  const base = ctx.date ? new Date(ctx.date) : new Date();
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  let date = '';
  let time = '';
  let session = '';
  if (/\boggi\b|stamattina|stasera|stanotte|questa mattina|questo pomeriggio|questa sera|in mattinata|nel pomeriggio|in serata|in nottata/.test(t)) date = iso(today);
  if (/\bieri\b/.test(t)) date = iso(addDays(today, -1));
  const dm = String(input).match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (dm) { let y = dm[3] ? Number(dm[3]) : today.getFullYear(); if (y < 100) y += 2000; date = `${y}-${pad2(dm[2])}-${pad2(dm[1])}`; }
  const tm = String(input).match(/(?:alle|ore)?\s*(\d{1,2})[:.](\d{2})\b/i) || String(input).match(/(?:alle|ore)\s*(\d{1,2})\b/i);
  if (tm) time = `${pad2(tm[1])}:${pad2(tm[2] || '00')}`;
  if (/mattina|stamattina|mattinata|prima di pranzo/.test(t)) session = 'm';
  else if (/pomeriggio|dopo pranzo/.test(t)) session = 'p';
  else if (/sera|stasera|serata|notte|stanotte|nottata/.test(t)) session = 'n';
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
  const sessionLabel = when.session === 'm' ? 'mattina' : when.session === 'p' ? 'pomeriggio' : when.session === 'n' ? 'sera/notte' : '';
  const reply = `Vuoi salvare questo intervento?\nCliente: ${company.nome || company.name}\n${when.date ? `Data: ${when.date}\n` : ''}${when.time ? `Ora: ${when.time}\n` : (sessionLabel ? `Sessione: ${sessionLabel}\n` : '')}Prestazioni:\n${services.map(s => `- ${s.name} x${s.qty}`).join('\n')}`;
  return {
    reply,
    action: { type: 'create_intervention', companyName: company.nome || company.name, services, date: when.date, time: when.time, session: when.session },
    quickReplies: ['SALVA', 'Annulla']
  };
}

function detectAndHandle(input, ctx = {}) {
  const t = norm(input);
  const isKm = /(\bkm\b|chilometr|kilometr|strada|spostament|tratt|rimbors)/.test(t);
  const isKmExcel = isKm && /(excel|xlsx|scarica|download|esporta|file|resoconto|riepilogo)/.test(t);
  if (isKm && !isKmExcel) return handleKmReport(input, ctx);
  if (isKmExcel) return handleKmReport(input, ctx);
  const fiscal = handleFiscalLookup(input, ctx); if (fiscal) return fiscal;
  if (/(quanto costa|prezzo|listino|tariffario|costo|quanto faccio pagare)/.test(t)) return handlePriceLookup(input, ctx);
  const add = handleAddIntervention(input, ctx); if (add) return add;
  if (/(servizi|prestazioni).*(ricavi|reso|redditiz|fattur)|ricavi per prestazione|top prestazioni|top servizi|prestazioni.*piu ricavi|servizi.*piu ricavi/.test(t)) return handleRevenueByService(input, ctx);
  if (/(dove sono stato|quali interventi|che interventi|cosa ho fatto|aziende ho visitato|riepilogo interventi|riassunto giornata)/.test(t)) return handleInterventionSummary(input, ctx);
  if (/(quale azienda|top aziende|migliori clienti|cliente.*fattur|azienda.*ricavi|cliente.*ricavi|piu ricavi|piu fattur|portato piu ricavi)/.test(t)) return handleRevenueByCustomer(input, ctx);
  if (/\bquanti\b|\bquante\b|numero/.test(t)) { const out = handleCountService(input, ctx); if (out) return out; }
  return null;
}

function compactContext(ctx) {
  const copy = { ...ctx };
  if (Array.isArray(copy.interventi) && copy.interventi.length > 1400) copy.interventi = copy.interventi.slice(0, 1400);
  if (Array.isArray(copy.kmRows) && copy.kmRows.length > 4000) copy.kmRows = copy.kmRows.slice(0, 4000);
  if (Array.isArray(copy.aziende) && copy.aziende.length > 1000) copy.aziende = copy.aziende.slice(0, 1000);
  if (Array.isArray(copy.prestazioni) && copy.prestazioni.length > 1000) copy.prestazioni = copy.prestazioni.slice(0, 1000);
  return copy;
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'Rural Vet AI backend', health: '/api/health', chat: '/api/vet-ai-chat' });
});
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Rural Vet AI backend', version: '8.2.0-rm-final', model: MODEL, openai: Boolean(openai) });
});
app.post('/api/debug-context', (req, res) => {
  const ctx = req.body?.context || req.body || {};
  res.json({ ok: true, receivedAt: new Date().toISOString(), keys: Object.keys(ctx), kmRows: Array.isArray(ctx.kmRows) ? ctx.kmRows.length : null, interventi: Array.isArray(ctx.interventi) ? ctx.interventi.length : null });
});

app.post('/api/vet-ai-chat', async (req, res) => {
  try {
    const { input = '', context = {}, system = '', conversation = [], image = null } = req.body || {};
    const deterministic = detectAndHandle(input, context);
    if (deterministic) return res.json(deterministic);

    if (!openai) {
      return res.json({ reply: 'Backend AI attivo, ma manca OPENAI_API_KEY su Render. Posso rispondere solo alle analisi gestionali deterministicamente coperte.' });
    }

    const ctx = compactContext(context || {});
    const messages = [
      { role: 'system', content: system || 'Sei Rural Vet AI. Rispondi in italiano, usando i dati gestionali forniti e senza inventare.' },
      { role: 'system', content: 'CONTESTO GESTIONALE JSON, usa solo questi dati per numeri e gestionali: ' + JSON.stringify(ctx).slice(0, 90000) },
      ...conversation.slice(-8).map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: String(m.content || m.text || '') })),
      { role: 'user', content: image ? `${input}\n[Immagine allegata: ${image.name || 'foto'}]` : input }
    ];

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.15,
      response_format: { type: 'json_object' }
    });
    const content = completion.choices?.[0]?.message?.content || '{}';
    let data;
    try { data = JSON.parse(content); } catch { data = { reply: content }; }
    if (!data.reply && !data.answer && !data.message) data.reply = String(content || '').trim();
    return res.json(data);
  } catch (err) {
    console.error('AI backend error:', err);
    return res.status(500).json({ error: 'AI backend error', message: err?.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Rural Vet AI backend listening on ${PORT}`));
