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

        // normalize key (month1, month2, etc)
        const key = parsed.month
          ? `month${parsed.month}`
          : path.basename(file, ".json");

        monthlyWordlists[key] = parsed;
      }
    }
    console.log("✅ Monthly wordlists loaded:", Object.keys(monthlyWordlists));
  } catch (err) {
    console.error("❌ Failed to load monthly wordlists:", err);
  }
}

// Load once at startup
loadMonthlyWordlists();


app.get("/wordlist/:month/:chapter", (req, res) => {
  const { month, chapter } = req.params;
  const monthData = monthlyWordlists[month];

  if (monthData && monthData.chapters && monthData.chapters[chapter]) {
    res.json(monthData.chapters[chapter]);
  } else {
    res.status(404).json({ error: `Chapter '${chapter}' not found in ${month}` });
  }
});

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

// === Quiz endpoint (monthly wordlists with types) ===
app.get("/quiz/:month/:chapter", (req, res) => {
  const { month, chapter } = req.params;
  const monthData = monthlyWordlists[month];

  if (!monthData || !monthData.chapters || !monthData.chapters[chapter]) {
    return res.status(404).json({ error: `No quiz words found for ${chapter} in ${month}` });
  }

  const { teacher, words } = monthData.chapters[chapter];
  if (!words || words.length === 0) {
    return res.status(404).json({ error: `No words found for ${chapter}` });
  }

  // Shuffle words
  const shuffled = [...words].sort(() => 0.5 - Math.random());

  // Generate quiz (5 questions)
  const quiz = shuffled.slice(0, 5).map((w, i) => {
    const type = i % 3 === 0 ? "multiple" : i % 3 === 1 ? "write" : "blank";

    if (type === "multiple") {
      // pick 3 random incorrect options
      const wrong = words
        .filter(x => x.en !== w.en)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(x => x.en);

      const options = [...wrong, w.en].sort(() => 0.5 - Math.random());

      return {
        type,
        question: `Mikä on "${w.fi}" englanniksi?`,
        options,
        answer: w.en
      };
    }

    if (type === "write") {
      return {
        type,
        question: `Translate to English: "${w.fi}"`,
        answer: w.en
      };
    }

    if (type === "blank") {
      return {
        type,
        question: `Fill in the blank: I like ___ (${w.fi}).`,
        answer: w.en
      };
    }
  });

  res.json({ teacher, quiz });
});
// === Quiz check endpoint ===
app.post("/quiz/check", (req, res) => {
  const { month, chapter, answers } = req.body; 
  // answers should be array of { question, userAnswer }

  if (!month || !chapter || !answers) {
    return res.status(400).json({ error: "month, chapter, and answers are required" });
  }

  const monthData = monthlyWordlists[month];
  if (!monthData || !monthData.chapters || !monthData.chapters[chapter]) {
    return res.status(404).json({ error: `No wordlist found for ${chapter} in ${month}` });
  }

  const { words } = monthData.chapters[chapter];

  // Build a quick lookup
  const wordMap = {};
  words.forEach(w => {
    wordMap[w.fi] = w.en.toLowerCase();
    wordMap[w.en.toLowerCase()] = w.en.toLowerCase(); // accept EN directly too
  });

  // Score answers
  const results = answers.map(a => {
    const correct = wordMap[a.correctKey] || a.answer; // fallback
    const isCorrect =
      a.userAnswer && a.userAnswer.trim().toLowerCase() === correct.trim().toLowerCase();

    return {
      question: a.question,
      userAnswer: a.userAnswer,
      correctAnswer: correct,
      correct: isCorrect
    };
  });

  const score = results.filter(r => r.correct).length;

  res.json({
    score,
    total: results.length,
    results
  });
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
  await redis.set(
    `lesson:${sessionId}`,
    JSON.stringify({ unit, chapter, learnedWords, timestamp: Date.now() })
  );
  res.json({ message: "📕 Lesson ended and stored!" });
});

app.get("/resume/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const data = await redis.get(`lesson:${sessionId}`);
  if (!data) return res.json({ error: "No saved lesson found." });
  res.json({ progress: JSON.parse(data) });
});

// === Health check ===
app.get("/health", (req, res) =>
  res.json({ ok: true, status: "Waterwheel backend alive" })
);

// === Lesson intros ===
const lessonIntros = {
  month1: {
    greetings_introductions: {
      teacher: "mcarthur",
      text: "Hello, friend! My name is Mr. McArthur. Let’s practice greetings and introductions. Try saying: 'Hello, my name is...' ",
    },
    numbers_days_questions: {
      teacher: "johannes",
      text: "I am Johannes. Let’s talk about numbers and days. Can you count to five with me?",
    },
    food_drink: {
      teacher: "fatima",
      text: "Welcome, dear student! I am Fatima. Today we will enjoy talking about food and drink. Let’s start with simple words like 'soup' and 'bread'.",
    },
    daily_phrases: {
      teacher: "anika",
      text: "Hi, I am Anika! Let’s practice daily phrases together. Start by saying: 'Good morning!'",
    },
  },
};

app.get("/lesson/:month/:chapter", async (req, res) => {
  const { month, chapter } = req.params;
  const { sessionId } = req.query;

  const intro = lessonIntros[month]?.[chapter];
  const monthData = monthlyWordlists[month];
  const words = monthData?.chapters?.[chapter]?.words || [];

  if (!intro) {
    return res.status(404).json({ error: "Lesson not found" });
  }

  // ✅ If sessionId given, lock teacher into the Redis session
  if (sessionId) {
    try {
      let sessionData = JSON.parse(await redis.get(`session:${sessionId}`)) || {};
      sessionData.character = intro.teacher; // lock teacher
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
    } catch (err) {
      console.error("Failed to set teacher in session:", err);
    }
  }

  res.json({
    teacher: intro.teacher,
    text: intro.text,
    words
  });
});


// === Start server ===
app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
