import { useEffect, useMemo, useRef, useState } from "react";
import dudenLogo from "./img/logo_200.png";
import testimonialImage from "./img/Testimonial.png";
import qrCode from "./img/WarefsDuden.svg";

const emptyForm = {
  term: "",
  definition: "",
  example: "",
  synonyms: "",
  partOfSpeech: "",
  article: ""
};
const asText = (value) => (typeof value === "string" ? value : value ? String(value) : "");
const LOWERCASE_HINTS = ["tatsächlich"];
const PART_LABELS = {
  noun: "Nomen",
  verb: "Verb",
  adjective: "Adjektiv",
  adverb: "Adverb",
  interjection: "Interjektion",
  particle: "Partikel",
  conjunction: "Konjunktion",
  preposition: "Präposition",
  phrase: "Redewendung"
};

const partLabel = (entry) => {
  const key = asText(entry?.partOfSpeech).toLowerCase();
  const label = PART_LABELS[key];
  if (!label) return "";
  if (key === "noun" && entry?.article) {
    return `${entry.article} · ${label}`;
  }
  return label;
};

const displayTerm = (entry) => {
  const term = asText(entry?.term).trim();
  if (!term) return "";
  const key = asText(entry?.partOfSpeech).toLowerCase();
  const article = asText(entry?.article).trim();
  if (key === "noun" && article) {
    return `${term}, ${article}`;
  }
  return term;
};

const findLowercaseIssues = (text) => {
  if (!text) return [];
  const issues = new Set();
  LOWERCASE_HINTS.forEach((word) => {
    const pattern = new RegExp(`\\b${word[0].toUpperCase()}${word.slice(1)}\\b`, "g");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const idx = match.index;
      // Skip if at start or directly after sentence delimiters (valid Großschreibung)
      if (idx === 0) continue;
      const prev = text.slice(0, idx).trimEnd();
      const lastChar = prev.slice(-1);
      if ([".", "!", "?", ";", ":"].includes(lastChar)) continue;
      issues.add(word);
      break;
    }
  });
  return Array.from(issues);
};

const applyLowercaseFixes = (text) => {
  if (!text) return "";
  let fixed = text;
  LOWERCASE_HINTS.forEach((word) => {
    const pattern = new RegExp(`\\b${word[0].toUpperCase()}${word.slice(1)}\\b`, "g");
    fixed = fixed.replace(pattern, word);
  });
  return fixed;
};

const sanitizeFilename = (value) => {
  if (!value) return "karte";
  return value
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "karte";
};

