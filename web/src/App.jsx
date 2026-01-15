import { useEffect, useMemo, useRef, useState } from "react";
import dudenLogo from "./img/logo_200.png";
import testimonialImage from "./img/Testimonial.png";
import qrCode from "./img/WarefsDuden.svg";
import dIcon from "./img/D.svg";

const emptyForm = {
  term: "",
  definition: "",
  example: "",
  synonyms: "",
  partOfSpeech: [],
  article: ""
};
const asText = (value) => (typeof value === "string" ? value : value ? String(value) : "");
const asArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
};
const capitalizeFirst = (value) => {
  if (!value || typeof value !== "string") return value;
  if (value.length === 0) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
};
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
const PART_OPTIONS = Object.entries(PART_LABELS).map(([value, label]) => ({ value, label }));
const AI_SITUATION_META = [
  {
    key: "arbeit",
    label: "Karrieregefährdend · HR-sensibel · Meeting-ungeeignet · Nicht zitierfähig",
    icon: "⚠"
  },
  {
    key: "schwiegereltern",
    label: "Schwiegerelternkritisch · Sonntagsessen-ungeeignet · Erklärungsbedürftig",
    icon: "❤"
  },
  {
    key: "philosophie_3uhr",
    label: "3-Uhr-tauglich · Tee & These · Gedankenschwer · Leicht überhöht",
    icon: "☕"
  },
  {
    key: "gasse_betrunken",
    label: "Gassentauglich · Promillefest · Freundeskreis erprobt · Grammatik optional",
    icon: "🍻"
  },
  {
    key: "behoerdlich",
    label: "Behördlich geprüft · Emotionsfrei · Haftungsarm · Unangreifbar",
    icon: "🏛️"
  }
];
const countResults = (results) =>
  AI_SITUATION_META.reduce((sum, meta) => {
    const list = results?.[meta.key];
    return sum + (Array.isArray(list) ? list.length : 0);
  }, 0);
const defaultVisibleSituations = () => AI_SITUATION_META.map((meta) => meta.key);

const partLabel = (entry) => {
  const parts = asArray(entry?.partOfSpeech).map((p) => p.toLowerCase());
  if (parts.length === 0) return "";
  return parts
    .map((p) => PART_LABELS[p])
    .filter(Boolean)
    .join(" · ");
};

const displayTerm = (entry) => {
  const term = asText(entry?.term).trim();
  if (!term) return "";
  const key = asArray(entry?.partOfSpeech).map((p) => p.toLowerCase());
  const article = asText(entry?.article).trim();
  if (key.includes("noun") && article) {
    return `${term}, ${article}`;
  }
  return term;
};

const dudenLink = (entry) => {
  const term = asText(entry?.term).trim();
  if (!term) return "";
  return `https://www.duden.de/suchen/dudenonline/${encodeURIComponent(term)}`;
};

