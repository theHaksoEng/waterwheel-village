// betterchatF.js

// ✅ Load environment variables
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ✅ Patch for node-fetch ESM compatibility
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(bodyParser.json());

console.log("✅ Environment validation successful.");

// ✅ Environment Variables
const PORT = process.env.PORT || 3000;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;

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

const DEFAULT_CHARACTER = "mcarthur";

// ✅ Test route
app.get('/', (req, res) => {
  res.send('BetterChat API is up and running!');
});

// ✅ Speak route
app.post('/speak', async (req, res) => {
  const { text, character } = req.body;
  const detectedCharacter = character.toLowerCase();
  const selectedVoiceId = characterVoices[detectedCharacter] || characterVoices[DEFAULT_CHARACTER];

  try {
    const response = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      responseType: "arraybuffer",
      data: {
        text,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      }
    });

    const audioBuffer = Buffer.from(response.data, "binary");
    res.set({ 'Content-Type': 'audio/mpeg' });
    res.send(audioBuffer);
  } catch (error) {
    console.error("Speak API error:", error?.response?.status, error?.response?.data);
    res.status(error.response?.status || 500).json({ error: 'Speak API failed' });
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
