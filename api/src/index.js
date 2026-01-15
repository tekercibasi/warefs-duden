const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
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
    const dictRoot = path.dirname(require.resolve("hunspell-dict-de-de/package.json"));
    const [aff, dic] = await Promise.all([
      fs.promises.readFile(path.join(dictRoot, "de-de.aff"), "utf8"),
      fs.promises.readFile(path.join(dictRoot, "de-de.dic"), "utf8")
    ]);
    return nspell(aff, dic);
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
    synonyms: { type: String, trim: true },
    partOfSpeech: {
      type: [String],
      enum: [
        "noun",
        "verb",
        "adjective",
        "adverb",
        "interjection",
        "particle",
        "conjunction",
        "preposition",
        "phrase"
      ],
      required: false,
      default: undefined
    },
    article: {
      type: String,
      enum: ["der", "die", "das"],
      required: false
    }
  },
  { timestamps: true }
);

const Entry = mongoose.model("Entry", entrySchema);
const AI_SITUATION_KEYS = [
  "arbeit",
  "schwiegereltern",
  "philosophie_3uhr",
  "gasse_betrunken",
  "behoerdlich"
];
const emptyAlternativeResults = () =>
  AI_SITUATION_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
const alternativeSchema = new mongoose.Schema(
  {
    item: { type: String, required: true, trim: true },
    situation: { type: String, required: true, enum: AI_SITUATION_KEYS },
    alternative_text: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true },
    model_version: { type: String, trim: true }
  },
  { timestamps: false }
);
const Alternative = mongoose.model("Alternative", alternativeSchema);

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

    const { term, definition, example, synonyms, partOfSpeech, article } = req.body || {};
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
        synonyms: parsed.synonyms ?? synonyms ?? "",
        partOfSpeech: normalizePartOfSpeech(parsed.partOfSpeech ?? partOfSpeech),
        article: parsed.article ?? article ?? ""
      });
    } catch (error) {
      console.error("AI completion failed", error);
      res.status(500).json({ error: "AI completion failed" });
    }
  });
});

const AI_ALTERNATIVES_SYSTEM_PROMPT = `
AGENTENANWEISUNG – Situative Alternativen (geordnet nach Tonalität)

Du agierst als Sprach- und Kontext-Agent.

Deine Aufgabe ist es, situativ passende alternative Formulierungen zu erzeugen und sie innerhalb jeder Situation nach Tonalität zu ordnen.

Wichtig:
- Die Ausgabe darf freundlich, neutral, verspielt oder kritisch sein.
- Überheblichkeit ist nicht der Default.
- Antworte ausschließlich als JSON-Objekt im unten angegebenen Schema.

Zentrale Sortierregel (verbindlich)
Innerhalb jeder Situation müssen die Alternativen wie folgt sortiert sein:
1) freundlich / positiv / wohlwollend
2) neutral / locker / ironisch
3) kritisch / flapsig / sozial unpassend
Die Liste geht von sozial akzeptabel zu zunehmend unfreundlich. Nicht alle Stufen müssen extrem sein, aber die Richtung muss erkennbar sein.
Wenn nur eine Alternative geliefert wird, wähle eine mittlere Tonalität.

Allgemeine Regeln
- Erzeuge 1–3 Alternativen pro Situation.
- Alternativen dürfen positiv, neutral oder kritisch sein.
- Positive Varianten sind ausdrücklich erlaubt.
- Keine Erklärungen, keine Metakommentare, keine Emojis.
- Keine Wiederholungen zwischen Situationen.
- Die emotionale Intensität ist an den Ausgangsbegriff anzupassen; neutrale oder abstrakte Begriffe erfordern mildere Tonlagen.

Situationen & Tonrahmen

1. Karrieregefährdend (Ziel: im Arbeitskontext unprofessionell)
- freundlich-locker → ironisch → schnippisch
- darf fehlplatzierte Begeisterung enthalten
- nicht offen beleidigend
- Sortierung: zuerst überfreundlich oder zu salopp, zuletzt latent respektlos

2. Schwiegereltern-kritisch (Ziel: gut gemeint, aber irritierend)
- freundlich → verniedlichend → zu locker
- positiver Ton ist häufig angemessen
- Sortierung: von höflich-locker zu sozial unangenehm

3. 3-Uhr-tauglich (Tee & Philosophie) (Ziel: wohlwollende Überhöhung)
- staunend → poetisch → leicht entrückt
- Sortierung: von ruhig-wertschätzend zu überhöht-abgehoben

4. Gasse, betrunken (Ziel: emotionale Nähe)
- herzlich → flapsig → derb
- Begeisterung ist erlaubt
- Sortierung: von kumpelhaft zu zunehmend grob

5. Behördlich leer (Ziel: emotionslose Distanz)
- neutral → abstrakt → maximal entpersonalisiert
- Sortierung: von sachlich zu zunehmend unpersönlich

Ausgabeformat (zwingend):
{
  "item": "<originaler Ausdruck>",
  "results": {
    "arbeit": [],
    "schwiegereltern": [],
    "philosophie_3uhr": [],
    "gasse_betrunken": [],
    "behoerdlich": []
  }
}

Qualitätskontrolle
- Die Reihenfolge innerhalb jeder Liste muss eine klare Eskalation zeigen.
- Mindestens eine Alternative pro Item darf positiv oder freundlich sein.
- Wenn alle Alternativen gleich unfreundlich klingen, ist die Aufgabe nicht erfüllt.

Priorität:
1) Korrekte Sortierung von freundlich → unfreundlich
2) Situationsangemessene Tonalität
3) Sprachliche Natürlichkeit
`;

