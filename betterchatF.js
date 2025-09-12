require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const app = express();
const cors = require('cors');
const fs = require("fs");
const path = require("path");

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(cors());
app.use(express.json());

// ===== Trial Mode =====
const TRIAL_MODE = process.env.TRIAL_MODE === "true";

// === Load wordlists.json dynamically ===
const wordlistsPath = path.join(__dirname, "data", "wordlists.json");
let wordlists = {};

try {
  const fileContent = fs.readFileSync(wordlistsPath, "utf-8");
  wordlists = JSON.parse(fileContent);
  console.log("✅ Wordlists loaded successfully. Levels available:", Object.keys(wordlists));
} catch (err) {
  console.error("❌ Failed to load wordlists.json", err);
}

// ===== Simple in-memory storage =====
const sessions = new Map();
const histories = new Map();
const messageCounts = new Map(); // track trial messages

async function getSession(sessionId) { return sessions.get(sessionId); }
async function setSession(sessionId, data) { sessions.set(sessionId, data); }
async function getChatHistory(sessionId) { return histories.get(sessionId) || []; }
async function storeChatHistory(sessionId, messages) { histories.set(sessionId, messages); }

// ===== Character → ElevenLabs Voice mapping =====
const voices = {
  mcarthur: "fEVT2ExfHe1MyjuiIiU9",
  nadia: "a1KZUXKFVFDOb33I1uqr",
  fatima: "JMbCR4ujfEfGaawA1YtC",
  anika: "GCPLhb1XrVwcoKUJYcvz",
  liang: "gAMZphRyrWJnLMDnom6H",
  johannes: "JgHmW3ojZwT0NDP5D1JJ",
  aleksanderi: "tIFPE2y0DAU6xfZn3Fka",
  sophia: "0q9TlrIoQJIdxZP9oZh7",
  kwame: "dhwafD61uVd8h85wAZSE",
  ibrahim: "tlETan7Okc4pzjD0z62P",
  default: "fEVT2ExfHe1MyjuiIiU9"
};

// ===== Helper: normalize & detect character =====
function detectCharacter(text, fallback = "mcarthur") {
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (/nadia/.test(lower)) return "nadia";
  if (/fatima/.test(lower)) return "fatima";
  if (/anika/.test(lower)) return "anika";
  if (/liang/.test(lower)) return "liang";
  if (/johannes/.test(lower)) return "johannes";
  if (/aleksanderi/.test(lower)) return "aleksanderi";
  if (/sophia/.test(lower)) return "sophia";
  if (/kwame/.test(lower)) return "kwame";
  if (/ibrahim/.test(lower)) return "ibrahim";
  if (/mcarthur/.test(lower)) return "mcarthur";
  return fallback;
}

