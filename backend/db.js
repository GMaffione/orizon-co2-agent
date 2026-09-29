// =============================================================
// Memoria persistente delle conversazioni (MongoDB Atlas)
// -------------------------------------------------------------
// Ogni conversazione è un documento nella collezione "conversazioni":
//   { _id: "<id conversazione>", messaggi: [...], creataIl, aggiornataIl }
// "messaggi" contiene TUTTO lo scambio con l'LLM (utente, assistente,
// richieste di strumento e loro risultati): è ciò che permette all'agente
// di ricordare i dati già forniti anche dopo un riavvio del server.
//
// Se MONGODB_URI non è impostata (es. prove veloci in locale), si usa una
// memoria temporanea in RAM, con un avviso ben visibile nel terminale.
// =============================================================

import { MongoClient } from "mongodb";
import dns from "node:dns";

// Le stringe "mongodb+srv://" richiedono un tipo speciale di ricerca DNS
// (record SRV) che alcuni router domestici non gestiscono: Node allora
// fallisce con "querySrv ECONNREFUSED". Usiamo DNS pubblici affidabili
// (Cloudflare e Google) per queste ricerche: funziona ovunque, anche su Render.
dns.setServers(["1.1.1.1", "8.8.8.8"]);

let collezione = null;           // collezione MongoDB (se configurata)
const memoriaTemporanea = new Map(); // ripiego in RAM (si perde al riavvio)

export async function connettiDatabase() {
  if (!process.env.MONGODB_URI) {
    console.warn("⚠️  MONGODB_URI non impostata: uso una memoria TEMPORANEA in RAM (non persistente).");
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  collezione = client.db("orizon").collection("conversazioni");
  console.log("✅ Connesso a MongoDB");
}

// Restituisce l'elenco dei messaggi di una conversazione ([] se non esiste)
export async function caricaConversazione(id) {
  if (!collezione) return memoriaTemporanea.get(id) ?? [];
  const documento = await collezione.findOne({ _id: id });
  return documento?.messaggi ?? [];
}

// Aggiunge in fondo alla conversazione i messaggi del turno appena concluso
export async function aggiungiMessaggi(id, nuoviMessaggi) {
  if (!collezione) {
    memoriaTemporanea.set(id, [...(memoriaTemporanea.get(id) ?? []), ...nuoviMessaggi]);
    return;
  }
  const adesso = new Date();
  await collezione.updateOne(
    { _id: id },
    {
      $push: { messaggi: { $each: nuoviMessaggi } },
      $set: { aggiornataIl: adesso },
      $setOnInsert: { creataIl: adesso },
    },
    { upsert: true } // crea il documento se è la prima volta
  );
}
