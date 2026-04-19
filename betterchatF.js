// === Waterwheel Village Backend (CommonJS) — ELEVENLABS-ONLY CLEAN ===
// ✅ Load env first
require("dotenv").config({ override: true });
console.log("BOOT FILE:", __filename);
console.log("BOOT BUILD:", "2026-03-24-MAIN-FIXED");

const crypto = require("crypto");
// === OpenAI Setup ===
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// === Core libs ===
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
// ==============================
// Helper functions (TOP OF FILE)
// ==============================

function detectEndOrNextIntent(text) {
  const t = (text || "").toLowerCase().trim();

  const endPhrases = [
    "goodbye", "bye", "that's enough", "i'm done",
    "all done", "finished", "stop", "end lesson", "exit"
  ];

  const nextPhrases = [
    "next chapter", "ready for the next chapter",
    "go to next chapter", "next lesson", "continue"
  ];

  return {
    wantsEnd: endPhrases.some(p => t.includes(p)),
    wantsNext: nextPhrases.some(p => t.includes(p)),
  };
}
// === Express setup ===
const app = express();
console.log("ROUTES will include /debug/static");
const PORT = process.env.PORT || 3000;
// 🔒 CORS MUST come before static files (so /app.js works from WordPress)
const allowed = [
  "https://www.aaronhakso.com",
  "https://aaronhakso.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

app.use(cors({
  origin: function (origin, cb) {
    // 1. Allow tools like curl or Postman (no origin)
    if (!origin) return cb(null, true);
    
    // 2. Allow your specific websites
    if (allowed.includes(origin)) {
      return cb(null, true);
    }

    console.warn("Blocked CORS origin:", origin);
    return cb(null, false);
  },
  // 3. IMPORTANT: Set to true so WordPress can pass session data
  credentials: true 
}));

app.options("*", cors());
// Middleware
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: false }));
// ✅ Serve static frontend AFTER CORS
app.use(express.static(path.join(__dirname, "public")));
// ✅ Serve lessons audio (only once)
app.use("/audio_lessons", express.static(path.join(__dirname, "audio_lessons")));
// === Audio Cache Setup ===
const AUDIO_CACHE_DIR = path.join(__dirname, "cache", "audio");
fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
function hashTextForCache(text, voiceId) {
const normalized = String(text || "").trim();
return crypto.createHash("sha256").update(voiceId + ":" + normalized).digest("hex");
}
// === Uploads (Multer, memory) ===
const multer = require("multer");
const upload = multer({
storage: multer.memoryStorage(),
limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB cap
});
// === Ensure Blob/File exist in Node (Node 18+ has Blob; File via undici) ===
const { Blob } = require("buffer");
if (!global.Blob) global.Blob = Blob;
try {
const { File } = require("undici");
if (!global.File) global.File = File;
} catch (_) {}