const findLowercaseIssues = () => [];
const applyLowercaseFixes = (text) => text || "";

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
  const [lemmaSuggestions, setLemmaSuggestions] = useState([]);
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
  const [showHelp, setShowHelp] = useState(false);
  const [showImprint, setShowImprint] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [synonymPanels, setSynonymPanels] = useState({});
  const [openSynonymId, setOpenSynonymId] = useState(null);
  const [editorMode, setEditorMode] = useState(false);
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

  useEffect(() => {
    if (showLogin) {
      requestAnimationFrame(() => {
        loginInputRef.current?.focus();
      });
    }
  }, [showLogin]);

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
      fetchAlternativeSummary(sorted);
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

  const openOverlay = () => {
    setShowOverlay(true);
  };

  const openHelp = () => {
    setShowHelp(true);
  };

  const openImprint = () => {
    setShowImprint(true);
  };

  const closeHelp = () => {
    setShowHelp(false);
  };

  const closeImprint = () => {
    setShowImprint(false);
  };

  const updateForm = (field) => (event) => {
    const nextValue = event.target.value;
    setForm((current) => ({ ...current, [field]: nextValue }));
    if (field === "term") {
      setLemmaSuggestions([]);
    }
  };
  const fetchAlternativeSummary = async (list) => {
    try {
      const response = await fetch("/api/entries/ai-alternatives/summary");
      const payload = await safeJson(response);
      if (!response.ok) return;
      const summary = payload.summary || {};
      setSynonymPanels((current) => {
        const next = { ...current };
        (Array.isArray(list) ? list : []).forEach((entry) => {
          const count = Number(summary[entry.term]) || 0;
          next[entry._id] = {
            ...(next[entry._id] || {}),
            hasStored: count > 0,
            count
          };
        });
        return next;
      });
    } catch {
      /* ignore summary errors */
    }
  };
  const togglePartOfSpeech = (value) => () => {
    setForm((current) => {
      const currentList = asArray(current.partOfSpeech).map((p) => asText(p).trim().toLowerCase());
      const has = currentList.includes(value);
      // Single selection: click toggles the value, otherwise replace with the clicked one
      const next = has ? [] : [value];
      const article = next.includes("noun") ? current.article : "";
      const nextTerm =
        next.includes("noun") && current.term ? capitalizeFirst(current.term) : current.term;
      return { ...current, partOfSpeech: next, article, term: nextTerm };
    });
  };
  const updateArticle = (event) => {
    setForm((current) => ({ ...current, article: event.target.value }));
  };
  const applyMorphologyFromReview = (reviewData) => {
    const termReview = reviewData?.term;
    if (!termReview) return;
    const suggestedPos = asArray(termReview.partOfSpeech)
      .map((p) => asText(p).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 1);
    const suggestedArticle = asText(termReview.article).trim().toLowerCase();
    if (suggestedPos.length === 0 && !suggestedArticle) return;

    setForm((current) => {
      const currentPos = asArray(current.partOfSpeech)
        .map((p) => asText(p).trim().toLowerCase())
        .filter(Boolean);
      const currentArticle = asText(current.article).trim().toLowerCase();
      let changed = false;
      const next = { ...current, partOfSpeech: currentPos };

      if (currentPos.length === 0 && suggestedPos.length > 0) {
        next.partOfSpeech = suggestedPos;
        changed = true;
        if (!suggestedPos.includes("noun")) {
          next.article = "";
        }
      }

      const targetPos = next.partOfSpeech.length ? next.partOfSpeech : suggestedPos;
      if (targetPos.includes("noun") && !currentArticle && suggestedArticle) {
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
  const isPartActive = (value) =>
    asArray(form.partOfSpeech)
      .map((p) => asText(p).trim().toLowerCase())
      .includes(value);

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
      ctx.fillText("Situative Synonym Edition", titleX, 56);
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
      const descriptor = partLabel(entry) || "Persönliche Notiz";
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
      const normalizedPos = asArray(form.partOfSpeech)
        .map((p) => asText(p).toLowerCase().trim())
        .filter(Boolean);
      const primaryPos = normalizedPos[0] ? [normalizedPos[0]] : [];
      const normalizedArticle = asText(form.article).trim().toLowerCase();
      if (primaryPos.includes("noun") && !normalizedArticle) {
        setError("Bitte Artikel für Nomen auswählen.");
        setStatus("idle");
        return;
      }

      const payload = {
        term: asText(form.term).trim(),
        definition: asText(form.definition).trim(),
        example: asText(form.example).trim(),
        synonyms: asText(form.synonyms).trim(),
        partOfSpeech: primaryPos.length ? primaryPos : undefined,
        article: primaryPos.includes("noun") ? normalizedArticle : undefined
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
      partOfSpeech: asArray(entry.partOfSpeech),
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
    if (field === "term") {
      const suggestion = asText(value);
      const hasNoun = asArray(form.partOfSpeech)
        .map((p) => asText(p).trim().toLowerCase())
        .includes("noun");
      const nextTerm = hasNoun ? capitalizeFirst(suggestion) : suggestion;
      setForm((current) => ({ ...current, term: nextTerm }));
      setLemmaSuggestions([]);
      return;
    }
    setForm((current) => ({ ...current, [field]: value }));
    setReviewResult(null);
  };

  const requestAiAlternatives = async (entry) => {
    const entryId = entry?._id;
    const itemText = asText(entry?.term);
    if (!entryId || !itemText.trim()) return;

    setOpenSynonymId(entryId);
    setSynonymPanels((current) => ({
      ...current,
      [entryId]: {
        ...current[entryId],
        status: "loading",
        error: "",
        item: itemText,
        results: current[entryId]?.results || null,
        visibleSituations: current[entryId]?.visibleSituations || defaultVisibleSituations()
      }
    }));

    try {
      const response = await fetch("/api/entries/ai-alternatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: itemText })
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "KI-Abfrage fehlgeschlagen");
      }

      const totalCount = countResults(payload.results);
      setSynonymPanels((current) => ({
        ...current,
        [entryId]: {
          status: "success",
          error: "",
          item: payload.item || itemText,
          results: payload.results || {},
          updatedAt: new Date().toISOString(),
          hasStored: totalCount > 0,
          count: totalCount,
          visibleSituations: current[entryId]?.visibleSituations || defaultVisibleSituations()
        }
      }));
    } catch (err) {
      setSynonymPanels((current) => ({
        ...current,
        [entryId]: {
          ...current[entryId],
          status: "error",
          error: err.message || "KI-Abfrage fehlgeschlagen"
        }
      }));
    }
  };

  const loadStoredAlternatives = async (entry) => {
    const entryId = entry?._id;
    if (!entryId) return;
    setSynonymPanels((current) => ({
      ...current,
      [entryId]: {
        ...(current[entryId] || {}),
        status: "loading",
        error: "",
        visibleSituations: current[entryId]?.visibleSituations || defaultVisibleSituations()
      }
    }));
    try {
      const response = await fetch(`/api/entries/${entryId}/ai-alternatives`);
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "Synonyme konnten nicht geladen werden");
      }
      const totalCount = countResults(payload.results);
      setSynonymPanels((current) => ({
        ...current,
        [entryId]: {
          ...(current[entryId] || {}),
          status: "success",
          error: "",
          item: payload.item || entry.term,
          results: payload.results || {},
          hasStored: totalCount > 0,
          count: Math.max(totalCount, current[entryId]?.count || 0),
          visibleSituations: current[entryId]?.visibleSituations || defaultVisibleSituations()
        }
      }));
    } catch (err) {
      setSynonymPanels((current) => ({
        ...current,
        [entryId]: {
          ...(current[entryId] || {}),
          status: "error",
          error: err.message || "Synonyme konnten nicht geladen werden"
        }
      }));
    }
  };

  const toggleSynonymPanel = async (entry) => {
    const entryId = entry?._id;
    if (!entryId) return;
    const nextOpen = openSynonymId === entryId ? null : entryId;
    setOpenSynonymId(nextOpen);
    if (nextOpen) {
      const panel = synonymPanels[entryId];
      if (!panel?.results && panel?.status !== "loading") {
        await loadStoredAlternatives(entry);
      }
    }
  };

  const deleteAllAlternatives = async (entry) => {
    const entryId = entry?._id;
    if (!entryId) return;
    setSynonymPanels((current) => ({
      ...current,
      [entryId]: {
        ...(current[entryId] || {}),
        status: "loading",
        error: "",
        visibleSituations: current[entryId]?.visibleSituations || defaultVisibleSituations()
      }
    }));
    try {
      const response = await fetch(`/api/entries/${entryId}/ai-alternatives`, { method: "DELETE" });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "Synonyme konnten nicht gelöscht werden");
      }
      const totalCount = countResults(payload.results);
      setSynonymPanels((current) => ({
        ...current,
        [entryId]: {
          ...(current[entryId] || {}),
          status: "idle",
          error: "",
          item: payload.item || entry.term,
          results: payload.results || {},
          hasStored: totalCount > 0,
          count: totalCount,
          visibleSituations: current[entryId]?.visibleSituations || defaultVisibleSituations()
        }
      }));
    } catch (err) {
      setSynonymPanels((current) => ({
        ...current,
        [entryId]: {
          ...(current[entryId] || {}),
          status: "error",
          error: err.message || "Synonyme konnten nicht gelöscht werden"
        }
      }));
    }
  };

  const handlePanelClick = (event, entry) => {
    if (event.target.closest("button")) return;
    toggleSynonymPanel(entry);
  };

  const toggleSituationVisibility = (entryId, key) => {
    setSynonymPanels((current) => {
      const panel = current[entryId] || {};
      const currentList = Array.isArray(panel.visibleSituations)
        ? panel.visibleSituations
        : defaultVisibleSituations();
      const has = currentList.includes(key);
      const next = has ? currentList.filter((item) => item !== key) : [...currentList, key];
      return {
        ...current,
        [entryId]: {
          ...panel,
          visibleSituations: next
        }
      };
    });
  };

  const applyLemmaSuggestion = (value) => {
    const suggestion = asText(value).trim();
    if (!suggestion) return;
    lastFocusedField.current = "term";
    setFocusedFieldState("term");
    setLemmaSuggestions([]);
    const hasNoun = asArray(form.partOfSpeech)
      .map((p) => asText(p).trim().toLowerCase())
      .includes("noun");
    setForm({
      term: hasNoun ? capitalizeFirst(suggestion) : suggestion,
      definition: "",
      example: "",
      synonyms: "",
      partOfSpeech: [],
      article: ""
    });
    requestAnimationFrame(() => {
      termRef.current?.focus();
      completeWithAi();
    });
  };

  const resetAllFields = () => {
    setForm(emptyForm);
    setLemmaSuggestions([]);
    setReviewResult(null);
    setError("");
    setAiMessage("");
    lastFocusedField.current = null;
    setFocusedFieldState(null);
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
    let focusedField = lastFocusedField.current || domFocusedField;

    const hasTerm = asText(form.term).trim();
    const hasDefinition = asText(form.definition).trim();
    const hasExample = asText(form.example).trim();
    const hasSynonyms = asText(form.synonyms).trim();
    if (!focusedField) {
      focusedField = hasTerm ? "term" : hasDefinition ? "definition" : null;
    }
    if (!focusedField || !["term", "definition"].includes(focusedField)) {
      setAiStatus("error");
      setAiMessage("KI ist nur für Lemma oder Bedeutung verfügbar.");
      return;
    }
    const fieldLabel = (field) => {
      if (field === "term") return "Lemma";
      if (field === "definition") return "Bedeutung";
      if (field === "example") return "Gebrauch";
      return "Synonyme";
    };
    const focusTarget = focusedField === "term" ? termRef : definitionRef;
    if (focusTarget?.current) {
      requestAnimationFrame(() => focusTarget.current?.focus());
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

      const normalizedPos = asArray(form.partOfSpeech)
        .map((p) => asText(p).toLowerCase().trim())
        .filter(Boolean);
      const primaryPos = normalizedPos[0] ? [normalizedPos[0]] : [];
      const normalizedArticle = asText(form.article).trim().toLowerCase();
      const focusedPayload =
        focusedField === "term"
          ? {
              term: hasTerm || undefined,
              definition: hasDefinition || undefined,
              example: hasExample || undefined,
              synonyms: hasSynonyms || undefined
            }
          : {
              term: undefined,
              definition: hasDefinition || undefined,
              example: undefined,
              synonyms: undefined
            };
      focusedPayload.partOfSpeech = primaryPos.length ? primaryPos : undefined;
      focusedPayload.article = primaryPos.includes("noun") ? normalizedArticle : undefined;
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

      if (focusedField === "definition") {
        const lemma = asText(payload.term).trim();
        if (lemma) {
          setLemmaSuggestions([lemma]);
          setAiStatus("success");
          setAiMessage("Lemma-Vorschlag verfügbar.");
        } else {
          setAiStatus("error");
          setAiMessage("Kein Lemma-Vorschlag erhalten.");
        }
      } else {
        setLemmaSuggestions([]);
        setForm((current) => {
          const payloadPos = asArray(payload.partOfSpeech)
            .map((p) => asText(p).trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 1);
          const payloadArticle = asText(payload.article).trim().toLowerCase();
          const currentPos = asArray(current.partOfSpeech)
            .map((p) => asText(p).trim().toLowerCase())
            .filter(Boolean);
          const nextPos = payloadPos.length ? payloadPos : currentPos;
          const hasNoun = nextPos.includes("noun");
          const nextArticle = hasNoun
            ? payloadArticle || asText(current.article).trim().toLowerCase()
            : "";
          return {
            ...current,
            term: current.term,
            definition: asText(payload.definition) || current.definition,
            example: asText(payload.example) || current.example,
            synonyms: asText(payload.synonyms) || current.synonyms,
            partOfSpeech: nextPos,
            article: nextArticle
          };
        });
        setAiStatus("success");
        setAiMessage("Felder wurden ergänzt.");
        if (focusedField && reviewFieldValue) {
          await reviewFocusedField(focusedField, reviewFieldValue);
        }
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
      definition: "KI: Lemma-Vorschläge holen",
      example: "KI nicht verfügbar",
      synonyms: "KI nicht verfügbar"
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
    setShowLogin(false);
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
                this pocket survival kit may assist you to  mastering German<br/> small talk under real-world conditions.
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
            <p className="duden-eyebrow">JETZT NEU: KI-gestützte Zauberformel</p>
            <p className="duden-slogan">
              <strong>Situative Synonym Edition</strong>
            </p>
            <p className="duden-subtitle">
              Das Toolkit für jeden, der über den Lemmarand denkt – und damit immer richtig liegt.
            </p>
          </div>
          <div className="duden-brand-actions">
            {isLoggedIn ? (
              <>
                <button
                  type="button"
                  className="duden-secondary"
                  onClick={() => setEditorMode((prev) => !prev)}
                  aria-pressed={editorMode}
                  title="Editor-Modus umschalten"
                >
                  ✎ Editor-Modus {editorMode ? "an" : "aus"}
                </button>
                <button
                  type="button"
                  className="duden-logout"
                  onClick={logoutAi}
                >
                  Abmelden
                </button>
              </>
            ) : (
              <>
                {!showLogin ? (
                  <button
                    type="button"
                    className="duden-login-link"
                    onClick={() => setShowLogin(true)}
                  >
                    Login
                  </button>
                ) : (
                  <form
                    className="duden-form duden-header-login"
                    onSubmit={loginForAi}
                    ref={loginFormRef}
                  >
                    <div className="duden-form-header">
                      <h2>Editor freischalten</h2>
                      <span className="duden-pill">Login</span>
                    </div>
                    <label htmlFor="duden-login-input">
                      Passwort
                      <div className="duden-header-login-row">
                        <input
                          id="duden-login-input"
                          type="password"
                          value={aiPassword}
                          onChange={(event) => setAiPassword(event.target.value)}
                          placeholder="Passwort eingeben"
                          ref={loginInputRef}
                        />
                        <button type="submit" className="duden-secondary">
                          Anmelden
                        </button>
                      </div>
                    </label>
                    {aiMessage ? (
                      <p className={aiStatus === "error" ? "duden-error" : "duden-status"}>
                        {aiMessage}
                      </p>
                    ) : null}
                  </form>
                )}
              </>
            )}
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
                    Letzter Check: 50 Stichproben (inkl. Mehrfach-Wortarten wie „schnell“ = Adjektiv+Adverb, Partikeln, Konjunktionen, Redewendungen) direkt gegen GPT‑4o mit JSON-Schema <code>{'{terms:[{term, corrected, suggestions, lemma, partOfSpeech[], article}]}'}</code>. Ergebnis: 50/50 korrekt (100 %); Mehrfach-Wortarten kamen als Liste zurück.
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
                <div className="duden-input-wrap">
                  <input
                    id="search"
                    type="search"
                    placeholder="Eintrag suchen"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query ? (
                    <button
                      type="button"
                      className="duden-clear"
                      onClick={() => setQuery("")}
                      aria-label="Suche löschen"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
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
                      <div className="duden-entry-head">
                        <h3>{displayTerm(entry)}</h3>
                        <div className="duden-entry-icons">
                          <button
                            type="button"
                            className="duden-card duden-card--icon"
                            onClick={() => downloadCard(entry)}
                            title="Lernkarte herunterladen"
                            aria-label="Lernkarte herunterladen"
                          />
                          {dudenLink(entry) ? (
                            <a
                              className="duden-icon-btn"
                              href={dudenLink(entry)}
                              target="_blank"
                              rel="noreferrer"
                              title="Auf Duden suchen"
                              aria-label="Auf Duden suchen"
                            >
                              <img src={dIcon} alt="" className="duden-icon-img" />
                            </a>
                          ) : null}
                          {isLoggedIn && editorMode ? (
                            <>
                              <button
                                type="button"
                                className="duden-icon-btn"
                                onClick={() => startEdit(entry)}
                                title="Eintrag bearbeiten"
                                aria-label="Eintrag bearbeiten"
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="duden-icon-btn duden-danger"
                                onClick={() => deleteEntry(entry)}
                                title="Eintrag löschen"
                                aria-label="Eintrag löschen"
                              >
                                🗑
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <p className="duden-entry-type">
                        {partLabel(entry)}
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
                      {(() => {
                        const panel = synonymPanels[entry._id] || { status: "idle", count: 0 };
                        const isOpen = openSynonymId === entry._id;
                        const visibleSituations = Array.isArray(panel.visibleSituations)
                          ? panel.visibleSituations
                          : defaultVisibleSituations();
                        return (
                          <div
                            className="duden-ai-panel"
                            onClick={(event) => handlePanelClick(event, entry)}
                          >
                            <div className="duden-ai-panel-top">
                              <button
                                type="button"
                                className="duden-ai-toggle"
                                onClick={() => toggleSynonymPanel(entry)}
                                aria-expanded={isOpen}
                              >
                                <span className="duden-ai-mark" aria-hidden="true" />
                                <span>
                                  Situative Synonyme {panel?.count ? `(${panel.count})` : ""}
                                </span>
                                <span aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
                              </button>
                              {isLoggedIn && editorMode ? (
                                <div className="duden-ai-panel-actions">
                                  <button
                                    type="button"
                                    className="duden-icon-btn"
                                    onClick={() => requestAiAlternatives(entry)}
                                    disabled={panel?.status === "loading"}
                                    title="KI erneut abfragen"
                                    aria-label="KI erneut abfragen"
                                  >
                                    ★
                                  </button>
                                  {panel?.count > 0 ? (
                                    <button
                                      type="button"
                                      className="duden-icon-btn duden-danger"
                                      onClick={() => deleteAllAlternatives(entry)}
                                      disabled={panel?.status === "loading"}
                                      title="Alle gespeicherten Synonyme löschen"
                                      aria-label="Alle gespeicherten Synonyme löschen"
                                    >
                                      🗑
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            {panel?.status === "error" ? (
                              <p className="duden-error">{panel?.error}</p>
                            ) : null}
                            {isOpen ? (
                              <div className="duden-ai-panel-body">
                                {panel?.status === "loading" ? (
                                  <p className="duden-status">Lade Synonyme ...</p>
                                ) : (
                                  <div className="duden-ai-situations">
                                    {AI_SITUATION_META.filter((meta) =>
                                      visibleSituations.includes(meta.key)
                                    ).map((meta) => (
                                      <div className="duden-ai-situation" key={meta.key}>
                                        <div className="duden-ai-situation-head">
                                          <span className="duden-ai-situation-icon">{meta.icon}</span>
                                          <span className="duden-ai-situation-label">{meta.label}</span>
                                        </div>
                                        <div className="duden-ai-situation-body">
                                          {(panel?.results?.[meta.key] || []).length === 0 ? (
                                            <span className="duden-status">Noch nichts gespeichert.</span>
                                          ) : (
                                            (panel?.results?.[meta.key] || []).map((item, idx) => (
                                              <span className="duden-ai-chip" key={`${meta.key}-${idx}`}>
                                                {item}
                                              </span>
                                            ))
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="duden-ai-filters">
                                  <span className="duden-status">Situationen filtern:</span>
                                  <div className="duden-pos-pills" role="group" aria-label="Situationen">
                                    {AI_SITUATION_META.map((meta) => {
                                      const active = visibleSituations.includes(meta.key);
                                      return (
                                        <button
                                          key={`filter-${meta.key}`}
                                          type="button"
                                          className={`duden-pos-pill${active ? " is-active" : ""}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            toggleSituationVisibility(entry._id, meta.key);
                                          }}
                                        >
                                          {meta.icon} {meta.label.split(" · ")[0]}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </article>
                  ))
                )}
              </div>
            </section>

            {isLoggedIn && editorMode ? (
              <aside className="duden-side">
                <form id="duden-form" onSubmit={submitEntry} className="duden-form">
                  <div className="duden-form-header">
                    <h2>{editingId ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h2>
                    <span className="duden-pill">{editingId ? "Editor-Modus" : "Neu"}</span>
                  </div>
                  <label>
                    Lemma
                    <div className="duden-input-wrap">
                      <input
                        type="text"
                        value={form.term}
                        onChange={updateForm("term")}
                        onFocus={rememberFocus("term")}
                        placeholder="Wort oder Wendung"
                        required
                        ref={termRef}
                      />
                      {form.term ? (
                        <button
                          type="button"
                          className="duden-clear"
                          onClick={resetAllFields}
                          aria-label="Felder leeren"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
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
                            Meintest du: {items
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
                    {lemmaSuggestions.length > 0 ? (
                      <div className="duden-lemma-suggestions">
                        <p className="duden-status">Lemma-Vorschläge:</p>
                        <div className="duden-pos-pills" role="group" aria-label="Lemma-Vorschläge">
                          {lemmaSuggestions.map((item, index) => (
                            <button
                              key={`lemma-s-${index}`}
                              type="button"
                              className="duden-pos-pill"
                              onClick={() => applyLemmaSuggestion(item)}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </label>
                  <div className="duden-inline">
                    <label className="duden-pos">
                      <span>Wortart</span>
                      <div className="duden-pos-pills" role="group" aria-label="Wortarten">
                        {PART_OPTIONS.map((opt) => {
                          const active = isPartActive(opt.value);
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className={`duden-pos-pill${active ? " is-active" : ""}`}
                              onClick={togglePartOfSpeech(opt.value)}
                              aria-pressed={active}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </label>
                  </div>
                  {asArray(form.partOfSpeech).includes("noun") ? (
                    <input type="hidden" value={form.article} readOnly />
                  ) : null}
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
              </aside>
            ) : null}
          </div>
          <footer className="duden-footer">
            <img
              src={testimonialImage}
              alt="Testimonial"
                            className="duden-footer-testimonial"
                            loading="lazy"
                            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }
                            }}
            />
            <div className="duden-footer-actions">
              <button type="button" className="duden-link-button" onClick={openImprint}>
                Impressum
              </button>
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
      <p className="duden-underframe-disclaimer">
        <strong>Kein offizielles Angebot von Cornelsen oder DUDEN.</strong> Künstlerisches Privatprojekt.
      </p>
      {showImprint ? (
        <div className="duden-overlay" role="dialog" aria-modal="true" onClick={closeImprint}>
          <div className="duden-help duden-imprint" onClick={(event) => event.stopPropagation()}>
            <div className="duden-help-header">
              <h2>Impressum</h2>
              <button type="button" className="duden-secondary" onClick={closeImprint}>
                Schließen
              </button>
            </div>
            <div className="duden-help-body">
              <div className="duden-help-section">
                <h3>Angaben gemäß § 5 TMG</h3>
                <p className="duden-help-text">
                  Dieses Projekt ist ein privates, nicht-kommerzielles Kunst- und Sprachprojekt zur persönlichen Nutzung.
                  Es dient der experimentellen und spielerischen Auseinandersetzung mit Sprache, Sprachgebrauch und situativen Sprachregistern.
                </p>
              </div>
              <div className="duden-help-section">
                <h3>Projektbetreiber</h3>
                <p className="duden-help-text">
                  Akin Tekercibasi<br />
                  Frankenfelder Weg 5<br />
                  64579 Gernsheim-Allmendfeld<br />
                  <a className="duden-link-button" href="https://tekercibasi.de" target="_blank" rel="noreferrer">tekercibasi.de</a><br />
                  <a className="duden-link-button" href="mailto:at@tekeribasi.de">at@tekeribasi.de</a>
                </p>
              </div>
              <div className="duden-help-section">
                <h3>Projektcharakter &amp; Haftungsausschluss</h3>
                <p className="duden-help-text">
                  Bei dieser Website handelt es sich nicht um ein Wörterbuch, kein Referenzwerk und keine Sprachberatung.
                  Alle Inhalte – insbesondere Beispiele, Alternativen, Redewendungen und KI-generierte Texte – sind künstlerisch, subjektiv und experimentell.
                  Es wird keine Gewähr für Richtigkeit, Vollständigkeit oder Angemessenheit der Inhalte übernommen. Die Nutzung erfolgt ausschließlich auf eigene Verantwortung.
                  Der Gebrauch ist ausschließlich dafür gedacht, dass eine einzelne Person sich per Passwort einloggt, eigenen Inhalt einträgt und damit den eigenen Wortschatz erweitert.
                </p>
              </div>
              <div className="duden-help-section">
                <h3>Abgrenzung zu Cornelsen &amp; DUDEN</h3>
                <p className="duden-help-text">
                  Dieses Projekt steht in keinerlei Verbindung zur Cornelsen Verlag GmbH oder zur Bibliographisches Institut GmbH (DUDEN).
                  Nichts auf dieser Website stammt von Cornelsen oder DUDEN; es besteht keine Kooperation, Partnerschaft, Lizenzierung oder Beauftragung.
                  Der Name „Duden“ wird ausschließlich im Rahmen eines künstlerischen, parodistischen Konzepts verwendet.
                  Es werden keine Wortherleitungen oder Inhalte von DUDEN übernommen. Inhalte stammen ausschließlich von Nutzer:innen oder sind OpenAI-generierte Texte.
                </p>
              </div>
              <div className="duden-help-section">
                <h3>Gestaltung</h3>
                <p className="duden-help-text">
                  Logo, Layout und gestalterische Elemente sind künstlerisch frei interpretiert und bewusst abgewandelt.
                  Es handelt sich nicht um das originale DUDEN-Logo oder Corporate Design; Ähnlichkeiten dienen allein der satirischen bzw. künstlerischen Referenz.
                </p>
              </div>
              <div className="duden-help-section">
                <h3>Nutzung &amp; Weitergabe</h3>
                <p className="duden-help-text">
                  Dieses Projekt ist nicht für die kommerzielle Nutzung bestimmt.
                  Eine Weiterverwendung über den privaten Rahmen hinaus ist ohne vorherige Zustimmung nicht gestattet.
                  Teile der Inhalte werden mithilfe automatisierter Sprachmodelle erzeugt und stellen keine objektiven Aussagen dar.
                </p>
              </div>
              <div className="duden-help-section">
                <h3>Open Source</h3>
                <p className="duden-help-text">
                  Der Code ist open-source verfügbar.
                </p>
                <a
                  className="duden-link-button"
                  href="https://github.com/tekercibasi/warefs-duden"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub-Repo öffnen
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
