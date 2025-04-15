require('dotenv').config(); // Lädt Variablen aus der .env Datei
const express = require('express');
const cors = require('cors');
const fs = require('fs'); // Node.js File System Modul
const path = require('path'); // Node.js Path Modul
const nodemailer = require('nodemailer');

const app = express();

const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Frontend-URL aus Umgebungsvariable oder localhost
    optionsSuccessStatus: 200
};
  app.use(cors(corsOptions));
app.use(express.json());

// --- Puzzle Daten laden ---
let allPuzzles = [];
const puzzlesFilePath = path.join(__dirname, 'puzzles.json'); // Pfad zur JSON-Datei

try {
    // Lese die Datei synchron beim Serverstart
    const puzzlesData = fs.readFileSync(puzzlesFilePath, 'utf8');
    allPuzzles = JSON.parse(puzzlesData);
    // Einfache Prüfung, ob es ein Array mit Inhalt ist
    if (!Array.isArray(allPuzzles) || allPuzzles.length === 0) {
        console.error("FEHLER: puzzles.json ist leer oder hat ein ungültiges Format. Lade keine Rätsel.");
        allPuzzles = []; // Stelle sicher, dass es ein leeres Array ist bei Fehlern
    } else {
        console.log(`INFO: Erfolgreich ${allPuzzles.length} Rätsel aus puzzles.json geladen.`);
    }
} catch (err) {
    console.error("FEHLER beim Lesen oder Parsen von puzzles.json:", err);
    // Entscheiden, wie damit umgegangen wird (z.B. Server nicht starten?).
    // Hier läuft der Server weiter, aber ohne Rätsel.
}

// --- Tagesaktuelles Rätsel auswählen ---

// WICHTIG: Setze hier ein festes Startdatum (in UTC!) für dein erstes Rätsel.
// Beispiel: 7. April 2025, 00:00:00 UTC
// Monate sind 0-indiziert (0=Januar, 1=Februar, ..., 3=April)
const startDate = new Date(Date.UTC(2025, 3, 9)); // Jahr, Monat(0-index), Tag

function getTodaysPuzzle() {
    if (allPuzzles.length === 0) {
        console.error("Keine Rätsel verfügbar.");
        return null; // Keine Rätsel geladen
    }

    const now = new Date();
    // Heutiges Datum um 00:00:00 UTC
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    if (isNaN(startDate.getTime()) || startDate > todayUtc) {
        console.error("Ungültiges Startdatum oder Startdatum liegt in der Zukunft (UTC).");
        return null;
    }

    // Differenz in Millisekunden -> umrechnen in Tage
    const diffMillis = todayUtc - startDate;
    const dayNumber = Math.floor(diffMillis / (1000 * 60 * 60 * 24)); // Anzahl Tage seit Startdatum (0-basiert)

    if (dayNumber < 0) {
         console.error("Negativer Tagesindex berechnet. Startdatum prüfen.");
         return null;
    }

    // Index auswählen mittels Modulo -> rotiert durch alle Rätsel
    const puzzleIndex = dayNumber % allPuzzles.length;
    console.log(`INFO: Heutiger Tag (seit Start): ${dayNumber}, Gesamt Rätsel: ${allPuzzles.length}, Gewählter Index: ${puzzleIndex}`);

    return allPuzzles[puzzleIndex];
}

// --- API Endpunkte ---