// Serve widget JS with correct MIME (prevents "nosniff" HTML issues)
app.get("/wwv-widget.js", (req, res) => {
const f = path.join(__dirname, "public", "wwv-widget.js");
if (!fs.existsSync(f)) {
return res.status(404).type("text/plain").send("wwv-widget.js not found in /public");
  }
res.type("application/javascript");
return res.sendFile(f);
});
// 🔍 Debug endpoint: verify static files exist on Render
app.get("/debug/static", (_req, res) => {
const widgetPath = path.join(__dirname, "public", "wwv-widget.js");
const audioDir = path.join(__dirname, "audio_lessons");
res.json({
widgetExists: fs.existsSync(widgetPath),
widgetSize: fs.existsSync(widgetPath) ? fs.statSync(widgetPath).size : 0,
audioLessonsDirExists: fs.existsSync(audioDir),
  });
});
app.get("/", (_req, res) => {
const indexPath = path.join(__dirname, "public", "index.html");
if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
res.status(200).send("Waterwheel backend is running. (No public/index.html found.)");
});
// Pretty titles for chapters
const chapterTitles = {
greetings_introductions: "Greetings & Introductions",
numbers_days_questions: "Numbers, Days & Questions",
food_drink: "Food & Drink",
daily_phrases: "Daily Phrases",
farmer_chat: "Farmer Chat",
};
function toTitleCase(s) {
return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
function humanizeChapter(slug) {
if (chapterTitles[slug]) return chapterTitles[slug];
return toTitleCase(slug.replace(/_/g, " "));
}
// === Redis Setup ===
const Redis = require("ioredis");
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl, {
tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});
console.log("✅ Using Redis at:", redisUrl);
// Connection test (fire-and-forget)
(async () => {
try {
const pong = await redis.ping();
console.log(`✅ Redis connected: ${pong}`);
  } catch (err) {
console.error("❌ Redis connection failed:", err.message);
  }
})();
// === Character Data ===
const characters = {
mcarthur: {
voiceId: "fEVT2ExfHe1MyjuiIiU9",
name: "Mr. McArthur",
style:
"a kind, patient, humurous and wise village elder. He speaks with a gentle, grandfatherly tone, guiding students like a mentor. He is deeply rooted in his faith and often uses analogies from his time on a farm or his travels.",
background:
"He is a retired history teacher who, after a lifetime of travel, found his home in Waterwheel Village. He is a man of quiet strength and faith, tending to his garden with the same care he gives to his students. He believes every path is built one step at a time.",
phrases: ["Let's rise up to the occasion.", "Each plant, like each person, has its season.", "Every path is built one step at a time."],
  },
johannes: {
voiceId: "JgHmW3ojZwT0NDP5D1JJ",
name: "Johannes",
style:
"a man of quiet strength and steady hands. He speaks little but his words are deeply thoughtful and reverent, reflecting a lifetime of working the soil. His teaching style is patient and humble, focused on perseverance.",
background:
"He is a Finnish farmer whose face is weathered by wind and sun. He believes the hard northern land teaches patience and humility. He mentors younger villagers, guiding them with a quiet reverence for the earth.",
phrases: ["The land knows me, and I know it.", "Patience grows stronger than the toughest storms."],
  },
nadia: {
voiceId: "a1KZUXKFVFDOb33I1uqr",
name: "Nadia",
style:
"a soft-spoken but firm architect. Her voice carries the calm rhythm of ancient stone cities. Her teaching style is precise and inspiring, focusing on structure, design, and harmony.",
background:
"An architect from Aleppo who rebuilds broken dreams in Waterwheel Village. She believes architecture should protect and inspire nature. She often sketches at sunrise and her words, like her designs, are inspired by both olive trees and pine forests.",
phrases: ["A good home must hold both light and silence."],
  },
fatima: {
voiceId: "JMbCR4ujfEfGaawA1YtC",
name: "Fatima",
style:
"a warm and compassionate healer. She walks slowly and listens deeply, speaking with the wisdom of her ancestors. Her teaching style is comforting and gentle, full of empathy and warmth.",
background:
"Born in Sudan, she learned healing from her grandmother using herbs, oils, and kind eyes. She is a comfort to the entire village, believing that laughter is a medicine.",
phrases: ["Every pain has a story. And every story has a root that can be softened."],
  },
anika: {
voiceId: "GCPLhb1XrVwcoKUJYcvz",
name: "Anika",
style:
"a cheerful and tender seamstress. She hums while she works, and her teaching style is gentle and nurturing, focusing on the beauty of heritage and the importance of memory.",
background:
"A seamstress from Ukraine, her hands move fast but tenderly, threading hope and heritage into her work. Her workshop smells of lavender and she often tells stories from her mother's village.",
phrases: ["Every stitch is a promise that we will not forget who we are."],
  },
liang: {
voiceId: "gAMZphRyrWJnLMDnom6H",
name: "Liang",
style:
"a calm and logical entrepreneur. He sees patterns in everything and his teaching style is strong, steady, and forward-flowing, using analogies from trade and cultivation.",
background:
"He managed a family tea house in China and now sets up networks in the village. He is also a poet, comparing the whisper of pine trees to bamboo in moonlight.",
phrases: ["Commerce is not just numbers. It is trust. And trust must be cultivated like a garden."],
  },
alex: {
voiceId: "tIFPE2y0DAU6xfZn3Fka",
name: "Aleksanderi (Alex)",
style:
"a calm and dignified Lutheran priest. His voice is gentle and soothing, and his teaching style is centered on grace, forgiveness, and the power of scripture. He is a source of hope and stillness.",
background:
"He is a priest who brings peace to the village. He carves wooden crosses and gives them to people who are feeling lost. He often sings old hymns and tells stories of saints and mercy.",
phrases: [
"The heart must be open like a window to receive both sunlight and rain.",
"In the name and blood of the Lord Jesus Christ, all your sins are forgiven.",
    ],
  },
ibrahim: {
voiceId: "tlETan7Okc4pzjD0z62P",
name: "Ibrahim",
style:
"a quiet and focused blacksmith. He speaks rarely, but when he does, his words are simple and true, like iron. His teaching style is hands-on and purposeful, focusing on craftsmanship and resilience.",
background:
"A blacksmith from Afghanistan whose forge is the heartbeat of the village. War stole his home, but not his craft. He believes metal remembers, and that shaping it is an act of peace.",
phrases: ["Because I now build what holds the world together—not what breaks it."],
  },
sophia: {
voiceId: "0q9TlrIoQJIdxZP9oZh7",
name: "Sophia",
style:
"a cheerful and energetic teacher. She brings sunshine into every room and her voice carries the rhythm of salsa. Her teaching style is full of laughter and stories, focusing on kindness and the joy of learning.",
background:
"A teacher from Venezuela who has a love of words and books. She often begins her day with a proverb from her homeland and is adored by the children she teaches.",
phrases: ["We are not just learning letters, we are learning how to be human."],
  },
kwame: {
voiceId: "dhwafD61uVd8h85wAZSE",
name: "Kwame",
style:
"a warm and wise farmer. He walks barefoot on the earth to listen to the soil. His teaching style is patient and nurturing, using analogies from farming and nature.",
background:
"A regenerative farmer from Ghana who believes food is sacred. He tells stories of talking goats and clever foxes, and teaches villagers how to plant and care for the land with love.",
phrases: ["Farming is like loving someone. You show up every day, even when it’s hard, and little by little, things grow."],
  },
};
// --- ASR Normalizer: fix typical "Who is Sophia" type errors ---
function normalizeTranscript(rawText, activeCharacterKey, isVoice) {
if (!rawText || typeof rawText !== "string") return "";
let text = rawText.trim();
const charName = characters[activeCharacterKey]?.name?.toLowerCase() || "";
if (isVoice) {
// Common mis-hearing: "Who is Sophia..." instead of "Hello Sophia..."
if (/^who is sophia\b/i.test(text) && charName.includes("sophia")) {
text = text.replace(/^who is sophia\b/i, "Hello Sophia");
    }
// If you ever talk "as Richard", this can help too
if (/^who is richard\b/i.test(text) && charName.includes("richard")) {
text = text.replace(/^who is richard\b/i, "Hello Richard");
    }
  }
// Optional: capitalize first letter for nicer logs / UI
if (text.length > 1) {
text = text[0].toUpperCase() + text.slice(1);
  }
return text;
}
// Validate characters early (fail fast in boot)
(function validateCharacters() {
const ids = Object.keys(characters);
if (ids.length !== 10) throw new Error(`Expected 10 characters, found ${ids.length}`);
for (const id of ids) {
const c = characters[id];
for (const k of ["voiceId", "name", "style", "background", "phrases"]) {
if (!c[k]) throw new Error(`Character ${id} missing '${k}'`);
    }
  }
})();
// Aliases to detect character switches in user text
const characterAliases = {
mcarthur: ["mr mcarthur","mcarthur","elder","teacher mcarthur","arthur"],
johannes: ["johannes","farmer"],
nadia: ["nadia","architect"],
fatima: ["fatima","healer"],
anika: ["anika","seamstress"],
liang: ["liang","entrepreneur","tea"],
alex: ["aleksanderi","alex","priest","pastor","lutheran"],
ibrahim: ["ibrahim","blacksmith","smith"],
sophia: ["sophia","teacher from venezuela","venezuelan teacher"],
kwame: ["kwame","farmer from ghana","regenerative farmer"],
};
function findCharacter(text) {
  const lowered = String(text || "").toLowerCase();
  for (const key of Object.keys(characterAliases)) {
    for (const alias of characterAliases[key]) {
      if (alias.includes(" ")) {
        // For multi-word aliases, use includes (exact phrase check)
        if (lowered.includes(alias)) return key;
      } else {
        // For single words, use regex with word boundaries to avoid substrings
        const regex = new RegExp(`\\b${alias}\\b`);
        if (lowered.match(regex)) return key;
      }
    }
    // Name check: single-word boundary for safety
    const nameLower = characters[key].name.toLowerCase();
    if (nameLower.includes(" ")) {
      if (lowered.includes(nameLower)) return key;
    } else {
      const regex = new RegExp(`\\b${nameLower}\\b`);
      if (lowered.match(regex)) return key;
    }
  }
  return null;
}

