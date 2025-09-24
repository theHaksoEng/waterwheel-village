// testKey.js
require("dotenv").config();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("🔑 Loaded key (first 8 chars):", process.env.OPENAI_API_KEY?.slice(0, 8));

(async () => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "Say 'KEY OK' if you can read this." }],
    });
    console.log("✅ API reply:", completion.choices[0].message.content);
  } catch (err) {
    console.error("❌ API error:", err);
  }
})();

