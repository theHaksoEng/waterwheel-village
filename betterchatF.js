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
const Redis = require("ioredis"); // 👈 must be here once
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const redis = new Redis(redisUrl, {
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});

console.log("✅ Using Redis at:", redisUrl);

// === Redis URL + Connection Test ===
(async () => {
  try {
    const pong = await redis.ping();
    console.log(`✅ Redis URL test success: ${redisUrl} → ${pong}`);
  } catch (err) {
    console.error(`❌ Redis URL test failed for ${redisUrl}:`, err.message);
  }
})();


// === Connection Test ===
(async () => {
  try {
    const pong = await redis.ping();
    console.log("✅ Redis connected:", pong);
  } catch (err) {
    console.error("❌ Redis connection failed:", err.message);
  }
})();

// === Wordlists ===
const wordlistsPath = path.join(__dirname, "wordlists.json");
let wordlists = {};
try {
  const fileContent = fs.readFileSync(wordlistsPath, "utf-8");
  wordlists = JSON.parse(fileContent);
  console.log("✅ Wordlists loaded:", Object.keys(wordlists));
} catch (err) {
  console.error("❌ Failed to load wordlists file", err);
}

// === Voices ===
const voices = {
  mcarthur: process.env.VOICE_MCARTHUR,
  nadia: process.env.VOICE_NADIA,
  fatima: process.env.VOICE_FATIMA,
  anika: process.env.VOICE_ANIKA,
  liang: process.env.VOICE_LIANG,
  johannes: process.env.VOICE_JOHANNES,
  aleksanderi: process.env.VOICE_ALEKSANDERI,
  sophia: process.env.VOICE_SOPHIA,
  kwame: process.env.VOICE_KWAME,
  ibrahim: process.env.VOICE_IBRAHIM,
  default: process.env.VOICE_MCARTHUR,
};

// === Character detection ===
function detectCharacter(text, fallback = "mcarthur") {
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (lower.includes("nadia")) return "nadia";
  if (lower.includes("fatima")) return "fatima";
  if (lower.includes("anika")) return "anika";
  if (lower.includes("liang")) return "liang";
  if (lower.includes("johannes")) return "johannes";
  if (lower.includes("aleksander")) return "aleksanderi";
  if (lower.includes("sophia")) return "sophia";
  if (lower.includes("kwame")) return "kwame";
  if (lower.includes("ibrahim")) return "ibrahim";
  if (lower.includes("mcarthur")) return "mcarthur";
  return fallback;
}