// =====================================================
// WATERWHEEL LESSON ENGINE + PROMPT BUILDER
// Paste this below your characters / aliases section
// =====================================================

const WWV_VERSION = "2026.03.12";

// --- Short core lore only (keep long lore elsewhere if needed) ---
const VILLAGE_CORE = `
Waterwheel Village is a small learning community in northern Finland where people from many cultures live, work, and study together.

English is the shared bridge language for daily life, work, and learning.

The village believes:
• Everyone can learn.
• Everyone can teach something.
• Mistakes help growth.
• Kindness and steady effort matter.

Life here is practical, peaceful, and community-centered.
`.trim();

// --- Lesson stages ---
const LESSON_STAGES = {
  WARMUP: "warmup",
  INTRO: "intro",
  ACTIVATE: "activate",
  GUIDED: "guided",
  SCENARIO: "scenario",
  CONSOLIDATE: "consolidate",
  CLOSE: "close",
  DONE: "done",
};

// --- Prompt types ---
const PROMPT_TYPES = [
  "question",
  "description",
  "completion",
  "comparison",
  "roleplay",
  "choice",
  "reflection",
];

// =====================================================
// STATE HELPERS
// =====================================================

function initLessonState(sessionData = {}) {
  const wordlist = Array.isArray(sessionData?.lessonWordlist)
    ? sessionData.lessonWordlist
    : [];

  return {
    chapterId: sessionData?.currentLesson?.id || "chapter-unknown",
    stage: sessionData?.isFirstChapter ? LESSON_STAGES.WARMUP : LESSON_STAGES.INTRO,
    turnsInStage: 0,
    totalTurns: 0,

    vocab: wordlist.map((word) => ({
      word: String(word).trim(),
      status: "unused", // unused | recognized | produced | mastered
      producedCount: 0,
    })),

    recentPromptTypes: [],
    turnsSinceVocabPush: 99,
    turnsSinceVillageMention: 99,
    turnsSincePraise: 99,

    driftCount: 0,
    unsafeCount: 0,
    nonsenseCount: 0,

    studentRichTurn: false,
    studentAskedQuestion: false,
    completionReady: false,
    chapterComplete: false,
  };
}

function bumpLessonCounters(state) {
  state.totalTurns += 1;
  state.turnsInStage += 1;
  state.turnsSinceVocabPush += 1;
  state.turnsSinceVillageMention += 1;
  state.turnsSincePraise += 1;
  return state;
}

function setStage(state, nextStage) {
  if (state.stage !== nextStage) {
    state.stage = nextStage;
    state.turnsInStage = 0;
  }
  return state;
}

// =====================================================
// TEXT ANALYSIS HELPERS
// =====================================================

function normalizeWordForMatch(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim();
}

function textContainsWord(text, word) {
  const t = normalizeWordForMatch(text);
  const w = normalizeWordForMatch(word);
  if (!w) return false;

  // Exact-ish word boundary match first
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");
  if (regex.test(t)) return true;

  // Fallback for simple plural/punctuation cases
  return t.includes(w);
}

function updateVocabStatusesFromStudentText(state, studentText) {
  const text = String(studentText || "");
  if (!text.trim()) return state;

  for (const item of state.vocab) {
    if (textContainsWord(text, item.word)) {
      item.producedCount += 1;
      if (item.producedCount >= 2) {
        item.status = "mastered";
      } else if (item.producedCount >= 1) {
        item.status = "produced";
      }
    }
  }

  return state;
}

function getVocabProgress(state) {
  const total = state.vocab.length || 1;
  const produced = state.vocab.filter(
    (v) => v.status === "produced" || v.status === "mastered"
  ).length;
  const mastered = state.vocab.filter((v) => v.status === "mastered").length;

  return {
    total,
    produced,
    mastered,
    ratio: produced / total,
  };
}

function getMissingWords(state, limit = 8) {
  return state.vocab
    .filter((v) => v.status === "unused" || v.status === "recognized")
    .slice(0, limit)
    .map((v) => v.word);
}

function detectRichStudentTurn(text) {
  const t = String(text || "").trim();
  if (!t) return false;

  const sentenceCount = (t.match(/[.!?]/g) || []).length + (t.length > 80 ? 1 : 0);
  const wordCount = t.split(/\s+/).filter(Boolean).length;

  return wordCount >= 18 || sentenceCount >= 3;
}

function detectStudentQuestion(text) {
  const t = String(text || "").trim().toLowerCase();
  return t.includes("?") || /^(what|why|how|when|where|who|can|do|does|is|are)\b/.test(t);
}

function classifyStudentAnswer(text) {
  const t = String(text || "").toLowerCase();

  // Unsafe / violent
  if (/(kill|shoot|stab|smack|beat|fire towards|hurt people|attack)/i.test(t)) {
    return "unsafe";
  }

  // Unrealistic / silly examples
  const unrealisticPatterns = [
    /comb.*milk.*cow/i,
    /spoon.*fix.*car/i,
    /pillow.*cut.*wood/i,
    /toothbrush.*build.*house/i,
  ];

  if (unrealisticPatterns.some((rx) => rx.test(t))) {
    return "unrealistic";
  }

  // Weak-but-plausible answer
  if (/(coffee mug|cup of coffee)/i.test(t)) {
    return "weak-but-acceptable";
  }

  return "normal";
}

function detectDrift(studentText, sessionData, state) {
  const text = String(studentText || "").toLowerCase();
  const chapter = String(sessionData?.currentLesson?.chapter || "").toLowerCase();
  const lessonWords = Array.isArray(sessionData?.lessonWordlist)
    ? sessionData.lessonWordlist.map((w) => String(w).toLowerCase())
    : [];

  const chapterTerms = chapter.split(/\s+/).filter(Boolean);
  const importantTerms = [...chapterTerms, ...lessonWords.slice(0, 20)];

  const matched = importantTerms.some((term) => term && text.includes(term));

  // If the student mentions none of the topic terms and gives a long unrelated answer,
  // count it as drift.
  const longish = text.split(/\s+/).filter(Boolean).length >= 8;

  if (!matched && longish) {
    state.driftCount += 1;
  } else {
    state.driftCount = 0;
  }

  return state;
}

