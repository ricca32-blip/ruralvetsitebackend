# Rural Vet AI backend + gestionale v8

## v8.12 - Incolla e basta + AI blindata per ogni evenienza

Versione **8.12.0**. Pensata per il deploy "copia-incolla": **bastano 2 file**, nessun'altra modifica.

### Deploy in 2 mosse (zero configurazione aggiuntiva)

1. **Repo del sito (GitHub Pages)** → incolla `index.html` al posto del vecchio. Fine.
2. **Repo del backend (Render)** → incolla `server.js` al posto del vecchio. Fine. Funziona col `package.json` già presente nel repo backend (stesse dipendenze, nessuna nuova) e con qualsiasi Node: su Node <18 il proxy cloud si disattiva da solo senza rompere nulla.

Tutto il resto (test, render.yaml, .env.example, README) è **facoltativo**: migliora il repo ma non serve per far funzionare l'app. Anche le variabili `JSONBIN_*` restano opzionali: senza, il salvataggio usa il canale attuale; quando le imposterai, il frontend passerà da solo al canale sicuro. Idem `OPENAI_API_KEY`: senza chiave il gestionale funziona comunque al 100% (vedi sotto).

### AI blindata per ogni evenienza

- **Domande cliniche mai più scambiate per inserimenti**: "Come si cura la mastite in una frisona?" o "Che terapia consigli per una metrite?" non aprono più il wizard intervento (bug reale trovato nei test): vanno alla risposta veterinaria. Gli inserimenti espliciti ("Ho fatto…", "Registra…") restano wizard.
- **Funziona anche senza OpenAI**: se manca `OPENAI_API_KEY` o OpenAI è giù, le domande libere ricevono una risposta chiara con bottoni verso tutto ciò che funziona offline (cockpit, KPI, interventi) — mai più "manca OPENAI_API_KEY su Render" secco. Router deterministico, KPI, grafici, wizard e fatture non dipendono da OpenAI.
- **Small talk offline**: "Ciao", "Grazie", "Chi sei?" ricevono risposta immediata con azioni suggerite; "ciao, quanti ricavi oggi?" risponde coi dati, non col saluto.
- **Comprensione più larga**: sinonimi economici ("quanto ho guadagnato", "incasso", "entrate"), date "dopodomani" e "altroieri".
- **Riprova con un tap**: se la rete o il backend falliscono, sotto il messaggio d'errore compare un bottone "Riprova" che ritrasmette l'ultima richiesta.

### Test nuovi

Small talk (incluso il caso misto saluto+dati), sinonimi, dopodomani, guardia anti-wizard sulle domande cliniche (2 casi + controprova inserimento esplicito), degradazione senza chiave OpenAI chiamando davvero l'endpoint `/api/vet-ai-chat`.

## v8.11 - Interfaccia Rural Vet AI ridisegnata

Versione **8.11.0**. Redesign professionale della chat Rural Vet AI (patch additiva `rv-v811-ai-pro`): la logica dei flussi non è stata toccata, cambia come l'informazione viene presentata.

### Cosa vedi di diverso

- **Design system a token** (colori, raggi, ombre, spaziature coerenti) con palette petrolio/verde già introdotta in v8.8, numeri tabellari per gli importi.
- **Messaggi strutturati invece del testo piatto**: titolo con periodo/ambito separato ("Riepilogo economico · oggi"), righe KPI come card, classifiche con badge numerati, importi/percentuali/KM evidenziati (negativi in rosso), domande finali come suggerimento discreto, SALVA/ELIMINA resi come tasti (ELIMINA in rosso). Il testo è sanificato: nessun HTML del backend viene mai iniettato (test XSS incluso).
- **Header con stato reale**: pallino verde/rosso e versione del backend (ping su `/api/health`, aggiornato max ogni 30s).
- **Quick replies ripensate**: chips scorrevoli in orizzontale su mobile, SALVA verde, ELIMINA rosso, Annulla tratteggiato.
- **Copia messaggio** al passaggio del mouse, **scroll-to-bottom** quando risali la conversazione, composer con focus ring, etichetta "Rural Vet AI" solo sul primo messaggio di un gruppo consecutivo (meno rumore).
- Rispetto di `prefers-reduced-motion`, `aria-label` sulle nuove azioni.

### Come è fatto (per chi mette le mani nel codice)

