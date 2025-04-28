const axios = require("axios");
require("dotenv").config();

const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY; // or paste directly as a string

axios.get("https://api.elevenlabs.io/v1/voices", {
  headers: { "xi-api-key": ELEVEN_API_KEY }
})
.then(res => {
  console.log("🎙️ Your Voices:");
  res.data.voices.forEach(voice => {
    console.log(`${voice.name}: ${voice.voice_id}`);
  });
})
.catch(err => {
  console.error("❌ Error fetching voices:", err.message);
});