// Liefert die gemischten Wörter des TAGESAKTUELLEN Rätsels
app.get('/words', (req, res) => {
    const todaysPuzzle = getTodaysPuzzle();
    if (!todaysPuzzle || !Array.isArray(todaysPuzzle.groups)) {
        return res.status(500).json({ error: "Could not determine today's puzzle words." });
    }

    // 1. Alle Wörter extrahieren
    const allWords = todaysPuzzle.groups.flatMap(group => group.words);
    if (allWords.length !== 16) {
        console.warn(`WARN: Puzzle ${todaysPuzzle.id || 'unknown'} does not contain exactly 16 words (${allWords.length}).`);
        // Optional: Fehler senden oder mit weniger/mehr Wörtern weitermachen?
        // return res.status(500).json({ error: "Puzzle does not contain 16 words." });
    }

    // 2. Grid initialisieren (16 Plätze, erstmal leer)
    const grid = new Array(16).fill(null);
    const fixedWords = new Set(); // Merken, welche Wörter fest platziert wurden

    // 3. Feste Positionen verarbeiten (falls vorhanden)
    if (todaysPuzzle.fixedPositions && typeof todaysPuzzle.fixedPositions === 'object') {
        console.log("INFO: Processing fixed positions for today's puzzle.");
        for (const positionKey in todaysPuzzle.fixedPositions) {
            try {
                const position = parseInt(positionKey, 10); // Position aus dem Key lesen (z.B. "1")
                const word = todaysPuzzle.fixedPositions[positionKey]; // Wort bekommen

                // Validierung
                if (isNaN(position) || position < 1 || position > 16) {
                    console.warn(`WARN: Invalid position key '${positionKey}' in fixedPositions.`);
                    continue; // Ignoriere ungültige Positionen
                }
                if (!allWords.includes(word)) {
                     console.warn(`WARN: Word '${word}' from fixedPositions (pos ${position}) not found in puzzle groups.`);
                     continue; // Ignoriere Wörter, die nicht im Rätsel sind
                }
                if (fixedWords.has(word)) {
                     console.warn(`WARN: Word '${word}' is assigned multiple fixed positions. Using first encountered.`);
                     continue; // Verhindere, dass ein Wort mehrfach fest platziert wird
                }

                const index = position - 1; // Umwandeln in 0-basierten Array-Index

                if (grid[index] !== null) {
                    console.warn(`WARN: Position conflict at index ${index} (position ${position}). Overwriting previous fixed word.`);
                    // Hier könnte man entscheiden, den alten Wert zu entfernen, falls er aus fixedWords stammt
                    // Für Einfachheit: Überschreibe einfach, aber logge eine Warnung.
                }

                // Wort im Grid platzieren und merken
                grid[index] = word;
                fixedWords.add(word);
                console.log(`INFO: Placed '${word}' at fixed position ${position} (index ${index})`);

            } catch (parseError) {
                console.warn(`WARN: Error processing fixed position key '${positionKey}':`, parseError);
            }
        }
    }

    // 4. Restliche Wörter sammeln und mischen
    const randomWords = allWords.filter(word => !fixedWords.has(word));
    randomWords.sort(() => Math.random() - 0.5); // Mischen

    // 5. Leere Plätze im Grid mit den gemischten Wörtern auffüllen
    let randomWordIndex = 0;
    for (let i = 0; i < grid.length; i++) {
        if (grid[i] === null) { // Finde einen leeren Platz
            if (randomWordIndex < randomWords.length) {
                grid[i] = randomWords[randomWordIndex];
                randomWordIndex++;
            } else {
                // Sollte nicht passieren, wenn allWords 16 Elemente hat und fixedPositions gültig sind
                console.error(`FEHLER: Nicht genug zufällige Wörter, um Grid-Platz ${i} zu füllen!`);
                // Fallback: Leeren String oder speziellen Marker einfügen?
                grid[i] = "FEHLER"; // Oder null lassen und im Frontend behandeln?
            }
        }
    }

     // 6. Prüfen, ob das Grid vollständig gefüllt ist (optional)
     if (grid.includes(null) || grid.includes("FEHLER") || grid.length !== 16) {
          console.error("FEHLER: Final grid is incomplete or contains errors:", grid);
          // Evtl. Fehler an Client senden? Oder versuchen, trotzdem zu senden?
          // return res.status(500).json({ error: "Failed to construct the final word grid properly." });
     }

    // 7. Ergebnis senden (das jetzt sortierte 'grid'-Array anstelle der alten 'shuffledWords')
    res.json({
        words: grid, // Das fertig sortierte Array senden
        author: todaysPuzzle.author || "Unbekannt"
    });
});


// Liefert die Gruppenstruktur des TAGESAKTUELLEN Rätsels
app.get('/groups', (req, res) => {
    const todaysPuzzle = getTodaysPuzzle();

    if (!todaysPuzzle || !Array.isArray(todaysPuzzle.groups)) {
        return res.status(500).json({ error: "Konnte die heutigen Gruppen nicht bestimmen." });
    }

    // Sende die Gruppenstruktur (nützlich für Frontend, z.B. für 3/4-Check)
    res.json({ groups: todaysPuzzle.groups });
});