// =====================================================
// PROMPT-TYPE ROTATION
// =====================================================

function chooseNextPromptType(recentPromptTypes = [], stage = LESSON_STAGES.ACTIVATE) {
  const stagePreferred = {
    [LESSON_STAGES.WARMUP]: ["question", "reflection"],
    [LESSON_STAGES.INTRO]: ["question", "description"],
    [LESSON_STAGES.ACTIVATE]: ["description", "completion", "choice"],
    [LESSON_STAGES.GUIDED]: ["description", "comparison", "completion"],
    [LESSON_STAGES.SCENARIO]: ["roleplay", "comparison", "description"],
    [LESSON_STAGES.CONSOLIDATE]: ["choice", "reflection", "completion", "comparison"],
    [LESSON_STAGES.CLOSE]: ["reflection"],
    [LESSON_STAGES.DONE]: ["reflection"],
  };

  const preferred = stagePreferred[stage] || PROMPT_TYPES;
  const lastTwo = recentPromptTypes.slice(-2);

  const blocked = lastTwo.length === 2 && lastTwo[0] === lastTwo[1]
    ? new Set([lastTwo[0]])
    : new Set();

  const candidate = preferred.find((p) => !blocked.has(p)) || preferred[0] || "question";
  return candidate;
}

function recordPromptType(state, promptType) {
  state.recentPromptTypes.push(promptType);
  if (state.recentPromptTypes.length > 6) {
    state.recentPromptTypes = state.recentPromptTypes.slice(-6);
  }
  return state;
}

// =====================================================
// STAGE TRANSITIONS
// =====================================================

function shouldOfferWarmup(sessionData) {
  return !!sessionData?.isFirstChapter;
}

function getNextStage(state) {
  const progress = getVocabProgress(state);

  if (state.chapterComplete) return LESSON_STAGES.DONE;

  switch (state.stage) {
    case LESSON_STAGES.WARMUP:
      if (state.turnsInStage >= 2) return LESSON_STAGES.INTRO;
      return LESSON_STAGES.WARMUP;

    case LESSON_STAGES.INTRO:
      if (state.turnsInStage >= 1) return LESSON_STAGES.ACTIVATE;
      return LESSON_STAGES.INTRO;

    case LESSON_STAGES.ACTIVATE:
      if (state.totalTurns >= 4 || progress.ratio >= 0.2) return LESSON_STAGES.GUIDED;
      return LESSON_STAGES.ACTIVATE;

    case LESSON_STAGES.GUIDED:
      if (progress.ratio >= 0.4 || state.totalTurns >= 8) return LESSON_STAGES.SCENARIO;
      return LESSON_STAGES.GUIDED;

    case LESSON_STAGES.SCENARIO:
      if (progress.ratio >= 0.65 || state.totalTurns >= 12) return LESSON_STAGES.CONSOLIDATE;
      return LESSON_STAGES.SCENARIO;

    case LESSON_STAGES.CONSOLIDATE:
      if (progress.ratio >= 0.8 && state.totalTurns >= 10) return LESSON_STAGES.CLOSE;
      return LESSON_STAGES.CONSOLIDATE;

    case LESSON_STAGES.CLOSE:
      return LESSON_STAGES.DONE;

    default:
      return LESSON_STAGES.DONE;
  }
}

function maybeMarkChapterComplete(state) {
  const progress = getVocabProgress(state);
  if (state.stage === LESSON_STAGES.CLOSE && progress.ratio >= 0.8 && state.totalTurns >= 10) {
    state.chapterComplete = true;
  }
  return state;
}

// =====================================================
// STAGE PROMPTS (Clean & Focused)
// =====================================================

function buildStageMode(sessionData, state) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";

  switch (state?.stage) {
    case LESSON_STAGES.WARMUP:
      return `
WARMUP MODE — ACTIVE

Keep the conversation brief, friendly, and casual for 2–3 turns maximum.
Do not start vocabulary practice yet.
Bridge naturally to the "${chapter}" topic at the end.
Use only one short question or invitation per reply.
Mention Waterwheel Village no more than once.`.trim();

    case LESSON_STAGES.INTRO:
      return `
INTRO MODE — ACTIVE

Give a short, warm, and practical introduction to the "${chapter}" topic.
End with one easy production prompt for the student.`.trim();

    case LESSON_STAGES.ACTIVATE:
      return `
ACTIVATE MODE — ACTIVE

Get the student producing English quickly about "${chapter}".
Use simple naming, one-sentence descriptions, or short tasks.
Require target vocabulary naturally every 2–3 turns.`.trim();

    case LESSON_STAGES.GUIDED:
      const guidedMissing = getMissingWords(state, 5).join(", ");
      return `
GUIDED PRACTICE MODE — ACTIVE

Topic: ${chapter}
Target words: ${guidedMissing || "lesson vocabulary"}

Acknowledge the student's reply in one short sentence, then immediately ask a question that forces them to use at least one target word.`.trim();

    case LESSON_STAGES.SCENARIO:
      const scenarioMissing = getMissingWords(state, 5).join(", ");
      return `
SCENARIO MODE — ACTIVE

Topic: ${chapter}
Goal: The student must use these target words naturally: ${scenarioMissing || "lesson vocabulary"}.

Stay in the roleplay scenario. Gently pull the student back if they drift away.`.trim();

    case LESSON_STAGES.CONSOLIDATE:
      const consolidateMissing = getMissingWords(state, 8).join(", ");
      return `
CONSOLIDATE MODE — ACTIVE

Lesson: "${chapter}"
Focus: Review and strengthen vocabulary.

Mix the missing words into short practical tasks (comparisons, choices, summaries).
Pay special attention to: ${consolidateMissing || "all lesson words"}.`.trim();

    case LESSON_STAGES.CLOSE:
    case LESSON_STAGES.DONE:
      const greenWords = state?.vocab
        ?.filter(v => v.status === "produced" || v.status === "mastered")
        ?.slice(0, 6)
        ?.map(v => v.word)
        ?.join(", ") || "lesson vocabulary";

      return `
CLOSE MODE — ACTIVE

Lesson: "${chapter}"

Briefly praise the student's progress and mention some words they used well (${greenWords}).
If most words are mastered, gently guide them toward the next chapter.
End with one clear invitation to continue.`.trim();

    default:
      // Fallback to Activate mode
      return buildStageMode(sessionData, { ...state, stage: LESSON_STAGES.ACTIVATE });
  }
}

