// =============================================================
// Server del back end (Express)
// -------------------------------------------------------------
// Espone UN SOLO endpoint, come richiesto dalla traccia:
//
//   POST /api/chat
//   corpo:    { conversationId?: string, message?: string }
//   risposta: { conversationId, risposta, cronologia }
//
// - Senza conversationId → ne crea uno nuovo (nuova conversazione).
// - Con conversationId   → recupera dal database tutta la conversazione,
//                          così l'agente ricorda i dati già forniti.
// - Senza message        → non chiama l'agente: restituisce solo la
//                          cronologia salvata (serve al front end per
//                          ripristinare la chat dopo un ricaricamento).
// =============================================================

import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { eseguiAgente } from "./agent/agent.js";
import { connettiDatabase, caricaConversazione, aggiungiMessaggi } from "./db.js";

const app = express();
app.use(express.json());
// CORS: permette al front end (su un altro indirizzo, es. Netlify) di
// chiamare questo server. FRONTEND_URL limita l'accesso a quel solo sito.
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));

// Dalla cronologia completa teniamo solo ciò che l'utente deve vedere:
// i suoi messaggi e le risposte testuali dell'assistente (non gli strumenti).
function cronologiaVisibile(messaggi) {
  return messaggi
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: m.content }));
}

app.post("/api/chat", async (req, res) => {
  const { conversationId, message } = req.body ?? {};
  const id = conversationId || randomUUID();

  try {
    const messaggiSalvati = await caricaConversazione(id);

    // Solo recupero della cronologia (nessun nuovo messaggio)
    if (!message || !message.trim()) {
      return res.json({ conversationId: id, risposta: null, cronologia: cronologiaVisibile(messaggiSalvati) });
    }

    const messaggioUtente = { role: "user", content: message.trim() };
    const { risposta, nuoviMessaggi } = await eseguiAgente([...messaggiSalvati, messaggioUtente]);

    // Salviamo nel database il messaggio dell'utente + tutto il turno dell'agente
    await aggiungiMessaggi(id, [messaggioUtente, ...nuoviMessaggi]);

    res.json({
      conversationId: id,
      risposta,
      cronologia: cronologiaVisibile([...messaggiSalvati, messaggioUtente, ...nuoviMessaggi]),
    });
  } catch (e) {
    console.error("Errore in /api/chat:", e);
    res.status(500).json({
      conversationId: id,
      errore: "Si è verificato un problema temporaneo. Riprova tra qualche istante.",
    });
  }
});

// Pagina di controllo: aprendo l'indirizzo del server nel browser si vede
// subito se è acceso (utile dopo il deploy su Render).
app.get("/", (req, res) => res.send("Server Orizon CO₂ attivo ✅"));

const PORTA = process.env.PORT || 3000;
await connettiDatabase();
app.listen(PORTA, () => console.log(`🚀 Server in ascolto su http://localhost:${PORTA}`));
