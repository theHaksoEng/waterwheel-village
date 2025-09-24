// betterchatF.js
// === Waterwheel Village Backend (CommonJS) ===

// ✅ Load env first
const dotenv = require("dotenv");
dotenv.config();


// === OpenAI Setup ===
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
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
    // Load or initialize session
    let sessionData = JSON.parse(await redis.get(`session:${sessionId}`)) || {
      character: "mcarthur",
      studentLevel: null,
    };

    // Handle first-time welcome if no input
    if (!sanitizedText) {
      const welcomeMsg =
        "Welcome to Waterwheel Village, friends! I'm Mr. McArthur. What's your name? Are you a beginner, intermediate, or expert student?";
      await redis.set(
        `history:${sessionId}`,
        JSON.stringify([{ role: "assistant", content: welcomeMsg }])
      );
      return res.json({ text: welcomeMsg, character: "mcarthur", voiceId: voices.mcarthur });
    }

    // Load history and append user input
    let messages = JSON.parse(await redis.get(`history:${sessionId}`)) || [];
    messages.push({ role: "user", content: sanitizedText });

    // Detect level from user message
    const lowered = sanitizedText.toLowerCase();
    if (lowered.includes("beginner")) sessionData.studentLevel = "beginner";
    else if (lowered.includes("intermediate")) sessionData.studentLevel = "intermediate";
    else if (lowered.includes("expert")) sessionData.studentLevel = "expert";

    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

    // === Build system prompt with teacher persistence ===
    let activeCharacter = sessionData.character || "mcarthur";

    // Check if lesson lock exists
    const lessonData = await redis.get(`lesson:${sessionId}`);
    if (lessonData) {
      try {
        const parsed = JSON.parse(lessonData);
        if (parsed.teacher) {
          activeCharacter = parsed.teacher;
        }
      } catch (err) {
        console.warn("⚠️ Failed to parse lessonData:", err.message);
      }
    }
    sessionData.character = activeCharacter;

    let systemPrompt = `You are ${activeCharacter} in Waterwheel Village. 
You must ALWAYS stay in character as ${activeCharacter}. 
Do not switch to other teachers unless the student explicitly requests a different one. 
Be a kind ESL teacher: brief, encouraging, correct gently, 
and always ask one short follow-up question.`;

    // Special rule: voice input
    if (isVoice) {
      systemPrompt +=
        " The student is speaking by voice. Do NOT mention punctuation, commas, periods, or capitalization. Focus only on words and clarity.";
    }

    // === Call OpenAI with history + system prompt ===
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content.trim();

    // Save bot reply to history
    messages.push({ role: "assistant", content: reply });
    await redis.set(`history:${sessionId}`, JSON.stringify(messages));

    // Voice ID mapping
    const voiceId = voices[activeCharacter] || voices.mcarthur;

    res.json({ text: reply, character: activeCharacter, voiceId });
  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// === Speakbase endpoint (for ElevenLabs) ===
const voices = {
  mcarthur: "fEVT2ExfHe1MyjuiIiU9",
  fatima: "JMbCR4ujfEfGaawA1YtC",
  johannes: "JgHmW3ojZwT0NDP5D1JJ",
  anika: "GCPLhb1XrVwcoKUJYcvz",
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