const buildAlternativesUserPrompt = (itemText) => `Ausdruck: "${itemText}"`;

const normalizeAlternativesResponse = (payload, itemText) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Ungültige KI-Antwort");
  }
  const results = payload.results && typeof payload.results === "object" ? payload.results : {};
  const normalized = emptyAlternativeResults();
  const toList = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) return [value];
    return [];
  };

  AI_SITUATION_KEYS.forEach((key) => {
    const values = toList(results[key]);
    const cleaned = values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .slice(0, 3);
    if (cleaned.length === 0) {
      throw new Error(`Keine Alternativen für ${key}`);
    }
    normalized[key] = cleaned;
  });

  return { item: itemText, results: normalized };
};

const aggregateAlternatives = async (item) => {
  const normalizedItem = typeof item === "string" ? item.trim() : "";
  if (!normalizedItem) {
    return { item: item || "", results: emptyAlternativeResults() };
  }
  const docs = await Alternative.find({ item: normalizedItem }).sort({ timestamp: 1 });
  const results = emptyAlternativeResults();
  docs.forEach((doc) => {
    if (!results[doc.situation]) return;
    if (!results[doc.situation].includes(doc.alternative_text)) {
      results[doc.situation].push(doc.alternative_text);
    }
  });
  return { item: normalizedItem, results };
};

app.post("/api/entries/ai-alternatives", async (req, res) => {
  if (!openai) {
    res.status(400).json({ error: "AI completion is not configured" });
    return;
  }

  const itemText = typeof req.body?.item === "string" ? req.body.item : "";
  if (!itemText.trim()) {
    res.status(400).json({ error: "item is required" });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AI_ALTERNATIVES_SYSTEM_PROMPT },
        { role: "user", content: buildAlternativesUserPrompt(itemText) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.8
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error("Keine Antwort erhalten");
    }

    const parsed = JSON.parse(raw);
    const normalized = normalizeAlternativesResponse(parsed, itemText);
    const timestamp = new Date();
    const modelVersion = completion.model || "gpt-4o-mini";
    const existingDocs = await Alternative.find({ item: normalized.item });
    const existingBySituation = existingDocs.reduce((acc, doc) => {
      const key = doc.situation;
      const value = (doc.alternative_text || "").toLowerCase();
      if (!acc[key]) acc[key] = new Set();
      if (value) acc[key].add(value);
      return acc;
    }, {});
    const docs = AI_SITUATION_KEYS.flatMap((key) =>
      normalized.results[key].map((text) => ({
        item: normalized.item,
        situation: key,
        alternative_text: text,
        timestamp,
        model_version: modelVersion
      }))
    );

    const toInsert = docs.filter((doc) => {
      const key = doc.situation;
      const value = (doc.alternative_text || "").toLowerCase();
      if (!value) return false;
      if (!existingBySituation[key]) existingBySituation[key] = new Set();
      if (existingBySituation[key].has(value)) return false;
      existingBySituation[key].add(value);
      return true;
    });

    if (toInsert.length > 0) {
      await Alternative.insertMany(toInsert);
    }
    const aggregated = await aggregateAlternatives(normalized.item);
    res.json(aggregated);
  } catch (error) {
    console.error("AI alternatives failed", error);
    res.status(502).json({ error: error?.message || "AI alternatives failed" });
  }
});

