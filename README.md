# Rural Vet AI backend + gestionale v8

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
