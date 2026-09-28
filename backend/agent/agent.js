// =============================================================
// Agente: LLM + tool calling
// -------------------------------------------------------------
// Qui vive il "cervello" dell'agente. La funzione eseguiAgente riceve
// la cronologia della conversazione e restituisce la risposta.
//
// Come funziona (ciclo ReAct / TAO, mappa 05_cicli_agente):
//   1. manda all'LLM: system prompt + cronologia + descrizione dello strumento
//   2. l'LLM decide: rispondere subito (es. per chiedere un dato mancante)
//      OPPURE chiedere di usare lo strumento
//   3. se chiede lo strumento: lo eseguiamo NOI e gli ridiamo il risultato
//   4. si torna al punto 2, finché l'LLM non produce la risposta finale
//
// Nota: l'LLM non chiama mai direttamente EcoFreight. "Chiede" di usare
// lo strumento con certi argomenti, e siamo noi a eseguire il codice.
// =============================================================

import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { calcolaCo2Viaggio } from "../tools/ecofreight.js";

// Il client legge da solo OPENAI_API_KEY dalle variabili d'ambiente (.env)
const openai = new OpenAI();

// Numero massimo di giri del ciclo: evita loop infiniti (e costi) nel caso
// in cui il modello continui a chiedere lo strumento senza mai rispondere.
const MAX_ITERAZIONI = 5;

// -------------------------------------------------------------
// Descrizione dello strumento per l'LLM (function calling)
// -------------------------------------------------------------
// È la "scheda tecnica" che il modello legge per sapere che lo strumento
// esiste, a cosa serve e quali argomenti vuole. Il campo "enum" obbliga il
// modello a scegliere il mezzo solo tra i valori che il nostro codice conosce.
const STRUMENTI = [
  {
    type: "function",
    function: {
      name: "calcola_co2_viaggio",
      description:
        "Calcola i kg di CO₂ prodotti dal trasporto di un certo peso di bagagli " +
        "da un'origine a una destinazione con un mezzo di trasporto. " +
        "Da usare solo quando si conoscono tutti e 4 i dati.",
      parameters: {
        type: "object",
        properties: {
          mezzo: {
            type: "string",
            enum: ["aereo", "treno", "auto", "pullman", "nave", "traghetto"],
            description: "Mezzo di trasporto. Es. 'macchina' diventa 'auto', 'bus' diventa 'pullman'.",
          },
          origine: {
            type: "string",
            description: "Luogo di partenza come scritto dall'utente, con il paese solo se l'utente lo ha indicato.",
          },
          destinazione: {
            type: "string",
            description: "Luogo di arrivo come scritto dall'utente, con il paese solo se l'utente lo ha indicato.",
          },
          peso_kg: {
            type: "number",
            description: "Peso totale dei bagagli in kg, come indicato dall'utente.",
          },
        },
        required: ["mezzo", "origine", "destinazione", "peso_kg"],
        additionalProperties: false,
      },
      strict: true, // il modello deve rispettare esattamente lo schema
    },
  },
];

// -------------------------------------------------------------
// Esecuzione di UNA richiesta di strumento fatta dal modello
// -------------------------------------------------------------
async function eseguiStrumento(chiamata) {
  if (chiamata.function.name !== "calcola_co2_viaggio") {
    return { ok: false, errore: `Strumento sconosciuto: ${chiamata.function.name}` };
  }
  try {
    // Il modello manda gli argomenti come testo JSON: li trasformiamo in oggetto
    const argomenti = JSON.parse(chiamata.function.arguments);
    return await calcolaCo2Viaggio(argomenti);
  } catch (e) {
    return { ok: false, errore: "Argomenti dello strumento non leggibili: riprova." };
  }
}

// -------------------------------------------------------------
// Funzione principale
// -------------------------------------------------------------
// cronologia: array di messaggi { role, content, ... } della conversazione,
//             già comprensivo dell'ultimo messaggio dell'utente.
// Restituisce:
//   - risposta: il testo finale da mostrare all'utente
//   - nuoviMessaggi: tutti i messaggi prodotti in questo turno (richieste di
//     strumento, risultati, risposta finale). Serviranno alla memoria
//     (Blocco 4) per salvare la conversazione completa.
//   - chiamateStrumento: elenco sintetico delle chiamate fatte (per i log)
export async function eseguiAgente(cronologia) {
  const nuoviMessaggi = [];
  const chiamateStrumento = [];

  for (let giro = 1; giro <= MAX_ITERAZIONI; giro++) {
    const completamento = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...cronologia, ...nuoviMessaggi],
      tools: STRUMENTI,
    });

    const messaggio = completamento.choices[0].message;
    nuoviMessaggi.push(messaggio);

    // Caso 1: il modello NON chiede strumenti → questa è la risposta finale
    if (!messaggio.tool_calls || messaggio.tool_calls.length === 0) {
      return { risposta: messaggio.content, nuoviMessaggi, chiamateStrumento };
    }

    // Caso 2: il modello chiede uno o più strumenti → li eseguiamo
    for (const chiamata of messaggio.tool_calls) {
      const risultato = await eseguiStrumento(chiamata);
      chiamateStrumento.push({ argomenti: chiamata.function.arguments, risultato });

      // Restituiamo il risultato al modello, collegato alla sua richiesta
      // tramite tool_call_id, così sa a quale chiamata si riferisce
      nuoviMessaggi.push({
        role: "tool",
        tool_call_id: chiamata.id,
        content: JSON.stringify(risultato),
      });
    }
    // ...e si ricomincia il giro: il modello ora legge il risultato
  }

  // Se arriviamo qui, il modello ha superato il numero massimo di giri
  const fallback = "Mi dispiace, non sono riuscito a completare il calcolo. Puoi riprovare riformulando la richiesta?";
  nuoviMessaggi.push({ role: "assistant", content: fallback });
  return { risposta: fallback, nuoviMessaggi, chiamateStrumento };
}
