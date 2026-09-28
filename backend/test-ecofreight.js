// Test manuale dello strumento EcoFreight (da lanciare con: node test-ecofreight.js)
import "dotenv/config"; // legge il file .env e carica ECOFREIGHT_API_KEY
import { calcolaCo2Viaggio } from "./tools/ecofreight.js";

// Test 1: un viaggio vero e valido
console.log("Test 1 - Roma → Bangkok in aereo, 23 kg:");
console.log(await calcolaCo2Viaggio({ mezzo: "aereo", origine: "Roma, Italia", destinazione: "Bangkok, Thailandia", peso_kg: 23 }));

// Test 2: treno, per confronto
console.log("\nTest 2 - Milano → Roma in treno, 23 kg:");
console.log(await calcolaCo2Viaggio({ mezzo: "treno", origine: "Milano, Italia", destinazione: "Roma, Italia", peso_kg: 23 }));

// Test 3: località inesistente (deve dare un errore leggibile, non bloccarsi)
console.log("\nTest 3 - località inventata:");
console.log(await calcolaCo2Viaggio({ mezzo: "aereo", origine: "Xyzqwkk", destinazione: "Roma, Italia", peso_kg: 23 }));

// Test 4: mezzo non supportato (fermato PRIMA di chiamare l'API)
console.log("\nTest 4 - mezzo non supportato:");
console.log(await calcolaCo2Viaggio({ mezzo: "bicicletta", origine: "Roma", destinazione: "Napoli", peso_kg: 10 }));
