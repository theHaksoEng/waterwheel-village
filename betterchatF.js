// betterchatF.js (clean version)

// 🌱 Load environment variables
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🌍 Load config
const PORT = process.env.PORT || 3000;
const CHATBASE_API_KEY = process.env.CHATBASE_API_KEY;
const CHATBASE_BOT_ID = process.env.CHATBASE_BOT_ID;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;

// 🧠 Voice character IDs
const characterVoices = {
  fatima: process.env.VOICE_FATIMA,
  ibrahim: process.env.VOICE_IBRAHIM,
  anika: process.env.VOICE_ANIKA,
  kwame: process.env.VOICE_KWAME,
  sophia: process.env.VOICE_SOPHIA,
  liang: process.env.VOICE_LIANG,
  johannes: process.env.VOICE_JOHANNES,
  aleksanderi: process.env.VOICE_ALEKSANDERI,
  nadia: process.env.VOICE_NADIA,
  mcarthur: process.env.VOICE_MCARTHUR,
};

// 🛡️ Ensure all required env vars are present
function validateEnv() {
  const required = [
    "CHATBASE_API_KEY", "CHATBASE_BOT_ID",
    "ELEVEN_API_KEY", "PORT",
    "VOICE_FATIMA", "VOICE_IBRAHIM", "VOICE_ANIKA",
    "VOICE_KWAME", "VOICE_SOPHIA", "VOICE_LIANG",
    "VOICE_JOHANNES", "VOICE_ALEKSANDERI",
    "VOICE_NADIA", "VOICE_MCARTHUR"
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    console.error("❌ Missing environment variables:", missing.join(", "));
    process.exit(1);
  }
  console.log("✅ Environment validation successful.");
}
validateEnv();
// 💬 Handle user chat input
app.post("/chat", async (req, res) => {
  const { text, sessionId } = req.body;

  try {
    const chatResponse = await axios.post(
      `https://www.chatbase.co/api/v1/chat`,
      {
        messages: [{ content: text, role: "user" }],
        stream: false,
        temperature: 0.7,
        system_prompt: "You're a helpful character from Waterwheel Village.",
        chatbot_id: CHATBASE_BOT_ID,
        session_id: sessionId
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CHATBASE_API_KEY}`
        }
      }
    );

    const reply = chatResponse.data?.messages?.[0]?.content || "Sorry, I didn’t understand.";
    res.json({ text: reply });
  } catch (err) {
    console.error("❌ /chat error:", err.message);
    res.status(500).json({ error: "Failed to get response from Chatbase." });
  }
});

const DEFAULT_CHARACTER = "McArthur";

// 🗣️ Converts text to speech using ElevenLabs
app.post("/speakbase", async (req, res) => {
  const { text, userMessage, sessionId } = req.body;
  const detectedCharacter = detectCharacter(userMessage) || DEFAULT_CHARACTER;
  const selectedVoiceId = characterVoices[detectedCharacter] || characterVoices[DEFAULT_CHARACTER];

  try {
    const elevenRes = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
      data: {
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8
        }
      },
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer"
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(elevenRes.data));
  } catch (err) {
    console.error("❌ /speakbase error:", err.message);
    res.status(500).json({ error: "Failed to get audio from ElevenLabs." });
  }
});

// Simple character detector (based on keyword)
function detectCharacter(message) {
  const lowered = message.toLowerCase();
  for (let name of Object.keys(characterVoices)) {
    if (lowered.includes(name.toLowerCase())) {
      return name;
    }
  }
  return null;
}
