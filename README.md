# Rural Vet AI backend v6

Versione backend-first molto piu robusta per Rural Vet AI.

## Cosa migliora

- Il backend normalizza i dati del gestionale in modo piu completo: clienti, prestazioni, interventi, fatture, utenti, km.
- Per domande gestionali usa prima calcoli deterministici e dati reali, non OpenAI.
- OpenAI viene usata come planner solo quando serve a capire l'intento, ma i numeri finali vengono calcolati dal backend.
- Aggiunto endpoint `/api/debug-context` per controllare quanti dati arrivano davvero dal gestionale.
- Migliorate ricerche fuzzy per cliente, prestazione e collaboratore.
- Supporto migliore per: P.IVA, CF, SDI, indirizzi, listino, fatturato, ricavi, incassato, da pagare, da fatturare, interventi, riepiloghi, km, creazione cliente, creazione intervento, eliminazione intervento.

## Variabili Render

```txt
OPENAI_API_KEY=la_tua_chiave
OPENAI_MODEL=gpt-4o-mini
ALLOWED_ORIGIN=*
```

## Test

Health:

```txt
https://rural-vet-ai.onrender.com/api/health
```

Deve dire `version: 6.0.0`.

Debug dati ricevuti:

```txt
POST /api/debug-context
```

La chat del gestionale manda il payload a `/api/vet-ai-chat`.
