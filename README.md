# Orizon · Assistente CO₂ per i viaggi

Assistente conversazionale che stima la CO₂ prodotta dal **trasporto dei bagagli** durante un viaggio.
L'utente descrive il viaggio a parole (mezzo, origine, destinazione, peso dei bagagli) e l'agente
raccoglie i dati mancanti, chiama il servizio **EcoFreight CO₂ Emissions API** e spiega il risultato
in modo semplice, con un consiglio per viaggiare in modo più sostenibile.

Progetto realizzato per **Orizon**, agenzia di viaggi specializzata in turismo responsabile.

🔗 **App online:** https://lucent-meringue-a805c5.netlify.app  
_(al primo accesso il server gratuito può impiegare fino a un minuto a rispondere)_

---

## Architettura

```
Utente (browser)
   │
   ▼
FRONT END · React + Vite (Netlify)
   │  POST /api/chat { conversationId, message }
   ▼
BACK END · Node.js + Express (Render)
   ├── Agente (OpenAI, function calling) ── system prompt "contratto"
   │        │
   │        └── tool calcola_co2_viaggio ──► EcoFreight API (/location + /calculate)
   │
   └── Memoria conversazioni ──► MongoDB Atlas
```

- **Agente mono-agente, goal-based:** l'obiettivo è raccogliere 4 dati (slot filling) e poi calcolare.
  Un solo strumento e un solo obiettivo: un sistema multi-agente non porterebbe benefici.
- **Un solo endpoint** (`POST /api/chat`), come richiesto: riceve il messaggio, recupera la cronologia
  dal database, esegue l'agente e salva il nuovo turno. Senza `message` restituisce solo la cronologia
  (serve al front end per ripristinare la chat dopo un ricaricamento).
- **Ciclo ReAct/TAO:** il modello decide se chiedere un dato mancante o usare lo strumento; il codice
  esegue lo strumento e restituisce il risultato al modello, fino alla risposta finale (max 5 giri).
- **Memoria persistente:** ogni conversazione è un documento MongoDB con l'intera cronologia
  (messaggi, richieste di strumento e risultati), così l'agente ricorda i dati già forniti.

## Struttura del repository

```
backend/
├── server.js            → endpoint POST /api/chat (Express)
├── db.js                → memoria conversazioni (MongoDB Atlas)
├── agent/
│   ├── agent.js         → ciclo agente + function calling (OpenAI)
│   └── systemPrompt.js  → system prompt (schema "contratto")
├── tools/
│   └── ecofreight.js    → strumento EcoFreight (risoluzione luoghi + calcolo)
├── test-ecofreight.js   → test dello strumento
└── test-agente.js       → chat di prova da terminale
frontend/
├── src/App.jsx          → interfaccia chat
└── src/App.css
```

## Scelte tecniche principali

| Scelta | Motivo |
|---|---|
| Strumenti deterministici, non codice generato dall'LLM | Prevedibilità, testabilità e sicurezza |
| Risoluzione dei luoghi con `/location` prima del calcolo | Nei test, `/calculate` con un nome inesistente "indovinava" un luogo senza segnalare errori |
| Calcolo con coordinate esatte | Elimina l'ambiguità del testo libero |
| Omonimi (es. Paris: Francia/USA) segnalati senza bloccare | Chiedere ogni volta "quale città?" peggiorava l'esperienza; l'utente può correggere indicando il paese |
| Aereo con `belly_cargo` | I bagagli viaggiano nella stiva di un volo passeggeri |
| `enum` sul mezzo di trasporto + schema `strict` | Il modello può scegliere solo valori gestiti dal codice |
| Chiavi solo nel back end (`.env`) | Il browser non vede mai le credenziali |
| Front end React leggero (senza Shadcn) | La traccia richiede solo una chat: meno dipendenze, meno rischi |

## Limiti noti

- **Il calcolo riguarda i bagagli, non il viaggiatore.** EcoFreight è un'API per il trasporto merci:
  stima la CO₂ di un certo peso lungo una tratta (metodologia GLEC v3.2 / ISO 14083). L'agente lo
  dichiara sempre.
- **Per l'aereo il valore è una ripartizione media** delle emissioni dell'intero aereo in base al peso,
  e include gli effetti del volo in quota (fattore 1,9). Per questo può sembrare alto anche per una
  sola valigia; l'agente lo spiega all'utente.
- **Auto e pullman** usano i fattori dei mezzi stradali merci: è un'approssimazione.
- Il piano gratuito di Render mette il server in pausa dopo inattività: la prima risposta può
  richiedere fino a un minuto.

## Sviluppi futuri

- Aggiungere un secondo strumento con un'API per passeggeri (es. emissions.dev) e sommare la CO₂
  della persona a quella dei bagagli, per una stima dell'impronta completa del viaggio.
- Confronto automatico tra mezzi (es. aereo vs treno sulla stessa tratta).

## Avvio in locale

Prerequisiti: Node.js 20+, chiavi EcoFreight e OpenAI, un cluster MongoDB Atlas (facoltativo in locale:
senza `MONGODB_URI` viene usata una memoria temporanea).

```bash
# Back end
cd backend
cp .env.example .env      # poi inserisci le tue chiavi
npm install
npm start                 # http://localhost:3000

# Front end (in un secondo terminale)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

## Esempi di conversazione testati

- *"Vado da Roma a Bangkok in aereo"* → l'agente chiede il peso → *"23 kg"* → 371,73 kg di CO₂ (9.086 km)
- *"E da Milano a Parigi in treno?"* → ricorda i 23 kg → 0,63 kg di CO₂ (895 km)
- *"Quanto costa il volo?"* → escalation: rimanda all'agenzia Orizon
