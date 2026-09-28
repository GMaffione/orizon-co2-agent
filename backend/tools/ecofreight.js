// =============================================================
// Strumento (tool) EcoFreight
// -------------------------------------------------------------
// Questa funzione è l'unico "strumento" dell'agente: riceve i 4 dati
// raccolti dall'LLM (mezzo, origine, destinazione, peso) e chiede
// all'API EcoFreight quanta CO2 produce il trasporto di quel peso.
//
// Scelta di progetto: la funzione NON lancia mai errori verso l'esterno.
// Restituisce sempre un oggetto con { ok: true, ... } oppure
// { ok: false, errore: "..." }. In questo modo l'LLM riceve sempre
// un messaggio leggibile e può reagire (es. chiedere all'utente di
// riscrivere una città), invece di bloccare tutta la conversazione.
// =============================================================

const URL_API = "https://api.ecofreight.co/api/v1/calculate";

// Traduzione dalle parole dell'utente ai valori che l'API conosce.
// È una tabella fissa (deterministica): non lasciamo questa scelta all'LLM.
const MEZZI = {
  aereo: "air",
  treno: "rail",
  auto: "road",
  pullman: "road",
  nave: "sea",
  traghetto: "sea",
};

// Messaggi comprensibili per ogni errore documentato dall'API.
const MESSAGGI_ERRORE = {
  400: "Uno dei dati inviati non è valido. Ricontrolla mezzo, località e peso.",
  401: "La chiave API di EcoFreight non è valida o manca (problema di configurazione del server).",
  404: "Non riesco a trovare una delle località indicate. Chiedi all'utente di scriverla in modo più preciso (es. 'Roma, Italia').",
  422: "Il mezzo di trasporto scelto non è compatibile con questo tipo di calcolo.",
  429: "Troppe richieste al servizio di calcolo: bisogna riprovare tra qualche minuto.",
  500: "Il servizio EcoFreight ha avuto un problema temporaneo: si può riprovare tra poco.",
};

export async function calcolaCo2Viaggio({ mezzo, origine, destinazione, peso_kg }) {
  // --- 1. Controlli sui dati, PRIMA di chiamare l'API ---------------
  const modalita = MEZZI[mezzo];
  if (!modalita) {
    return {
      ok: false,
      errore: `Mezzo "${mezzo}" non supportato. Valori ammessi: ${Object.keys(MEZZI).join(", ")}.`,
    };
  }
  if (typeof peso_kg !== "number" || peso_kg < 1 || peso_kg > 100000) {
    return { ok: false, errore: "Il peso deve essere un numero tra 1 e 100.000 kg." };
  }
  if (!origine || !destinazione) {
    return { ok: false, errore: "Servono sia l'origine sia la destinazione." };
  }

  // --- 2. Costruzione della richiesta ------------------------------
  const corpo = {
    origin: { query: origine },
    destination: { query: destinazione },
    cargo: { weight: peso_kg, type: "general" },
    transport_mode: modalita,
  };
  // I bagagli in aereo viaggiano nella stiva di un volo passeggeri:
  // l'API chiama questo caso "belly_cargo".
  if (modalita === "air") {
    corpo.vessel_type = "belly_cargo";
  }

  // --- 3. Chiamata all'API -----------------------------------------
  let risposta;
  try {
    risposta = await fetch(URL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ECOFREIGHT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10000), // max 10 secondi di attesa
    });
  } catch (e) {
    // Qui arriviamo se la rete non risponde o scade il tempo di attesa
    return { ok: false, errore: "Impossibile contattare EcoFreight (rete o tempo di attesa scaduto)." };
  }

  // --- 4. Gestione degli errori HTTP -------------------------------
  if (!risposta.ok) {
    const codice = risposta.status >= 500 ? 500 : risposta.status;
    return {
      ok: false,
      errore: MESSAGGI_ERRORE[codice] ?? `Errore imprevisto da EcoFreight (codice ${risposta.status}).`,
    };
  }

  // --- 5. Risultato: solo i campi che servono all'agente -----------
  const dati = await risposta.json();
  return {
    ok: true,
    mezzo,
    origine,
    destinazione,
    peso_kg,
    co2_kg: Math.round(dati.emissions.total * 100) / 100, // arrotondato a 2 decimali
    distanza_km: Math.round(dati.calculation.distance),
  };
}
