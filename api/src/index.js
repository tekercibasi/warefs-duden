const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const OpenAI = require("openai");
const cookieParser = require("cookie-parser");
const nspell = require("nspell");

const PORT = Number(process.env.PORT || 4000);
const MONGO_URL = process.env.MONGO_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const spellReady = (async () => {
  try {
    const mod = await import("dictionary-de");
    const dict = mod.default || mod;
    return nspell(dict);
  } catch (error) {
    console.error("Failed to load dictionary", error);
    return null;
  }
})();

const requireAuth = (req, res, next) => {
  const authCookie = req.cookies?.duden_auth;
  if (authCookie !== "1") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};

if (!MONGO_URL) {
  console.error("MONGO_URL is required");
  process.exit(1);
}

mongoose
  .connect(MONGO_URL)
  .then(() => {
    console.log("Mongo connected");
  })
  .catch((error) => {
    console.error("Mongo connection error", error);
    process.exit(1);
  });

const entrySchema = new mongoose.Schema(
  {
    term: { type: String, required: true, trim: true, unique: true },
    definition: { type: String, required: true, trim: true },
    example: { type: String, trim: true },
    synonyms: { type: String, trim: true }
  },
  { timestamps: true }
);

const Entry = mongoose.model("Entry", entrySchema);

const app = express();
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN,
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/entries", async (req, res) => {
  const entries = await Entry.find().sort({ term: 1 });
  res.json(entries);
});

app.post("/api/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.cookie("duden_auth", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: false
  });
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("duden_auth");
  res.json({ ok: true });
});

app.get("/api/auth/status", (req, res) => {
  res.json({ loggedIn: req.cookies?.duden_auth === "1" });
});

app.post("/api/entries/ai-complete", async (req, res) => {
  if (!ADMIN_PASSWORD) {
    res.status(400).json({ error: "AI login is not configured" });
    return;
  }
  requireAuth(req, res, async () => {
    if (!openai) {
      res.status(400).json({ error: "AI completion is not configured" });
      return;
    }

    const { term, definition, example, synonyms } = req.body || {};
    if (!term && !definition && !example && !synonyms) {
      res
        .status(400)
        .json({ error: "Provide at least term, definition, example, or synonyms" });
      return;
    }

    const prompt = [
      "Du bist ein hilfsbereiter, sachlicher Duden-Redakteur.",
      "Ergänze fehlende Felder für einen Lexikon-Eintrag, der trocken und präzise ist.",
      "Korrigiere bei allen gelieferten Feldern Rechtschreibung/Typografie, ohne den Sinn zu verändern.",
      "Term (Lemma) nur klein schreiben, außer bei Eigennamen/Abkürzungen; nicht automatisch groß am Satzanfang setzen.",
      "Struktur: term, definition (Bedeutung), example (Gebrauch), synonyms (Synonyme/Alternativen).",
      "Gib ausschließlich JSON zurück mit den Schlüsseln: term, definition, example, synonyms."
    ].join(" ");

    const messages = [
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify({ term, definition, example, synonyms })
      }
    ];

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        response_format: { type: "json_object" },
        temperature: 0.4
      });

      const raw = completion.choices?.[0]?.message?.content;
      if (!raw) {
        throw new Error("Keine Antwort erhalten");
      }

      const parsed = JSON.parse(raw);
      res.json({
        term: parsed.term ?? term ?? "",
        definition: parsed.definition ?? definition ?? "",
        example: parsed.example ?? example ?? "",
        synonyms: parsed.synonyms ?? synonyms ?? ""
      });
    } catch (error) {
      console.error("AI completion failed", error);
      res.status(500).json({ error: "AI completion failed" });
    }
  });
});

