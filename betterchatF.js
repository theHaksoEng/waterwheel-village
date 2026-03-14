// === Waterwheel Village Backend (CommonJS) — ELEVENLABS-ONLY CLEAN ===
// ✅ Load env first
require("dotenv").config({ override: true });
console.log("BOOT FILE:", __filename);
console.log("BOOT BUILD:", "2025-12-31-DEBUG1");
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
  "https://aaronhakso.com"
];

app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // allow curl / server calls
    if (allowed.includes(origin)) return cb(null, true);

    console.warn("Blocked CORS origin:", origin);
    return cb(null, false); // reject without throwing error
  },
  credentials: false,
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
// ✅ Debug + hard static serving (prevents HTML/nosniff issues)
app.get("/debug/static", (_req, res) => {
const widgetPath = path.join(__dirname, "public", "wwv-widget.js");
const audioDir = path.join(__dirname, "audio_lessons");
res.json({
ok: true,
running: __filename,
widgetPath,
widgetExists: fs.existsSync(widgetPath),
widgetSize: fs.existsSync(widgetPath) ? fs.statSync(widgetPath).size : 0,
audioDir,
audioLessonsDirExists: fs.existsSync(audioDir),
  });
});
// Force correct MIME for widget JS (prevents "nosniff" when HTML is returned)
app.get("/wwv-widget.js", (req, res) => {
const f = path.join(__dirname, "public", "wwv-widget.js");
if (!fs.existsSync(f)) {
return res.status(404).type("text/plain").send("wwv-widget.js not found in /public");
  }
res.type("application/javascript");
return res.sendFile(f);
});
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
// STAGE PROMPTS
// =====================================================

function buildWarmupMode(sessionData) {
  const chapter = sessionData?.currentLesson?.chapter || "today's lesson";
  return `
WARMUP MODE — ACTIVE

Purpose:
Keep conversation brief, warm, and simple before the lesson begins.

Rules:
- Use only 1 short question or invitation.
- Talk casually for 2–3 turns maximum.
- Do not begin full vocabulary practice yet.
- After the short warmup, bridge clearly to the lesson topic "${chapter}".
- Do not mention Waterwheel Village more than once in warmup.
- End with exactly ONE question, task, or invitation.
`.trim();
}

function buildIntroMode(sessionData) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";
  return `
INTRO MODE — ACTIVE

Purpose:
Give a short, focused introduction to the lesson topic "${chapter}".

Rules:
- 1 short intro only.
- Keep it practical, not poetic.
- Introduce the topic clearly.
- End with exactly ONE easy production prompt.
- Do not overuse village storytelling.
`.trim();
}

function buildActivateMode(sessionData) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";
  return `
ACTIVATE MODE — ACTIVE

Purpose:
Get the student producing English quickly about "${chapter}".

Rules:
- Use easy naming, one-sentence, or simple description tasks.
- Keep replies short.
- Every 2–3 tutor turns, require a lesson word in student output.
- End with exactly ONE question, task, or invitation.
`.trim();
}

function buildGuidedMode(sessionData, state) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";
  const missingWords = getMissingWords(state, 6).join(", ");
  return `
GUIDED PRACTICE MODE — ACTIVE

Lesson topic: "${chapter}"

Purpose:
Develop stronger controlled production.

Rules:
- Use short description, comparison, completion, or explanation tasks.
- Keep teaching progression stronger than free conversation.
- If the student drifts, acknowledge briefly and return to the lesson in the same reply.
- Recycle missing lesson words naturally.
- Prioritize these not-yet-green words when helpful: ${missingWords || "use remaining target words"}.
- End with exactly ONE question, task, or invitation.
`.trim();
}

function buildScenarioMode(sessionData, state) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";
  const missingWords = getMissingWords(state, 6).join(", ");
  return `
SCENARIO MODE — ACTIVE

Lesson topic: "${chapter}"

Purpose:
Practice realistic communication.

Rules:
- Prefer mini roleplay or practical scenarios.
- Keep the scenario directly related to the lesson topic.
- Do not allow long unrelated topic chains.
- If a student answer is unrealistic, gently correct it, give a real example, and ask for one better answer.
- If a student answer becomes unsafe or violent, redirect calmly and return to professional/everyday language.
- Try to bring in these remaining words if possible: ${missingWords || "remaining target words"}.
- End with exactly ONE question, task, or invitation.
`.trim();
}

