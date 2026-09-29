// =============================================================
// Chat dell'assistente Orizon
// -------------------------------------------------------------
// Il front end è volutamente semplice (la traccia chiede solo una chat):
// tutta la logica sta nel back end. Qui facciamo tre cose:
//   1. mostriamo i messaggi
//   2. inviamo il messaggio dell'utente a POST /api/chat
//   3. ricordiamo l'id della conversazione nel browser, così ricaricando
//      la pagina la chat viene recuperata dal database del back end
// =============================================================

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

// Indirizzo del back end: da .env in locale, dalle impostazioni di Netlify online
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const CHIAVE_ID = "orizon-conversation-id";

const BENVENUTO = {
  role: "assistant",
  content:
    "Ciao! Sono l'assistente di **Orizon** 🌍\n\n" +
    "Dimmi come viaggi, da dove a dove e quanto pesano i tuoi bagagli: " +
    "ti dirò quanta CO₂ produce il loro trasporto.\n\n" +
    "Esempio: *«Vado da Roma a Lisbona in aereo con una valigia da 20 kg»*",
};

// Chiamata all'unico endpoint del back end
async function chiamaApi(conversationId, message) {
  const risposta = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, message }),
  });
  const dati = await risposta.json();
  if (!risposta.ok) throw new Error(dati.errore || "Errore del server");
  return dati;
}

// Lettura/scrittura sicura nella memoria del browser
function leggiId() {
  try { return localStorage.getItem(CHIAVE_ID); } catch { return null; }
}
function salvaId(id) {
  try { id ? localStorage.setItem(CHIAVE_ID, id) : localStorage.removeItem(CHIAVE_ID); } catch { /* ignora */ }
}

export default function App() {
  const [messaggi, setMessaggi] = useState([BENVENUTO]);
  const [conversationId, setConversationId] = useState(leggiId());
  const [testo, setTesto] = useState("");
  const [inAttesa, setInAttesa] = useState(false);
  const [errore, setErrore] = useState(null);
  const fondoChat = useRef(null);

  // All'avvio: se c'è una conversazione salvata, ne recuperiamo la cronologia
  useEffect(() => {
    if (!conversationId) return;
    chiamaApi(conversationId)
      .then((dati) => {
        if (dati.cronologia?.length) setMessaggi([BENVENUTO, ...dati.cronologia]);
      })
      .catch(() => { /* se il server non risponde, si parte con una chat vuota */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scorre automaticamente in fondo quando arriva un nuovo messaggio
  useEffect(() => {
    fondoChat.current?.scrollIntoView({ behavior: "smooth" });
  }, [messaggi, inAttesa]);

  async function invia(e) {
    e.preventDefault();
    const messaggio = testo.trim();
    if (!messaggio || inAttesa) return;

    setTesto("");
    setErrore(null);
    setMessaggi((m) => [...m, { role: "user", content: messaggio }]);
    setInAttesa(true);

    try {
      const dati = await chiamaApi(conversationId, messaggio);
      setConversationId(dati.conversationId);
      salvaId(dati.conversationId);
      setMessaggi((m) => [...m, { role: "assistant", content: dati.risposta }]);
    } catch {
      setErrore("Non riesco a contattare il server. Riprova tra qualche istante (al primo accesso può servire fino a un minuto).");
    } finally {
      setInAttesa(false);
    }
  }

  function nuovaConversazione() {
    salvaId(null);
    setConversationId(null);
    setMessaggi([BENVENUTO]);
    setErrore(null);
  }

  return (
    <div className="app">
      <header className="intestazione">
        <div>
          <h1>Orizon</h1>
          <p>Calcolatore CO₂ dei bagagli di viaggio</p>
        </div>
        <button className="nuova" onClick={nuovaConversazione} disabled={inAttesa}>
          Nuova conversazione
        </button>
      </header>

      <main className="chat">
        {messaggi.map((m, i) => (
          <div key={i} className={`messaggio ${m.role}`}>
            <ReactMarkdown>{m.content}</ReactMarkdown>
          </div>
        ))}
        {inAttesa && <div className="messaggio assistant attesa">Sto calcolando…</div>}
        {errore && <div className="errore">{errore}</div>}
        <div ref={fondoChat} />
      </main>

      <form className="invio" onSubmit={invia}>
        <input
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          placeholder="Descrivi il tuo viaggio…"
          disabled={inAttesa}
          autoFocus
        />
        <button type="submit" disabled={inAttesa || !testo.trim()}>Invia</button>
      </form>
    </div>
  );
}
