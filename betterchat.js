// Load environment variables
require("dotenv").config();

// Import packages
const express = require("express");
const axios = require("axios");
const cors = require("cors");

// Setup Express app
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Log environment keys (for dev/debug only)
console.log("🧪 ENV DEBUG:", {
  CHATBASE_API_KEY: process.env.CHATBASE_API_KEY,
  CHATBASE_BOT_ID: process.env.CHATBASE_BOT_ID,
  ELEVEN_API_KEY: process.env.ELEVEN_API_KEY,
  ELEVEN_VOICE_ID: process.env.ELEVEN_VOICE_ID,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY
});

// Voice ID map (loaded from .env or hardcoded fallback)
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

// Root route
app.get("/", (req, res) => {
  res.send("🌍 Welcome to Waterwheel Village - BetterChat is running!");
});

// /chat endpoint (Text only)
app.post("/chat", async (req, res) => {
  try {
    const userText = req.body.text?.trim();

    console.log("🔎 Sending to Chatbase:", userText);

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

    res.json({ text: replyText });

  } catch (error) {
    console.error("🔥 Chatbase error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Chatbase failed." });
  }
});

// /speakbase endpoint (Text + Voice)
app.post("/speakbase", async (req, res) => {
  console.log("🌟 /speakbase was hit!");

  try {
    const userText = req.body.text?.trim() || "";
    const lowerCaseText = userText.toLowerCase();

    // Detect character and assign voice
    let selectedVoiceId = process.env.ELEVEN_VOICE_ID;
    const detected = Object.keys(characterVoices).find(name =>
      lowerCaseText.includes(name)
    );
    if (detected) {
      selectedVoiceId = characterVoices[detected];
      console.log(`🎩 Detected character: ${detected}`);
    }

    // Call Chatbase directly
    const chatResponse = await axios.post(
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

    const rawText =
      chatResponse.data?.messages?.[0]?.content ||
      chatResponse.data?.text ||
      "Sorry, I had trouble understanding you.";

    // Clean up markdown for TTS
    const spokenText = rawText
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim();

    console.log("🗣 Text to speak:", spokenText);
    console.log("🎤 Voice ID:", selectedVoiceId);

    // ElevenLabs voice generation
    const voiceResponse = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      data: {
        text: spokenText,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8
        }
      },
      responseType: "arraybuffer"
    });

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": voiceResponse.data.length
    });
    res.send(voiceResponse.data);

  } catch (error) {
    console.error("❌ Speakbase error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Speakbase error occurred." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BetterChat server running on port ${PORT}`);
});