app.post("/api/entries/ai-review", async (req, res) => {
  if (!ADMIN_PASSWORD) {
    res.status(400).json({ error: "AI login is not configured" });
    return;
  }
  requireAuth(req, res, async () => {
    const { term, definition, example, synonyms } = req.body || {};
    if (!term && !definition && !example && !synonyms) {
      res
        .status(400)
        .json({ error: "Provide at least term, definition, example, or synonyms" });
      return;
    }
    const spell = await spellReady.catch(() => null);
    if (!spell) {
      res.status(500).json({ error: "Spellchecker not available" });
      return;
    }

    const reviewText = (text, fieldName) => {
      if (!text || typeof text !== "string") {
        return { corrected: null, suggestions: [] };
      }
      const suggestions = [];
      let correctedText = text;

      // Lemma: einzelnes Wort, bevorzugt kleingeschrieben prüfen
      if (fieldName === "term") {
        const word = text.trim();
        const lowerWord = word.toLowerCase();
        // Falls großgeschrieben, aber kein Akronym, Kleinschreibung vorschlagen
        if (
          word !== lowerWord &&
          /^[A-ZÄÖÜ][a-zäöüß]+$/.test(word) &&
          spell.correct(lowerWord)
        ) {
          suggestions.push({ from: word, to: lowerWord, reason: "Kleinschreibung" });
          correctedText = lowerWord;
        }
        if (!spell.correct(lowerWord)) {
          const guess = spell.suggest(lowerWord)[0];
          if (guess) {
            suggestions.push({ from: word, to: guess, reason: "Rechtschreibung" });
            correctedText = guess;
          }
        }
        return {
          corrected: suggestions.length > 0 ? correctedText : null,
          suggestions
        };
      }

      // Andere Felder: flacher Scan, einfache Wortvorschläge
      const words = text.match(/[A-Za-zÄÖÜäöüß]+/g) || [];
      words.forEach((word) => {
        if (spell.correct(word.toLowerCase())) return;
        const guess = spell.suggest(word.toLowerCase())[0];
        if (guess) {
          suggestions.push({ from: word, to: guess, reason: "Rechtschreibung" });
          correctedText = correctedText.replace(new RegExp(`\\b${word}\\b`, "g"), guess);
        }
      });

      return {
        corrected: suggestions.length > 0 ? correctedText : null,
        suggestions
      };
    };

    try {
      res.json({
        term: reviewText(term, "term"),
        definition: reviewText(definition, "definition"),
        example: reviewText(example, "example"),
        synonyms: reviewText(synonyms, "synonyms")
      });
    } catch (error) {
      console.error("Spell review failed", error);
      res.status(500).json({ error: "Spell review failed" });
    }
  });
});

app.post("/api/entries", requireAuth, async (req, res) => {
  const { term, definition, example, synonyms } = req.body || {};

  if (!term || !definition) {
    res.status(400).json({ error: "term and definition are required" });
    return;
  }

  try {
    const entry = await Entry.create({ term, definition, example, synonyms });
    res.status(201).json(entry);
  } catch (error) {
    if (error && error.code === 11000) {
      res.status(409).json({ error: "term already exists" });
      return;
    }

    console.error("Failed to create entry", error);
    res.status(500).json({ error: "failed to create entry" });
  }
});

app.put("/api/entries/:id", requireAuth, async (req, res) => {
  const { term, definition, example, synonyms } = req.body || {};
  const { id } = req.params || {};

  if (!term || !definition) {
    res.status(400).json({ error: "term and definition are required" });
    return;
  }

  try {
    const updated = await Entry.findByIdAndUpdate(
      id,
      { term, definition, example, synonyms },
      { new: true, runValidators: true }
    );

    if (!updated) {
      res.status(404).json({ error: "entry not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    if (error && error.code === 11000) {
      res.status(409).json({ error: "term already exists" });
      return;
    }
    console.error("Failed to update entry", error);
    res.status(500).json({ error: "failed to update entry" });
  }
});

app.delete("/api/entries/:id", requireAuth, async (req, res) => {
  const { id } = req.params || {};
  try {
    const deleted = await Entry.findByIdAndDelete(id);
    if (!deleted) {
      res.status(404).json({ error: "entry not found" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete entry", error);
    res.status(500).json({ error: "failed to delete entry" });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
