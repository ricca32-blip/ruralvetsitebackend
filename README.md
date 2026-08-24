# Rural Vet — Gestionale + Rural Vet AI · v9.1.0

Gestionale veterinario buiatrico con assistente AI integrato, ripensato da zero
nella parte AI: **autenticazione vera, motore KM deterministico, gestione
completa del listino prestazioni, modifiche agli interventi con PRIMA/DOPO,
test comportamentali**.

Il vincolo "incolla e vai" è mantenuto: **un solo `index.html`** (GitHub Pages)
e **un solo `server.js`** (Render).

---

## Correzioni v9.1 (bugfix su v9)

**Sicurezza e coerenza col design dichiarato.**
- La **master key JSONBin è stata davvero rimossa dall'HTML**: la v9 la
  dichiarava fuori dal client ma il "canale diretto" di fallback la teneva
  ancora incorporata. Ora il sync cloud passa solo dal backend autenticato
  (`/api/db/load` / `/api/db/save`); offline si lavora sulla copia locale del
  browser. Dopo il deploy **ruota la vecchia chiave su jsonbin.io**.
- **Login backend-first**: il controllo hash locale non è più un blocco che
  precede il backend, quindi gli override password `RV_USER_<ID>_PASS` su
  Render ora funzionano davvero; l'hash locale resta solo come fallback
  offline (AI e cloud disattivati).
- **Protezione brute force sul login** (max 8 tentativi falliti/10 minuti per
  IP+utente) e warning nei log se `RV_AUTH_OPTIONAL=true`.
- **Scope worker su tutte le letture**: prima valeva solo per i KM; ora anche
  ricavi/interventi/analisi di un collega vengono riportati ai propri dati,
  con nota esplicita nella risposta.

**Bug numerici e di parsing (colpivano i dati mostrati).**
- `num()`: **"12.4" veniva letto 124** (il punto era sempre trattato come
  separatore delle migliaia). Corretto con euristica italiana: "1.234,56" →
  1234,56; "12.4" → 12,4.
- **Orari letti come date**: "alle 12.30" generava una finta data con
  rollover silenzioso (finiva in un periodo del 2028). Giorno e mese ora sono
  validati e gli orari introdotti da "alle/ore" vengono ignorati.
- **Pagina Km allineata all'AI**: due interventi nella stessa azienda nello
  stesso giro non contano più doppio nemmeno nella pagina Km (il fix v9 c'era
  solo nel motore kmRoutes usato dalla chat: pagina e AI davano totali
  diversi).
- La pagina Km **salva in cloud solo se la cache km è cambiata** (prima ogni
  apertura lanciava un salvataggio completo del DB).

**Robustezza.**
- La suite di test **non dipende più dal giorno di esecuzione**: i test HTTP
  fissano l'orologio via `context.now`, onorato dal backend solo con
  `NODE_ENV=test`. La suite passa 76/76 (72 originali + 4 regressioni nuove).
- `isDeleteRequest` aveva un pattern sempre vero: qualunque "annulla/togli…"
  partiva come eliminazione intervento. Ora serve un oggetto reale.
- Preflight CORS coerente con `ALLOWED_ORIGIN`; alias `/api/ai` e `/api/chat`
  registrati senza usare l'API interna di Express; l'eliminazione con più
  interventi candidati include `options` come la modifica; un ping fallito al
  backend (cold start Render) non blocca più la sessione in modalità locale.

**Ordine di aggiornamento v9.1**: prima il backend, poi l'HTML. Con l'HTML
v9.1 e il backend spento il gestionale funziona in locale ma senza sync cloud
(per design: la chiave non è più nel client).

---

## Cosa cambia nella v9 (in breve)

**1. Accessi e permessi sul serio.**
Il login ora passa dal backend: `POST /api/auth/login` verifica la password
(lato server, come hash) ed emette un token firmato valido 12 ore. Tutte le
chiamate AI e il sync cloud richiedono il token. **Edoardo Ronda riceve HTTP
403 anche chiamando l'endpoint direttamente**, e l'identità dichiarata dal
client non conta più nulla: fa fede solo il token (niente impersonificazioni).
Le password non sono più scritte in chiaro nell'HTML (restano solo gli hash per
il fallback offline). Se il backend è irraggiungibile il gestionale funziona
lo stesso in locale, ma l'AI resta disattivata.

**2. I KM via AI adesso funzionano davvero.**
Prima il frontend inviava all'AI un elenco tratte sempre vuoto (`ctx.km = []`):
qualunque risposta sui km era rotta per costruzione. Ora il gestionale
**materializza le tratte** in `db.kmRoutes` per ogni giorno/utente (ricalcolo
automatico quando gli interventi cambiano) e il backend le usa con una
gerarchia di fonti dichiarata e mai sommata: tratte registrate → km salvati
sugli interventi → stima dalla distanza azienda (andata e ritorno, sempre
etichettata come *stima*). Record sporchi (senza data, km negativi o oltre
400 km) vengono esclusi e riportati. Il totale, il periodo, la fonte e lo
scope (personale/societario) sono sempre visibili nella risposta. Corretto
anche un bug storico: due interventi nella stessa azienda nello stesso giro
non generano più una tratta doppia.