Il renderer esistente produce i nodi; la patch li **decora** via `MutationObserver` in modo idempotente (`data-rv-pro`). Il formatter è una funzione pura esposta come `window.__rvAiProTest.formatMessage` e coperta da test (titolo+scope, elenchi, classifica, importi, kbd, XSS, negativi).

## v8.10 - Rural Vet AI più capace e UX rifinita

Versione **8.10.0** (include tutta la v8.9 qui sotto).

### Rural Vet AI

- **"Cambia il cesareo di Rossi in visita clinica" ora funziona**: sostituzione puntuale di una singola prestazione (quantità preservata; se la prestazione di destinazione è già presente, le quantità si sommano). L'AI considera solo gli interventi che contengono la prestazione da sostituire.
- **Riepiloghi delle modifiche in italiano**: "Ora: 16:30 · Sessione: pomeriggio · Fatturato: sì" invece di "time: 16:30 · fatt: true".
- **Niente false modifiche**: se chiedi di segnare come fatturato un intervento già fatturato, l'AI risponde "È già così" invece di proporre un salvataggio inutile; "di ieri" usato solo per individuare l'intervento non compare più come cambio di data.

### UX / UI (patch additiva `rv-v810-ux`, nessun layout stravolto)

- **Annulla eliminazione**: dopo aver eliminato un intervento compare per 6 secondi un toast con "Annulla" che lo ripristina (tombstone rimosso e ripristino che vince anche nel merge multi-dispositivo).
- **Toast non bloccanti** per esiti e errori di salvataggio cloud (con promemoria che i dati restano nella copia locale), `aria-live` per gli screen reader.
- **Guardia anti doppio click** generalizzata sui bottoni delle modali e sui bottoni distruttivi.
- **Mobile**: bottoni con area di tocco ≥46px, tabelle scorrevoli in orizzontale con intestazione fissa, input a 16px per evitare lo zoom automatico di iOS.
- **Tastiera e accessibilità**: ESC chiude le modali (con sblocco dello scroll), focus visibile su bottoni e campi, ruoli ARIA su navigazione e dialog.

### Test aggiunti

- Sostituzione prestazione end-to-end (ids e etichetta), riconoscimento no-op, annulla-eliminazione eseguita davvero in sandbox (eliminazione → tombstone → ripristino → updatedAt).

## v8.9 - Sync cloud sicuro, merge multi-dispositivo e fix router

Versione **8.9.0**. Focus: integrità e sicurezza dei dati, senza toccare l'esperienza d'uso.

### Cosa cambia

1. **La chiave JSONBin esce dall'HTML.** Nuovi endpoint backend `/api/db/ping`, `/api/db/load`, `/api/db/save`: il gestionale salva e carica passando dal backend, che tiene `JSONBIN_BIN_ID` e `JSONBIN_API_KEY` in variabili ambiente. Se il backend non è ancora configurato, il frontend torna da solo al vecchio canale diretto: **nulla si rompe** nel frattempo.
2. **Merge multi-dispositivo con timestamp per record.** Prima, a parità di id vinceva sempre la copia locale (anche se non toccata), sovrascrivendo in silenzio le modifiche fatte da un altro dispositivo. Ora ogni record realmente modificato viene marcato con `updatedAt` e nel merge vince il più recente. Le eliminazioni (tombstone) restano rispettate. Senza timestamp il comportamento resta quello storico.
3. **Guardia fatture**: niente fatture vuote (0 interventi) e niente doppia emissione da doppio click, che consumava un numero progressivo.
4. **Fix router Rural Vet AI**: "Km percorsi oggi" non viene più dirottata su "Non trovo quel cliente"; "P.IVA di Rossi" risponde con la P.IVA e non col riepilogo economico; il backend accetta anche `context.interventions` come alias.
5. **Igiene progetto**: `package.json` con script `check`/`test`, `.env.example`, `.gitignore`, `render.yaml` aggiornato (health check + env del proxy), limite JSON ridotto da 60mb a 12mb (configurabile con `JSON_LIMIT`).
6. **Test veri**: `test-ai-flow.js` ora, oltre ai controlli statici, esegue davvero il router con dati finti (KPI con cifre attese esatte, KM, P.IVA, wizard intervento con `safeToApply`, sicurezza eliminazioni), esegue il codice del merge in sandbox (6 casi) e chiama gli endpoint `/api/db/*` senza rete.

### Deploy v8.9 (una volta sola, ~5 minuti)