// =====================================================
// MAIN SYSTEM PROMPT (Single Source of Truth) VERSION 10.5
// =====================================================

function buildSystemPrompt(activeCharacterKey, sessionData, mode, state = null, turnGuard = "") {
  const c = characters[activeCharacterKey] || characters.sophia;
  const chapter = sessionData?.currentLesson?.chapter || "this topic";
  
  const stageInstructions = state ? buildStageMode(sessionData, state) : "";
  const targetWords = (state && typeof getMissingWords === 'function') 
    ? getMissingWords(state, 8) 
    : (sessionData.lessonWordlist || []);
  
  const inversionWord = (targetWords && targetWords.length > 0) ? targetWords[0] : "village";
  const targetWordsString = targetWords.length ? targetWords.join(", ") : "vocabulary";

  return `### IDENTITY & WORLD:
You are ${c.name} from Waterwheel Village. 
PERSONALITY: ${c.style}
LORE: ${c.background}
STRICT RULE: Mention a detail from your life in Waterwheel Village every 2-3 turns.

### TEACHING RULES (MANDATORY):
1. RECAST: Before responding, check for grammar/spelling. If an error exists, start with: "You could say: [Corrected Version]" followed by a line break.
2. NATURAL PRAISE: If the student is correct, start with a natural reaction (e.g., "I see!", "How interesting"). DO NOT say "You could say."
3. LIMIT: Max 3 short sentences. 
4. THE INVERSION: Every 3rd turn, you MUST say: "Now, ${sessionData.userName || 'my friend'}, ask ME a question about my village using the word '${inversionWord}'. "
5. SINGLE FOCUS: End with exactly ONE question or task.

### ACTIVE LESSON CONTEXT:
${stageInstructions}
Target words for this turn: ${targetWordsString}

### PIVOT RULE:
If the student talks about big cities, acknowledge it, then compare it back to Waterwheel Village.

${mode === "voice" ? "VOICE MODE: Keep sentences rhythmic and clear." : ""}
${turnGuard || ""}`;
}// <--- THIS ends the buildSystemPrompt function

// History helper
async function loadHistory(sessionId) {
  return JSON.parse((await redis.get(`history:${sessionId}`)) || "[]");
}

