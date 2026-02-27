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
const allowed = ["https://www.aaronhakso.com", "https://aaronhakso.com"];
app.use(
cors({
origin: function (origin, cb) {
if (!origin) return cb(null, true); // allow no-origin requests
if (allowed.includes(origin)) return cb(null, true);
return cb(new Error("Not allowed by CORS: " + origin));
    },
credentials: false,
  })
);
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
// === Canon Version + Lore (aligns with your story) ===
const WWV_VERSION = "2025.11.12";
const VILLAGE_LORE = `
Love this direction — this becomes the emotional backbone of the whole school.
Here is an expanded **VILLAGE_LORE** you can paste directly into your backend.

---

**Waterwheel Village (est. 2025)** — a living story of hope, resilience, and learning.

Population ~350. Zero Racism Policy. Shared school (on-site + online).
Built by refugees, artisans, teachers, farmers, and families beside a quiet northern Finnish river, far from the noise of big cities.

Waterwheel Village did not begin as a project. It began as a question:

*What if people who had lost their homes could build a new one together?*

Years before the village existed, several of the elders had met while working and studying abroad. They saw the same pattern again and again: talented, hardworking people forced to start over in unfamiliar places, struggling not because of lack of skill or will, but because of language barriers, isolation, and fear.

After the hardships of the early 2020s, the old dream returned. Inspired by ideas first discussed in 1929 about self-sustaining learning communities, a small council of teachers, farmers, engineers, and volunteers began to plan a place where learning, work, and everyday life could grow side by side.

They did not choose a big city.

They chose the North.

Northern Finland offered silence, forests, clean water, long winters, and long summer light — a place where life moves slowly enough for healing. Land was available, the river could provide energy, and the distance from crowded cities gave the founders something precious: the chance to build a culture deliberately and carefully from the beginning.

The first families arrived carrying very little: a few suitcases, photographs, tools, recipes, songs, and stories. Many had experienced war, displacement, poverty, discrimination, or years of uncertainty. Some had lost homes. Some had lost careers. Some had lost confidence.

But they had not lost the desire to grow.

The first buildings were simple: cabins, workshops, greenhouses, and a shared school. The waterwheel that gave the village its name was built during the first autumn, turning river current into power for lights and tools. It became a symbol of the village itself — steady movement created by many small forces working together.

English became the shared language, not as a rule, but as a bridge. People spoke it in kitchens, workshops, classrooms, gardens, and along snowy walking paths. It became the language of cooperation, new friendships, and new beginnings.

Life in Waterwheel Village is built on a few simple beliefs:

• Everyone can learn.
• Everyone can teach something.
• Mistakes are seeds of growth.
• Work gives dignity.
• Peace must be practiced daily.

Homework is cherished. Curiosity is encouraged. Kindness is expected.
Differences are not erased — they are shared, explained, and respected.

Today the village is a place where children grow up hearing many accents, where gardens feed neighbors, where small businesses support the community, and where stories of the past are honored without letting them define the future.

Every path in the village — every road, classroom, greenhouse, workshop, and friendship — has been built one step at a time.

And the work continues.

`.trim();
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