function buildConsolidateMode(sessionData, state) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";
  const missingWords = getMissingWords(state, 8);
  return `
CONSOLIDATE MODE — ACTIVE

Lesson topic: "${chapter}"

Purpose:
Review and strengthen memory.

Rules:
- Revisit missing words and mix them into short practical tasks.
- Use comparison, choice, matching, or summary tasks.
- Do not open new unrelated topics.
- Focus especially on these words: ${missingWords.length ? missingWords.join(", ") : "the full lesson vocabulary"}.
- End with exactly ONE question, task, or invitation.
`.trim();
}

function buildCloseMode(sessionData, state) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";
  const progress = getVocabProgress(state);
  const greenWords = state.vocab
    .filter((v) => v.status === "produced" || v.status === "mastered")
    .slice(0, 8)
    .map((v) => v.word)
    .join(", ");

  return `
CLOSE MODE — ACTIVE

Lesson topic: "${chapter}"

Purpose:
Close the chapter clearly.

Rules:
- Briefly praise the student's progress.
- Mention that the student used important lesson words.
- Mention a few completed words naturally: ${greenWords || "lesson vocabulary"}.
- If most words are now green (${progress.produced}/${progress.total}), guide the student to the next chapter.
- Do not continue open-ended chatting.
- End with exactly ONE invitation to continue to the next chapter.
`.trim();
}

function buildStageMode(sessionData, state) {
  switch (state.stage) {
    case LESSON_STAGES.WARMUP:
      return buildWarmupMode(sessionData);
    case LESSON_STAGES.INTRO:
      return buildIntroMode(sessionData);
    case LESSON_STAGES.ACTIVATE:
      return buildActivateMode(sessionData);
    case LESSON_STAGES.GUIDED:
      return buildGuidedMode(sessionData, state);
    case LESSON_STAGES.SCENARIO:
      return buildScenarioMode(sessionData, state);
    case LESSON_STAGES.CONSOLIDATE:
      return buildConsolidateMode(sessionData, state);
    case LESSON_STAGES.CLOSE:
    case LESSON_STAGES.DONE:
      return buildCloseMode(sessionData, state);
    default:
      return buildActivateMode(sessionData);
  }
}

// =====================================================
// UNIVERSAL TEACHING POLICY
// =====================================================

function buildUniversalTeachingPolicy(sessionData, state, promptType) {
  const chapter = sessionData?.currentLesson?.chapter || "daily life";

  return `
UNIVERSAL LESSON POLICY — REQUIRED

Lesson authority:
During lessons, teaching progression has priority over free conversation.
Warmth supports learning but does not replace structured guidance.

Topic priority:
The current lesson topic is "${chapter}".
Stay connected to it.
Do not allow unrelated topic chains to continue.

Student output:
The student should produce most of the language.
Prefer short tasks that make the student speak or write.

Correction:
Correct gently by modeling.
Use no more than one correction sentence.

Personality balance:
Character warmth supports teaching but must not dominate lesson content.
Avoid repeated village references during active lessons.

Village rule:
Do NOT mention Waterwheel Village unless:
- opening warmup or intro
- the student asks about it
- a short cultural example clearly helps
- chapter closure

Wrong or silly answers:
- If answer is weak but acceptable, accept lightly and redirect to a stronger lesson example.
- If answer is unrealistic, gently correct it, give one real example, and ask for one better answer.
- If answer is unsafe or violent, redirect calmly and return to professional or everyday language.

Prompt variation:
Use this prompt type next if possible: "${promptType}".
Do not repeat the same prompt pattern more than twice in a row.

One-prompt rule:
Every reply must end with EXACTLY ONE:
(A) question
(B) task
(C) invitation
`.trim();
}

function buildVocabContext(sessionData, state) {
  if (!Array.isArray(sessionData?.lessonWordlist) || !sessionData.lessonWordlist.length) {
    return "";
  }

  const words = sessionData.lessonWordlist.slice(0, 40).join(", ");
  const missingWords = getMissingWords(state, 8).join(", ");

  return `
LESSON VOCABULARY

Target words:
${words}

Vocabulary guidance:
- Recycle lesson words naturally.
- Every 2–3 tutor turns, guide the student to use a lesson word.
- Prioritize not-yet-green words when useful: ${missingWords || "all target words"}.
- A word becomes green when the student uses it meaningfully.
`.trim();
}

// =====================================================
// SYSTEM PROMPT BUILDER
// =====================================================