// === CHAT endpoint ===
app.post("/chat", async (req, res) => {
  const { text: rawText, sessionId: providedSessionId, isVoice } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : "";

  try {
    // Load session
    let sessionData = JSON.parse(await redis.get(`session:${sessionId}`)) || {
      character: "mcarthur",
      studentLevel: null,
    };

    // Welcome if no input
    if (!sanitizedText) {
      const welcomeMsg =
        "Welcome to Waterwheel Village, friends! I'm Mr. McArthur. What's your name? Are you a beginner, intermediate, or expert student?";
      await redis.set(`history:${sessionId}`, JSON.stringify([{ role: "assistant", content: welcomeMsg }]));
      return res.json({ text: welcomeMsg, character: "mcarthur", voiceId: voices.mcarthur });
    }

    // Save input
    let messages = JSON.parse(await redis.get(`history:${sessionId}`)) || [];
    messages.push({ role: "user", content: sanitizedText });

    // Detect level
    const lowered = sanitizedText.toLowerCase();
    if (lowered.includes("beginner")) sessionData.studentLevel = "beginner";
    else if (lowered.includes("intermediate")) sessionData.studentLevel = "intermediate";
    else if (lowered.includes("expert")) sessionData.studentLevel = "expert";

    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

    // Build system prompt
    let systemPrompt = `You are ${sessionData.character} in Waterwheel Village. Be a kind ESL teacher. Be brief, encouraging, correct gently. Always ask one short follow-up.`;
    if (isVoice) {
      systemPrompt += " Student is speaking by voice, ignore punctuation corrections.";
    }
    const outboundMessages = [{ role: "system", content: systemPrompt }, ...messages];

    // === Chatbase ===
    const chatbaseRes = await fetch("https://www.chatbase.co/api/v1/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CHATBASE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chatbotId: process.env.CHATBASE_CHATBOT_ID,
        conversationId: sessionId,
        messages: outboundMessages,
      }),
      timeout: 30000,
    });
    const cbData = await chatbaseRes.json();
    const responseText = cbData?.text?.trim?.() || "Let's keep going!";

    // Detect character
    let detectedCharacter = detectCharacter(responseText, sessionData.character || "mcarthur");
    sessionData.character = detectedCharacter;
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

    // Save history
    messages.push({ role: "assistant", content: responseText });
    await redis.set(`history:${sessionId}`, JSON.stringify(messages));

    res.json({
      text: responseText,
      character: detectedCharacter,
      voiceId: voices[detectedCharacter] || voices.mcarthur,
      level: sessionData.studentLevel,
    });
  } catch (err) {
    console.error("❌ /chat error:", err);
    res.json({
      text: "Thanks! Let’s begin with a short exercise: tell me 3 things about yourself.",
      character: "mcarthur",
      voiceId: voices.mcarthur,
      level: null,
      note: "fallback-error",
    });
  }
});

// === SPEAK endpoint ===
app.post("/speakbase", async (req, res) => {
  try {
    const { text, voiceId, character } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });
    const finalVoiceId = voiceId || voices[character] || voices.default;

    const processedText = text.replace(/,/g, " ...");

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: processedText,
        voice_settings: { stability: 0.3, similarity_boost: 0.8 },
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("❌ /speakbase error:", err);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

// === Wordlist endpoint ===
app.get("/wordlist/:week/:level", async (req, res) => {
  const { week, level } = req.params;
  const key = `week${week}`;
  let words = wordlists[key]?.[level] || [];
  if (!words.length) return res.status(404).json({ error: "No words found" });
  res.json(words);
});

// === Quiz endpoint ===
app.get("/quiz/:week/:level", async (req, res) => {
  const { week, level } = req.params;
  const key = `week${week}`;
  let words = wordlists[key]?.[level] || [];
  if (!words.length) return res.status(404).json({ error: "No quiz words found" });
  res.json(words.sort(() => 0.5 - Math.random()).slice(0, 5));
});

// === Story endpoint ===
app.get("/story/:unit/:chapter", (req, res) => {
  const { unit, chapter } = req.params;
  const stories = {
    "1": {
      "1": "🌾 In Waterwheel Village, the morning sun rises over the mill...",
      "2": "🍞 At the bakery, the smell of fresh bread fills the air...",
      "3": "🥕 At the market, farmers bring carrots, potatoes, and apples...",
      "4": "🏡 In the evening, families gather around the table...",
    },
  };
  if (stories[unit] && stories[unit][chapter]) {
    return res.json({ story: stories[unit][chapter] });
  }
  res.json({ error: "No story found" });
});

// === End + Resume lesson ===
app.post("/endlesson", async (req, res) => {
  const { sessionId, unit, chapter, learnedWords } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  await redis.set(`lesson:${sessionId}`, JSON.stringify({ unit, chapter, learnedWords, timestamp: Date.now() }));
  res.json({ message: "📕 Lesson ended and stored!" });
});

app.get("/resume/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const data = await redis.get(`lesson:${sessionId}`);
  if (!data) return res.json({ error: "No saved lesson found." });
  res.json({ progress: JSON.parse(data) });
});

// === Health check ===
app.get("/health", (req, res) => res.json({ ok: true, status: "Waterwheel backend alive" }));

// === Start server ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
