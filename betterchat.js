require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Debug: print environment values
console.log("🧪 ENV DEBUG:", {
  CHATBASE_BOT_ID: process.env.CHATBASE_BOT_ID,
  CHATBASE_API_KEY: process.env.CHATBASE_API_KEY,
  ELEVEN_API_KEY: process.env.ELEVEN_API_KEY,
  ELEVEN_VOICE_ID: process.env.ELEVEN_VOICE_ID,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY
});

// Voice map (customizable from .env)
const characterVoices = {
  fatima: process.env.VOICE_FATIMA,
  ibrahim: process.env.VOICE_IBRAHIM,
  anika: process.env.VOICE_ANIKA,
  kwame: process.env.VOICE_KWAME,
  sophia: process.env.VOICE_SOPHIA,
  liang: process.env.VOICE_LIANG,
  johannes: process.env.VOICE_JOHANNES,
  aleksanderi: process.env.VOICE_ALEKSANDERI
};

// Root
app.get("/", (req, res) => {
  res.send("🌍 Waterwheel Village - BetterChat is online!");
});

// /chat route — Chatbase direct
app.post("/chat", async (req, res) => {
  try {
    const userText = req.body.text?.trim() || "";

    console.log("💬 /chat input:", userText);

    const chatbaseResponse = await axios.post(
      "https://www.chatbase.co/api/v1/chat",
      {
        messages: [{ role: "user", content: userText }],
        chatbotId: process.env.CHATBASE_BOT_ID
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CHATBASE_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const replyText =
      chatbaseResponse.data?.messages?.[0]?.content ||
      chatbaseResponse.data?.text ||
      "Sorry, I had trouble understanding you.";

    console.log("🧠 /chat reply:", replyText);
    res.json({ text: replyText });

  } catch (error) {
    console.error("❌ /chat error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Chatbase error" });
  }
});

// /speakbase route — Chatbase + ElevenLabs
app.post("/speakbase", async (req, res) => {
  console.log("🎙️ /speakbase hit");

  try {
    const userText = req.body.text?.trim() || "";
    const lower = userText.toLowerCase();

    // ✅ Fix: define voice map inside the route to ensure .env values are available
    const characterVoices = {
      fatima: process.env.VOICE_FATIMA,
      ibrahim: process.env.VOICE_IBRAHIM,
      anika: process.env.VOICE_ANIKA,
      kwame: process.env.VOICE_KWAME,
      sophia: process.env.VOICE_SOPHIA,
      liang: process.env.VOICE_LIANG,
      johannes: process.env.VOICE_JOHANNES,
      aleksanderi: process.env.VOICE_ALEKSANDERI
    };

    // ✅ Character detection
    let selectedVoiceId = process.env.ELEVEN_VOICE_ID; // fallback
    const detected = Object.keys(characterVoices).find(name =>
      lower.includes(name)
    );

    if (detected && characterVoices[detected]) {
      selectedVoiceId = characterVoices[detected];
      console.log(`🎩 Character detected: ${detected}`);
    } else {
      console.log("⚠️ No matching voice ID found — using fallback voice.");
    }

    // (continue with Chatbase + ElevenLabs as you already have)

  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BetterChat server running on port ${PORT}`);
});
