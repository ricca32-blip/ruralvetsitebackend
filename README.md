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
