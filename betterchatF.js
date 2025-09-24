// betterchatF.js
// === Waterwheel Village Backend (CommonJS) ===

// ✅ Load env first
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// === Express setup ===
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(bodyParser.json());

// === Redis Setup ===
const Redis = require("ioredis");
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl, {
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});
console.log("✅ Using Redis at:", redisUrl);

// Connection test
(async () => {
  try {
    const pong = await redis.ping();
    console.log(`✅ Redis connected: ${pong}`);
  } catch (err) {
    console.error("❌ Redis connection failed:", err.message);
  }
})();

// === Load monthly wordlists ===
const monthlyWordlists = {};
function loadMonthlyWordlists() {
  const wordlistsDir = path.join(__dirname, "wordlists", "monthly");
  try {
    const files = fs.readdirSync(wordlistsDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const content = fs.readFileSync(path.join(wordlistsDir, file), "utf8");
        const parsed = JSON.parse(content);
        const key = parsed.month ? `month${parsed.month}` : path.basename(file, ".json");
        monthlyWordlists[key] = parsed;
      }
    }
    console.log("✅ Monthly wordlists loaded:", Object.keys(monthlyWordlists));
  } catch (err) {
    console.error("❌ Failed to load monthly wordlists:", err);
  }
}
loadMonthlyWordlists();

// === Wordlist endpoint ===
app.get("/wordlist/:month/:chapter", (req, res) => {
  const { month, chapter } = req.params;
  const monthData = monthlyWordlists[month];
  if (monthData && monthData.chapters && monthData.chapters[chapter]) {
    res.json(monthData.chapters[chapter]);
  } else {
    res.status(404).json({ error: `Chapter '${chapter}' not found in ${month}` });
  }
});

// === Lesson intros ===
const lessonIntros = {
  month1: {
    greetings_introductions: {
      teacher: "mcarthur",
      text: "Hello, friend! My name is Mr. McArthur. Let’s practice greetings and introductions. Try saying: 'Hello, my name is...'"
    },
    numbers_days_questions: {
      teacher: "johannes",
      text: "I am Johannes. Let’s talk about numbers and days. Can you count to five with me?"
    },
    food_drink: {
      teacher: "fatima",
      text: "Welcome, dear student! I am Fatima. Today we will enjoy talking about food and drink. Let’s start with simple words like 'soup' and 'bread'."
    },
    daily_phrases: {
      teacher: "anika",
      text: "Hi, I am Anika! Let’s practice daily phrases together. Start by saying: 'Good morning!'"
    }
  }
};

// === Lesson endpoint ===
app.get("/lesson/:month/:chapter", async (req, res) => {
  const { month, chapter } = req.params;
  const intro = lessonIntros[month]?.[chapter];
  if (!intro) return res.status(404).json({ error: "Lesson not found" });

  const sessionId = req.query.sessionId || uuidv4();
  const sessionData = {
    character: intro.teacher,
    currentLesson: { month, chapter },
  };
  await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

  const monthData = monthlyWordlists[month];
  const words = monthData?.chapters?.[chapter]?.words || [];

  res.json({ ...intro, words, sessionId });
});

// === CHAT endpoint ===
app.post("/chat", async (req, res) => {
  const { text: rawText, sessionId: providedSessionId, isVoice } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : "";

  try {
    // Load session or init
    let sessionData = JSON.parse(await redis.get(`session:${sessionId}`)) || {
      character: "mcarthur",
      studentLevel: null,
      currentLesson: null,
      progress: {},
    };

    // Handle no input = welcome
    if (!sanitizedText) {
      const welcomeMsg =
        "Welcome to Waterwheel Village, friends! I'm Mr. McArthur. What's your name? Are you a beginner, intermediate, or expert student?";
      await redis.set(
        `history:${sessionId}`,
        JSON.stringify([{ role: "assistant", content: welcomeMsg }])
      );
      return res.json({ text: welcomeMsg, character: "mcarthur", voiceId: voices.mcarthur });
    }

    // Save user input into history
    let messages = JSON.parse(await redis.get(`history:${sessionId}`)) || [];
    messages.push({ role: "user", content: sanitizedText });

    // Detect level from user self-report
    const lowered = sanitizedText.toLowerCase();
    if (lowered.includes("beginner")) sessionData.studentLevel = "beginner";
    else if (lowered.includes("intermediate")) sessionData.studentLevel = "intermediate";
    else if (lowered.includes("expert")) sessionData.studentLevel = "expert";

    // === Teacher persistence ===
    let activeCharacter = sessionData.character || "mcarthur";
    if (sessionData.currentLesson && sessionData.currentLesson.month) {
      const lessonIntro = lessonIntros[sessionData.currentLesson.month]?.[sessionData.currentLesson.chapter];
      if (lessonIntro?.teacher) activeCharacter = lessonIntro.teacher;
    }
    sessionData.character = activeCharacter;

    // === Build system prompt ===
    let systemPrompt = `You are ${activeCharacter} in Waterwheel Village.
You must ALWAYS stay in character as ${activeCharacter}.
Do not switch to other teachers unless the student explicitly requests a different one.
Be a kind ESL teacher: brief, encouraging, correct gently,
and always ask one short follow-up question.`;

    if (isVoice) {
      systemPrompt +=
        " The student is speaking by voice. Do NOT mention punctuation, commas, periods, or capitalization. Focus only on words and clarity.";
    }

    // === Vocab integration ===
    let vocabWords = [];
    if (sessionData.currentLesson) {
      const { month, chapter } = sessionData.currentLesson;
      vocabWords = monthlyWordlists[month]?.chapters?.[chapter]?.words?.map(w => w.en) || [];
      if (!sessionData.progress[chapter]) sessionData.progress[chapter] = {};
    }

    if (vocabWords.length > 0) {
      systemPrompt += ` Encourage the student to use these target words if possible: ${vocabWords.join(", ")}.`;
    }

    // Call OpenAI (dummy structure shown, replace with real API call)
    const replyText = `(${activeCharacter} replying...) ${sanitizedText}`; // placeholder

    // Save assistant reply to history
    messages.push({ role: "assistant", content: replyText });

    await redis.set(`history:${sessionId}`, JSON.stringify(messages));
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

    res.json({
      text: replyText,
      character: activeCharacter,
      voiceId: voices[activeCharacter] || voices.mcarthur,
    });
  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// === Speakbase endpoint (for ElevenLabs) ===
const voices = {
  mcarthur: "fEVT2ExfHe1MyjuiIiU9",
  fatima: "Pt5YrLNyu6d2s3s4CVMg",
  johannes: "replace-with-ID",
  anika: "replace-with-ID",
};

app.post("/speakbase", async (req, res) => {
  const { text, voiceId } = req.body;
  try {
    const ttsRes = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const audioBuffer = await ttsRes.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error("❌ Speakbase failed:", err);
    res.status(500).json({ error: "Speakbase failed" });
  }
});

// === Health check ===
app.get("/health", (req, res) => res.json({ ok: true, status: "Waterwheel backend alive" }));

// === Start server ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
