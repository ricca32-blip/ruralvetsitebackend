# Rural Vet AI backend v5

Backend PRO per collegare Rural Vet AI a OpenAI e al gestionale.

## Novita v5

- Risposte gestionali piu sicure: per dashboard, P.IVA, CF, SDI, indirizzi, ricavi, fatture, interventi, listino e km il backend usa prima i dati reali ricevuti dal gestionale.
- Se un dato non e presente nel contesto, non lo inventa.
- Risposte piu rapide per domande contabili/anagrafiche: molte vengono calcolate direttamente dal backend senza chiamare OpenAI.
- OpenAI resta usato per linguaggio naturale, casi ambigui, clinica, immagini e comandi operativi complessi.
- Migliorata la gestione delle casistiche da assistente operativo: inserimento interventi, eliminazione interventi, creazione clienti, domande su fatturato, pagamenti, km, listino, clienti e dashboard.
- Validazione delle azioni: se OpenAI restituisce un id cliente/prestazione/intervento non presente nel contesto, il backend lo svuota per evitare salvataggi errati.

## Variabili ambiente Render

```txt
OPENAI_API_KEY=la_tua_chiave
OPENAI_MODEL=gpt-4o-mini
ALLOWED_ORIGIN=*
```

Facoltative:

```txt
OPENAI_TIMEOUT_MS=24000
MAX_INPUT_CHARS=7000
```

## Endpoint

Health:

```txt
/api/health
```

Chat:

```txt
/api/vet-ai-chat
```

## Strategia anti-stupidate

Per le domande tipo:

- qual e la P.IVA di Gramigna?
- quanto ha fatturato Medardo da inizio anno?
- quanti interventi ho fatto oggi?
- quanto e da pagare?
- dammi la giornata di Edoardo
- quanti km ha fatto Medardo?

il backend calcola direttamente dai dati del gestionale quando il frontend li invia nel payload.
OpenAI non deve inventare numeri.

## Aggiornamento su GitHub/Render

1. Decomprimi questo zip.
2. Sostituisci nel repository GitHub del backend tutti i file.
3. Commit su `main`.
4. Render fara il redeploy automatico.
5. Testa:

```txt
https://rural-vet-ai.onrender.com/api/health
```

Deve indicare `version: 5.0.0`.