function buildSystemPrompt(activeCharacterKey, sessionData, mode, lessonState, turnGuard = "") {
  const c = characters[activeCharacterKey] || characters.sophia;
  const student = sessionData?.userName || "friend";

  const inLesson =
    !!sessionData?.currentLesson &&
    Array.isArray(sessionData?.lessonWordlist) &&
    sessionData.lessonWordlist.length > 0;

  const state = lessonState || initLessonState(sessionData);
  const promptType = chooseNextPromptType(state.recentPromptTypes, state.stage);
  const stageMode = inLesson ? buildStageMode(sessionData, state) : "";
  const policy = inLesson ? buildUniversalTeachingPolicy(sessionData, state, promptType) : "";
  const vocabContext = inLesson ? buildVocabContext(sessionData, state) : "";

  const allNames = Object.values(characters).map((ch) => ch.name).join(", ");

  return [
    ...(turnGuard ? [turnGuard] : []),

    `You are ${c.name}, an ESL tutor from Waterwheel Village (v${WWV_VERSION}).`,
    VILLAGE_CORE,

    `PERSONA STYLE:
${c.style}`,

    `PERSONA BACKGROUND:
${c.background}`,

    `Signature phrases (use rarely and naturally):
${c.phrases.join(" | ")}`,

    `Character rule: Remain ONLY ${c.name}. Do not become any other character (${allNames}).`,
    `Even if the student mentions another character, still answer only as ${c.name}.`,

    `Student name: ${student}. Use the student's name naturally.`,
    `Teaching tone: warm, calm, encouraging, human.`,
    `Never say you are an AI or language model.`,
    `REAL-WORLD FACTS RULE: Do not claim a real-world nationality or biography unless it appears in your character background.`,
    `If explicitly asked for translation or Finnish, give one short sentence in Finnish first, then continue in simple English.`,

    mode === "voice"
      ? `VOICE MODE: Do not mention punctuation or capitalization. Correct gently by example.`
      : `TEXT MODE: Correct gently by example. Do not comment on punctuation.`,

    inLesson ? `CURRENT LESSON STAGE: ${state.stage}` : "",
    policy,
    stageMode,
    vocabContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// =====================================================
// RUNTIME LESSON ENGINE
// Call these around each turn in your app
// =====================================================

function processStudentTurn({
  lessonState,
  studentText,
  sessionData,
}) {
  const state = lessonState || initLessonState(sessionData);
  const text = String(studentText || "");

  bumpLessonCounters(state);

  state.studentRichTurn = detectRichStudentTurn(text);
  state.studentAskedQuestion = detectStudentQuestion(text);

  updateVocabStatusesFromStudentText(state, text);
  detectDrift(text, sessionData, state);

  const answerClass = classifyStudentAnswer(text);
  if (answerClass === "unsafe") state.unsafeCount += 1;
  if (answerClass === "unrealistic") state.nonsenseCount += 1;

  const nextStage = getNextStage(state);
  setStage(state, nextStage);

  if (state.stage === LESSON_STAGES.CLOSE) {
    maybeMarkChapterComplete(state);
  }

  return {
    lessonState: state,
    answerClass,
    vocabProgress: getVocabProgress(state),
    missingWords: getMissingWords(state),
  };
}

function processTutorPromptChoice(lessonState) {
  const state = lessonState;
  const nextPromptType = chooseNextPromptType(state.recentPromptTypes, state.stage);
  recordPromptType(state, nextPromptType);
  return nextPromptType;
}

// =====================================================
// OPTIONAL: small helper for intro handoff
// Use this if chapter 1 should start with elder chat
// =====================================================

function buildChapterWarmupStarter(studentName = "friend") {
  return `Good day, ${studentName}. The village feels calm today. How has your day begun so far?`;
}

function buildLessonHandoff(elderName, teacherName, chapterTitle, studentName = "friend") {
  return `${studentName}, thank you. ${elderName} will now let ${teacherName} guide you into our lesson about ${chapterTitle}.`;
}

// =====================================================
// OPTIONAL: detect if lesson is ready to finish
// =====================================================

function shouldCloseChapter(lessonState) {
  const progress = getVocabProgress(lessonState);
  return progress.ratio >= 0.8 && lessonState.totalTurns >= 10;
}

function buildVocabContext(sessionData) {
  if (!Array.isArray(sessionData?.lessonWordlist) || !sessionData.lessonWordlist.length) {
    return "";
  }

  const words = sessionData.lessonWordlist.slice(0, 40).join(", ");

  return `
LESSON VOCABULARY:
Use lesson words naturally in conversation.
Encourage the student to use them in meaningful personal context.

Target words:
${words}
`.trim();
}
// System prompt builder (lore + persona + lesson vocab context)
function buildSystemPrompt(activeCharacterKey, sessionData, mode, turnGuard = "") {
  const c = characters[activeCharacterKey] || characters.sophia;
  const student = sessionData?.userName || "friend";

  const inLesson =
    !!sessionData?.currentLesson &&
    Array.isArray(sessionData?.lessonWordlist) &&
    sessionData.lessonWordlist.length > 0;

  const isDemo = !!sessionData?.demo;

  const topicAnchor = inLesson
    ? `TOPIC: Current lesson topic is "${sessionData.currentLesson.chapter}". Stay connected.`
    : "";

  const coachMode = inLesson && !isDemo
    ? buildCoachMode(sessionData)
    : "";

  const vocabContext = inLesson ? buildVocabContext(sessionData) : "";

  const allNames = Object.values(characters).map((ch) => ch.name).join(", ");

  return [
    ...(turnGuard ? [turnGuard] : []),

    `You are ${c.name}, an ESL tutor from Waterwheel Village (v${WWV_VERSION}).`,
    VILLAGE_CORE,

    `PERSONA STYLE:
${c.style}`,

    `PERSONA BACKGROUND:
${c.background}`,

    `Signature phrases (use rarely and naturally):
${c.phrases.join(" | ")}`,

    `Character rule: Remain ONLY ${c.name}. Do not become any other character (${allNames}).`,
    `Even if the student mentions another character, still answer only as ${c.name}.`,

    `Student name: ${student}. Use the student's name naturally.`,

    `Teaching tone: warm, calm, encouraging, human.`,
    `Never say you are an AI or language model.`,
    `REAL-WORLD FACTS RULE: Do not claim a real-world nationality or biography unless it is in your character background.`,

    `If explicitly asked for translation or Finnish, give one short sentence in Finnish first, then continue in simple English.`,

    mode === "voice"
      ? `VOICE MODE: Do not mention punctuation or capitalization. Correct gently by example.`
      : `TEXT MODE: Correct gently by example. Do not comment on punctuation.`,

    topicAnchor,
    coachMode,
    vocabContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// History helper: keep last 40 messages
async function loadHistory(sessionId) {
return JSON.parse((await redis.get(`history:${sessionId}`)) || "[]");
}
async function saveHistory(sessionId, arr) {
const MAX = 40;
const trimmed = arr.length > MAX ? arr.slice(arr.length - MAX) : arr;
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
app.get("/wordlist/:month/:chapter", (req, res) => {
const { month, chapter } = req.params;
const monthData = monthlyWordlists[month];
const ch = monthData?.chapters?.[chapter];
if (!ch) {
return res.status(404).json({ error: `Chapter '${chapter}' not found in ${month}` });
  }
// Normalize: prefer arrays under words|vocab|wordlist; else return the chapter object
const payload =
    (Array.isArray(ch.words) && ch.words) ||
    (Array.isArray(ch.vocab) && ch.vocab) ||
    (Array.isArray(ch.wordlist) && ch.wordlist) ||
ch;
res.json(payload);
});
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
// Name
const studentName = req.query.name ? decodeURIComponent(req.query.name) : sessionData.userName || "friend";
sessionData.userName = studentName;
// --- WORDS (accept words | vocab | wordlist) ---
const rawList = chData?.words || chData?.vocab || chData?.wordlist || [];
const words = Array.isArray(rawList) ? rawList : [];
// Build a lowercase list of just the English tokens for matching (strings or {en:...})
const wordlist = words
    .map((w) =>
typeof w === "string"
? w.toLowerCase()
: (w?.en || w?.word || "").toLowerCase()
    )
    .filter(Boolean);
console.log(`Wordlist for ${month}/${chapter}:`, wordlist);
// Save session state
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
// Prefer explicit title from lessonIntros, fall back to slug-based label
const chapterTitle =
      (intro && intro.title) ? intro.title : humanizeChapter(chapter);
const isMcArthurTeacher = intro.teacher === "mcarthur";  // Add this check
if (chapter !== "greetings_introductions" && !isMcArthurTeacher) {
  welcomeText = `Greetings, ${studentName}! I’m Mr. McArthur, the village elder. Welcome to Waterwheel Village, where we learn together like family. Today, you’ll meet ${characters[intro.teacher].name} to explore ${chapterTitle}. Let’s begin!`;
}
// For lessonText: Optionally trim redundant "I am Mr. McArthur" if already in welcome
let teacherText = intro.text.replace(/\[name\]/g, studentName);
if (isMcArthurTeacher && teacherText.startsWith(`Hello, ${studentName}. I am Mr. McArthur.`)) {  // Customize based on your lessonIntros patterns
  teacherText = teacherText.replace(`Hello, ${studentName}. I am Mr. McArthur. `, `Hello, ${studentName}. `);  // Merge/skip repeat
}
const storyText = intro.story.replace(/\[name\]/g, studentName);
const lessonText = `${teacherText}\n\n${storyText}`;
// Initialize history
const initialHistory = [];
if (welcomeText) initialHistory.push({ role: "assistant", content: welcomeText });
initialHistory.push({ role: "assistant", content: lessonText });
try {
await redis.set(`history:${sessionId}`, JSON.stringify(initialHistory));
console.log(`History initialized for ${sessionId}:`, initialHistory);
  } catch (err) {
console.error(`Failed to save history:${sessionId}:`, err.message);
  }
const voiceId = characters[intro.teacher].voiceId;
const response = { welcomeText, lessonText, words, sessionId, voiceId, character: intro.teacher };
console.log(`Lesson response:`, response);
res.json(response);
});
app.post("/chat", async (req, res) => {
  console.log("=== /chat HIT ===");
  console.log("Origin:", req.headers.origin || "(none)");
  console.log("Body:", req.body);

  try {
    const body = req.body || {};

const userMessage =
  body.text ||
  body.message ||
  body.userMessage ||
  "";

const sessionId =
  body.sessionId ||
  body.session_id ||
  uuidv4();

const messageId =
  body.messageId ||
  body.message_id ||
  "";

const mode = body.mode || "text";
const isVoice = body.isVoice || mode === "voice";
const userNameFromFrontend =
  body.name ||
  body.sessionData?.userName ||
  null;
const demo = body.demo;

const activeCharacterKey =
  body.activeCharacterKey ||
  body.character ||
  "mcarthur";

const incomingSessionData = body.sessionData || {};

    if (!messageId) {
      console.error("❌ Missing messageId");
      return res.status(400).json({ error: "Missing messageId" });
    }

    // Duplicate protection
    const dedupeKey = `processed:${sessionId}:${messageId}`;
    if (await redis.exists(dedupeKey)) {
      console.log(`⚠️ Skipping duplicate message: ${messageId}`);

      const messages = await loadHistory(sessionId);
      const lastReply =
        messages
          .slice()
          .reverse()
          .find((m) => m.role === "assistant")?.content || "";

      return res.json({
        text: lastReply,
        character: activeCharacterKey,
        version: WWV_VERSION,
      });
    }

    await redis.set(dedupeKey, "1", "EX", 300); // 5 min TTL

const sanitizedText = userMessage ? String(userMessage).trim() : "";

    console.log("📩 Incoming chat request:", {
  text: sanitizedText,
  sessionId,
  isVoice,
  mode,
  name: userNameFromFrontend,
  demo,
  activeCharacterKey,
  messageId,
  chapter: incomingSessionData?.currentLesson?.chapter,
  wordlistLength: incomingSessionData?.lessonWordlist?.length,
});

    // --- Load session data ---
    let sessionData;
    try {
      const sessionRaw = await redis.get(`session:${sessionId}`);
     const storedSessionData = sessionRaw
  ? JSON.parse(sessionRaw)
  : {
      character: "mcarthur",
      studentLevel: null,
      currentLesson: null,
      isWeatherQuery: false,
      learnedWords: [],
      userName: null,
      lessonWordlist: [],
      tutorAskedLastTurn: false,
    };

sessionData = {
  ...storedSessionData,
  ...incomingSessionData,
  character: activeCharacterKey,
  userName:
    userNameFromFrontend ||
    incomingSessionData.userName ||
    storedSessionData.userName ||
    null,
  currentLesson:
    incomingSessionData.currentLesson ||
    storedSessionData.currentLesson ||
    null,
  lessonWordlist:
    incomingSessionData.lessonWordlist ||
    storedSessionData.lessonWordlist ||
    [],
};

console.log("📦 Loaded sessionData:", sessionData);
    } catch (err) {
      console.error(`❌ Redis error for session:${sessionId}:`, err.message);
     sessionData = {
  character: activeCharacterKey,
  studentLevel: null,
  currentLesson: incomingSessionData.currentLesson || null,
  isWeatherQuery: false,
  learnedWords: [],
  userName: userNameFromFrontend || incomingSessionData.userName || null,
  lessonWordlist: incomingSessionData.lessonWordlist || [],
  tutorAskedLastTurn: false,
};
    }

    // --- Username sync ---
    if (userNameFromFrontend && userNameFromFrontend !== sessionData.userName) {
      sessionData.userName = decodeURIComponent(userNameFromFrontend);
    }

    // --- Lesson sync: auto-select correct teacher ---
    if (sessionData.currentLesson) {
      const lesson =
        lessonIntros[sessionData.currentLesson.month]?.[sessionData.currentLesson.chapter];
      if (lesson) sessionData.character = lesson.teacher;
    }

    // --- ASR Normalization ---
    const activeKeyForASR = sessionData.character || "mcarthur";
    const normalizedText = normalizeTranscript(sanitizedText, activeKeyForASR, !!isVoice);
    console.log("🔤 Normalized text:", normalizedText);

    // --- Character switching by text trigger ---
    const requestedCharacterKey = findCharacter(normalizedText);
    const requestedCharacter = requestedCharacterKey ? characters[requestedCharacterKey] : null;

    if (
      !sessionData.currentLesson &&
      requestedCharacter &&
      requestedCharacterKey !== sessionData.character
    ) {
      sessionData.character = requestedCharacterKey;
      sessionData.currentLesson = null;
      sessionData.isWeatherQuery = false;
      sessionData.learnedWords = [];
      sessionData.lessonWordlist = [];
      sessionData.tutorAskedLastTurn = false;

      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
      await saveHistory(sessionId, []);
      await redis.del(`lessonState:${sessionId}`);

      console.log("🔄 Switched to new character:", requestedCharacterKey);

      const introText = `Hello, I am ${requestedCharacter.name}. What would you like to talk about today?`;
      await saveHistory(sessionId, [{ role: "assistant", content: introText }]);

      res.setHeader("X-WWV-Version", WWV_VERSION);
      res.setHeader("X-WWV-Character", requestedCharacterKey);

      return res.json({
        text: introText,
        character: requestedCharacterKey,
        voiceId: requestedCharacter.voiceId,
        version: WWV_VERSION,
      });
    }

    // --- Load history ---
    let messages = await loadHistory(sessionId);

        // --- Lesson engine state ---
    let lessonState = JSON.parse(
      (await redis.get(`lessonState:${sessionId}`)) || "null"
    );

    if (!lessonState) {
      lessonState = initLessonState(sessionData);
    }

    // Process the student turn only if there is actual user text
if (normalizedText && normalizedText.length > 0) {
        const lessonResult = processStudentTurn({
        lessonState,
        studentText: normalizedText,
        sessionData,
      });

      lessonState = lessonResult.lessonState;

      // Record next prompt type for variation control
      processTutorPromptChoice(lessonState);

      await redis.set(`lessonState:${sessionId}`, JSON.stringify(lessonState));
    }
    // --- Demo mode chat limit ---
    const DEMO_MAX_MESSAGES = 11;
    if (demo && messages.length >= DEMO_MAX_MESSAGES - 1) {
      const goodbye =
        "It was a pleasure sharing with you, friend. This concludes our demo conversation. Feel free to start a new session!";

      messages.push({ role: "assistant", content: goodbye });
      await saveHistory(sessionId, messages);

      return res.json({
        text: goodbye,
        character: sessionData.character,
        voiceId: characters[sessionData.character].voiceId,
        demoEnded: true,
      });
    }

    // --- Word Counting Logic ---
    function normalizeToken(t) {
      t = String(t || "").toLowerCase().trim();
      t = t.replace(/[^\w\s-]/g, "");
      if (!t) return t;
      if (t.length <= 2) return t;
      if (t.endsWith("ies") && t.length > 3) return t.slice(0, -3) + "y";
      if (t.endsWith("es") && t.length > 3) {
        const base = t.slice(0, -2);
        if (/(s|x|z|ch|sh|o)$/.test(base)) return base;
      }
      if (t.endsWith("s") && t.length > 3) return t.slice(0, -1);
      return t;
    }

    const userWords = normalizedText
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const userSet = new Set();
    for (const w of userWords) {
      userSet.add(w);
      userSet.add(normalizeToken(w));
    }

    const userNorm = normalizedText.toLowerCase().replace(/[^\w\s-]/g, "").trim();

    // --- Word tracking + milestones ---
    let newlyLearned = [];
    let milestone10 = false;
    let chapterComplete = false;
    let badgeTitle = null;

    const previousLearnedCount = sessionData.learnedWords.length;
    const previousWordsRemaining = sessionData.lessonWordlist.length;

    if (sessionData.lessonWordlist.length > 0) {
      const wordsRemaining = [];

      for (const rawWord of sessionData.lessonWordlist) {
        const lessonWord = String(rawWord || "").toLowerCase().trim();
        const normLesson = normalizeToken(lessonWord);

        let isMatch = userSet.has(lessonWord) || userSet.has(normLesson);

        if (!isMatch && lessonWord.includes(" ")) {
          const phraseNorm = lessonWord.replace(/[^\w\s-]/g, "").trim();
          if (userNorm.includes(phraseNorm)) isMatch = true;
        }

        if (isMatch && !sessionData.learnedWords.includes(lessonWord)) {
          sessionData.learnedWords.push(lessonWord);
          newlyLearned.push(lessonWord);
        } else {
          wordsRemaining.push(lessonWord);
        }
      }

      sessionData.lessonWordlist = wordsRemaining;

      const previousCount = previousLearnedCount || 0;
      const currentCount = sessionData.learnedWords.length || 0;
      const prevLevel = Math.floor(previousCount / 10);
      const currentLevel = Math.floor(currentCount / 10);

      if (currentLevel > prevLevel && currentLevel > 0) {
        milestone10 = true;
        const studentName = sessionData.userName || "friend";
        const wordsLearned = currentLevel * 10;
        newlyLearned.push(
          `\n\n${studentName}, you’ve already used ${wordsLearned} new words from this unit! 🎉`
        );
      }

      if (
        sessionData.lessonWordlist.length === 0 &&
        previousWordsRemaining > 0 &&
        sessionData.learnedWords.length > 0
      ) {
        chapterComplete = true;

        const chapterName = sessionData.currentLesson
          ? humanizeChapter(sessionData.currentLesson.chapter)
          : "this lesson";

        badgeTitle = `${chapterName} Explorer`;

        newlyLearned.push(
          `\n\n🎉 You've learned all the words for this lesson! Great job!\n\n` +
            `You are now a ${badgeTitle} of Waterwheel Village 🏅\n\n` +
            `If you like, we can:\n` +
            ` (A) review these words again,\n` +
            ` (B) write a short story using them, or\n` +
            ` (C) talk freely about your week.`
        );
      }
    }

    const isCompleteNow =
      chapterComplete ||
      (sessionData.lessonWordlist.length === 0 && sessionData.learnedWords.length > 0);

    const { wantsEnd, wantsNext } = detectEndOrNextIntent(normalizedText);

  if (isCompleteNow && (wantsEnd || wantsNext)) {
  const characterKeyForCompletion = sessionData.character || activeCharacterKey;
  const voiceId = characters[characterKeyForCompletion].voiceId;

      const closing = wantsNext
        ? "Great! Lesson complete — moving to the next chapter."
        : "Great! Lesson complete — goodbye!";

      messages.push({ role: "assistant", content: closing });
      await saveHistory(sessionId, messages);

      sessionData.conversationState = wantsNext ? "ADVANCE_CHAPTER" : "ENDED";
      sessionData.tutorAskedLastTurn = false;
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

      res.setHeader("X-WWV-Version", WWV_VERSION);
      res.setHeader("X-WWV-Character", characterKeyForCompletion);
      return res.json({
        text: closing,
      character: characterKeyForCompletion,
        voiceId,
        learnedCount: sessionData.learnedWords.length,
        newlyLearned,
        milestone10,
        chapterComplete: isCompleteNow,
        badgeTitle,
        action: wantsNext ? "NEXT_CHAPTER" : "END_LESSON",
        version: WWV_VERSION,
      });
    }

    // --- Build message history for OpenAI ---
    messages.push({ role: "user", content: normalizedText });
    await saveHistory(sessionId, messages);

    // --- System prompt ---
    // --- System prompt ---
const characterKeyForPrompt = sessionData.character || activeCharacterKey;
const combinedGuard = "";
const systemPrompt = buildSystemPrompt(
  characterKeyForPrompt,
  sessionData,
  isVoice ? "voice" : "text",
  lessonState,
  combinedGuard
);
    console.log("🛠 Using systemPrompt:", systemPrompt);

    // --- OpenAI request ---
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.5,
    });

    const reply =
      (completion.choices?.[0]?.message?.content || "").trim() || "Okay.";

    sessionData.tutorAskedLastTurn = /\?\s*$/.test(reply);
    console.log("💬 OpenAI reply:", reply);

    // --- Save response ---
    messages = await loadHistory(sessionId);
    messages.push({ role: "assistant", content: reply });
    await saveHistory(sessionId, messages);

    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

    const voiceId = characters[activeCharacterKey].voiceId;
    res.setHeader("X-WWV-Version", WWV_VERSION);
    res.setHeader("X-WWV-Character", activeCharacterKey);

    return res.json({
      text: reply,
      character: activeCharacterKey,
      voiceId,
      learnedCount: sessionData.learnedWords.length,
      newlyLearned,
      milestone10,
      chapterComplete: isCompleteNow,
      badgeTitle,
      version: WWV_VERSION,
    });
  } catch (err) {
    console.error("=== /chat CRASHED ===");
    console.error(err?.stack || err);
    return res.status(500).json({
      error: "Chat failed",
      details: err?.message || "Unknown error",
    });
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

app.post("/speakbase", async (req, res) => {
const { text, voiceId } = req.body || {};
if (!process.env.ELEVENLABS_API_KEY) {
console.error("❌ Missing ELEVENLABS_API_KEY");
return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY" });
  }
if (!text || !voiceId) {
return res.status(400).json({ error: "Missing text or voiceId" });
  }
  // 🔊 Clean text for speech (removes Mr. pause etc.)
const speechText = cleanTextForSpeech(text);

// 1) Compute cache key & path
const key = hashTextForCache(speechText, voiceId);
const cachedPath = path.join(AUDIO_CACHE_DIR, `${key}.mp3`);
try {
// 2) If cached, stream file and return (no ElevenLabs cost)
if (fs.existsSync(cachedPath)) {
console.log(`🔁 Serving cached audio: ${cachedPath}`);
res.setHeader("Content-Type", "audio/mpeg");
const stream = fs.createReadStream(cachedPath);
stream.on("error", (err) => {
console.error("❌ Error reading cached audio:", err.message);
if (!res.headersSent) {
res.status(500).json({ error: "Failed to read cached audio" });
        } else {
res.end();
        }
      });
return stream.pipe(res);
    }
// 3) Not cached → call ElevenLabs, save, then send
console.log(`🔊 Generating new audio for cache key: ${key}`);
const response = await fetch(
`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
method: "POST",
headers: {
"Content-Type": "application/json",
"xi-api-key": process.env.ELEVENLABS_API_KEY,
Accept: "audio/mpeg",
        },
body: JSON.stringify({
  text: speechText,

model_id: "eleven_multilingual_v2", // keep your current model
        }),
      }
    );
if (!response.ok) {
const errorText = await response.text();
console.error("❌ ElevenLabs API error:", response.status, errorText);
return res
        .status(response.status)
        .json({ error: "ElevenLabs generation failed", details: errorText });
    }
const arrayBuffer = await response.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);
// 3a) Save to cache
try {
fs.writeFileSync(cachedPath, buffer);
console.log(`✅ Cached new audio at: ${cachedPath}`);
    } catch (err) {
console.error("⚠️ Failed to write audio cache:", err.message);
// We still continue and send the audio; caching just fails silently
    }
// 3b) Send audio to client
res.setHeader("Content-Type", "audio/mpeg");
res.end(buffer);
  } catch (err) {
console.error("❌ Speakbase processing error:", err.message);
if (!res.headersSent) {
return res
        .status(500)
        .json({ error: "TTS Generation Failed", details: err.message });
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
const ch = v && v.chapters && typeof v.chapters === "object" ? Object.keys(v.chapters) : [];
index[k] = ch;
  }
res.json({ months: index });
});
app.get("/health", (_req, res) => res.json({ ok: true, status: "Waterwheel backend alive", version: WWV_VERSION }));
// Boot-time load of monthly wordlists
loadMonthlyWordlists();
// === Start server ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));