// Prüft die Auswahl gegen das TAGESAKTUELLE Rätsel
app.post('/check', (req, res) => {
    const { selectedWords } = req.body;

    // Einfache Validierung der Eingabe
    if (!Array.isArray(selectedWords) || selectedWords.length !== 4) {
        return res.status(400).json({ error: "Ungültige Auswahl. Bitte 4 Wörter senden." });
    }

    const todaysPuzzle = getTodaysPuzzle();

    if (!todaysPuzzle || !Array.isArray(todaysPuzzle.groups)) {
        return res.status(500).json({ error: "Konnte das heutige Rätsel zum Prüfen nicht bestimmen." });
    }

    // Finde die passende Gruppe im HEUTIGEN Rätsel
    const matchingGroup = todaysPuzzle.groups.find(group =>
        // Prüfe, ob ALLE ausgewählten Wörter in dieser Gruppe sind
        selectedWords.every(word => group.words.includes(word)) &&
        // Optional: Sicherstellen, dass die Gruppe auch genau 4 Wörter hat
        group.words.length === 4
    );

    if (matchingGroup) {
        res.json({
            correct: true,
            category: matchingGroup.category // Kategorie zurückgeben
        });
    } else {
        res.json({ correct: false });
    }
});

app.post('/submit-puzzle', async (req, res) => { // async für await bei sendMail
    const { author, category, words } = req.body;
    console.log('INFO: Puzzle submission received:', { author, category }); // Logge Empfang

    // Einfache Validierung
    if (!author || !category) {
        console.warn('WARN: Submission rejected - missing author or category.');
        return res.status(400).json({ success: false, message: 'Autor und Kategorie sind Pflichtfelder.' });
    }

    // --- Nodemailer Konfiguration ---
    // Hole Zugangsdaten und Konfiguration aus Umgebungsvariablen
    const emailHost = process.env.EMAIL_HOST;
    const emailPort = process.env.EMAIL_PORT || 587; // Standard TLS Port
    const emailSecure = process.env.EMAIL_SECURE === 'true'; // true für Port 465, false für 587/TLS
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS; // Passwort oder App-Passwort
    const recipientEmail = process.env.RECIPIENT_EMAIL; // Deine E-Mail-Adresse

    // Prüfe, ob alle nötigen Umgebungsvariablen gesetzt sind
    if (!emailHost || !emailUser || !emailPass || !recipientEmail) {
        console.error('FEHLER: E-Mail Umgebungsvariablen nicht vollständig konfiguriert! (EMAIL_HOST, EMAIL_USER, EMAIL_PASS, RECIPIENT_EMAIL)');
        return res.status(500).json({ success: false, message: 'E-Mail-Konfiguration serverseitig unvollständig.' });
    }

    // Erstelle den Transporter für Nodemailer
    let transporter = nodemailer.createTransport({
        host: emailHost,
        port: parseInt(emailPort, 10), // Stelle sicher, dass Port eine Zahl ist
        secure: emailSecure, // true für 465, false für andere ports (STARTTLS)
        auth: {
            user: emailUser,
            pass: emailPass,
        },
        // Optional: Falls dein Server (z.B. Gmail) strikte TLS-Prüfung erfordert
        // tls: {
        //     rejectUnauthorized: false // Nur verwenden, wenn unbedingt nötig!
        // }
    });

    // --- E-Mail Inhalt ---
    const subject = `Neuer Rätselvorschlag für Vierwandt: ${category}`;
    const textContent = `
Neuer Vorschlag eingegangen:

Autor: ${author}
Kategorie: ${category}
Wortvorschläge:
${words || '(keine angegeben)'}
    `;
    const htmlContent = `
<h3>Neuer Rätselvorschlag für Vierwandt</h3>
<p><strong>Autor:</strong> ${author}</p>
<p><strong>Kategorie:</strong> ${category}</p>
<p><strong>Wortvorschläge:</strong></p>
<pre>${words || '(keine angegeben)'}</pre>
    `;

    // E-Mail Optionen
    let mailOptions = {
        from: `"Vierwandt Einreichung" <${emailUser}>`, // Absenderadresse (oft die gleiche wie user)
        to: recipientEmail, // Empfänger (Deine Adresse)
        subject: subject,
        text: textContent,
        html: htmlContent,
    };

    // --- E-Mail senden ---
    try {
        console.log('INFO: Attempting to send email...');
        let info = await transporter.sendMail(mailOptions);
        console.log('INFO: Email sent successfully! Message ID:', info.messageId);
        // Erfolgsantwort an das Frontend senden
        res.status(200).json({ success: true, message: 'Vorschlag erfolgreich gesendet!' });
    } catch (error) {
        console.error('FEHLER beim Senden der E-Mail:', error);
        // Fehlerantwort an das Frontend senden
        res.status(500).json({ success: false, message: 'Fehler beim Senden des Vorschlags.' });
    }
});

// --- Server Start ---
const PORT = process.env.PORT || 5000; // Port über Umgebungsvariable oder Standard 5000
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));