async function saveHistory(sessionId, arr) {
  const MAX = 20; 
  const trimmed = arr.length > MAX ? arr.slice(-MAX) : arr;
  await redis.set(`history:${sessionId}`, JSON.stringify(trimmed));
  return trimmed;
}
// === Lessons ===
const lessonIntros = require("./lessonIntros");
// === Load monthly wordlists ===
const monthlyWordlists = {};
function loadMonthlyWordlists() {
const wordlistsDir = path.join(__dirname, "wordlists", "monthly");
const nextMap = {}; // build here first
let loadedSomething = false;
try {
const files = fs.readdirSync(wordlistsDir).filter(f => f.endsWith(".json"));
console.log("📂 Wordlists dir:", wordlistsDir);
console.log("🧾 JSON files found:", files);
if (!files.length) console.warn(`⚠️ No .json files found in ${wordlistsDir}`);
for (const file of files) {
const full = path.join(wordlistsDir, file);
let parsed;
try {
parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      } catch (e) {
console.error(`❌ JSON parse error in ${file}: ${e.message}`);
continue;
      }
// Determine month number from "month" or filename
let m = (parsed && typeof parsed.month === "number") ? parsed.month : undefined;
if (!Number.isFinite(m)) {
const mMatch = file.match(/month(\d{1,2})/i) || file.match(/(\d{1,2})/);
if (mMatch) m = Number(mMatch[1]);
}
if (!Number.isFinite(m) || m < 1 || m > 12) {
console.error(`❌ Skipping ${file}: missing/invalid "month":`, parsed ? parsed.month : undefined);
continue;
}
const key = `month${m}`;
// Validate + coerce chapters into a keyed object
let ch = (parsed && parsed.chapters) ? parsed.chapters : null;
if (Array.isArray(ch)) {
// Try to convert an array into an object keyed by a slug-like field
const out = {};
for (const item of ch) {
if (!item || typeof item !== "object") continue;
const slug =
item.slug || item.key || item.name || item.id || item.chapter || item.title;
if (typeof slug === "string" && slug.trim()) {
out[slug.trim()] = item;
    }
  }
if (Object.keys(out).length) {
console.warn(`↺ Coerced array 'chapters' to object with keys: ${Object.keys(out).join(", ")}`);
ch = out;
  } else {
console.warn(`⚠️ Skipping ${file}: chapters is an array but no usable slug fields found`);
continue;
  }
}
if (!ch || typeof ch !== "object" || Array.isArray(ch)) {
console.warn(`⚠️ Skipping ${file}: no usable "chapters" object (got ${Array.isArray(ch) ? "array" : typeof ch})`);
continue;
}
// Merge chapters (normalize 'words'/'vocab'/'wordlist' later in endpoints)
if (!nextMap[key]) nextMap[key] = { month: m, chapters: {} };
for (const [slug, data] of Object.entries(ch)) {
nextMap[key].chapters[slug] = data;
}
loadedSomething = true;
console.log(`📦 Loaded ${file} -> ${key} (${Object.keys(ch).length} chapters)`);
    }
  } catch (err) {
console.error("❌ Failed to scan monthly wordlists:", err.message);
  }
if (loadedSomething) {
// only swap if we have something valid
for (const k of Object.keys(monthlyWordlists)) delete monthlyWordlists[k];
Object.assign(monthlyWordlists, nextMap);
const keys = Object.keys(monthlyWordlists).sort((a,b)=>Number(a.replace("month",""))-Number(b.replace("month","")));
console.log("✅ Monthly wordlists loaded:", keys);
for (const k of keys) {
const chs = Object.keys(monthlyWordlists[k].chapters || {});
console.log(` • ${k}: ${chs.length ? chs.join(", ") : "(no chapters)"}`);
    }
  } else {
console.warn("⚠️ No valid monthly wordlists loaded; keeping previous in-memory data.");
  }
}
// === Wordlist endpoint ===
// === Lesson endpoint ===
app.get("/lesson/:month/:chapter", async (req, res) => {
  const { month, chapter } = req.params;
  console.log(`Fetching lesson: ${month}/${chapter}, query:`, req.query);

  const monthData = monthlyWordlists[month];
  const chData = monthData?.chapters?.[chapter];

  // Prefer lessonIntros; fall back to JSON teacher if present
  let intro = lessonIntros[month]?.[chapter];
  if (!intro && chData?.teacher && characters[chData.teacher]) {
    intro = {
      teacher: chData.teacher,
      text: `Hello, [name]. I am ${characters[chData.teacher].name}. Let’s explore ${humanizeChapter(chapter)}.`,
      story: `In our village, we learn step by step.`,
    };
    console.log(`ℹ️ Using fallback intro from JSON teacher: ${chData.teacher}`);
  }

  if (!intro) {
    console.error(`Lesson not found: ${month}/${chapter}`);
    return res.status(404).json({ error: `Lesson '${chapter}' not found in ${month}` });
  }

  const sessionId = req.query.sessionId || uuidv4();

  // Load or initialize session
  let sessionData;
  try {
    const sessionRaw = await redis.get(`session:${sessionId}`);
    sessionData = sessionRaw
      ? JSON.parse(sessionRaw)
      : {
          character: "mcarthur",
          currentLesson: null,
          learnedWords: [],
          lessonWordlist: [],
          userName: null,
        };
    console.log(`Session loaded: ${sessionId}`, sessionData);
  } catch (err) {
    console.error(`Redis error for session:${sessionId}:`, err.message);
    sessionData = {
      character: "mcarthur",
      currentLesson: null,
      learnedWords: [],
      lessonWordlist: [],
      userName: null,
    };
  }

  // === SAFETY FIXES (always run) ===
  if (!Array.isArray(sessionData.learnedWords)) sessionData.learnedWords = [];
  if (!Array.isArray(sessionData.lessonWordlist)) sessionData.lessonWordlist = [];

  // Set student name safely
  const studentName = req.query.name
    ? decodeURIComponent(req.query.name)
    : (sessionData.userName || "friend");
  sessionData.userName = studentName;

  // --- WORDS (accept words | vocab | wordlist) ---
  const rawList = chData?.words || chData?.vocab || chData?.wordlist || [];
  const words = Array.isArray(rawList) ? rawList : [];

  // Build lowercase wordlist for matching
  const wordlist = words
    .map((w) =>
      typeof w === "string"
        ? w.toLowerCase()
        : (w?.en || w?.word || "").toLowerCase()
    )
    .filter(Boolean);

  console.log(`Wordlist for ${month}/${chapter}:`, wordlist);

  // Save session
  sessionData.currentLesson = { month, chapter };
  sessionData.lessonWordlist = wordlist;

  try {
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
    console.log(`Session saved: ${sessionId}`);
  } catch (err) {
    console.error(`Failed to save session:${sessionId}:`, err.message);
  }

  // Welcome + lesson text
  let welcomeText = "";
  const chapterTitle = intro.title ? intro.title : humanizeChapter(chapter);
  const isMcArthurTeacher = intro.teacher === "mcarthur";

  if (chapter !== "greetings_introductions" && !isMcArthurTeacher) {
    welcomeText = `Greetings, ${studentName}! I’m Mr. McArthur, the village elder. Welcome to Waterwheel Village, where we learn together like family. Today, you’ll meet ${characters[intro.teacher].name} to explore ${chapterTitle}. Let’s begin!`;
  }

  let teacherText = intro.text.replace(/\[name\]/g, studentName);
  if (isMcArthurTeacher && teacherText.startsWith(`Hello, ${studentName}. I am Mr. McArthur.`)) {
    teacherText = teacherText.replace(`Hello, ${studentName}. I am Mr. McArthur. `, `Hello, ${studentName}. `);
  }

  const storyText = intro.story.replace(/\[name\]/g, studentName);
  const lessonText = `${teacherText}\n\n${storyText}`;

  // Initialize history
  const initialHistory = [];
  if (welcomeText) initialHistory.push({ role: "assistant", content: welcomeText });
  initialHistory.push({ role: "assistant", content: lessonText });

  try {
    await redis.set(`history:${sessionId}`, JSON.stringify(initialHistory));
    console.log(`History initialized for ${sessionId}`);
  } catch (err) {
    console.error(`Failed to save history:${sessionId}:`, err.message);
  }

  const voiceId = characters[intro.teacher].voiceId;

  const response = {
    welcomeText,
    lessonText,
    words,
    sessionId,
    voiceId,
    character: intro.teacher,
  };

  console.log(`Lesson response sent:`, response);
  res.json(response);
});
app.post("/chat", async (req, res) => {
  try {
    const body = req.body || {};

    // === STRONG DIAGNOSTIC BLOCK ===
    const sessionId = body.sessionId || body.session_id || uuidv4();
    const isDemo = !!(body.mode === "demo" || 
                     body.demo === true || 
                     body.demo === "true" ||
                     (sessionId && sessionId.startsWith("demo-")));

    console.log("=== DEMO DEBUG ===");
    console.log("Body keys:", Object.keys(body));
    console.log("mode:", body.mode);
    console.log("demo flag:", body.demo);
    console.log("sessionId:", sessionId);
    console.log("isDemo result:", isDemo);
    console.log("character requested:", body.character);
    console.log("==================");

    if (isDemo) {
      console.log(`[DEMO] Clearing old data for session ${sessionId}`);
      await redis.del(`session:${sessionId}`);
      await redis.del(`lessonState:${sessionId}`);
      await redis.del(`history:${sessionId}`);
      await redis.del(`demoTurns:${sessionId}`);
    }

    // === DEMO TURN LIMIT (max 8 turns) ===
    if (isDemo) {
      let demoTurnCount = parseInt((await redis.get(`demoTurns:${sessionId}`)) || "0", 10);
      demoTurnCount += 1;
      await redis.set(`demoTurns:${sessionId}`, demoTurnCount.toString(), "EX", 1800);

      console.log(`[DEMO TURN] Current count = ${demoTurnCount}`);

      if (demoTurnCount > 8) {
        console.log(`[DEMO LIMIT] Reached ${demoTurnCount} turns - stopping`);
        return res.json({
          text: "You've reached the free demo limit (8 turns). Great job practicing! Click below to unlock the full Waterwheel Village school.",
          action: "DEMO_LIMIT_REACHED",
          limitReached: true
        });
      }
    }
    // =======================================================

    const userMessage = body.text || body.message || body.userMessage || "";
    const messageId = body.messageId || body.message_id || Date.now().toString();
    const mode = body.mode || "text";
    const isVoice = body.isVoice || mode === "voice";
    const userNameFromFrontend = body.name || body.sessionData?.userName || null;
    const incomingSessionData = body.sessionData || {};

    if (!messageId) {
      return res.status(400).json({ error: "Missing messageId" });
    }

    // 1. DUPLICATE PROTECTION
    const dedupeKey = `processed:${sessionId}:${messageId}`;
    if (await redis.exists(dedupeKey)) {
      const messages = await loadHistory(sessionId);
      return res.json({ text: messages.reverse().find(m => m.role === "assistant")?.content || "", version: WWV_VERSION });
    }
    await redis.set(dedupeKey, "1", "EX", 300);

    // 2. LOAD DATA
    const sessionRaw = await redis.get(`session:${sessionId}`);
    let sessionData = sessionRaw ? JSON.parse(sessionRaw) : { 
      character: "mcarthur", 
      learnedWords: [], 
      lessonWordlist: [] 
    };
    
    sessionData = { ...sessionData, ...incomingSessionData };
    if (userNameFromFrontend) sessionData.userName = decodeURIComponent(userNameFromFrontend);

    // Force character when user switches on demo
    if (isDemo && body.character) {
      sessionData.character = body.character.toLowerCase();
    }

    // Forced character for lessons
   if (body.character) {
  sessionData.character = body.character.toLowerCase();
} else if (sessionData.currentLesson) {
  const lesson = lessonIntros[sessionData.currentLesson.month]?.[sessionData.currentLesson.chapter];
  if (lesson?.teacher) sessionData.character = lesson.teacher;
}

    const normalizedText = normalizeTranscript(userMessage, sessionData.character || "mcarthur", isVoice);

    // --- 3. THE BRAIN: UPDATE LESSON STATE ---
    let lessonState = JSON.parse((await redis.get(`lessonState:${sessionId}`)) || "null");

    // EMERGENCY RESET
    const currentChapter = sessionData.currentLesson?.chapter || "unknown";
    if (lessonState && lessonState.chapterId !== currentChapter) {
      console.log(`♻️ CHAPTER MISMATCH: Resetting brain to ${currentChapter}`);
      lessonState = initLessonState(sessionData); 
    }
    if (!lessonState) lessonState = initLessonState(sessionData);

    let newlyLearned = [];
    if (normalizedText) {
      lessonState = detectDrift(normalizedText, sessionData, lessonState);
      lessonState = bumpLessonCounters(lessonState);
      lessonState.stage = getNextStage(lessonState);

     // B: PHRASE-FIRST WORD MATCHING
const userNorm = normalizedText
  .toLowerCase()
  .replace(/[^\w\s-]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const userWords = userNorm.split(" ").filter(Boolean);
const userSet = new Set(userWords);

const wordsRemaining = [];
const currentList = sessionData.lessonWordlist || [];

console.log("=== MATCH DEBUG START ===");
console.log("RAW USER TEXT:", normalizedText);
console.log("NORMALIZED USER TEXT:", userNorm);
console.log("CURRENT LESSON WORDLIST:", currentList);

for (const rawWord of currentList) {
  let lessonWord = String(rawWord || "").toLowerCase().trim();
  let isMatch = false;

  if (lessonWord.includes(" ")) {
    const lessonPhraseNorm = String(lessonWord || "")
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (userNorm.includes(lessonPhraseNorm)) {
      isMatch = true;
    } else if (userNorm.includes(lessonPhraseNorm.replace(/ /g, "-"))) {
      isMatch = true;
    }

    console.log("PHRASE CHECK:", {
      lessonWord,
      lessonPhraseNorm,
      userNorm,
      isMatch
    });
  } else {
    const normLesson = normalizeToken(lessonWord);
    isMatch =
      userSet.has(String(lessonWord || "").toLowerCase()) ||
      userSet.has(normLesson);

    console.log("WORD CHECK:", {
      lessonWord,
      normLesson,
      userWords: Array.from(userSet),
      isMatch
    });
  }

  if (isMatch && !sessionData.learnedWords.includes(lessonWord)) {
    sessionData.learnedWords.push(lessonWord);
    newlyLearned.push(lessonWord);

    if (lessonState) {
      const vIndex = lessonState.vocab.findIndex(
        v => String(v.word || "").toLowerCase() === lessonWord
      );
      if (vIndex !== -1) {
        lessonState.vocab[vIndex].status = "produced";
      }
    }

    console.log("✅ MATCHED:", lessonWord);
  } else if (!isMatch) {
    wordsRemaining.push(lessonWord);
    console.log("❌ NOT MATCHED:", lessonWord);
  } else {
    console.log("⚠️ ALREADY LEARNED, NOT ADDING AGAIN:", lessonWord);
  }
}

console.log("NEWLY LEARNED THIS TURN:", newlyLearned);
console.log("TOTAL LEARNED WORDS:", sessionData.learnedWords);
console.log("WORDS REMAINING:", wordsRemaining);
console.log("=== MATCH DEBUG END ===");

sessionData.lessonWordlist = wordsRemaining;
    }
// 4. CHECK COMPLETION
const { wantsEnd, wantsNext } = detectEndOrNextIntent(normalizedText);

console.log("DEBUG normalizedText:", normalizedText);

// Ensure these are arrays to avoid .length crash
const currentWordlist = Array.isArray(sessionData.lessonWordlist) ? sessionData.lessonWordlist : [];
const currentLearned = Array.isArray(sessionData.learnedWords) ? sessionData.learnedWords : [];

const isChapterDone = (currentWordlist.length === 0 && currentLearned.length > 0);

if (isChapterDone) {
  return res.json({
    text: `You have done very well today, ${sessionData.userName || "my friend"}.

You used many new words and spoke with care and confidence.

This chapter is now complete. Take a moment to rest and enjoy what you have learned.

When you are ready, we will continue together to the next chapter.`,
    action: wantsNext ? "NEXT_CHAPTER" : "CHAPTER_COMPLETE",
    chapterComplete: true
  });
}
  // 5. TALK TO AI
let messages = await loadHistory(sessionId);
messages.push({ role: "user", content: normalizedText });

// We pass 5 arguments: character, sessionData, mode, lessonState, and an empty turnGuard
const systemPrompt = buildSystemPrompt(
  sessionData.character, 
  sessionData, 
  mode, 
  lessonState, 
  "" 
);

// --- CRITICAL SAFETY CHECK ---
// If for some reason the prompt is still undefined, this prevents the 400 Error crash.
if (!systemPrompt) {
  throw new Error("System Prompt generation failed. Check buildSystemPrompt return statement.");
}

console.log("SYSTEM PROMPT:\n", systemPrompt);

const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "system", content: systemPrompt }, ...messages],
  temperature: 0.88,           
  frequency_penalty: 0.65,     
  presence_penalty: 0.25,      
});
    const reply = completion.choices[0].message.content;
    messages.push({ role: "assistant", content: reply });
    