app.get("/api/entries/:id/ai-alternatives", async (req, res) => {
  const { id } = req.params || {};
  try {
    const entry = await Entry.findById(id);
    if (!entry) {
      res.status(404).json({ error: "entry not found" });
      return;
    }
    const aggregated = await aggregateAlternatives(entry.term);
    res.json(aggregated);
  } catch (error) {
    console.error("Failed to load alternatives", error);
    res.status(500).json({ error: "failed to load alternatives" });
  }
});

app.delete("/api/entries/:id/ai-alternatives", async (req, res) => {
  const { id } = req.params || {};
  try {
    const entry = await Entry.findById(id);
    if (!entry) {
      res.status(404).json({ error: "entry not found" });
      return;
    }
    await Alternative.deleteMany({ item: entry.term });
    res.json({ item: entry.term, results: emptyAlternativeResults() });
  } catch (error) {
    console.error("Failed to delete alternatives", error);
    res.status(500).json({ error: "failed to delete alternatives" });
  }
});

app.get("/api/entries/ai-alternatives/summary", async (_req, res) => {
  try {
    const summary = await Alternative.aggregate([
      { $group: { _id: "$item", count: { $sum: 1 } } }
    ]);
    const normalized = summary.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});
    res.json({ summary: normalized });
  } catch (error) {
    console.error("Failed to load alternatives summary", error);
    res.status(500).json({ error: "failed to load alternatives summary" });
  }
});

app.post("/api/entries/spellcheck", async (req, res) => {
  if (!ADMIN_PASSWORD) {
    res.status(400).json({ error: "AI login is not configured" });
    return;
  }
  requireAuth(req, res, async () => {
    if (!openai) {
      res.status(400).json({ error: "Spellcheck is not configured" });
      return;
    }

    const body = req.body || {};
    const allowedFields = ["term", "definition", "example", "synonyms"];
    const requestedFields = Array.isArray(body.userFields)
      ? body.userFields.filter((field) => allowedFields.includes(field))
      : allowedFields;
    const userInputMap =
      body.userInput && typeof body.userInput === "object" ? body.userInput : null;
    const fieldsToReview = requestedFields.filter((field) => {
      const value = body[field];
      if (!value) return false;
      if (userInputMap) {
        return Boolean(userInputMap[field]);
      }
      return true;
    });

    if (fieldsToReview.length === 0) {
      res.status(400).json({ error: "Provide at least one user-entered field to review" });
      return;
    }

    try {
      const payload = {};
      fieldsToReview.forEach((field) => {
        payload[field] = body[field];
      });

      const messages = [
        {
          role: "system",
          content: [
            "Du bist ein deutscher Lektor. Prüfe Rechtschreibung und gib Lemma/Artikel, falls es ein Nomen ist.",
            "Antworte ausschließlich mit JSON. Keine Fließtexte.",
            "Schema: { term: { corrected, suggestions, lemma, partOfSpeech, article }, definition: { corrected, suggestions }, example: { corrected, suggestions }, synonyms: { corrected, suggestions } }",
            "Für nicht gelieferte Felder: keinen Schlüssel ausgeben.",
            "Für Felder ohne Änderung: corrected = null, suggestions = [].",
            "suggestions ist ein Array von Objekten { from, to, reason }.",
            "partOfSpeech: Array mit null bis n Einträgen aus: noun, verb, adjective, adverb, interjection, particle, conjunction, preposition, phrase.",
            "article: Wenn partOfSpeech ein Nomen enthält, MUSS der beste Artikel (der/die/das) gesetzt werden; sonst null.",
            "Großschreibung: Wenn partOfSpeech ein Nomen enthält, setze corrected auf die großgeschriebene Form des Lemmas, falls es klein geschrieben wurde.",
            "Sprache ist immer Deutsch; keine Halluzinationen hinzufügen, Sinn nicht verändern."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        response_format: { type: "json_object" },
        temperature: 0
      });

      const raw = completion.choices?.[0]?.message?.content;
      if (!raw) {
        throw new Error("Empty response");
      }

      const parsed = JSON.parse(raw);
      const result = {};
      fieldsToReview.forEach((field) => {
        const value = parsed[field];
        if (value && typeof value === "object") {
          const normalizedPos = normalizePartOfSpeech(value.partOfSpeech || value.pos);
          const original = body[field];
          result[field] = {
            corrected:
              typeof value.corrected === "string" && value.corrected.trim()
                ? value.corrected
                : null,
            suggestions: Array.isArray(value.suggestions) ? value.suggestions : [],
            lemma:
              typeof value.lemma === "string" && value.lemma.trim() ? value.lemma.trim() : null,
            partOfSpeech: normalizedPos.length ? normalizedPos : [],
            article:
              typeof value.article === "string" && value.article.trim()
                ? value.article.trim().toLowerCase()
                : null
          };

          if (field === "term" && result[field].partOfSpeech.includes("noun")) {
            const originalTerm = typeof original === "string" ? original : "";
            const base = result[field].corrected || originalTerm;
            const capitalized = capitalizeFirst(base);
            if (capitalized && capitalized !== base) {
              result[field].corrected = capitalized;
              result[field].suggestions =
                result[field].suggestions && Array.isArray(result[field].suggestions)
                  ? result[field].suggestions
                  : [];
              result[field].suggestions.push({
                from: originalTerm || base,
                to: capitalized,
                reason: "Großschreibung (Nomen)"
              });
            }
          }
        } else {
          result[field] = { corrected: null, suggestions: [], partOfSpeech: [], article: null, lemma: null };
        }
      });

      res.json(result);
    } catch (error) {
      console.error("Spell review failed", error);
      res.status(500).json({ error: "Spell review failed" });
    }
  });
});

const allowedPos = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "interjection",
  "particle",
  "conjunction",
  "preposition",
  "phrase"
];

