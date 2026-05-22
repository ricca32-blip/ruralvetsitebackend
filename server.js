import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import OpenAI from 'openai';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 4500);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!process.env.OPENAI_API_KEY) {
  console.warn('ATTENZIONE: OPENAI_API_KEY non impostata. Il backend rispondera con errore finche non la configuri.');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-key' });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '30mb' }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN.split(',').map(s => s.trim()) }));

function safeText(value, max = 4000) {
  return String(value || '').replace(/\u0000/g, '').slice(0, max);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactCatalog(context = {}) {
  const aziende = asArray(context.aziende)
    .slice(0, 800)
    .map(a => ({
      id: a.id,
      nome: safeText(a.nome, 140),
      ragioneSociale: safeText(a.ragioneSociale, 180),
      addr: safeText(a.addr || a.indirizzo, 220),
      comune: safeText(a.comune, 100),
      cap: safeText(a.cap, 20),
      provincia: safeText(a.provincia, 20),
      piva: safeText(a.piva, 40),
      cf: safeText(a.cf, 40),
      sdi: safeText(a.sdi, 40)
    }))
    .filter(a => a.nome || a.ragioneSociale);

  const prestazioni = asArray(context.prestazioni)
    .slice(0, 700)
    .map(p => ({ id: p.id, nome: safeText(p.nome, 160), cat: safeText(p.cat, 80), tipo: safeText(p.tipo, 80) }))
    .filter(p => p.nome);

  return { aziende, prestazioni };
}

function recentMemory(context = {}) {
  return asArray(context.aiMemoryRecent)
    .slice(0, 35)
    .map(m => ({
      at: m.at,
      userName: safeText(m.userName, 80),
      kind: safeText(m.kind, 60),
      text: safeText(m.text, 900)
    }))
    .filter(m => m.text);
}

function buildSystemPrompt() {
  return `
Sei Rural Vet AI, agente operativo dentro un gestionale veterinario buiatrico.
Rispondi SEMPRE in italiano.
Stile: come ChatGPT, naturale, concreto, breve.

COMPORTAMENTO COME ASSISTENTE DEL PROFILO
- L'utente corrente e' il veterinario/operatore che ha fatto l'accesso.
- Se chiede di registrare interventi, comportati come assistente operativo: estrai azienda, prestazioni, quantita, data, ora/sessione e nota.
- Usa prestazioni presenti nel catalogo ricevuto.
- Per le aziende: se trovi corrispondenza sicura nel catalogo, usa companyId. Cerca anche in ragione sociale, indirizzo, comune, P.IVA, CF e SDI.
- Se l'azienda NON e' nel catalogo, non inventare un id: lascia companyId vuoto e usa companyName scritto dall'utente. Il gestionale proporra' di creare il nuovo cliente.
- Se l'utente chiede di aggiungere un cliente/azienda, restituisci action type "create_client".
- Se data o ora mancano per un intervento, NON inventarle: chiedi se registrare ADESSO oppure in altro giorno/ora.
- Non dire mai "fatto" prima che il gestionale abbia salvato.
- Prepara riepilogo e chiedi conferma con "Scrivi SALVA".
- Se ci sono piu' interventi in una giornata, puoi restituire piu' azioni.

COMPORTAMENTO CLINICO
- Se e' un caso clinico: diagnosi piu' probabile quando possibile, massimo 2 differenziali e massimo 3 domande mirate.
- Evita spiegoni lunghi.
- Non inventare dati, dosaggi, ricette o tempi di sospensione se non sono negli appunti/protocolli forniti.

APPRENDIMENTO
- La memoria vera viene salvata dal gestionale nel cloud Rural Vet/JSONbin.
- Nel campo learn inserisci SOLO informazioni durevoli, utili e sicure da ricordare.
- Aggiungi learn quando l'utente dice esplicitamente ricorda/memorizza/impara/istruisci, oppure quando corregge una preferenza stabile.
- Non salvare come learn ipotesi cliniche incerte.

FORMATO OBBLIGATORIO
Rispondi SOLO con JSON valido, senza markdown, senza testo fuori JSON:
{
  "reply": "testo breve per l'utente",
  "action": null oppure una di queste azioni:
  {
    "type": "create_intervention",
    "companyName": "nome azienda",
    "companyId": "id se sicuro, vuoto se azienda nuova",
    "services": [{"name":"nome prestazione", "id":"id se sicuro", "qty":1}],
    "date": "YYYY-MM-DD oppure vuoto",
    "time": "HH:MM oppure vuoto",
    "session": "m oppure p oppure n oppure vuoto",
    "note": "nota breve"
  }
  oppure
  {
    "type": "create_client",
    "name": "nome gestionale cliente",
    "ragioneSociale": "ragione sociale per fattura",
    "address": "indirizzo completo",
    "comune": "comune",
    "cap": "CAP",
    "provincia": "provincia",
    "piva": "partita IVA",
    "cf": "codice fiscale",
    "sdi": "codice SDI"
  },
  "actions": [] oppure lista di azioni create_intervention/create_client se ci sono piu' operazioni,
  "learn": []
}
`;
}

function buildUserPayload(reqBody) {
  const context = reqBody.context || {};
  const catalog = compactCatalog(context);
  const memory = recentMemory(context);

  return {
    messaggio: safeText(reqBody.input, MAX_INPUT_CHARS),
    utente: context.user || null,
    data_ora_backend: new Date().toISOString(),
    catalogo_aziende: catalog.aziende,
    catalogo_prestazioni: catalog.prestazioni,
    memoria_recente_cloud: memory,
    istruzioni_e_appunti_frontend: safeText(reqBody.system, 10000),
    impostazioni_ai: reqBody.settings || {},
    contatori_gestionale: context.counts || {},
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
  return { reply: text || 'Non ho capito. Scrivimi il caso o il comando in una frase.', action: null, learn: [] };
}

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'Rural Vet AI backend', model: MODEL });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'rural-vet-ai', model: MODEL, time: new Date().toISOString() });
});

app.post('/api/vet-ai-chat', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        reply: 'Backend attivo, ma manca OPENAI_API_KEY. Inseriscila nelle variabili ambiente del servizio.',
        action: null,
        learn: []
      });
    }

    const body = req.body || {};
    const payload = buildUserPayload(body);

    const history = asArray(body.conversation)
      .slice(-5)
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: safeText(m.content || m.text, 1500)
      }))
      .filter(m => m.content);

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: toOpenAIContent(payload, body.image) }
    ];

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.15,
      response_format: { type: 'json_object' },
      messages
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    const parsed = cleanJson(raw);

    res.json({
      reply: safeText(parsed.reply || 'Dimmi meglio cosa vuoi fare.', 3000),
      action: parsed.action || null,
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 10) : [],
      learn: Array.isArray(parsed.learn) ? parsed.learn.slice(0, 8) : [],
      usage: completion.usage || null,
      model: MODEL
    });
  } catch (err) {
    console.error('Errore /api/vet-ai-chat', err);
    res.status(500).json({
      reply: 'Errore backend AI. Controlla chiave OpenAI, modello e log del server.',
      action: null,
      learn: [],
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Rural Vet AI backend v3 attivo sulla porta ${PORT} con modello ${MODEL}`);
});