let milestone = null;

// Count learned words in the CURRENT CHAPTER only
const chapterLearnedCount = Array.isArray(lessonState?.vocab)
  ? lessonState.vocab.filter(
      v => v.status === "produced" || v.status === "mastered"
    ).length
  : 0;

// Fire milestone once per chapter
if (chapterLearnedCount >= 10 && !lessonState.milestone10Shown) {
  milestone = 10;
  lessonState.milestone10Shown = true;
}

await saveHistory(sessionId, messages);
await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
await redis.set(`lessonState:${sessionId}`, JSON.stringify(lessonState));

return res.json({
  text: reply,
  character: sessionData.character,
  voiceId: characters[sessionData.character].voiceId,
  newlyLearned,
  remainingWords: sessionData.lessonWordlist.slice(0, 5),
  chapterComplete: isChapterDone,
  milestone,
  version: WWV_VERSION
});

  } catch (err) {
    console.error("CRASH:", err);
    res.status(500).send("Error");
  }
});
// === Speakbase endpoint (ElevenLabs with disk cache) ===
function cleanTextForSpeech(input) {
  if (!input || typeof input !== "string") return "";

  return input
    // Fix title abbreviations that cause unnatural pauses in TTS
    .replace(/\bMr\./g, "Mr")
    .replace(/\bMrs\./g, "Mrs")
    .replace(/\bMs\./g, "Ms")
    .replace(/\bDr\./g, "Dr")
    .replace(/\bProf\./g, "Professor")

    // Optional: remove markdown emphasis that gets spoken weirdly
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")

    // Optional: normalize whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
}
console.log("Reached end of /chat route definition");
app.post("/speakbase", async (req, res) => {
  const { text, voiceId } = req.body || {};
  
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("❌ Missing ELEVENLABS_API_KEY");
    return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY" });
  }
  
  if (!text || !voiceId) {
    return res.status(400).json({ error: "Missing text or voiceId" });
  }

  // 🔊 Clean text for speech (removes Mr. pause, colons etc.)
  const speechText = cleanTextForSpeech(text);

  // 1) Compute cache key & path
  const key = hashTextForCache(speechText, voiceId);
  const cachedPath = path.join(AUDIO_CACHE_DIR, `${key}.mp3`);

  try {
    // 2) If cached, stream file and return
    if (fs.existsSync(cachedPath)) {
      console.log(`🔁 Serving cached audio: ${cachedPath}`);
      res.setHeader("Content-Type", "audio/mpeg");
      const stream = fs.createReadStream(cachedPath);
      return stream.pipe(res);
    }

    // 3) Not cached → call ElevenLabs with "Stability" fixes
    console.log(`🔊 Generating high-quality audio for: ${key}`);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: speechText,
          model_id: "eleven_multilingual_v2", 
          voice_settings: {
            stability: 0.75,         // Fixes slurring: makes the voice consistent
            similarity_boost: 0.75,  // Makes the voice clearer
            style: 0.0,              // Prevents "random" emotional glitches
            use_speaker_boost: true  // Boosts clarity for educational use
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ ElevenLabs API error:", response.status, errorText);
      return res.status(response.status).json({ error: "ElevenLabs failed", details: errorText });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3a) Save to cache
    try {
      fs.writeFileSync(cachedPath, buffer);
      console.log(`✅ Cached new audio at: ${cachedPath}`);
    } catch (err) {
      console.error("⚠️ Cache write failed:", err.message);
    }

    // 3b) Send audio to client
    res.setHeader("Content-Type", "audio/mpeg");
    res.end(buffer);

  } catch (err) {
    console.error("❌ Speakbase error:", err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: "TTS Generation Failed" });
    }
    res.end();
  }
});
// Alias so frontend can POST /speak
app.post("/speak", (req, res) => {
req.url = "/speakbase";
app._router.handle(req, res);
});
// === Meta & Health ===
app.get("/meta", async (_req, res) => {
  res.json({
    ok: true,
    version: WWV_VERSION,
    characters: Object.keys(characters),
    monthlySets: Object.keys(monthlyWordlists),
    redis: redis.status,
  });
});

