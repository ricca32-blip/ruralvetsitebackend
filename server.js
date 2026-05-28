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

function cleanReply(v) {
  let out = String(v ?? '');
  out = out.replace(/```[\s\S]*?```/g, (m) => m.replace(/```(?:json)?/gi, '').replace(/```/g, ''));
  out = out.replace(/\*\*/g, '');
  out = out.replace(/\*/g, '');
  out = out.replace(/^#{1,6}\s*/gm, '');
  out = out.replace(/\b(intent|payload|context|action)\s*[:=].*$/gmi, '');
  out = out.replace(/[{}\[\]`]/g, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}
function pluralPrestazione(q) { return q === 1 ? 'prestazione/servizio' : 'prestazioni/servizi'; }
function table(headers, rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const safe = (v) => String(v ?? '').replace(/\|/g, '/').trim();
  const h = '| ' + headers.map(safe).join(' | ') + ' |';
  const sep = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const body = rows.map(r => '| ' + r.map(safe).join(' | ') + ' |').join('\n');
  return h + '\n' + sep + '\n' + body;
}

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

  const mk = (d) => iso(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
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

  // Trimestri: primo trimestre, Q1, trimestre 1, ecc.
  if (!start) {
    const yearMatch = t.match(/\b(20\d{2}|19\d{2})\b/);
    const y = yearMatch ? Number(yearMatch[1]) : today.getFullYear();
    let q = null;
    if (/\bq1\b|primo trimestre|trimestre 1|1 trimestre/.test(t)) q = 1;
    else if (/\bq2\b|secondo trimestre|trimestre 2|2 trimestre/.test(t)) q = 2;
    else if (/\bq3\b|terzo trimestre|trimestre 3|3 trimestre/.test(t)) q = 3;
    else if (/\bq4\b|quarto trimestre|trimestre 4|4 trimestre/.test(t)) q = 4;
    if (q) {
      const firstMonth = (q - 1) * 3;
      start = iso(new Date(y, firstMonth, 1));
      end = iso(new Date(y, firstMonth + 3, 0));
      label = `${q}° trimestre ${y}`;
    }
  }

  // Mesi specifici in italiano.
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

  if (!start && /ieri l altro|ierlaltro|due giorni fa|2 giorni fa/.test(t)) {
    const d = addDays(today, -2); start = end = iso(d); label = "ieri l'altro";
  } else if (!start && /\boggi\b|data odierna|giornata di oggi/.test(t)) {
    start = end = iso(today); label = 'oggi';
  } else if (!start && /\bieri\b|giornata di ieri/.test(t)) {
    const d = addDays(today, -1); start = end = iso(d); label = 'ieri';
  } else if (!start && /settimana scorsa|scorsa settimana|settimana passata|settimana precedente/.test(t)) {
    const s = addDays(startOfWeek(today), -7); const e = addDays(s, 6); start = iso(s); end = iso(e); label = 'settimana scorsa';
  } else if (!start && /questa settimana|settimana corrente|settimana in corso|da lunedi/.test(t)) {
    const s = startOfWeek(today); start = iso(s); end = iso(today); label = 'questa settimana';
  } else if (!start && /ultimi 7 giorni|ultimi sette giorni/.test(t)) {
    start = iso(addDays(today, -6)); end = iso(today); label = 'ultimi 7 giorni';
  } else if (!start && /mese scorso|scorso mese|mese precedente/.test(t)) {
    const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const m = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    start = iso(new Date(y, m, 1)); end = iso(new Date(y, m + 1, 0)); label = 'mese scorso';
  } else if (!start && /ultimo mese|ultimi 30 giorni|ultimi trenta giorni/.test(t)) {
    start = iso(addDays(today, -29)); end = iso(today); label = 'ultimo mese';
  } else if (!start && /questo mese|mese corrente|mese in corso/.test(t)) {
    start = iso(new Date(today.getFullYear(), today.getMonth(), 1)); end = iso(today); label = 'questo mese';
  } else if (!start && /\bytd\b|da inizio anno|dall inizio anno|inizio anno|quest anno|anno corrente/.test(t)) {
    start = `${today.getFullYear()}-01-01`; end = iso(today); label = 'da inizio anno';
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
    const rows = [...byUser.entries()].sort((a,b)=>b[1].km-a[1].km).map(([name, v]) => [name, kmFmt(v.km) + ' km', eur(v.rimborso)]);
    reply += '\n\nDettaglio per collaboratore:\n' + table(['Collaboratore', 'KM', 'Rimborso'], rows);
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
  const rows = [...byCompany.entries()].sort((a,b)=>b[1].revenue-a[1].revenue).map(([name, v]) => {
    const prest = v.services.size ? [...v.services.entries()].map(([sn, q]) => `${sn} x${q}`).join(', ') : 'Nessuna prestazione dettagliata';
    return [name, prest, eur(v.revenue)];
  });
  reply += '\n\nDettaglio per azienda:\n' + table(['Azienda', 'Prestazioni', 'Ricavi'], rows);
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

function countAllServicesInInterventions(ints) {
  let total = 0;
  const by = new Map();
  for (const i of ints) {
    const rows = serviceRows(i);
    if (!rows.length) continue;
    for (const row of rows) {
      const name = row.nome || row.name || row.prestazione || 'Prestazione';
      const q = nnum(row.qty ?? row.quantita ?? 1) || 1;
      total += q;
      by.set(name, (by.get(name) || 0) + q);
    }
  }
  return { total, by };
}

function handleGenericServiceCount(input, ctx) {
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  if (!ints.length) return { reply: `Nel periodo ${p.label} non risultano interventi o prestazioni registrate.` };
  const { total, by } = countAllServicesInInterventions(ints);
  let reply = `${cap(p.label)} hai svolto ${total} ${pluralPrestazione(total)} totali, distribuite su ${ints.length} intervent${ints.length === 1 ? 'o' : 'i'} in ${new Set(ints.map(companyName)).size} aziende.`;
  const arr = [...by.entries()].sort((a, b) => b[1] - a[1]);
  if (arr.length) {
    reply += '\n\nDettaglio prestazioni:\n' + table(['Prestazione', 'Quantità'], arr.slice(0, 20).map(([name, q]) => [name, q]));
  }
  return { reply };
}

function handleInterventionCount(input, ctx) {
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  if (!ints.length) return { reply: `Nel periodo ${p.label} non risultano interventi registrati.` };
  const totalRevenue = ints.reduce((s, i) => s + interventionTotal(i), 0);
  const { total: totalPrest } = countAllServicesInInterventions(ints);
  const companies = new Set(ints.map(companyName));
  return { reply: `${cap(p.label)} hai eseguito ${ints.length} intervent${ints.length === 1 ? 'o' : 'i'}.\nAziende visitate: ${companies.size}.\nPrestazioni/servizi: ${totalPrest}.\nRicavi totali: ${eur(totalRevenue)}.` };
}



function handleRevenueSummary(input, ctx) {
  const p = parsePeriod(input, ctx);
  const ints = interventions(ctx, p);
  if (!ints.length) return { reply: `Nel periodo ${p.label} non risultano ricavi registrati.` };
  const byCompany = new Map();
  let totalRevenue = 0;
  let totalPrest = 0;
  for (const i of ints) {
    const name = companyName(i);
    const rev = interventionTotal(i);
    totalRevenue += rev;
    const cur = byCompany.get(name) || { revenue: 0, interventions: 0, services: 0 };
    cur.revenue += rev;
    cur.interventions += 1;
    const services = serviceRows(i);
    if (services.length) {
      for (const row of services) cur.services += (nnum(row.qty ?? row.quantita ?? 1) || 1);
    } else {
      cur.services += 0;
    }
    byCompany.set(name, cur);
  }
  totalPrest = [...byCompany.values()].reduce((s, v) => s + v.services, 0);
  const arr = [...byCompany.entries()].sort((a,b)=>b[1].revenue-a[1].revenue);
  let reply = `${cap(p.label)} hai fatto ${eur(totalRevenue)} di ricavi.`;
  reply += `\nAziende visitate: ${byCompany.size}.`;
  reply += `\nInterventi: ${ints.length}.`;
  reply += `\nPrestazioni/servizi: ${totalPrest}.`;
  if (arr.length) {
    reply += `\n\nDettaglio per azienda:`;
    for (const [name, v] of arr) {
      reply += `\n- ${name}: ${eur(v.revenue)} (${v.interventions} intervent${v.interventions === 1 ? 'o' : 'i'}, ${v.services} prestazion${v.services === 1 ? 'e' : 'i'})`;
    }
  }
  return { reply };
}

function humanizeObject(data) {
  if (!data || typeof data !== 'object') return String(data ?? '');
  if (typeof data.reply === 'string' && data.reply.trim()) return data.reply;
  if (typeof data.answer === 'string' && data.answer.trim()) return data.answer;
  if (typeof data.message === 'string' && data.message.trim()) return data.message;

  const total = data.totaleRicavi ?? data.totalRevenue ?? data.ricaviTotali;
  const aziende = data.aziendeVisitate ?? data.aziendeVisitated ?? data.customers ?? data.aziende;
  if (total !== undefined || Array.isArray(aziende)) {
    let reply = `Ricavi totali: ${eur(total || 0)}.`;
    if (data.numeroAziende !== undefined) reply += `\nAziende visitate: ${data.numeroAziende}.`;
    if (data.numeroInterventi !== undefined) reply += `\nInterventi: ${data.numeroInterventi}.`;
    if (data.numeroPrestazioni !== undefined) reply += `\nPrestazioni/servizi: ${data.numeroPrestazioni}.`;
    if (Array.isArray(aziende) && aziende.length) {
      reply += `\n\nDettaglio per azienda:`;
      for (const a of aziende) {
        const name = a.azienda || a.nome || a.name || 'Azienda';
        const rev = a.ricavi ?? a.revenue ?? a.importo ?? 0;
        reply += `\n- ${name}: ${eur(rev)}`;
      }
    }
    return reply;
  }
  return 'Ho ricevuto dati dal gestionale, ma non riesco a trasformarli in una risposta leggibile. Riprova specificando periodo e tipo di riepilogo.';
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
  reply += '\n' + table(['Prestazione', 'Ricavi', '% sul totale', 'Quantità'], arr.slice(0, 12).map(([name, v]) => [name, eur(v.revenue), pct(total ? v.revenue / total * 100 : 0), v.qty]));
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
  reply += '\n\nTop aziende:\n' + table(['Azienda', 'Ricavi', '% sul totale'], arr.slice(0, 10).map(([name, val]) => [name, eur(val), pct(total ? val / total * 100 : 0)]));
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

function parseTemporalOrderForAction(input) {
  const raw = String(input || '').replace(/\s+/g, ' ').trim();
  const cleaned = raw.replace(/[.,;!?]+$/g, '');
  function tidy(v) {
    return String(v || '')
      .replace(/^(da|presso|azienda|cliente)\s+/i, '')
      .replace(/\s+(oggi|ieri|stamattina|in mattinata|nel pomeriggio|stasera|stanotte|alle|ore).*$/i, '')
      .trim()
      .slice(0, 120);
  }
  let m = cleaned.match(/tra\s+(.+?)\s+e\s+(.+?)(?=\s+(?:oggi|ieri|stamattina|in mattinata|nel pomeriggio|stasera|stanotte|alle|ore|con|per|$)|[.,;]|$)/i);
  if (m) return { type: 'tra', reference: tidy(m[1]), reference2: tidy(m[2]), label: `tra ${tidy(m[1])} e ${tidy(m[2])}` };
  m = cleaned.match(/(?:subito\s+)?dopo(?:\s+essere\s+stato\s+da|\s+essere\s+andato\s+da|\s+l[’']?intervento\s+da|\s+da)?\s+(.+?)(?=\s+(?:oggi|ieri|stamattina|in mattinata|nel pomeriggio|stasera|stanotte|alle|ore|con|e\s+(?:un|una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|\d+)\s+|$)|[.,;]|$)/i);
  if (m) { const r = tidy(m[1]); if (r) return { type: 'dopo', reference: r, label: `dopo ${r}` }; }
  m = cleaned.match(/(?:subito\s+)?prima\s+di(?:\s+andare\s+da|\s+l[’']?intervento\s+da|\s+essere\s+stato\s+da|\s+da)?\s+(.+?)(?=\s+(?:oggi|ieri|stamattina|in mattinata|nel pomeriggio|stasera|stanotte|alle|ore|con|e\s+(?:un|una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|\d+)\s+|$)|[.,;]|$)/i);
  if (m) { const r = tidy(m[1]); if (r) return { type: 'prima', reference: r, label: `prima di ${r}` }; }
  if (/(a\s+inizio\s+giro|inizio\s+giro|come\s+primo\s+intervento|primo\s+intervento)/i.test(cleaned)) return { type: 'inizio_giro', label: 'a inizio giro' };
  if (/(a\s+fine\s+giro|alla\s+fine\s+del\s+giro|fine\s+giro|come\s+ultimo\s+intervento|ultimo\s+intervento)/i.test(cleaned)) return { type: 'fine_giro', label: 'a fine giro' };
  return null;
}
function temporalOrderLabel(order) {
  if (!order) return '';
  return order.label || (order.type === 'dopo' ? `dopo ${order.reference || ''}` : order.type === 'prima' ? `prima di ${order.reference || ''}` : order.type === 'tra' ? `tra ${order.reference || ''} e ${order.reference2 || ''}` : order.type === 'inizio_giro' ? 'a inizio giro' : order.type === 'fine_giro' ? 'a fine giro' : '');
}


function handlePendingInterventionCompletion(input, ctx) {
  const draft = ctx.pendingAiAction || ctx.pendingInterventionDraft;
  if (!draft || draft.type !== 'create_intervention') return null;
  const t = norm(input);
  if (/^(salva|conferma|ok salva|si salva|sì salva|registra|inserisci)$/.test(t)) return null;
  const when = parseWhenForAction(input, ctx);
  const order = parseTemporalOrderForAction(input);
  const hasWhen = Boolean(when.date || when.time || when.session);
  if (!hasWhen && !order) return null;
  const completed = { ...draft };
  completed.date = completed.date || completed.data || when.date;
  completed.time = completed.time || completed.ora || when.time;
  completed.session = completed.session || completed.sess || when.session;
  completed.temporalOrder = completed.temporalOrder || completed.ordineTemporale || order;
  completed.orderLabel = completed.orderLabel || temporalOrderLabel(completed.temporalOrder);
  if (!completed.date && order) completed.date = iso(new Date((ctx.date ? new Date(ctx.date) : new Date()).getFullYear(), (ctx.date ? new Date(ctx.date) : new Date()).getMonth(), (ctx.date ? new Date(ctx.date) : new Date()).getDate()));
  const companyName = completed.companyName || completed.azienda || completed.company || (completed.company && (completed.company.nome || completed.company.name)) || 'Cliente non indicato';
  const services = Array.isArray(completed.services) ? completed.services : (Array.isArray(completed.servs) ? completed.servs : []);
  const sessionLabel = completed.session === 'm' ? 'mattina' : completed.session === 'p' ? 'pomeriggio' : completed.session === 'n' ? 'sera/notte' : '';
  const serviceLines = services.length ? services.map(s => `- ${s.name || s.nome || s.prestazione || 'Prestazione'} x${s.qty || s.quantita || 1}`).join('\n') : '- Prestazioni già indicate nella bozza';
  const reply = `Vuoi salvare questo intervento?\nCliente: ${companyName}\n${completed.date ? `Data: ${completed.date}\n` : ''}${completed.time ? `Ora: ${completed.time}\n` : (sessionLabel ? `Sessione: ${sessionLabel}\n` : '')}Prestazioni:\n${serviceLines}`;
  return { reply, action: completed, quickReplies: ['SALVA', 'Annulla'] };
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
    action: { type: 'create_intervention', companyName: company.nome || company.name, services, date: when.date, time: when.time, session: when.session, temporalOrder: order, orderLabel: temporalOrderLabel(order) },
    quickReplies: ['SALVA', 'Annulla']
  };
}

function detectAndHandle(input, ctx = {}) {
  const t = norm(input);
  const isKm = /(\bkm\b|chilometr|kilometr|strada|spostament|tratt|rimbors)/.test(t);
  const isKmExcel = isKm && /(excel|xlsx|scarica|download|esporta|file|resoconto|riepilogo)/.test(t);
  if (isKm && !isKmExcel) return handleKmReport(input, ctx);
  if (isKmExcel) return handleKmReport(input, ctx);

  const pendingCompletion = handlePendingInterventionCompletion(input, ctx); if (pendingCompletion) return pendingCompletion;
  const fiscal = handleFiscalLookup(input, ctx); if (fiscal) return fiscal;
  if (/(quanto costa|prezzo|listino|tariffario|costo|quanto faccio pagare)/.test(t)) return handlePriceLookup(input, ctx);
  const add = handleAddIntervention(input, ctx); if (add) return add;

  const asksRevenue = /(ricav|fatturat|incassat|prodotto|quanto ho fatto|quanto ho guadagnato|quanto abbiamo fatto)/.test(t);
  const asksInterventions = /(quanti interventi|numero interventi|quante uscite|quante visite|interventi ho fatto)/.test(t);
  const asksGenericServices = /(quante prestazioni|quanti servizi|numero prestazioni|numero servizi|prestazioni ho fatto|servizi ho fatto)/.test(t);

  if (/(servizi|prestazioni).*(ricavi|reso|redditiz|fattur)|ricavi per prestazione|top prestazioni|top servizi|prestazioni.*piu ricavi|servizi.*piu ricavi|da cosa derivano i ricavi/.test(t)) return handleRevenueByService(input, ctx);
  if (/(dove sono stato|dove sono andato|quali interventi|che interventi|cosa ho fatto|aziende ho visitato|clienti ho visto|riepilogo interventi|riassunto giornata)/.test(t)) return handleInterventionSummary(input, ctx);
  if (/(quale azienda|top aziende|migliori clienti|cliente.*fattur|azienda.*ricavi|cliente.*ricavi|piu ricavi|piu fattur|portato piu ricavi|cliente piu redditizio|azienda piu redditizia)/.test(t)) return handleRevenueByCustomer(input, ctx);
  if (asksRevenue) return handleRevenueSummary(input, ctx);
  if (asksInterventions) return handleInterventionCount(input, ctx);
  if (asksGenericServices) return handleGenericServiceCount(input, ctx);
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
  res.json({ ok: true, service: 'Rural Vet AI backend', version: '8.5.0-temporal-order', model: MODEL, openai: Boolean(openai) });
});

// Se apri questo URL nel browser, il browser fa una richiesta GET.
// La chat vera usa POST, ma questo GET evita il messaggio Express "Cannot GET /api/vet-ai-chat"
// e conferma che l'endpoint corretto e attivo.
app.get('/api/vet-ai-chat', (req, res) => {
  res.json({
    ok: true,
    service: 'Rural Vet AI backend',
    endpoint: '/api/vet-ai-chat',
    methodForChat: 'POST',
    message: 'Endpoint AI attivo. Nel gestionale usa questo URL come endpoint; la chat inviera richieste POST.'
  });
});

app.post('/api/debug-context', (req, res) => {
  const ctx = req.body?.context || req.body || {};
  res.json({ ok: true, receivedAt: new Date().toISOString(), keys: Object.keys(ctx), kmRows: Array.isArray(ctx.kmRows) ? ctx.kmRows.length : null, interventi: Array.isArray(ctx.interventi) ? ctx.interventi.length : null });
});

app.post('/api/vet-ai-chat', async (req, res) => {
  try {
    const { input = '', context = {}, system = '', conversation = [], image = null } = req.body || {};
    const deterministic = detectAndHandle(input, context);
    if (deterministic) { if (deterministic.reply) deterministic.reply = cleanReply(deterministic.reply); return res.json(deterministic); }

    if (!openai) {
      return res.json({ reply: 'Backend AI attivo, ma manca OPENAI_API_KEY su Render. Posso rispondere solo alle analisi gestionali deterministicamente coperte.' });
    }

    const ctx = compactContext(context || {});
    const messages = [
      { role: 'system', content: (system || 'Sei Rural Vet AI. Rispondi in italiano, usando i dati gestionali forniti e senza inventare.') + '\n' + [
        'Rispondi sempre con un JSON che contenga almeno la chiave reply come testo umano leggibile.',
        'Non restituire mai solo oggetti dati grezzi.',
        'Stile: italiano naturale, niente markdown tecnico, niente asterischi ** vicino a prezzi/nomi/numeri, niente JSON nella reply, niente intent/payload/context/action nella reply.',
        'Dai subito il dato richiesto e poi il dettaglio. Se ci sono 3 o più righe di dettaglio, usa una tabella leggibile in formato pipe table con intestazioni chiare.',
        'Interpreta bene periodi: oggi, ieri, ieri l altro, settimana scorsa, mese di maggio, Q1/primo trimestre, da inizio anno.',
        'Memoria interventi in bozza: se context.pendingAiAction o context.pendingInterventionDraft esiste, interpreta risposte brevi dell utente come completamento della bozza aperta. Non chiedere di nuovo dati gia presenti nella bozza.',
        'Una fascia come stamattina, in mattinata, oggi pomeriggio, ieri mattina o stanotte completa data/sessione.',
        'Salvataggio sicuro: non dire mai che un intervento e stato registrato/salvato/fatto/inserito nel gestionale se non e avvenuta una conferma tecnica. Prima del SALVA devi solo proporre: Vuoi salvare questo intervento? con riepilogo. Dopo SALVA, se il frontend/backend conferma, allora puoi dire Intervento salvato nel gestionale.',
        'ORDINE TEMPORALE TRA INTERVENTI / DOPO / PRIMA DI: quando l utente sta aggiungendo un intervento, espressioni come dopo [azienda], dopo essere stato da [azienda], prima di [azienda], prima di andare da [azienda], tra [azienda A] e [azienda B], subito dopo, subito prima, a inizio giro, a fine giro, come primo intervento o come ultimo intervento indicano la posizione temporale nel giro della giornata. Non sono il cliente dell intervento da registrare se nella frase esiste gia un altro cliente principale. Esempio: Segnami un parto da Arata dopo Palladini = cliente Arata, Parto x1, posizione nel giro dopo Palladini. Esempio: Ho fatto un cesareo da Arata prima di Ziliani = cliente Arata, Cesareo x1, posizione prima di Ziliani. Esempio: visita da Rossi tra Palladini e Repetti = cliente Rossi, posizione tra Palladini e Repetti. Se manca il cliente principale, chiedilo: Ok, lo metto dopo Palladini nel giro. Da quale azienda hai fatto l intervento? Se esiste una bozza aperta, dopo Palladini o prima di Ziliani completano la bozza, non creano una nuova richiesta.'
      ].join('\n') },
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
    if (!data.reply && !data.answer && !data.message) data.reply = humanizeObject(data);
    if (data.answer && !data.reply) data.reply = data.answer;
    if (data.message && !data.reply) data.reply = data.message;
    data.reply = cleanReply(data.reply);
    return res.json(data);
  } catch (err) {
    console.error('AI backend error:', err);
    return res.status(500).json({ error: 'AI backend error', message: err?.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Rural Vet AI backend listening on ${PORT}`));