const wrapText = (ctx, text, maxWidth) => {
  const normalized = (text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  normalized.forEach((word) => {
    const tentative = current ? `${current} ${word}` : word;
    if (ctx.measureText(tentative).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = tentative;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : ["—"];
};

const drawWrappedText = (ctx, text, x, y, maxWidth, lineHeight) => {
  const segments = (text || "").split(/\n+/).filter(Boolean);
  const lines = segments.length > 0 ? segments : [text || "—"];
  let cursor = y;
  lines.forEach((segment, idx) => {
    const wrapped = wrapText(ctx, segment, maxWidth);
    wrapped.forEach((line, lineIndex) => {
      ctx.fillText(line, x, cursor);
      cursor += lineHeight;
    });
    if (idx < lines.length - 1) {
      cursor += lineHeight * 0.4;
    }
  });
  return cursor;
};

export default function App() {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [aiStatus, setAiStatus] = useState("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [aiPassword, setAiPassword] = useState("");
  const [reviewResult, setReviewResult] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [focusedFieldState, setFocusedFieldState] = useState(null);
  const loginFormRef = useRef(null);
  const loginInputRef = useRef(null);
  const termRef = useRef(null);
  const definitionRef = useRef(null);
  const exampleRef = useRef(null);
  const synonymsRef = useRef(null);
  const lastFocusedField = useRef(null);

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...entries].sort((a, b) =>
      (a.term || "").localeCompare(b.term || "", "de", { sensitivity: "base" })
    );
    if (!normalized) return sorted;
    return sorted.filter((entry) =>
      [entry.term, entry.definition, entry.example, entry.synonyms]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalized))
    );
  }, [entries, query]);

  const lowercaseWarnings = useMemo(
    () => ({
      definition: findLowercaseIssues(asText(form.definition)),
      example: findLowercaseIssues(asText(form.example)),
      synonyms: findLowercaseIssues(asText(form.synonyms))
    }),
    [form.definition, form.example, form.synonyms]
  );

  const safeJson = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Unerwartete Antwort vom Server");
    }
  };

  const loadEntries = async () => {
    setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/entries");
      if (!response.ok) {
        throw new Error("Einträge konnten nicht geladen werden");
      }
      const data = await safeJson(response);
      const sorted = (Array.isArray(data) ? data : []).sort((a, b) =>
        (a.term || "").localeCompare(b.term || "", "de", { sensitivity: "base" })
      );
      setEntries(sorted);
      setStatus("idle");
    } catch (err) {
      setError(err.message || "Einträge konnten nicht geladen werden");
      setStatus("error");
    }
  };

  useEffect(() => {
    loadEntries();
    fetch("/api/auth/status", { credentials: "include" })
      .then((response) => response.json())
      .then((payload) => setIsLoggedIn(Boolean(payload.loggedIn)))
      .catch(() => setIsLoggedIn(false));
  }, []);

  useEffect(() => {
    const seen = localStorage.getItem("dudenOverlaySeen");
    if (!seen) {
      setShowOverlay(true);
      localStorage.setItem("dudenOverlaySeen", "1");
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      setShowSidebar(true);
    }
  }, [isLoggedIn]);

  const openOverlay = () => {
    setShowOverlay(true);
  };

  const openHelp = () => {
    setShowHelp(true);
  };

  const closeHelp = () => {
    setShowHelp(false);
  };

  const openLoginPanel = () => {
    setShowSidebar(true);
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 980px)").matches) {
        loginFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      loginInputRef.current?.focus();
    });
  };

  const updateForm = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };
  const updatePartOfSpeech = (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      partOfSpeech: value,
      article: value === "noun" ? current.article : ""
    }));
  };
  const updateArticle = (event) => {
    setForm((current) => ({ ...current, article: event.target.value }));
  };
  const applyMorphologyFromReview = (reviewData) => {
    const termReview = reviewData?.term;
    if (!termReview) return;
    const suggestedPos = asText(termReview.partOfSpeech).trim().toLowerCase();
    const suggestedArticle = asText(termReview.article).trim().toLowerCase();
    if (!suggestedPos && !suggestedArticle) return;

    setForm((current) => {
      const currentPos = asText(current.partOfSpeech).trim().toLowerCase();
      const currentArticle = asText(current.article).trim().toLowerCase();
      let changed = false;
      const next = { ...current };

      if (!currentPos && suggestedPos) {
        next.partOfSpeech = suggestedPos;
        changed = true;
        if (suggestedPos !== "noun") {
          next.article = "";
        }
      }

      const targetPos = next.partOfSpeech || suggestedPos;
      if (targetPos === "noun" && !currentArticle && suggestedArticle) {
        next.article = suggestedArticle;
        changed = true;
      }

      return changed ? next : current;
    });
  };
  const rememberFocus = (field) => () => {
    lastFocusedField.current = field;
    setFocusedFieldState(field);
  };

  const applyLowercaseSuggestionFor = (field) => {
    setForm((current) => ({
      ...current,
      [field]: applyLowercaseFixes(asText(current[field]))
    }));
  };

  const downloadCard = async (entry) => {
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready.catch(() => null);
      }

      const loadImage = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });

      const [logoImg, qrImg] = await Promise.all([
        loadImage(dudenLogo).catch(() => null),
        loadImage(qrCode).catch(() => null)
      ]);

      const width = 900;
      const height = 540;
      const padding = 40;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#d6cfc2";
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, width - 20, height - 20);

      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(0, 0, width, 92);
      ctx.fillStyle = "#111111";
      ctx.fillRect(0, 84, width, 8);

      if (logoImg) {
        const logoHeight = 52;
        const ratio = logoImg.width ? logoHeight / logoImg.height : 1;
        const logoWidth = logoImg.width ? logoImg.width * ratio : 140;
        ctx.drawImage(logoImg, padding, 24, logoWidth, logoHeight);
      }

      ctx.fillStyle = "#111111";
      ctx.font = "700 22px 'Libre Baskerville', serif";
      const titleX = logoImg ? padding + 170 : padding;
      ctx.fillText("OG GERMAN MASTERCLASS", titleX, 56);
      const qrSize = 72;
      const qrY = Math.max(8, (84 - qrSize) / 2);
      const qrX = qrImg ? width - padding - qrSize : width - padding;
      if (qrImg) {
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      }

      let cursorY = 150;
      const cardTerm = displayTerm(entry) || "Unbenannt";
      ctx.font = "700 34px 'Libre Baskerville', serif";
      ctx.fillText(cardTerm, padding, cursorY);
      cursorY += 28;

      ctx.font = "600 12px 'Source Sans 3','Segoe UI',sans-serif";
      ctx.fillStyle = "#4d4d4d";
      const posDescriptor = partLabel(entry);
      const descriptor = posDescriptor
        ? `Eintrag · Persönliche Notiz · ${posDescriptor}`
        : "Eintrag · Persönliche Notiz";
      ctx.fillText(descriptor, padding, cursorY);
      cursorY += 28;

      const maxWidth = width - padding * 2;
      const addSection = (label, content) => {
        ctx.fillStyle = "#111111";
        ctx.font = "700 13px 'Source Sans 3','Segoe UI',sans-serif";
        ctx.fillText(label, padding, cursorY);
        cursorY += 18;
        ctx.font = "400 13px 'Source Sans 3','Segoe UI',sans-serif";
        ctx.fillStyle = "#111111";
        cursorY = drawWrappedText(ctx, content || "—", padding, cursorY, maxWidth, 20);
        cursorY += 12;
      };

      addSection("Bedeutung", entry.definition);
      if (entry.example) {
        addSection("Gebrauch", entry.example);
      }
      if (entry.synonyms) {
        addSection("Synonyme", entry.synonyms);
      }

      ctx.fillStyle = "#4d4d4d";
      ctx.font = "600 11px 'Source Sans 3','Segoe UI',sans-serif";
      ctx.fillText("warefs-duden.de · Persönliche Lernkarte", padding, height - 26);

      const filename = `${sanitizeFilename(entry.term)}-karte.png`;
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = filename;
      link.click();
      link.remove();
    } catch (err) {
      console.error("Karte konnte nicht exportiert werden", err);
      setError("Karte konnte nicht erstellt werden.");
      setTimeout(() => setError(""), 3000);
    }
  };

  const submitEntry = async (event) => {
    event.preventDefault();
    if (!isLoggedIn) {
      setError("Bitte zuerst anmelden, um Einträge zu speichern.");
      return;
    }

    setStatus("saving");
    setError("");

    try {
      const normalizedPos = asText(form.partOfSpeech).trim().toLowerCase();
      const normalizedArticle = asText(form.article).trim().toLowerCase();
      if (normalizedPos === "noun" && !normalizedArticle) {
        setError("Bitte Artikel für Nomen auswählen.");
        setStatus("idle");
        return;
      }

      const payload = {
        term: asText(form.term).trim(),
        definition: asText(form.definition).trim(),
        example: asText(form.example).trim(),
        synonyms: asText(form.synonyms).trim(),
        partOfSpeech: normalizedPos || undefined,
        article: normalizedPos === "noun" ? normalizedArticle : undefined
      };

      let response;
      if (editingId) {
        response = await fetch(`/api/entries/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload)
        });
      } else {
        response = await fetch("/api/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload)
        });
      }

      if (!response.ok) {
        const payload = await safeJson(response).catch(() => ({}));
        throw new Error(payload.error || "Eintrag konnte nicht gespeichert werden");
      }

      setForm(emptyForm);
      setEditingId(null);
      await loadEntries();
      setStatus("idle");
    } catch (err) {
      setError(err.message || "Eintrag konnte nicht gespeichert werden");
      setStatus("error");
    }
  };

  const startEdit = (entry) => {
    setForm({
      term: asText(entry.term),
      definition: asText(entry.definition),
      example: asText(entry.example),
      synonyms: asText(entry.synonyms),
      partOfSpeech: asText(entry.partOfSpeech),
      article: asText(entry.article)
    });
    setEditingId(entry._id);
    requestAnimationFrame(() => {
      const formAnchor = document.getElementById("duden-form");
      if (formAnchor) {
        formAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  };

  const reviewFocusedField = async (field, value) => {
    if (!field || !value) {
      setReviewResult(null);
      return null;
    }
    try {
      const payload = { [field]: value };
      const response = await fetch("/api/entries/spellcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      const data = await safeJson(response);
      if (!response.ok) {
        throw new Error(data.error || "Rechtschreibprüfung fehlgeschlagen");
      }
      setReviewResult(data);
      return data;
    } catch (err) {
      console.error("Review failed", err);
      setReviewResult(null);
      return null;
    }
  };

  const applyReviewSuggestion = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setReviewResult(null);
  };

  const deleteEntry = async (entry) => {
    if (!isLoggedIn) {
      setError("Bitte zuerst anmelden, um Einträge zu löschen.");
      return;
    }
    if (!window.confirm(`Eintrag "${entry.term}" wirklich löschen?`)) {
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const response = await fetch(`/api/entries/${entry._id}`, {
        method: "DELETE",
        credentials: "include"
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "Eintrag konnte nicht gelöscht werden");
      }
      await loadEntries();
      setStatus("idle");
    } catch (err) {
      setError(err.message || "Eintrag konnte nicht gelöscht werden");
      setStatus("error");
    }
  };
  const completeWithAi = async () => {
    if (!isLoggedIn) {
      setAiStatus("error");
      setAiMessage("Bitte zuerst anmelden, um KI zu verwenden.");
      return;
    }

    const activeElement = document.activeElement;
    const domFocusedField =
      activeElement === termRef.current
        ? "term"
        : activeElement === definitionRef.current
          ? "definition"
          : activeElement === exampleRef.current
            ? "example"
            : activeElement === synonymsRef.current
              ? "synonyms"
              : null;
    const focusedField = lastFocusedField.current || domFocusedField;

    const hasTerm = asText(form.term).trim();
    const hasDefinition = asText(form.definition).trim();
    const hasExample = asText(form.example).trim();
    const hasSynonyms = asText(form.synonyms).trim();
    const fieldLabel = (field) => {
      if (field === "term") return "Lemma";
      if (field === "definition") return "Bedeutung";
      if (field === "example") return "Gebrauch";
      return "Synonyme";
    };
    const fieldsToReplace = focusedField
      ? ["term", "definition", "example", "synonyms"].filter((field) => field !== focusedField)
      : ["term", "definition", "example", "synonyms"];
    const fieldsLabel = fieldsToReplace.map(fieldLabel).join(", ");
    const shouldConfirm = focusedField
      ? fieldsToReplace.some((field) => {
          if (field === "term") return hasTerm;
          if (field === "definition") return hasDefinition;
          if (field === "example") return hasExample;
          return hasSynonyms;
        })
      : Boolean(hasTerm || hasDefinition || hasExample || hasSynonyms);
    if (shouldConfirm) {
      const confirmCopy = `Ich werde neue Werte für ${fieldsLabel} hinzufügen. Vorhandene Inhalte werden ersetzt.`;
      if (!window.confirm(confirmCopy)) {
        return;
      }
    }

    const focusTarget = focusedField
      ? focusedField === "term"
        ? termRef
        : focusedField === "definition"
          ? definitionRef
          : focusedField === "example"
            ? exampleRef
            : synonymsRef
      : hasTerm
        ? termRef
        : hasDefinition
          ? definitionRef
          : hasExample
            ? exampleRef
            : hasSynonyms
              ? synonymsRef
              : null;

    if (focusTarget?.current) {
      requestAnimationFrame(() => focusTarget.current?.focus());
    }

    if (focusedField) {
      setForm((current) => ({
        ...current,
        term: focusedField === "term" ? current.term : "",
        definition: focusedField === "definition" ? current.definition : "",
        example: focusedField === "example" ? current.example : "",
        synonyms: focusedField === "synonyms" ? current.synonyms : ""
      }));
    }

    setAiStatus("loading");
    setAiMessage("");
    setError("");
    setReviewResult(null);
    const reviewFieldValue = focusedField ? asText(form[focusedField]).trim() : "";
    try {
      if (focusedField === "term" && reviewFieldValue) {
        const reviewData = await reviewFocusedField(focusedField, reviewFieldValue);
        applyMorphologyFromReview(reviewData);
      }

      const normalizedPos = asText(form.partOfSpeech).trim().toLowerCase();
      const normalizedArticle = asText(form.article).trim().toLowerCase();
      const focusedPayload = focusedField
        ? {
            term: focusedField === "term" ? hasTerm || undefined : undefined,
            definition: focusedField === "definition" ? hasDefinition || undefined : undefined,
            example: focusedField === "example" ? hasExample || undefined : undefined,
            synonyms: focusedField === "synonyms" ? hasSynonyms || undefined : undefined
          }
        : {
            term: hasTerm || undefined,
            definition: hasDefinition || undefined,
            example: hasExample || undefined,
            synonyms: hasSynonyms || undefined
          };
      focusedPayload.partOfSpeech = normalizedPos || undefined;
      focusedPayload.article = normalizedPos === "noun" ? normalizedArticle : undefined;
      const response = await fetch("/api/entries/ai-complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(focusedPayload)
      });

      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "KI-Vervollständigung fehlgeschlagen");
      }

      setForm((current) => {
        const payloadPos = asText(payload.partOfSpeech).trim().toLowerCase();
        const payloadArticle = asText(payload.article).trim().toLowerCase();
        const nextPos = payloadPos || asText(current.partOfSpeech).trim().toLowerCase();
        const nextArticle = nextPos === "noun"
          ? payloadArticle || asText(current.article).trim().toLowerCase()
          : "";
        if (!focusedField) {
          return {
            ...current,
            term: asText(payload.term) || current.term,
            definition: asText(payload.definition) || current.definition,
            example: asText(payload.example) || current.example,
            synonyms: asText(payload.synonyms) || current.synonyms,
            partOfSpeech: nextPos,
            article: nextArticle
          };
        }
        return {
          ...current,
          term: focusedField === "term" ? current.term : asText(payload.term) ?? "",
          definition:
            focusedField === "definition" ? current.definition : asText(payload.definition) ?? "",
          example: focusedField === "example" ? current.example : asText(payload.example) ?? "",
          synonyms:
            focusedField === "synonyms" ? current.synonyms : asText(payload.synonyms) ?? "",
          partOfSpeech: nextPos,
          article: nextArticle
        };
      });
      setAiStatus("success");
      setAiMessage("Felder wurden ergänzt.");
      if (focusedField && reviewFieldValue) {
        await reviewFocusedField(focusedField, reviewFieldValue);
      }
    } catch (err) {
      setAiStatus("error");
      setAiMessage(err.message || "KI-Vervollständigung fehlgeschlagen");
    }
  };

  const aiButtonLabel = () => {
    const field = focusedFieldState || lastFocusedField.current;
    if (aiStatus === "loading") return "KI denkt ...";
    if (!field) return "Mit KI ergänzen";
    const labelMap = {
      term: "KI: Beschreibung, Gebrauch und Synonyme",
      definition: "KI: Lemma, Gebrauch und Synonyme",
      example: "KI: Lemma, Beschreibung und Synonyme",
      synonyms: "KI: Lemma, Beschreibung und Gebrauch"
    };
    return labelMap[field] || "Mit KI ergänzen";
  };

  const loginForAi = async (event) => {
    event.preventDefault();
    setAiStatus("loading");
    setAiMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: aiPassword }),
        credentials: "include"
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "Login fehlgeschlagen");
      }
      setIsLoggedIn(true);
      setAiPassword("");
      setAiStatus("success");
      setAiMessage("KI-Zugang aktiv.");
      setShowSidebar(true);
    } catch (err) {
      setAiStatus("error");
      setAiMessage(err.message || "Login fehlgeschlagen");
    }
  };

  const logoutAi = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(
      () => null
    );
    setIsLoggedIn(false);
    setShowSidebar(false);
  };

  return (
    <div className="duden">
      {showOverlay ? (
        <div
          className="duden-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowOverlay(false)}
        >
          <div className="duden-overlay-heart">
            <div className="duden-overlay-inner">
              <div className="duden-overlay-text">
              <p className="duden-overlay-level"> Happy Birthday Waref,<br/>you have reached level 40</p>
              {/* <p></p> */}
              <p>
                As the rotting-braincell-struggle is real,
                <br />
                this pocket survival kit may assist you to  mastering German small talk under real-world conditions.
              </p>
              <p>Nobody’s gonna know.<br/>Have phun!<br />Akin</p>

            </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="duden-frame">
        <header className="duden-brandbar">
          <div className="duden-logo-wrap">
            <img className="duden-logo" src={dudenLogo} alt="DUDEN" />
          </div>
          <div className="duden-branding">
            <p className="duden-eyebrow">
              AI-supported, really clever Edition
            </p>
            <p className="duden-slogan">OG German Masterclass</p>
            <p className="duden-subtitle">
              Für jeden, der die deutsche Sprache ernst nimmt – und damit alles richtig macht. 
            </p>
          </div>
          <div className="duden-brand-actions">
            {isLoggedIn ? (
              <button
                type="button"
                className="duden-logout"
                onClick={logoutAi}
              >
                Abmelden
              </button>
            ) : !showSidebar ? (
              <button
                type="button"
                className="duden-login-link"
                onClick={openLoginPanel}
              >
                Login
              </button>
            ) : null}
          </div>
        </header>
        {showHelp ? (
          <div className="duden-overlay" role="dialog" aria-modal="true" onClick={closeHelp}>
            <div className="duden-help" onClick={(event) => event.stopPropagation()}>
              <div className="duden-help-header">
                <h2>Hilfe &amp; Ablauf</h2>
                <button type="button" className="duden-secondary" onClick={closeHelp}>
                  Schließen
                </button>
              </div>
              <div className="duden-help-body">
                <div className="duden-help-section">
                  <h3>So nutzt du die App</h3>
                  <ul>
                    <li>Anmelden (oben rechts), dann ein Lemma eintragen.</li>
                    <li>Beim Klick auf „Mit KI ergänzen“ prüft GPT‑4o Rechtschreibung, Wortart (inkl. Redewendungen) und Artikel; Vorschläge sind optional, der Flow blockiert nicht.</li>
                    <li>Die ermittelte Wortart/Artikel werden ins Formular übernommen; danach ergänzt die KI Bedeutung, Gebrauch und Synonyme.</li>
                    <li>Speichern mit „Eintrag speichern“; Bearbeiten/Löschen nur im Login.</li>
                  </ul>
                </div>
                <div className="duden-help-section">
                  <h3>Technischer Überblick</h3>
                  <ul>
                    <li>Rechtschreibprüfung/Lemmatisierung: GPT‑4o liefert {`{corrected, suggestions, lemma, partOfSpeech, article}`} für noun, verb, adjective, adverb, interjection, particle, conjunction, preposition, phrase.</li>
                    <li>KI-Vervollständigung: OpenAI füllt fehlende Felder; vorhandene Inhalte bleiben erhalten.</li>
                    <li>Persistenz: MongoDB (Container) hält alle Einträge; API lauscht auf Port 4000, Frontend auf 80.</li>
                    <li>Sicherheit: Login via ADMIN_PASSWORD aktiviert Bearbeiten/Löschen/KI.</li>
                  </ul>
                </div>
                <div className="duden-help-section">
                  <h3>Qualität &amp; Tests</h3>
                  <p className="duden-help-text">
                    Letzter Check: 20 Stichproben (Nomen/Verb/Adj/Adv/Interjektion/Partikel/Konjunktion/Präposition/Redewendung) direkt gegen GPT‑4o mit der obigen JSON-Vorgabe. Ergebnis: 19/20 korrekt (95 %); einziger Fehl-Treffer: „schnell“ wurde als Adjektiv statt Adverb eingestuft.
                  </p>
                </div>
                <div className="duden-help-section">
                  <h3>Contribute</h3>
                <p className="duden-help-text">
                  Ideen, Fehler oder Verbesserungen? Eröffne ein Issue oder eine PR. Bitte keine Secrets pushen;
                  nutze Platzhalter in <code>.env.example</code>.
                </p>
                <a
                  className="duden-link-button"
                  href="https://github.com/tekercibasi/warefs-duden"
                  target="_blank"
                  rel="noreferrer"
                >
                  Zum GitHub-Repo
                </a>
              </div>
            </div>
          </div>
          </div>
        ) : null}
        <main className="duden-page">

          <div className="duden-content">
            <section className="duden-entries">
              <div className="duden-search">
                <label htmlFor="search">Suche</label>
                <input
                  id="search"
                  type="search"
                  placeholder="Eintrag suchen"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <span className="duden-count">{filteredEntries.length} Einträge</span>
              </div>

              {status === "loading" && (
                <p className="duden-status" role="status">
                  Einträge werden geladen ...
                </p>
              )}
              {error && <p className="duden-error">{error}</p>}

              <div className="duden-list">
                {filteredEntries.length === 0 && status !== "loading" ? (
                  <p className="duden-status">Noch keine Einträge vorhanden.</p>
                ) : (
                  filteredEntries.map((entry, index) => (
                    <article
                      className="duden-entry"
                      key={entry._id}
                      style={{ animationDelay: `${index * 70}ms` }}
                    >
                      <h3>{displayTerm(entry)}</h3>
                      <p className="duden-entry-type">
                        Eintrag · Persönliche Notiz
                        {partLabel(entry) ? ` · ${partLabel(entry)}` : ""}
                      </p>
                      <div className="duden-entry-block">
                        <span>Bedeutung:</span>
                        <p>{entry.definition}</p>
                      </div>
                      {entry.example ? (
                        <div className="duden-entry-block">
                          <span>Gebrauch:</span>
                          <p>{entry.example}</p>
                        </div>
                      ) : null}
                      {entry.synonyms ? (
                        <div className="duden-entry-block">
                          <span>Synonyme:</span>
                          <p>{entry.synonyms}</p>
                        </div>
                      ) : null}
                      <div className="duden-entry-actions">
                        <button
                          type="button"
                          className="duden-card"
                          onClick={() => downloadCard(entry)}
                          title="Lernkarte herunterladen"
                        >
                          Karte
                        </button>
                        {isLoggedIn ? (
                          <>
                            <button
                              type="button"
                              className="duden-edit"
                              onClick={() => startEdit(entry)}
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              className="duden-edit"
                              onClick={() => deleteEntry(entry)}
                            >
                              Löschen
                            </button>
                          </>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            {(showSidebar || isLoggedIn) ? (
              <aside className="duden-side">
                {isLoggedIn ? (
                  <form id="duden-form" onSubmit={submitEntry} className="duden-form">
                    <div className="duden-form-header">
                      <h2>{editingId ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h2>
                      {editingId ? <span className="duden-pill">Editor-Modus</span> : null}
                    </div>
                    <label>
                      Lemma
                      <input
                        type="text"
                        value={form.term}
                        onChange={updateForm("term")}
                        onFocus={rememberFocus("term")}
                        placeholder="Wort oder Wendung"
                        required
                        ref={termRef}
                      />
                      {(() => {
                        const suggestions = reviewResult?.term?.suggestions || [];
                        const corrected = reviewResult?.term?.corrected;
                        const items =
                          suggestions.length > 0
                            ? suggestions
                            : corrected
                              ? [{ from: form.term, to: corrected }]
                              : [];
                        if (items.length === 0) return null;
                        return (
                          <div className="duden-lowercase-hint">
                            <p className="duden-status">
                              Meintest du:{" "}
                              {items
                                .map((item) => item.to || item.suggestion || item.corrected)
                                .filter(Boolean)
                                .join(", ")}
                              ?
                            </p>
                            {items.map((item, index) => {
                              const target = item.to || item.suggestion || item.corrected;
                              if (!target) return null;
                              return (
                                <button
                                  key={`term-s-${index}`}
                                  type="button"
                                  className="duden-secondary"
                                  onClick={() => applyReviewSuggestion("term", target)}
                                >
                                  {(item.from || item.wrong || "Eingabe")} → {target}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </label>
                    <div className="duden-inline">
                      <label>
                        Wortart
                        <select value={form.partOfSpeech} onChange={updatePartOfSpeech}>
                          <option value="">Bitte wählen</option>
                          <option value="noun">Nomen</option>
                          <option value="verb">Verb</option>
                          <option value="adjective">Adjektiv</option>
                          <option value="adverb">Adverb</option>
                          <option value="interjection">Interjektion</option>
                          <option value="particle">Partikel</option>
                          <option value="conjunction">Konjunktion</option>
                          <option value="preposition">Präposition</option>
                          <option value="phrase">Redewendung</option>
                        </select>
                      </label>
                      {form.partOfSpeech === "noun" ? (
                        <label>
                          Artikel
                          <select value={form.article} onChange={updateArticle} required>
                            <option value="">Bitte wählen</option>
                            <option value="der">der</option>
                            <option value="die">die</option>
                            <option value="das">das</option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                    <label>
                      Bedeutung
                      <textarea
                        value={form.definition}
                        onChange={updateForm("definition")}
                        onFocus={rememberFocus("definition")}
                        placeholder="Beschreibung oder Bedeutung"
                        required
                        rows="4"
                        ref={definitionRef}
                      />
                      {lowercaseWarnings.definition.length > 0 ? (
                        <div className="duden-lowercase-hint">
                          <p className="duden-status">
                            Hinweis: {lowercaseWarnings.definition.join(", ")} schreibt man klein.
                          </p>
                          <button
                            type="button"
                            className="duden-secondary"
                            onClick={() => applyLowercaseSuggestionFor("definition")}
                          >
                            Korrektur anwenden
                          </button>
                        </div>
                      ) : null}
                    </label>
                    <label>
                      Gebrauch (optional)
                      <textarea
                        value={form.example}
                        onChange={updateForm("example")}
                        onFocus={rememberFocus("example")}
                        placeholder="Beispiel oder Kontext"
                        rows="3"
                        ref={exampleRef}
                      />
                      {lowercaseWarnings.example.length > 0 ? (
                        <div className="duden-lowercase-hint">
                          <p className="duden-status">
                            Hinweis: {lowercaseWarnings.example.join(", ")} schreibt man klein.
                          </p>
                          <button
                            type="button"
                            className="duden-secondary"
                            onClick={() => applyLowercaseSuggestionFor("example")}
                          >
                            Korrektur anwenden
                          </button>
                        </div>
                      ) : null}
                    </label>
                    <label>
                      Synonyme / Alternativen (optional)
                      <textarea
                        value={form.synonyms}
                        onChange={updateForm("synonyms")}
                        onFocus={rememberFocus("synonyms")}
                        placeholder="Alternative Formulierungen oder Synonyme"
                        rows="3"
                        ref={synonymsRef}
                      />
                      {lowercaseWarnings.synonyms.length > 0 ? (
                        <div className="duden-lowercase-hint">
                          <p className="duden-status">
                            Hinweis: {lowercaseWarnings.synonyms.join(", ")} schreibt man klein.
                          </p>
                          <button
                            type="button"
                            className="duden-secondary"
                            onClick={() => applyLowercaseSuggestionFor("synonyms")}
                          >
                            Korrektur anwenden
                          </button>
                        </div>
                      ) : null}
                    </label>
                    <div className="duden-ai">
                      <button
                        type="button"
                        className="duden-secondary"
                        onClick={completeWithAi}
                        disabled={aiStatus === "loading"}
                      >
                        {aiButtonLabel()}
                      </button>
                      {aiMessage ? (
                        <p className={aiStatus === "error" ? "duden-error" : "duden-status"}>
                          {aiMessage}
                        </p>
                      ) : null}
                    </div>
                    <button type="submit" className="duden-save" disabled={status === "saving"}>
                      {status === "saving" ? "Speichern ..." : "Eintrag speichern"}
                    </button>
                    {editingId && isLoggedIn ? (
                      <button type="button" className="duden-secondary" onClick={cancelEdit}>
                        Bearbeitung abbrechen
                      </button>
                    ) : null}
                  </form>
                ) : (
                  <form
                    className="duden-form duden-login"
                    onSubmit={loginForAi}
                    ref={loginFormRef}
                  >
                    <div className="duden-form-header">
                      <h2>Editor freischalten</h2>
                      <span className="duden-pill">Login</span>
                    </div>
                    <div className="duden-ai-login">
                      <label>
                        Login
                        <input
                          type="password"
                          value={aiPassword}
                          onChange={(event) => setAiPassword(event.target.value)}
                          placeholder="Passwort eingeben"
                          ref={loginInputRef}
                        />
                      </label>
                    </div>
                    <div className="duden-ai-actions">
                      <button type="submit" className="duden-secondary">
                        Anmelden
                      </button>
                    </div>
                    {aiMessage ? (
                      <p className={aiStatus === "error" ? "duden-error" : "duden-status"}>
                        {aiMessage}
                      </p>
                    ) : null}
                  </form>
                )}

              <div className="duden-note">
                Sprachwissenschaftliche Anmerkung: Die hier aufgeführten Ausdrücke
                gelten als korrekt, präzise und gepflegt. Im mündlichen Alltag
                können sie jedoch als überformell oder unbeabsichtigt ironisch
                wahrgenommen werden, insbesondere bei Sprecher:innen unter 35 Jahren.
              </div>

            </aside>
            ) : null}
          </div>
          <footer className="duden-footer">
            <img
              src={testimonialImage}
              alt="Testimonial"
              className="duden-footer-testimonial"
              loading="lazy"
            />
            <div className="duden-footer-actions">
              <button type="button" className="duden-link-button" onClick={openHelp}>
                Help
              </button>
              <button type="button" className="duden-footer-button" onClick={openOverlay}>
                <span className="duden-heart duden-heart--mini" aria-hidden="true" />
                Made with love
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