// System prompt builder (lore + persona + lesson vocab context)
function buildSystemPrompt(activeCharacterKey, sessionData, mode, turnGuard = "") {
  const c = characters[activeCharacterKey] || characters.sophia;
  const student = sessionData?.userName || "friend";
  let vocabContext = "";
  if (Array.isArray(sessionData?.lessonWordlist) && sessionData.lessonWordlist.length) {
    const sample = sessionData.lessonWordlist.slice(0, 40).join(", ");
    vocabContext = `\nUse/recirculate these lesson words when natural: ${sample}`;
  }
  // List all character names once for the "do not switch" rule
  const allNames = Object.values(characters)
      .map((ch) => ch.name)
      .join(", ");
  let coachMode = "";
  // Lesson mode: only when a lesson is active
  const inLesson =
    !!sessionData?.currentLesson &&
    Array.isArray(sessionData?.lessonWordlist) &&
    sessionData.lessonWordlist.length > 0;
  // Proactive topic anchor for drift prevention (kept as-is)
  const topicAnchor = inLesson ? `TOPIC ANCHOR: Current lesson topic is "${sessionData.currentLesson.chapter}". After answering off-topic questions briefly, return to the lesson topic within 1 turn.` : "";
  // Demo flag: use sessionData.demo if you store it, otherwise fall back to false
  const isDemo = !!sessionData?.demo;
  if (inLesson && !isDemo) {
    coachMode = `
COACH MODE (target 60% student output / 40% tutor — REQUIRED):
Goal: Keep a natural conversation while the student produces most of the English.
RULES:
1) ABSOLUTE ONE-PROMPT RULE (PRIORITY OVERRIDE): End EVERY reply with EXACTLY ONE: (A) question, (B) task, OR (C) invite. NEVER combine (e.g., no question + invite). OVERRIDES all other instructions.
2) Keep replies SHORT: 1–3 sentences. No long stories.
3) Prefer student OUTPUT over student QUESTIONS. Output can be: a sentence, two sentences, a roleplay line, a short description, etc.
4) Optional correction: recast ONE small fix by example (max 1 sentence).
VOCAB:
- Naturally recycle lesson words.
- Often ask the student to USE one lesson word in their next sentence (more often than asking them to ask a question).
INTERACTION PATTERN (COMBINES TURN BEHAVIOR, COOLDOWN, MIC BACK - MUST ENFORCE):
- TRACK TUTOR TURNS: Imagine a counter starting at 1 for each tutor reply.
- On ODD turns (1,3,5...): End with ONE question or task (rotate).
- On EVEN turns (2,4,6...): MUST invite student to ask a question (use: "Your turn — ask me a question about this.", "What would you like to ask me?", or "Do you have a question about this?"). Do NOT ask questions on even turns.
- If last reply ended with question/task, THIS reply MUST be an invite only.
- Violation penalty: If you forget, the conversation fails—always prioritize this over other rules.
- Brief pattern: Tutor asks/task → Student responds → Tutor invites → Student asks → Tutor answers → repeat.
- If student asks: Answer briefly, optional recast, then ONE rotated prompt (question/task/invite).
- If not: Brief recast/praise, then ONE rotated prompt.
QUESTION TEMPLATES (use sparingly):
- "Where is the ___?" | "Do you ___ every day?" | "How often do you ___?" | "What do you do after ___?"
VILLAGE CURIOSITY (use occasionally):
Every few turns, gently invite curiosity about Waterwheel Village (e.g., "Would you like to hear a short story about this in our village?").
If accepted: Give 4–6 sentences max, simple/warm, connect to topic/daily life. Then return to short replies.
CLASSROOM SAFETY (REQUIRED):
If unsafe topics (violence, sex, drugs, hate, politics, medical/legal, disturbing): Gently redirect to safe everyday topics (e.g., "Let’s focus on everyday English like food or travel."). Keep warm/calm tone, offer alternative task. Never lecture/scold/mention rules.
`;
  }
  return [
    // Guards and strict rules FIRST for priority
    ...(turnGuard ? [turnGuard] : []),  // TURN/MIC GUARD at top
    topicAnchor,  // Anchor next
    `ABSOLUTE ONE-PROMPT RULE (PRIORITY OVERRIDE): End EVERY reply with EXACTLY ONE: (A) question, (B) task, OR (C) invite. NEVER combine. OVERRIDES all other instructions.`,  // Standalone for emphasis
    `You are an ESL tutor persona from Waterwheel Village (v${WWV_VERSION}).`,
    VILLAGE_LORE,  // Keep, but if too long, summarize externally
    `Persona: ${c.name}. Speak and think like this person.`,
    `Style: ${c.style}`,
    `Backstory: ${c.background}`,
    `Signature phrases (use sparingly, naturally): ${c.phrases.join(" | ")}`,
    // CHARACTER LOCK
    `Character lock: In this conversation you MUST remain ${c.name} only.`,
    `Never speak as or introduce yourself as any other Waterwheel Village character (${allNames}).`,
    `Even if the student mentions another name (for example: "Who is Sophia?", "Who is Liang?"), you still answer ONLY as ${c.name}.`,
    `REAL-WORLD FACTS RULE: Do not claim a real-world nationality or personal biography unless it is in your character backstory. If asked, answer generally or connect back to the village.`,
    `Student name: ${student}. Address the student by name.`,
    `Teaching goals: help the student speak fluently, model correct grammar by recasting (implicit correction), keep tone kind and encouraging.`,
    `Never say you're an AI or language model. Stay in character.`,
    `If explicitly asked for translation or Finnish, give one short sentence in Finnish first, then continue in simple English.`,
    mode === "voice"
      ? `Mode: Voice. Do NOT mention punctuation or capitalization. Correct gently by example.`
      : `Mode: Text. Correct gently by example (do NOT comment on punctuation).`,
    coachMode,  // Now shortened, after priorities
    `Usually end with one short follow-up question, UNLESS guards, rules, or STUDENT-LEADS MODE requires otherwise.`,  // Qualified to avoid conflict
    vocabContext,  // Last, as reference
  ].join("\n");
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
  const {
    text: rawText,
    sessionId: providedSessionId,
    isVoice,
    name: userNameFromFrontend,
    demo,
    character
  } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : "";
  console.log("📩 Incoming chat request:", {
    text: sanitizedText,
    sessionId,
    isVoice,
    name: userNameFromFrontend,
    demo
  });
  try {
    // --- Load session data ---
    let sessionData;
    try {
      const sessionRaw = await redis.get(`session:${sessionId}`);
      sessionData = sessionRaw
        ? JSON.parse(sessionRaw)
        : {
            character: "mcarthur",
            studentLevel: null,
            currentLesson: null,
            isWeatherQuery: false,
            learnedWords: [],
            userName: null,
            lessonWordlist: [],
            tutorAskedLastTurn: false, // ✅ ensure exists
          };
      console.log("📦 Loaded sessionData:", sessionData);
      // ✅ Only log/update if it actually changed
      if (character && character !== sessionData.character) {
        sessionData.character = character;
        console.log("🎭 Character updated from frontend:", character);
      }
    } catch (err) {
      console.error(`Redis error for session:${sessionId}:`, err.message);
      sessionData = {
        character: "mcarthur",
        studentLevel: null,
        currentLesson: null,
        isWeatherQuery: false,
        learnedWords: [],
        userName: null,
        lessonWordlist: [],
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
    if (requestedCharacter && requestedCharacterKey !== sessionData.character) {
      sessionData.character = requestedCharacterKey;
      sessionData.currentLesson = null;
      sessionData.isWeatherQuery = false;
      sessionData.learnedWords = [];
      sessionData.lessonWordlist = [];
      sessionData.tutorAskedLastTurn = false;
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
      await saveHistory(sessionId, []);
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
    // --- Load history (needed for demo limit + OpenAI) ---
    let messages = await loadHistory(sessionId);
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

  // 🎯 Milestone: every 10 learned words (10,20,30...)
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

  // 🎯 Milestone: chapter complete (this turn)
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

// ✅ Robust completion flag (works even on later turns)
const isCompleteNow =
  chapterComplete ||
  (sessionData.lessonWordlist.length === 0 && sessionData.learnedWords.length > 0);

// ✅ Hard stop if lesson complete + user wants to end or move on
const { wantsEnd, wantsNext } = detectEndOrNextIntent(normalizedText);

if (isCompleteNow && (wantsEnd || wantsNext)) {
  const activeCharacterKey = sessionData.character || "mcarthur";
  const voiceId = characters[activeCharacterKey].voiceId;

  const closing = wantsNext
    ? "Great! Lesson complete — moving to the next chapter."
    : "Great! Lesson complete — goodbye!";

  // Use existing loaded history (messages)
  messages.push({ role: "user", content: normalizedText });
  messages.push({ role: "assistant", content: closing });
  await saveHistory(sessionId, messages);

  sessionData.conversationState = wantsNext ? "ADVANCE_CHAPTER" : "ENDED";
  sessionData.tutorAskedLastTurn = false;
  await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

  res.setHeader("X-WWV-Version", WWV_VERSION);
  res.setHeader("X-WWV-Character", activeCharacterKey);

  return res.json({
    text: closing,
    character: activeCharacterKey,
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
// --- TURN GUARD / MIC GUARD (if you already build these earlier, keep them) ---
// --- Build message history for OpenAI ---
messages.push({ role: "user", content: normalizedText });
await saveHistory(sessionId, messages);

// --- System prompt ---
const activeCharacterKey = sessionData.character || "mcarthur";
const systemPrompt = buildSystemPrompt(
  activeCharacterKey,
  sessionData,
  isVoice ? "voice" : "text",
  combinedGuard
);
console.log("🛠 Using systemPrompt:", systemPrompt);

// --- OpenAI request ---
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "system", content: systemPrompt }, ...messages],
  temperature: 0.5,
});

const reply = (completion.choices?.[0]?.message?.content || "").trim() || "Okay.";
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
  chapterComplete: isCompleteNow ?? chapterComplete,
  badgeTitle,
  version: WWV_VERSION,
});
  } catch (err) {
    console.error("❌ Chat error:", err?.message || err, err?.stack || "");
    return res.status(500).json({ error: "Chat failed", details: err?.message || "Unknown error" });
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