**3. Gestione prestazioni completa.**
Creazione guidata (chiede il prezzo mancante, controlla i duplicati), modifica
con blocco PRIMA/DOPO e impatto dichiarato ("le aziende con prezzo
personalizzato non cambiano; lo storico resta invariato"), no-op riconosciuti
("è già impostato così"), prezzi personalizzati per azienda anche in rimozione,
**archiviazione** motivata per le voci usate nello storico (mai cancellazione
fisica), eliminazione reversibile 30 giorni per le voci mai usate, ripristino.
Dentro gli interventi: aggiunta/rimozione di quantità, sostituzioni totali e
parziali ("sostituisci una delle due fecondazioni con un'ecografia"),
correzione del prezzo di riga, fusione delle righe uguali e totali ricalcolati,
sempre con PRIMA/DOPO e conferma SALVA/ELIMINA. Ogni record ha una versione
(`_v`): se i dati cambiano tra proposta e conferma, la modifica viene rifiutata
invece di sovrascrivere alla cieca.

**4. Test veri.**
`test-ai-flow.js` non controlla più che il sorgente "contenga certe stringhe":
è una suite comportamentale con dataset realistico (76 test) che copre parser
date, motore KM, listino, operazioni di riga, token e chiamate HTTP reali
all'endpoint (incluso il 403 di Edoardo).

### Decisione architetturale dichiarata
Il backend **autorizza, valida, firma e versiona** ogni operazione; l'azione
validata viene poi applicata dal frontend al database locale e sincronizzata
in cloud. Ho scelto questo modello ibrido (invece dell'applicazione diretta
lato server) per preservare il funzionamento offline del gestionale e perché
Render è stateless: le bozze in corso sono blob **firmati HMAC** che il client
non può alterare senza invalidarli. Le modifiche fatte via AI finiscono in un
registro (`db.auditLog`, ultime 500).

---

## Deploy (incolla e vai)

**Backend (Render):**
1. Sostituisci `server.js` nel repository collegato a Render (insieme a
   `package.json` e `render.yaml` se non li hai già).
2. Nelle variabili d'ambiente imposta: `OPENAI_API_KEY`, `JSONBIN_BIN_ID`,
   `JSONBIN_API_KEY` e **`RV_AI_SECRET`** (stringa lunga e casuale).
3. Consigliato: `ALLOWED_ORIGIN` = l'indirizzo esatto del tuo GitHub Pages.

**Frontend (GitHub Pages):**
1. Sostituisci `index.html` con quello nuovo. Fine.

**Password:** restano quelle attuali (Rural Vet `2026`, Medardo `1996`,
Edoardo `0000`). Per cambiarle senza toccare i file usa le variabili
`RV_USER_<ID>_PASS` su Render (es. `RV_USER_MEDARDO_PASS`). I collaboratori
aggiunti da Rural Vet continuano a funzionare come prima.

**Ordine di aggiornamento:** prima il backend, poi l'HTML. Con il backend v9 e
l'HTML vecchio, l'AI risponderebbe "sessione assente" finché non aggiorni la
pagina (il gestionale in sé continua a funzionare).

---

## Endpoint principali

| Endpoint | Auth | Descrizione |
|---|---|---|
| `POST /api/auth/login` | — | `{userId, password}` → `{token, user, aiAccess}` |
| `GET /api/auth/me` | token | Stato sessione |
| `POST /api/vet-ai-chat` | token **+ AI abilitata** | Chat AI (Edoardo → 403) |
| `GET /api/db/load` · `POST /api/db/save` | token | Proxy sync JSONBin |
| `GET /api/health` | — | Health check |

Contratto di risposta della chat: `{ ok, reply, data, action, quickReplies,
ui }` dove `ui.scope` dichiara sempre l'ambito (personale/societario) e, per i
KM, `data` include periodo, totale, fonte, flag stima, esclusioni e confronto.

## Test

```bash
npm install
npm test        # esegue test-ai-flow.js: 76 test comportamentali
```

## Note operative

### Pulizia visite di prova (v9.1.1)
In **Impostazioni** (profilo Rural Vet) c'è la card **"Pulizia visite di
prova"** con un solo pulsante: **Elimina tutte le visite di prova**. Cancella
in un colpo interventi, fatture, tratte km, diario AI e cestino listino.
**Aziende, listino, collaboratori e impostazioni restano intatti** (le aziende
sono dati reali e non vengono toccate). Prima della pulizia viene scaricato
automaticamente un backup completo e la numerazione fatture riparte da 1.
Le eliminazioni sono registrate in `db.deleted`: il merge multi-dispositivo
non le fa risorgere da copie cloud o locali vecchie. È stata inoltre rimossa
la semina automatica delle aziende iniziali a ogni caricamento (serviva solo
al primissimo avvio e faceva ricomparire un'azienda anche dopo
un'eliminazione volontaria): nessuna azienda esistente viene modificata.

- Le voci di listino **archiviate** spariscono dai selettori dei nuovi
  interventi ma restano leggibili nello storico; si ripristinano anche via AI
  ("ripristina la prestazione X").
- Le eliminazioni di voci mai usate finiscono in `db.tombstones` (cestino,
  30 giorni).
- La chiave OpenRouteService nell'HTML storico e la vecchia master key JSONBin
  sono da considerare compromesse: ruotale appena possibile.
