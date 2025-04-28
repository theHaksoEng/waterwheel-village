// Load environment variables
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { OpenAI } = require("openai");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static("public"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Root page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const transcribedText = req.body.text;
    const messages = [
      { role: "system", content: "You are a helpful assistant with a warm voice." },
      { role: "user", content: transcribedText }
    ];

    const chatResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages
    });

    const chatResponseText = chatResponse.choices[0].message.content;
    res.json({ text: chatResponseText });
  } catch (error) {
    console.error("🔥 Chat Error:", error?.response?.data || error.message);
    res.status(500).send("Chat error");
  }
});

// Speak endpoint (manual text to voice)
app.post("/speak", async (req, res) => {
  try {
    const { text, voice_id } = req.body;
    const voiceId = voice_id || process.env.ELEVEN_VOICE_ID;

    const cleanedText = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*/g, "")
      .replace(/[_~`]/g, "")
      .trim();

    const response = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      data: {
        text: cleanedText,
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
      "Content-Length": response.data.length
    });
    res.send(response.data);
  } catch (error) {
    console.error("🔊 ElevenLabs Error:", error?.response?.data || error.message);
    res.status(500).send("Voice generation error");
  }
});

// Speakbase endpoint (ask + voice)
app.post("/speakbase", async (req, res) => {
    console.log("🗣️ /speakbase endpoint hit");
    console.log("📨 Request body:", req.body);    
  console.log("🎯 speakbase was hit!");

  try {
    const userText = req.body.text || "";
    const lowerCaseText = userText.toLowerCase();

    const characterVoices = {
      fatima: "fEVT2ExfHe1MyjuiIiU9",
    };

    let selectedVoiceId = process.env.ELEVEN_VOICE_ID;
    const nameDetected = Object.keys(characterVoices).find(name =>
      lowerCaseText.includes(name)
    );

    if (nameDetected) {
      selectedVoiceId = characterVoices[nameDetected];
      console.log(`🎭 Using voice: ${nameDetected}`);
    }

    const chatResponse = await axios.post(
      "http://localhost:3000/chat",
      { text: userText },
      { headers: { "Content-Type": "application/json" } }
    );

    const rawText = chatResponse.data.text;
    const spokenText = rawText
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*/g, "")
      .replace(/[_~`]/g, "")
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
    console.error("❌ Speakbase Error:", error?.message || error);
    if (error.response?.data) {
      console.error("🔍 Error response data:", error.response.data);
    }
        res.status(500).send("Something went wrong in speakbase.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
