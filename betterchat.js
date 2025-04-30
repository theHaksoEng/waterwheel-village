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

// ENV Debug Printout
console.log("🧪 ENV DEBUG:", {
  CHATBASE_API_KEY: process.env.CHATBASE_API_KEY,
  CHATBASE_BOT_ID: process.env.CHATBASE_BOT_ID,
  ELEVEN_API_KEY: process.env.ELEVEN_API_KEY,
  ELEVEN_VOICE_ID: process.env.ELEVEN_VOICE_ID,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY
});

// Voice ID map
const characterVoices = {
  fatima: "VJPdWR5GhEdG6LxWu8AS",
  ibrahim: "VJPdWR5GhEdG6LxWu8AS",
  anika: "GCPLhb1XrVwcoKUJYcvz",
  kwame: "tlETan7Okc4pzjD0z62P",
  sophia: "0q9TlrIoQJIdxZP9oZh7",
  liang: "VJPdWR5GhEdG6LxWu8AS",
  johannes: "JgHmW3ojZwT0NDP5D1JJ",
  aleksanderi: "tIFPE2y0DAU6xfZn3Fka"
};

// Root route
app.get("/", (req, res) => {
  res.send("Welcome to Waterwheel Village - BetterChat!");
});

// Chat endpoint (text only)
app.post("/chat", async (req, res) => {
  try {
    const userText = req.body.text;
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

    const replyText = chatbaseResponse.data?.messages?.[0]?.content ||
      "Sorry, I had trouble understanding you.";
    res.json({ text: replyText });
  } catch (error) {
    console.error("🔥 Chatbase error:", error?.response?.data || error.message);
    res.status(500).send("Chatbase error");
  }
});

// Speakbase endpoint (text + voice)
app.post("/speakbase", async (req, res) => {
  console.log("🌟 /speakbase was hit!");

  try {
    const userText = req.body.text || "";
    const lowerCaseText = userText.toLowerCase();

    // Determine character voice if mentioned
    let selectedVoiceId = process.env.ELEVEN_VOICE_ID;
    const detected = Object.keys(characterVoices).find(name => lowerCaseText.includes(name));

    if (detected) {
      selectedVoiceId = characterVoices[detected];
      console.log(`🎩 Detected character: ${detected}`);
    }

    // Get chatbot response
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

    console.log("🗣 Text to send to ElevenLabs:", spokenText);
    console.log("🎤 Using Voice ID:", selectedVoiceId);

    // Generate voice
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
    console.error("❌ Speakbase Error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Speakbase error occurred." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
