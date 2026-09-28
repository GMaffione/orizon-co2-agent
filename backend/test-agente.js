// =============================================================
// Chat di prova da terminale (da lanciare con: node test-agente.js)
// -------------------------------------------------------------
// Serve a provare l'agente PRIMA di costruire l'interfaccia web.
// La memoria qui è provvisoria: la cronologia vive in una variabile e si
// perde quando chiudi il programma. Nel Blocco 4 la sposteremo su MongoDB.
// Per uscire scrivi: esci
// =============================================================

import "dotenv/config";
import readline from "node:readline/promises";
import { eseguiAgente } from "./agent/agent.js";

const terminale = readline.createInterface({ input: process.stdin, output: process.stdout });
const cronologia = []; // memoria provvisoria della conversazione

console.log("Chat con l'assistente Orizon — scrivi 'esci' per terminare.\n");

while (true) {
  const testo = await terminale.question("Tu: ");
  if (testo.trim().toLowerCase() === "esci") break;

  cronologia.push({ role: "user", content: testo });

  try {
    const { risposta, nuoviMessaggi, chiamateStrumento } = await eseguiAgente(cronologia);

    // Mostriamo le chiamate allo strumento, per vedere cosa ha deciso l'agente
    for (const c of chiamateStrumento) {
      console.log(`\n  [STRUMENTO] argomenti: ${c.argomenti}`);
      console.log(`  [STRUMENTO] risultato: ${JSON.stringify(c.risultato)}`);
    }

    console.log(`\nAssistente: ${risposta}\n`);
    cronologia.push(...nuoviMessaggi); // aggiorniamo la memoria provvisoria
  } catch (e) {
    // Errori dell'API OpenAI (chiave sbagliata, credito esaurito, rete...)
    console.log(`\n[ERRORE] ${e.message}\n`);
    cronologia.pop(); // togliamo il messaggio rimasto senza risposta
  }
}

terminale.close();
