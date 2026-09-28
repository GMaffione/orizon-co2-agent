// =============================================================
// Strumento (tool) EcoFreight
// -------------------------------------------------------------
// Unico "strumento" dell'agente: riceve i 4 dati raccolti dall'LLM
// (mezzo, origine, destinazione, peso) e restituisce la CO2 prodotta
// dal trasporto di quel peso lungo la tratta.
//
// Funziona in due fasi:
//   FASE A - risolve origine e destinazione in luoghi precisi (/location)
//   FASE B - calcola la CO2 usando le coordinate esatte (/calculate)
//
// Perché la fase A? Nei test abbiamo scoperto che /calculate, se riceve
// un nome inesistente o sbagliato, "indovina" un luogo a caso e calcola
// lo stesso, senza segnalare errori. Risolvendo prima i luoghi possiamo:
//   - accorgerci se un luogo non esiste
//   - accorgerci se un nome è ambiguo (es. Paris: Francia o Texas?)
//   - restituire il nome risolto, così l'utente può verificarlo
//
// Scelta di progetto: la funzione NON lancia mai errori verso l'esterno.
// Restituisce sempre { ok: true, ... } oppure { ok: false, errore: "..." },
// così l'LLM riceve sempre un messaggio leggibile e può reagire.
// =============================================================

const URL_BASE = "https://api.ecofreight.co/api/v1";

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

// Messaggi comprensibili per gli errori di /calculate.
const MESSAGGI_ERRORE = {
  400: "Uno dei dati inviati non è valido. Ricontrolla mezzo, località e peso.",
  401: "La chiave API di EcoFreight non è valida o manca (problema di configurazione del server).",
  403: "La chiave API di EcoFreight non è stata riconosciuta (problema di configurazione del server).",
  422: "Il mezzo di trasporto scelto non è compatibile con questo tipo di calcolo.",
  429: "Troppe richieste al servizio di calcolo: bisogna riprovare tra qualche minuto.",
  500: "Il servizio EcoFreight ha avuto un problema temporaneo: si può riprovare tra poco.",
};

// Intestazioni comuni a tutte le chiamate (qui viaggia la chiave API).
function intestazioni() {
  return {
    Authorization: `Bearer ${process.env.ECOFREIGHT_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// -------------------------------------------------------------
// FASE A: da un testo ("Paris") a un luogo preciso con coordinate
// -------------------------------------------------------------
async function risolviLuogo(testo) {
  let risposta;
  try {
    // Nota: il parametro si chiama "query" (la documentazione dice "q",
    // ma i test hanno mostrato che con "q" il server non legge il testo).
    risposta = await fetch(`${URL_BASE}/location?query=${encodeURIComponent(testo)}`, {
      headers: intestazioni(),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    return { ok: false, errore: "Impossibile contattare il servizio di ricerca luoghi (rete o tempo scaduto)." };
  }

  // Nei test, un nome inesistente ("Xyzqwkk") fa rispondere il server con
  // un errore 500 "All geocoding services failed": lo trattiamo come
  // "luogo non trovato", che è il caso di gran lunga più probabile.
  const candidati = risposta.ok ? await risposta.json() : [];
  if (!Array.isArray(candidati) || candidati.length === 0) {
    return {
      ok: false,
      errore: `Non riesco a trovare la località "${testo}". Chiedi all'utente di controllare come è scritta o di aggiungere il paese (es. "Roma, Italia").`,
    };
  }

   // Controllo ambiguità: se l'utente ha scritto SOLO il nome della città
  // (nessuna virgola, es. "Paris") e i candidati stanno in PAESI diversi,
  // il nome è ambiguo e non scegliamo a caso.
  // Se invece ha già indicato il paese (es. "Bangkok, Thailandia"), ci
  // fidiamo del primo candidato, il più rilevante: nei test, "Bangkok,
  // Thailandia" restituiva anche un omonimo in Indonesia, e segnalarlo
  // come ambiguo sarebbe stato un falso allarme.
  const paeseIndicato = testo.includes(",");
  const paesi = [...new Set(candidati.map((c) => c.address?.country ?? c.display_name.split(", ").pop()))];
  if (!paeseIndicato && paesi.length > 1) {
    return {
      ok: false,
      errore: `La località "${testo}" è ambigua. Chiedi all'utente di aggiungere il paese.`,
    };
  }

  // Un solo paese: prendiamo il primo candidato, il più rilevante.
  const scelto = candidati[0];
  return {
    ok: true,
    nome: scelto.display_name,
    // Attenzione: /location restituisce "lon", ma /calculate vuole "lng"
    coordinate: { lat: scelto.lat, lng: scelto.lon },
  };
}

// -------------------------------------------------------------
// Funzione principale, chiamata dall'agente
// -------------------------------------------------------------
export async function calcolaCo2Viaggio({ mezzo, origine, destinazione, peso_kg }) {
  // --- 1. Controlli sui dati, PRIMA di qualsiasi chiamata ----------
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

  // --- 2. FASE A: risoluzione dei due luoghi -----------------------
  const luogoOrigine = await risolviLuogo(origine);
  if (!luogoOrigine.ok) return luogoOrigine;

  const luogoDestinazione = await risolviLuogo(destinazione);
  if (!luogoDestinazione.ok) return luogoDestinazione;

  // --- 3. FASE B: calcolo della CO2 con le coordinate esatte --------
  const corpo = {
    origin: { coordinates: luogoOrigine.coordinate },
    destination: { coordinates: luogoDestinazione.coordinate },
    cargo: { weight: peso_kg, type: "general" },
    transport_mode: modalita,
  };
  // I bagagli in aereo viaggiano nella stiva di un volo passeggeri:
  // l'API chiama questo caso "belly_cargo".
  if (modalita === "air") {
    corpo.vessel_type = "belly_cargo";
  }

  let risposta;
  try {
    risposta = await fetch(`${URL_BASE}/calculate`, {
      method: "POST",
      headers: intestazioni(),
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10000), // max 10 secondi di attesa
    });
  } catch (e) {
    return { ok: false, errore: "Impossibile contattare EcoFreight (rete o tempo di attesa scaduto)." };
  }

  if (!risposta.ok) {
    const codice = risposta.status >= 500 ? 500 : risposta.status;
    return {
      ok: false,
      errore: MESSAGGI_ERRORE[codice] ?? `Errore imprevisto da EcoFreight (codice ${risposta.status}).`,
    };
  }

  // --- 4. Risultato: solo i campi che servono all'agente -----------
  const dati = await risposta.json();
  return {
    ok: true,
    mezzo,
    origine,
    destinazione,
    // Nomi risolti: l'agente li mostra all'utente per conferma
    origine_trovata: luogoOrigine.nome,
    destinazione_trovata: luogoDestinazione.nome,
    peso_kg,
    co2_kg: Math.round(dati.emissions.total * 100) / 100, // arrotondato a 2 decimali
    distanza_km: Math.round(dati.calculation.distance),
  };
}