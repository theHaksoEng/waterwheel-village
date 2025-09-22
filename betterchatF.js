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

// === Load wordlists dynamically ===
const wordlistsPath = TRIAL_MODE
  ? path.join(__dirname, "data", "trialWordlists.json")
  : path.join(__dirname, "data", "wordlists.json");

let wordlists = {};
try {
  const fileContent = fs.readFileSync(wordlistsPath, "utf-8");
  wordlists = JSON.parse(fileContent);
  console.log(`✅ ${TRIAL_MODE ? "Trial" : "Full"} wordlists loaded. Levels available:`, Object.keys(wordlists));
} catch (err) {
  console.error("❌ Failed to load wordlists file", err);
}

// ===== Simple in-memory storage =====
const sessions = new Map();
const histories = new Map();
const messageCounts = new Map();

// ===== Voices =====
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

// ===== Character detection =====
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

    let sessionData = sessions.get(sessionId);
    if (!sessionData) {
      sessionData = { character: 'mcarthur', studentName: null, studentLevel: null };
      sessions.set(sessionId, sessionData);
    }
    let character = sessionData.character;

    // ===== Trial Mode limit =====
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
      histories.set(sessionId, [{ role: 'assistant', content: welcomeMsg }]);
      return res.json({ text: welcomeMsg, character: 'mcarthur', voiceId: voices.mcarthur, level: null });
    }

    // === Save user input ===
    let messages = histories.get(sessionId) || [];
    if (sanitizedText) {
      messages.push({ role: 'user', content: sanitizedText });

      // detect student level
      const lowered = sanitizedText.toLowerCase();
      if (lowered.includes("beginner")) sessionData.studentLevel = "beginner";
      else if (lowered.includes("intermediate")) sessionData.studentLevel = "intermediate";
      else if (lowered.includes("expert")) sessionData.studentLevel = "expert";

      sessions.set(sessionId, sessionData);
    }

    // === Build system prompt ===
    let systemPrompt = `You are ${character} in Waterwheel Village. You are a kind ESL teacher. Be brief, encouraging, and correct mistakes gently. Always ask one short follow-up question.`;
    if (isVoice) {
      systemPrompt += " The student is speaking by voice, so ignore punctuation corrections. Focus only on words and grammar.";
    }

    // === Character override if student explicitly asks ===
    const villagerMatch = sanitizedText.match(/\b(anika|nadia|fatima|liang|johannes|aleksanderi|sophia|kwame|ibrahim|mcarthur)\b/i);
    if (villagerMatch) {
      const villager = villagerMatch[1].toLowerCase();
      sessionData.character = villager;
      sessions.set(sessionId, sessionData);

      systemPrompt = `You are ${villager} from Waterwheel Village. Speak directly in first person ("I"). Do NOT say "let me bring" — you are already here. Be warm, encouraging, and keep replies short.`;
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
    let detectedCharacter = sessionData.character || detectCharacter(responseText, "mcarthur");
    sessionData.character = detectedCharacter;
    sessions.set(sessionId, sessionData);

    // store history
    messages.push({ role: 'assistant', content: responseText });
    histories.set(sessionId, messages);

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
      level: sessions.get(sessionId)?.studentLevel || null,
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

    // convert commas to slight pauses
    const processedText = text.replace(/,/g, " …");

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`,
      { text: processedText, voice_settings: { stability: 0.3, similarity_boost: 0.8 } },
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
    const key1 = `week${week}`;
    const key2 = week;
    let words = wordlists[key1]?.[level] || wordlists[key2]?.[level];

    if (!words) return res.status(404).json({ error: "No words found" });
    if (TRIAL_MODE) words = words.slice(0, 10);
    res.json(words);
  } catch (err) {
    res.status(500).json({ error: "Failed to load word list" });
  }
});

// ===== Quiz endpoint =====
app.get("/quiz/:week/:level", (req, res) => {
  const { week, level } = req.params;
  try {
    const key1 = `week${week}`;
    const key2 = week;
    let words = wordlists[key1]?.[level] || wordlists[key2]?.[level];

    if (!words) return res.status(404).json({ error: "No quiz words found" });

    const quizSize = TRIAL_MODE ? 3 : 5;
    const shuffled = [...words].sort(() => 0.5 - Math.random());
    res.json(shuffled.slice(0, quizSize));
  } catch (err) {
    res.status(500).json({ error: "Failed to load quiz" });
  }
});

// ===== Healthcheck =====
app.get('/health', (req, res) => res.json({ ok: true, status: "Waterwheel backend alive" }));

const lessonsDir = path.join(__dirname, "data", "lessons");

// Make sure lessons directory exists
if (!fs.existsSync(lessonsDir)) {
  fs.mkdirSync(lessonsDir, { recursive: true });
}

// ===== End Lesson =====
app.post("/endlesson", async (req, res) => {
  try {
    const { sessionId, unit, chapter, learnedWords } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Session ID required" });

    const history = await getChatHistory(sessionId);
    const lessonData = {
      studentId: sessionId,
      unit: unit || 1,
      chapter: chapter || 1,
      learnedWords: learnedWords || [],
      chatHistory: history || [],
      lastUpdated: new Date().toISOString()
    };

    const filePath = path.join(lessonsDir, `lesson-${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(lessonData, null, 2));

    res.json({
      message: "✅ Lesson ended and stored!",
      fileUrl: `/lessons/lesson-${sessionId}.json`
    });
  } catch (err) {
    console.error("❌ Error ending lesson:", err);
    res.status(500).json({ error: "Failed to end lesson" });
  }
});

// ===== Resume Lesson =====
app.get("/resume/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const filePath = path.join(lessonsDir, `lesson-${sessionId}.json`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "No saved lesson found" });
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (err) {
    console.error("❌ Error resuming lesson:", err);
    res.status(500).json({ error: "Failed to resume lesson" });
  }
});

// ===== Serve saved lessons as downloadable files =====
app.use("/lessons", express.static(lessonsDir));

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
