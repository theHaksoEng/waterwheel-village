// Load environment variables
require("dotenv").config();

// Import packages
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const cors = require("cors");
app.use(cors({
  origin: "*", // <-- Allow all origins (for now)
  methods: ["GET", "POST"], // <-- Allow POST
}));


// Setup Express app
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ENV Debug Printout
console.log("\ud83e\uddea ENV DEBUG:", {
  CHATBASE_API_KEY: process.env.CHATBASE_API_KEY,
  CHATBASE_BOT_ID: process.env.CHATBASE_BOT_ID,
  ELEVEN_API_KEY: process.env.ELEVEN_API_KEY,
  ELEVEN_VOICE_ID: process.env.ELEVEN_VOICE_ID,
  FATIMA_VOICE_ID: process.env.FATIMA_VOICE_ID,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});

// Root route
app.get("/", (req, res) => {
  res.send("Welcome to Waterwheel Village Chatbot!");
});

// Corrected Chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const userText = req.body.text;

    const chatbaseResponse = await axios.post(
      "https://www.chatbase.co/api/v1/chat",
      {
        messages: [{ role: "user", content: userText }],
        chatbotId: process.env.CHATBASE_BOT_ID,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CHATBASE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const replyText = chatbaseResponse.data.text || "Sorry, I had trouble understanding you.";
    res.json({ text: replyText });
  } catch (error) {
    console.error("\ud83d\udd25 Chatbase error:", error?.response?.data || error.message);
    res.status(500).send("Chatbase error");
  }
});

// Speakbase endpoint (Chat + ElevenLabs voice)
app.post("/speakbase", async (req, res) => {
  console.log("\ud83c\udf1f /speakbase was hit!");

  try {
    const userText = req.body.text || "";
    const lowerCaseText = userText.toLowerCase();

    const characterVoices = {
      fatima: process.env.FATIMA_VOICE_ID,
    };

    let selectedVoiceId = process.env.ELEVEN_VOICE_ID;

    const nameDetected = Object.keys(characterVoices).find(name =>
      lowerCaseText.includes(name)
    );

    if (nameDetected) {
      selectedVoiceId = characterVoices[nameDetected];
      console.log(`\ud83c\udfa9 Detected character: ${nameDetected}`);
    }

    // Get chat response from our own /chat endpoint
    const chatResponse = await axios.post(
      "https://waterwheel-village.onrender.com/chat",
      { text: userText },
      { headers: { "Content-Type": "application/json" } }
    );

    const rawText = chatResponse.data.text;
    const spokenText = rawText
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*/g, "")
      .replace(/[_~`]/g, "")
      .trim();

    console.log("\ud83d\udde3 Text to send to ElevenLabs:", spokenText);
    console.log("\ud83c\udfbf Using Voice ID:", selectedVoiceId);

    const voiceResponse = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json",
      },
      data: {
        text: spokenText,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
        },
      },
      responseType: "arraybuffer",
    });

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": voiceResponse.data.length,
    });
    res.send(voiceResponse.data);

  } catch (error) {
    console.error("\u274c Speakbase Error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Speakbase error occurred." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\ud83d\ude80 Server running on port ${PORT}`);
});
