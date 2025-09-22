// betterchatF.js
// === Waterwheel Village Backend ===

const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config(); // Load ELEVEN_API_KEY from .env

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// === Load wordlists ===
const wordlistPath = path.join(__dirname, "wordlist.json");
const trialWordlistPath = path.join(__dirname, "trialwordlist.json");

let wordlists = {};
let trialWordlists = {};

try {
  if (fs.existsSync(wordlistPath)) {
    wordlists = JSON.parse(fs.readFileSync(wordlistPath, "utf8"));
    console.log("✅ Full wordlists loaded. Levels available:", Object.keys(wordlists));
  }
  if (fs.existsSync(trialWordlistPath)) {
    trialWordlists = JSON.parse(fs.readFileSync(trialWordlistPath, "utf8"));
    console.log("✅ Trial wordlists loaded.");
  }
} catch (err) {
  console.error("❌ Error loading wordlists:", err);
}

// === In-memory lessons ===
let savedLessons = {};

// === CHAT endpoint ===
app.post("/chat", async (req, res) => {
  const { text, sessionId, overrideCharacter, overrideVoiceId } = req.body;

  let reply = "";
  if (!text || text.trim() === "") {
    reply =
      "Welcome to Waterwheel Village, friends! I'm Mr. McArthur. What's your name? Are you a beginner, intermediate, or expert student?";
  } else {
    reply = `You said: "${text}". Great! Let's keep practicing.`;
  }

  res.json({
    text: reply,
    character: overrideCharacter || "mcarthur",
    voiceId: overrideVoiceId || "Pt5YrLNyu6d2s3s4CVMg",
  });
});

// === SPEAK endpoint (ElevenLabs) ===
app.post("/speakbase", async (req, res) => {
  try {
    const { text, voiceId } = req.body;

    if (!process.env.ELEVEN_API_KEY) {
      console.error("❌ ELEVEN_API_KEY missing in .env");
      return res.status(500).json({ error: "Missing ElevenLabs API key" });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "xi-api-key": process.env.ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.4, similarity_boost: 0.8 },
        }),
      }
    );

    if (!response.ok) {
      const errTxt = await response.text();
      console.error("❌ ElevenLabs error:", errTxt);
      return res.status(500).json({ error: "ElevenLabs request failed" });
    }

    const audioBuffer = await response.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error("❌ Speak error:", err);
    res.status(500).json({ error: "Speak failed" });
  }
});

// === End lesson ===
app.post("/endlesson", (req, res) => {
  const { sessionId, unit, chapter, learnedWords } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }
  savedLessons[sessionId] = {
    unit,
    chapter,
    learnedWords,
    timestamp: Date.now(),
  };
  res.json({ message: "📕 Lesson ended and stored!", fileUrl: null });
});

// === Resume lesson ===
app.get("/resume/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (!savedLessons[sessionId]) {
    return res.json({ error: "No saved lesson found." });
  }
  res.json({ progress: savedLessons[sessionId] });
});

// === Wordlist endpoint ===
app.get("/wordlist/:unit/:level", (req, res) => {
  const { unit, level } = req.params;

  let list = (wordlists[unit] && wordlists[unit][level]) || [];
  if (list.length === 0 && trialWordlists[unit] && trialWordlists[unit][level]) {
    list = trialWordlists[unit][level];
  }

  if (!list || list.length === 0) {
    return res.json({ error: "No words found" });
  }
  res.json(list);
});

// === Quiz endpoint ===
app.get("/quiz/:unit/:level", (req, res) => {
  const { unit, level } = req.params;
  let list = (wordlists[unit] && wordlists[unit][level]) || [];
  if (!list || list.length === 0) {
    return res.json({ error: "No quiz words found" });
  }
  res.json(list);
});

// === Story endpoint ===
app.get("/story/:unit/:chapter", (req, res) => {
  const { unit, chapter } = req.params;
  const stories = {
    "1": {
      "1": "🌾 In Waterwheel Village, the morning sun rises over the mill. Villagers greet each other with warm hellos as they begin their day.",
      "2": "🍞 At the bakery, the smell of fresh bread fills the air. Children count coins to buy a small loaf.",
      "3": "🥕 At the market, farmers bring carrots, potatoes, and apples. Villagers practice numbers and greetings as they trade.",
      "4": "🏡 In the evening, families gather around the table, sharing food and simple phrases like 'please' and 'thank you.'",
    },
    "2": {
      "1": "👨‍👩‍👧 Families in the village live in wooden houses near the river. Parents teach children the names of rooms and furniture.",
      "2": "🪑 Sophia the teacher shows her students how to say 'chair', 'table', and 'bed' in English.",
      "3": "😊 At night, villagers talk about their feelings — happy, sad, tired — and comfort each other.",
      "4": "🧹 Families share chores: cleaning, cooking, and fetching water. Each task brings new words to learn.",
    },
  };

  if (stories[unit] && stories[unit][chapter]) {
    return res.json({ story: stories[unit][chapter] });
  }
  res.json({ error: "No story found" });
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
