require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

console.log("🧪 ENV DEBUG:", {
  CHATBASE_BOT_ID: process.env.CHATBASE_BOT_ID,
  CHATBASE_API_KEY: process.env.CHATBASE_API_KEY,
  ELEVEN_API_KEY: process.env.ELEVEN_API_KEY,
  ELEVEN_VOICE_ID: process.env.ELEVEN_VOICE_ID
});

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
  mcarthur: process.env.VOICE_MCARTHUR
};

const aliases = {
  fatima: ["fatima"],
  ibrahim: ["ibrahim"],
  anika: ["anika"],
  kwame: ["kwame"],
  sophia: ["sophia"],
  liang: ["liang"],
  johannes: ["johannes"],
  aleksanderi: ["aleksanderi", "alex", "alexanderi"],
  nadia: ["nadia"],
  mcarthur: ["mcarthur", "aaron", "mr mcarthur"]
};

app.get("/", (req, res) => {
  res.send("🌍 Waterwheel Village - BetterChat is online!");
});

app.post("/chat", async (req, res) => {
  try {
    const userText = req.body.text?.trim() || "";

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
    console.error("❌ /chat error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Chatbase error" });
  }
});

app.post("/speakbase", async (req, res) => {
  console.log("🎙️ /speakbase hit");

  try {
    const userText = req.body.text?.trim() || "";

    let detectedCharacter = null;
    const lowerText = userText.toLowerCase();
    for (const [name, triggers] of Object.entries(aliases)) {
      if (triggers.some(trigger => lowerText.includes(trigger))) {
        detectedCharacter = name;
        break;
      }
    }

    const selectedVoiceId = characterVoices[detectedCharacter] || process.env.ELEVEN_VOICE_ID;
    console.log("🎤 Voice Map:", characterVoices);
    console.log("👀 Detected character:", detectedCharacter);
    console.log("🔊 Selected voice ID:", selectedVoiceId);

    const spokenText = userText
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim();

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
          similarity_boost: 0.75
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
    console.error("❌ /speakbase error:", error?.response?.data || error.message);
    res.status(500).json({ error: "Speakbase error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BetterChat server running on port ${PORT}`);
});