const normalizePartOfSpeech = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const normalized = list
    .map((item) => String(item).toLowerCase().trim())
    .filter((item) => allowedPos.includes(item));
  const unique = Array.from(new Set(normalized));
  return unique.slice(0, 1); // enforce single primary POS
};

const capitalizeFirst = (value) => {
  if (!value || typeof value !== "string") return value;
  if (value.length === 0) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
};

const normalizeArticle = (value) => {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase().trim();
  if (["der", "die", "das"].includes(normalized)) return normalized;
  return undefined;
};

const validateMorphology = (partOfSpeech, article) => {
  const normalizedPos = normalizePartOfSpeech(partOfSpeech);
  const normalizedArticle = normalizeArticle(article);

  if (normalizedPos.includes("noun")) {
    if (!normalizedArticle) {
      return { error: "Artikel ist für Nomen erforderlich." };
    }
    return { partOfSpeech: normalizedPos, article: normalizedArticle };
  }

  return { partOfSpeech: normalizedPos, article: undefined };
};

app.post("/api/entries", requireAuth, async (req, res) => {
    const { term, definition, example, synonyms, partOfSpeech, article } = req.body || {};

  if (!term || !definition) {
    res.status(400).json({ error: "term and definition are required" });
    return;
  }

  const morph = validateMorphology(partOfSpeech, article);
  if (morph.error) {
    res.status(400).json({ error: morph.error });
    return;
  }

  try {
    const entry = await Entry.create({
      term,
      definition,
      example,
      synonyms,
      partOfSpeech: morph.partOfSpeech,
      article: morph.article
    });
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
  const { term, definition, example, synonyms, partOfSpeech, article } = req.body || {};
  const { id } = req.params || {};

  if (!term || !definition) {
    res.status(400).json({ error: "term and definition are required" });
    return;
  }

  const morph = validateMorphology(partOfSpeech, article);
  if (morph.error) {
    res.status(400).json({ error: morph.error });
    return;
  }

  try {
    const updated = await Entry.findByIdAndUpdate(
      id,
      {
        term,
        definition,
        example,
        synonyms,
        partOfSpeech: morph.partOfSpeech,
        article: morph.article
      },
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