1. Commit e push dei file su GitHub (vedi messaggio di commit sotto). Render fa il deploy da solo (`autoDeploy: true`).
2. Su **jsonbin.io** genera una **nuova master key** (la vecchia, essendo stata dentro l'HTML pubblico, è da considerare compromessa).
3. Su **Render → Environment** compila `JSONBIN_BIN_ID` (l'id del bin attuale) e `JSONBIN_API_KEY` (la nuova chiave). Con il `render.yaml` aggiornato i due campi vengono richiesti automaticamente.
4. Fine: al prossimo caricamento il gestionale rileva il backend configurato (`/api/db/ping`) e passa da solo al canale sicuro. Nessuna modifica a mano al codice.
5. Solo dopo aver verificato un salvataggio riuscito ("✓ Salvato" senza "(canale diretto)"), **elimina la vecchia chiave** su jsonbin.io.

### Verifica prima del deploy

```bash
npm install
npm test
```

### Messaggio di commit consigliato

```txt
v8.9: sync cloud via backend (chiave fuori dall'HTML), merge multi-dispositivo con timestamp, guardia fatture, fix router KM/P.IVA, test funzionali
```

### Limiti noti e trasparenti

- Finché la vecchia chiave JSONBin non viene ruotata, resta tecnicamente utilizzabile da chi ha il vecchio HTML: la rotazione (passo 2-5) è la parte che chiude davvero la falla.
- Il login profili resta cosmetico (password nel client): protezione da uso improprio, non da un attaccante. Una autenticazione vera è candidata per la v9.
- L'endpoint AI resta aperto (CORS `*`): valuta di impostare `ALLOWED_ORIGIN` all'origine GitHub Pages del frontend.


Versione **8.0.0**. Questa release rende Rural Vet AI molto piu gestionale-first: prima legge e calcola sui dati reali del gestionale, poi usa OpenAI solo quando serve interpretare meglio la richiesta o rispondere a domande cliniche.

## Cosa puo fare da chat

### Interventi

- Inserire interventi da frasi naturali, anche con piu prestazioni nella stessa frase.
- Capire quantita scritte in lettere o numeri: `due fecondazioni`, `3 visite`, `un cesareo`.
- Chiedere data/ora quando mancano e proporre bottoni rapidi: `ADESSO`, `oggi 14:30`, `ieri 09:00`, `SALVA`, `Annulla`.
- Cercare, contare e riepilogare interventi per giorno, mese, anno, cliente, veterinario e prestazione.
- Modificare interventi passati: data, ora, sessione, cliente, prestazioni, note e stato fatturato.
- Eliminare interventi con conferma esplicita `ELIMINA`.

Esempi:

```txt
Ho fatto un cesareo e due fecondazioni da Rossi oggi alle 14:30
Sposta l'intervento di cesareo da Rossi oggi alle 16:30
Cambia prestazione intervento cesareo da Rossi oggi in visita clinica
Aggiungi nota all'intervento di Rossi oggi: vacca 245 agitata
Segna l'intervento di ieri da Rossi come fatturato
Elimina l'intervento di visita da Rossi di ieri
Quanti interventi ho fatto oggi?
Mostrami gli interventi con mastite questo mese
```

### Aziende/clienti

- Cercare dati anagrafici e fiscali: P.IVA, CF, SDI, indirizzo, telefono, email, km.
- Creare nuovi clienti quando mancano.
- Modificare anagrafiche da chat.
- Eliminare clienti solo se non hanno storico collegato.

Esempi:

```txt
Cerca azienda Rossi
P.IVA di Rossi
Crea cliente Azienda Verdi, ragione sociale Azienda Agricola Verdi, indirizzo Via Roma 1, comune Piacenza, CAP 29121, provincia PC, P.IVA 12345678901
Modifica P.IVA cliente Rossi a 98765432109
Modifica indirizzo cliente Rossi in Via Nuova 15 Piacenza
Imposta km cliente Rossi a 18
```

### Listino/prestazioni

- Cercare prezzi.
- Creare nuove voci listino.
- Aggiornare prezzo base.
- Aggiornare prezzo specifico per cliente, quando il gestionale usa prezzi personalizzati.
- Eliminare voci non usate nello storico.

Esempi:

```txt
Prezzo cesareo
Crea prestazione Controllo podale prezzo 45
Prezzo cesareo a 320 euro
Imposta prezzo ecografia per Rossi a 55 euro
Elimina voce listino Controllo podale
```

### Fatture

- Emettere fattura per cliente partendo dagli interventi non fatturati.
- Segnare fatture pagate o da pagare.
- Elencare fatture per periodo, cliente o stato.
- Annullare fatture, rimettendo gli interventi collegati come da fatturare.

Esempi:

```txt
Emetti fattura per Rossi
Segna fattura 10 pagata
Segna fattura 10 non pagata
Mostra fatture aperte questo mese
Annulla fattura 10
```

### Analisi economiche e operative

- Ricavi del giorno, settimana, mese, anno, YTD o intervallo.
- Ricavi per cliente, veterinario, prestazione, giorno o mese.
- Top clienti e top prestazioni.
- Da fatturare, fatture aperte, incassato, scaduto.
- Imponibile e IVA da fatture.
- Medie: ricavo medio per intervento, giorno attivo, fattura media.
- Confronti con periodo precedente.

Esempi:

```txt
Quanti ricavi ho fatto oggi?
Quanto ho fatto da inizio anno?
Ricavi dal 01/05 al 20/05
Top clienti questo mese
Ricavi per prestazione oggi
Ricavi per veterinario da inizio anno
Da fatturare oggi
Fatture scadute
Confronta questo mese col mese precedente
Media ricavo per intervento questo mese
```

### Impostazioni

- Cambiare IVA.
- Cambiare tariffa km per collaboratore.
- Aggiornare dati personali dei collaboratori quando presenti nel gestionale.

Esempi:

```txt
Imposta IVA al 22%
Imposta tariffa km Medardo a 0,55
Cambia email Medardo in medardo@example.com
```

### Risposte veterinarie

Rural Vet AI continua a rispondere anche a casi clinici. Il prompt e stato rinforzato per dare risposte operative: diagnosi probabile, differenziali principali, urgenza, cosa controllare subito e domande mirate. Le decisioni cliniche restano da confermare con visita, protocolli aziendali, normativa, ricetta e tempi di sospensione.

## Bottoni nella chat

Il frontend ora supporta risposte con bottoni rapidi. Il backend puo inviare `quickReplies` e il gestionale mostra chip selezionabili sotto la risposta AI.

Bottoni tipici:

```txt
SALVA
ELIMINA
ADESSO
oggi 14:30
ieri 09:00
Annulla
```

Le modifiche distruttive non vengono applicate automaticamente: Rural Vet AI prepara l'azione e chiede conferma.

## Deploy su Render

Variabili consigliate:

```txt
OPENAI_API_KEY=la_tua_chiave
OPENAI_MODEL=gpt-4o-mini
ALLOWED_ORIGIN=*
```

Health check:

```txt
https://rural-vet-ai.onrender.com/api/health
```

Deve rispondere con:

```txt
version: 8.0.0
```

Debug dati ricevuti dal gestionale:

```txt
POST /api/debug-context
```

Endpoint chat usato dal frontend:

```txt
/api/vet-ai-chat
```

## Verifiche effettuate

- `node --check server.js`
- Controllo sintassi degli script dentro `index.html`
- Test simulati del router gestionale per:
  - ricavi oggi e da inizio anno;
  - top clienti;
  - ricavi per prestazione;
  - da fatturare e fatture scadute;
  - inserimento intervento multi-prestazione;
  - modifica ora intervento;
  - segna intervento fatturato;
  - modifica P.IVA cliente;
  - modifica prezzo listino;
  - creazione voce listino;
  - segna fattura pagata;
  - emissione fattura;
  - modifica IVA.

## Nota importante

L'obiettivo di questa versione e coprire il piu possibile le modifiche umane del gestionale tramite chat. Per sicurezza, le azioni che cambiano dati vengono sempre trasformate in una proposta strutturata e applicate solo dopo `SALVA` o `ELIMINA`.

## Stabilizzazione Rural Vet AI

Questa versione aggiunge una fase di sicurezza per il flusso AI di inserimento interventi.

### Contratto backend/frontend

Le risposte AI possono includere anche:

```json
{
  "ui": {
    "mode": "intervention_wizard",
    "awaiting": "service_choice|company_choice|datetime_choice|note_choice|confirm",
    "draftId": "...",
    "safeToApply": false
  }
}
```

Regole operative:

- `safeToApply` diventa `true` solo quando l'intervento ha azienda reale, prestazioni reali, quantità, data e ora/sessione.
- I click sui bottoni continuano la `pendingInterventionDraft`, invece di essere interpretati come nuove richieste.
- `SALVA` applica solo azioni complete.
- `Annulla` cancella bozza e pending action.

### Debug opzionale

Per vedere il percorso decisionale del backend senza mostrarlo all'utente:

```txt
AI_DEBUG=true
```

Il backend logga intent, step della bozza, action type e stato `safeToApply`.

### Test prima del deploy

Prima di caricare su Render o sostituire i file in produzione, eseguire:

```bash
node --check server.js
node test-ai-flow.js
```

`test-ai-flow.js` verifica sintassi backend, sintassi script frontend e presenza del contratto della bozza intervento.

## Patch AI wizard interventi - revisione ChatGPT

Questa patch rafforza il flusso progressivo per l'inserimento interventi da parte del medico:

- aggiunta riga di avanzamento bozza: azienda, prestazioni, data/ora;
- quick replies dinamiche per scelte azienda e prestazione, con label leggibili e value stabile;
- nuovo step `qty_choice` per modificare rapidamente la quantità della prestazione con `x1`, `x2`, `x3`, `+1`, `-1`;
- nuovo bottone `Aggiungi prestazione` nella conferma finale;
- mantenuti i bottoni di correzione: `Modifica prestazione`, `Modifica azienda`, `Modifica data/ora`, `Aggiungi nota`, `Annulla`;
- migliorata la gestione frontend delle quick replies mentre esiste una `pendingInterventionDraft`;
- resa più robusta la conferma `SALVA` quando la bozza è già completa ma l'azione normalizzata non è ancora pronta lato frontend;
- esteso lo smoke test con controlli sul wizard progressivo e sulle quick replies dinamiche.

Verifiche eseguite dopo la patch:

```bash
node --check server.js
node test-ai-flow.js
```

Nota: il test importa sintassi e contratto bozza; l'esecuzione completa del server richiede le dipendenze del progetto installate (`dotenv`, `express`, `cors`, `helmet`, `openai`).

## Patch AI analytics + interventi - 2026-07-02

Questa revisione porta Rural Vet AI verso i due task richiesti come prioritari:

1. **Dati, KPI e grafici del gestionale**
   - aggiunto contratto `ui.chart`/`chart` dal backend AI;
   - aggiunto rendering grafici nella chat Rural Vet AI del frontend senza librerie esterne;
   - migliorati riepiloghi su ricavi, incassato, da fatturare, fatture aperte/scadute, KPI, medie, top clienti, top prestazioni, andamento mensile/giornaliero;
   - migliorate risposte su KM con grafici per giorno/utente;
   - migliorata anagrafica clienti: conteggio, elenco, campi mancanti come P.IVA/indirizzo;
   - aggiunte quick replies operative: Grafico ricavi, KPI periodo, Top clienti, Top prestazioni, Confronto periodo.

2. **Interventi: aggiunta, modifica, eliminazione**
   - mantenuto e rinforzato il wizard progressivo di creazione intervento;
   - mantenuti pulsanti: SALVA, Aggiungi prestazione, Modifica prestazione, Modifica quantità, Modifica azienda, Modifica data/ora, Aggiungi nota, Annulla;
   - mantenuta conferma obbligatoria prima di salvare o cancellare;
   - il prompt backend è stato riscritto per limitare l'AI ai due task critici e impedire numeri inventati o modifiche senza conferma;
   - Structured UI: `mode=chart`, `mode=analytics`, `mode=intervention_wizard`, `safeToApply`.

Verifica eseguita:

```bash
node --check server.js
node test-ai-flow.js
```

Risultato: smoke test AI flow + analytics/grafici superato.

## Patch Rural Vet AI branding + prompt operativo - 2026-07-02

Questa revisione rinomina l'assistente in **Rural Vet AI** nelle parti visibili del gestionale e rafforza ancora il comportamento AI.

### Modifiche principali

- Branding coerente: le label visibili generiche "AI"/"chat AI" diventano **Rural Vet AI**.
- Header, home card, login card, messaggi, appunti, endpoint e messaggi errore usano il nome Rural Vet AI.
- Backend aggiornato a `8.3.0-rural-vet-ai`.
- Nuovo prompt backend operativo: Rural Vet AI non e una chat generica, ma un assistente gestionale per analytics/KPI/grafici e interventi.
- Nuova funzione `ruralVetAiBriefingQuery`: risponde a richieste tipo "fammi il punto", "situazione", "briefing", "dashboard Rural Vet AI".
- Nuova funzione `managementInsights`: aggiunge insight pratici su trend ricavi, da fatturare, fatture aperte/scadute e km/intervento.
- KPI piu utili: oltre ai numeri base, Rural Vet AI segnala anomalie/azioni prioritarie.
- Test aggiornato per verificare branding, prompt, briefing e assenza di label AI generiche visibili.

### Prompt operativo consigliato

Rural Vet AI deve restare focalizzata su due sole aree: dati gestionali e interventi. Non deve inventare numeri, non deve salvare o cancellare senza conferma e deve usare output JSON strutturato con `reply`, `action/actions`, `quickReplies` e `ui.chart` quando servono grafici.

### Verifica

```bash
node --check server.js
node test-ai-flow.js
```

Risultato atteso:

```text
OK: smoke test Rural Vet AI flow + analytics/grafici superato. Sintassi server/html e contratto verificati.
```

## Patch v8.4 - Rural Vet AI ancora più gestionale

Questa versione rafforza Rural Vet AI su tre punti pratici:

1. **Priorità operative**
   - nuova gestione di richieste come "cosa devo fare", "priorità", "azioni consigliate", "criticità";
   - Rural Vet AI mette in cima fatture scadute, interventi da fatturare, anagrafiche incomplete, anomalie sugli interventi e clienti fermi;
   - restituisce anche un grafico delle priorità operative.

2. **Qualità dati e anagrafiche**
   - nuovo controllo dati mancanti su clienti/anagrafiche: P.IVA, CF, SDI, indirizzo, telefono, email, KM fallback;
   - controllo anomalie sugli interventi: senza ora/sessione, senza prestazione, importo zero;
   - quick replies dedicate: `Controllo dati mancanti`, `Clienti fermi`, `Da fatturare`.

3. **Clienti fermi / aziende inattive**
   - nuova risposta per domande tipo "clienti fermi", "aziende inattive", "clienti da richiamare";
   - calcolo dell'ultimo intervento per cliente;
   - grafico dei giorni trascorsi dall'ultimo intervento.

Verifica eseguita:

```bash
node --check server.js
node test-ai-flow.js
```

Risultato: smoke test Rural Vet AI v8.4 superato.

## v8.5 - Rural Vet AI audit operativo, cash flow e insight

Questa versione rinforza ancora Rural Vet AI come assistente gestionale, non come chat generica.

Nuove capacità principali:

- **Audit gestionale / check-up**: Rural Vet AI calcola uno score operativo 0-100 e mostra subito criticità su fatture scadute, da fatturare, anagrafiche incomplete, interventi anomali, clienti fermi e listino incompleto.
- **Cash flow**: nuova risposta dedicata a cassa, incassi previsti, crediti, fatture da incassare e solleciti, con classifica clienti da incassare.
- **Anomalie interventi**: identifica interventi senza ora/sessione, senza prestazioni, importo zero o cliente mancante.
- **Listino da sistemare**: rileva prestazioni senza prezzo, senza categoria o con prezzo sospetto molto basso.
- **Suggerimenti operativi**: produce prossimi passi concreti sulla base dello stato del gestionale.
- **Insight cards nel frontend**: oltre a grafici e testo, la chat Rural Vet AI ora può mostrare card sintetiche per problemi, score e azioni consigliate.
- **Quick replies più operative**: Audit gestionale, Cash flow, Anomalie interventi, Controllo dati mancanti, Clienti fermi.

Comandi testati:

```bash
node --check server.js
node test-ai-flow.js
```

Risultato atteso:

```text
OK: smoke test Rural Vet AI v8.5 flow + audit/cashflow/insight/anomalie superato.
```

## v8.6 - Rural Vet AI pronta da caricare, cockpit e grafica migliorata

Questa versione è pensata per essere più vicina a una release caricabile: meno chat generica, più assistente operativo visuale.

### Migliorie funzionali Rural Vet AI

- **Cockpit Rural Vet AI**: nuovo comando per avere in una sola risposta score gestionale, ricavi, incassato, da fatturare, fatture aperte/scadute, interventi, prestazioni, ticket medio e prima azione consigliata.
- **Chiusura giornata**: nuovo flusso per fine giornata con interventi del giorno, ricavi, prestazioni, da fatturare e anomalie da controllare.
- **Proiezione mese**: stima matematica del ricavo a fine mese basata sui dati registrati fino a oggi. La risposta specifica sempre che si tratta di proiezione, non di dato certo.
- **Preflight caricamento**: comando di controllo prima del deploy/caricamento, con verifica su backend, clienti, prestazioni, interventi e fatture presenti nel contesto.
- **Card operative consolidate**: i dati principali vengono restituiti sia come testo sia come insight cards e grafici.
- **Prompt ancora più vincolante**: Rural Vet AI deve usare dati reali, evitare invenzioni e non applicare modifiche senza `SALVA` o `ELIMINA` esplicito.

### Migliorie grafiche

- Restyling della chat Rural Vet AI con header più professionale, effetto cockpit, messaggio iniziale con card e comandi rapidi.
- Grafici più leggibili con header, metadati, classifica sotto al grafico e barre più chiare.
- Insight cards più moderne con severità visiva: alta, media, bassa.
- Quick replies aumentate e più operative.
- Placeholder e microcopy più chiari per l'uso gestionale.

### Comandi utili da provare

- `Cockpit Rural Vet AI`
- `Audit gestionale`
- `Chiusura giornata`
- `Proiezione mese`
- `Cash flow`
- `Anomalie interventi`
- `Controllo dati mancanti`
- `Clienti fermi`
- `Inserisci intervento da ...`
- `Modifica intervento di ieri da ...`
- `Elimina intervento di oggi da ...`

### Verifica

```bash
node --check server.js
node test-ai-flow.js
```

Risultato atteso:

```text
OK: smoke test Rural Vet AI v8.6 pronta da caricare + cockpit/grafica/analytics/interventi superato.
```

### Nota onesta

La versione è pronta come pacchetto caricabile lato codice. La qualità finale della Rural Vet AI dipende però anche da tre cose esterne al codice: endpoint backend configurato correttamente, `OPENAI_API_KEY` presente su Render/server, e dati reali passati dal frontend nel payload di contesto. Senza questi tre elementi, nessun prompt può rendere l'AI affidabile.


## v8.7 - Rural Vet AI plus

Migliorie aggiunte in questa iterazione:

- Diagnostica Rural Vet AI: comando `Diagnostica Rural Vet AI` per controllare backend, chiave OpenAI, contesto clienti/prestazioni/interventi, grafici e regole SALVA/ELIMINA.
- KM piu robusti: Rural Vet AI legge prima le tratte KM calcolate e, se assenti, usa i KM salvati sugli interventi.
- Efficienza KM: comando `Efficienza KM` con km totali, km/intervento, ricavi/km e grafico per giorno, cliente o veterinario.
- Performance veterinari: comando `Performance veterinari` con ricavi, interventi, prestazioni e KM per collaboratore.
- Report settimanale/mensile: comando `Report settimanale` o `Report mensile` con score, ricavi, interventi, da fatturare, fatture aperte e priorita.
- Grafica AI migliorata: score meter, statistiche sopra i grafici, quick replies piu operative e card piu leggibili.

Verifica consigliata prima del deploy:

```bash
node --check server.js
node test-ai-flow.js
```

Comandi da provare in chat dopo il caricamento:

- Cockpit Rural Vet AI
- Diagnostica Rural Vet AI
- Report settimanale
- Efficienza KM
- Performance veterinari
- Inserisci intervento
- Modifica intervento
- Elimina intervento


## v8.8 - Rural Vet AI UI compatta e leggibile

Questa versione corregge il problema di leggibilità segnalato nella schermata Rural Vet AI:

- header Rural Vet AI ad alto contrasto con colore petrolio/blu;
- bottoni `Appunti`, `Nuova` e `Chiudi` resi leggibili su desktop e mobile;
- welcome iniziale molto più compatto;
- rimosse le tre card iniziali troppo grandi dalla prima schermata;
- ridotte le funzioni mostrate subito in alto a tre azioni principali: `Cockpit Rural Vet AI`, `Inserisci intervento`, `Grafico ricavi`;
- tutte le altre funzioni restano disponibili digitandole o tramite i flussi generati da Rural Vet AI;
- grafici e pulsanti spostati su una palette petrolio/blu più netta rispetto al verde chiaro precedente.

La parte funzionale v8.7 resta invariata: analytics, interventi guidati, audit, cash flow, efficienza KM, performance veterinari e diagnostica continuano a essere presenti.