// ===== /chat endpoint =====
app.post('/chat', async (req, res) => {
  const { text: rawText, sessionId: providedSessionId, isVoice } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : '';
  const isWelcomeMessage = !sanitizedText;

  try {
    if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

    let sessionData = await getSession(sessionId);
    if (!sessionData) {
      sessionData = { character: 'mcarthur', studentName: null, studentLevel: null };
      await setSession(sessionId, sessionData);
    }
    let character = sessionData.character;

    // ===== Trial Mode message limit =====
    if (TRIAL_MODE) {
      const count = (messageCounts.get(sessionId) || 0) + 1;
      messageCounts.set(sessionId, count);
      if (count > 10) {
        return res.json({
          text: "⚠️ Trial limit reached. Please sign up to continue.",
          character: 'mcarthur',
          voiceId: voices.mcarthur,
          level: sessionData.studentLevel || null,
          trialEnded: true
        });
      }
    }

    // === Welcome ===
    if (isWelcomeMessage && !sessionData.studentName) {
      const welcomeMsg = "Welcome to Waterwheel Village, friends! I'm Mr. McArthur. What's your name? Are you a beginner, intermediate, or expert student?";
      await storeChatHistory(sessionId, [{ role: 'assistant', content: welcomeMsg }]);
      return res.json({ text: welcomeMsg, character: 'mcarthur', voiceId: voices.mcarthur, level: null });
    }

    // === Save user input ===
    let messages = await getChatHistory(sessionId);
    if (sanitizedText) {
      messages.push({ role: 'user', content: sanitizedText });

      // detect student level
      const lowered = sanitizedText.toLowerCase();
      if (lowered.includes("beginner")) sessionData.studentLevel = "beginner";
      else if (lowered.includes("intermediate")) sessionData.studentLevel = "intermediate";
      else if (lowered.includes("expert")) sessionData.studentLevel = "expert";

      await setSession(sessionId, sessionData);
    }

    // === Build system prompt ===
    let systemPrompt = `You are ${character} in Waterwheel Village. You are a kind ESL teacher. Be brief, encouraging, and correct mistakes gently. Always ask one short follow-up question.`;
    if (isVoice) {
      systemPrompt += " The student is speaking by voice, so ignore punctuation corrections (commas, periods). Focus only on words and grammar.";
    }
    const outboundMessages = [{ role: 'system', content: systemPrompt }, ...messages];

    // === Send to Chatbase ===
    const key = process.env.CHATBASE_API_KEY;
    const CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;

    const response = await axios.post(
      'https://www.chatbase.co/api/v1/chat',
      { chatbotId: CHATBOT_ID, conversationId: sessionId, messages: outboundMessages },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const responseText = response?.data?.text?.trim?.() || '';
    let detectedCharacter = detectCharacter(responseText, sessionData.character || "mcarthur");
    sessionData.character = detectedCharacter;
    await setSession(sessionId, sessionData);

    // store history
    messages.push({ role: 'assistant', content: responseText });
    await storeChatHistory(sessionId, messages);

    return res.json({
      text: responseText,
      character: detectedCharacter,
      voiceId: voices[detectedCharacter] || voices.mcarthur,
      level: sessionData.studentLevel || null
    });

  } catch (error) {
    console.error('Error in /chat:', error.response?.data || error.message);
    return res.json({
      text: "Thanks! Let’s begin with a short exercise: tell me 3 things about yourself.",
      character: 'mcarthur',
      voiceId: voices.mcarthur,
      level: sessionData?.studentLevel || null,
      note: 'fallback-error'
    });
  }
});

// ===== /speakbase endpoint =====
app.post('/speakbase', async (req, res) => {
  try {
    const { text, voiceId, character } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    const finalVoiceId = voiceId || voices[character] || voices.default;

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`,
      { text, voice_settings: { stability: 0.3, similarity_boost: 0.8 } },
      { headers: { "Accept": "audio/mpeg", "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY }, responseType: "arraybuffer" }
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(response.data);
  } catch (error) {
    console.error("Error in /speakbase:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

// ===== Wordlist endpoint =====
app.get("/wordlist/:week/:level", (req, res) => {
  const { week, level } = req.params;
  try {
    let words = wordlists[`week${week}`]?.[level];
    if (!words) {
      return res.status(404).json({ error: "No words found for this week/level." });
    }
    // 🚫 Trial mode: limit to 10 words
    if (TRIAL_MODE) {
      words = words.slice(0, 10);
    }
    res.json(words);
  } catch (err) {
    console.error("❌ Error serving wordlist:", err);
    res.status(500).json({ error: "Failed to load word list" });
  }
});

// ===== Quiz endpoint =====
app.get("/quiz/:week/:level", (req, res) => {
  const { week, level } = req.params;
  try {
    let words = wordlists[`week${week}`]?.[level];
    if (!words) {
      return res.status(404).json({ error: "No quiz words found for this week/level." });
    }
    // 🚫 Trial mode: only 3 quiz questions, else 5
    const quizSize = TRIAL_MODE ? 3 : 5;
    const shuffled = [...words].sort(() => 0.5 - Math.random());
    res.json(shuffled.slice(0, quizSize));
  } catch (err) {
    console.error("❌ Error serving quiz:", err);
    res.status(500).json({ error: "Failed to load quiz" });
  }
});

// ===== Healthcheck endpoint =====
app.get('/health', (req, res) => { res.json({ ok: true, status: "Waterwheel backend alive" }); });

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
