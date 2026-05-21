# Rural Vet AI PRO backend

Questo backend e' il ponte tra il gestionale Rural Vet e OpenAI.
La chiave OpenAI resta qui, non dentro `Index.html`.

## Cosa fa

- riceve messaggi, foto e contesto dal gestionale;
- legge aziende, prestazioni, appunti e memoria recente inviati dal frontend;
- chiama OpenAI;
- risponde in stile breve e interattivo;
- prepara azioni operative, per esempio inserire interventi;
- restituisce eventuali nuove informazioni da salvare nella memoria AI del gestionale.

## Dove si salva la conoscenza?

Per questa versione la conoscenza si salva nel cloud che usi gia': JSONbin.
Nel backup del gestionale vengono aggiunti questi campi:

- `db.cfg.ai`: endpoint backend, stile di risposta, appunti e protocolli scritti da te;
- `db.cfg.aiMemory`: memoria appresa durante l'uso, correzioni, preferenze e interventi salvati;
- `db.int`: interventi creati o confermati dal chatbot.

OpenAI non e' il tuo database. OpenAI riceve il contesto a ogni richiesta e risponde.
La memoria stabile resta nel tuo gestionale/cloud.

## Avvio locale

```bash
npm install
cp .env.example .env
# apri .env e inserisci OPENAI_API_KEY
npm start
```

Endpoint locale da inserire nel gestionale:

```txt
http://localhost:3000/api/vet-ai-chat
```

## Deploy consigliato su Render

1. Crea un nuovo repository GitHub con questa cartella.
2. Vai su Render e crea un nuovo Web Service.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Health check path: `/api/health`.
6. Environment variables:
   - `OPENAI_API_KEY`: la tua chiave OpenAI;
   - `OPENAI_MODEL`: `gpt-4o-mini` per iniziare;
   - `ALLOWED_ORIGIN`: `*` in test, poi il dominio del gestionale.
7. Copia l'URL pubblico del servizio, per esempio:

```txt
https://rural-vet-ai-backend.onrender.com/api/vet-ai-chat
```

8. Apri Rural Vet AI > Appunti > Endpoint backend AI e incolla l'URL.

## Comandi supportati

Esempi:

```txt
Ho fatto un cesareo da Arata e due fecondazioni
```

Il backend prepara l'azione. Il gestionale chiede conferma. Scrivendo:

```txt
SALVA
```

il frontend registra l'intervento nel gestionale e salva la memoria nel cloud.

```txt
Ricorda: nelle metriti post parto voglio sempre che mi chieda odore dello scolo, temperatura e BHBA.
```

La memoria viene salvata nel JSONbin del gestionale.

## Nota privacy

Il backend invia a OpenAI il messaggio dell'utente, gli appunti rilevanti, la memoria recente e il catalogo necessario per capire aziende/prestazioni. Non mettere dati non necessari negli appunti.