app.get("/months", (_req, res) => {
  const index = {};
  for (const [k, v] of Object.entries(monthlyWordlists)) {
    const ch = v && v.chapters && typeof v.chapters === "object" 
      ? Object.keys(v.chapters) 
      : [];
    index[k] = ch;
  }
  res.json({ months: index });
});

// IMPROVED HEALTH CHECK (this replaces your old one-liner)
app.get("/health", async (_req, res) => {
  const health = { 
    ok: true, 
    status: "Waterwheel backend alive", 
    version: WWV_VERSION,
    redis: "unknown"
  };

  try {
    const pong = await redis.ping();
    health.redis = "connected (" + pong + ")";
  } catch (e) {
    health.ok = false;
    health.redis = "error";
    health.redisError = e.message;
    console.error("Health check Redis failed:", e.message);
  }

  res.status(health.ok ? 200 : 503).json(health);
});

// --- UTILITY HELPERS ---

function normalizeToken(t) {
  if (!t) return "";
  // 1. Lowercase and trim
  t = String(t).toLowerCase().trim();
  
  // 2. Remove punctuation but KEEP spaces
  t = t.replace(/[^\w\s-]/g, "");

  // 3. Basic Plural/Suffix stripping
  if (t.length > 4) {
    if (t.endsWith("ies")) return t.slice(0, -3) + "y";
    if (t.endsWith("es")) return t.slice(0, -2);
    if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  }
  return t;
}

// Boot-time load of monthly wordlists
loadMonthlyWordlists();

// === GLOBAL ERROR HANDLER + 404 (Very Important for preventing 503) ===
app.use((err, req, res, next) => {
  console.error("=== UNHANDLED ERROR ===", err.stack || err);
  if (!res.headersSent) {
    res.status(500).json({ 
      error: "Internal server error", 
      version: WWV_VERSION 
    });
  }
});

app.use((req, res) => {
  console.warn(`404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: "Not found - this is the Waterwheel Village backend only" 
  });
});

// === Start server ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));