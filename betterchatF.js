// betterchatF.js
// === Waterwheel Village Backend (CommonJS) ===

// ✅ Load env first
const dotenv = require("dotenv");
dotenv.config();

// === OpenAI Setup ===
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// === Express setup ===
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(bodyParser.json());

// === Redis Setup ===
const Redis = require("ioredis");
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl, {
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});
console.log("✅ Using Redis at:", redisUrl);

// Connection test
(async () => {
  try {
    const pong = await redis.ping();
    console.log(`✅ Redis connected: ${pong}`);
  } catch (err) {
    console.error("❌ Redis connection failed:", err.message);
  }
})();

// === NEW: WeatherAPI Setup ===
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
console.log("Checking the WeatherAPI Key:", WEATHERAPI_KEY); // <-- ADD THIS LINE


// === Character Data ===
const characters = {
  mcarthur: {
    voiceId: "fEVT2ExfHe1MyjuiIiU9",
    name: "Mr. McArthur",
    style: "a kind, patient, and wise village elder. He speaks with a gentle, grandfatherly tone, guiding students like a mentor. He is deeply rooted in his faith and often uses analogies from his time on a farm or his travels.",
    background: "He is a retired history teacher who, after a lifetime of travel, found his home in Waterwheel Village. He is a man of quiet strength and faith, tending to his garden with the same care he gives to his students. He believes every path is built one step at a time.",
    phrases: ["Let's rise up to the occasion.", "Each plant, like each person, has its season.", "Every path is built one step at a time."],
  },
  johannes: {
    voiceId: "JgHmW3ojZwT0NDP5D1JJ",
    name: "Johannes",
    style: "a man of quiet strength and steady hands. He speaks little but his words are deeply thoughtful and reverent, reflecting a lifetime of working the soil. His teaching style is patient and humble, focused on perseverance.",
    background: "He is a Finnish farmer whose face is weathered by wind and sun. He believes the hard northern land teaches patience and humility. He mentors younger villagers, guiding them with a quiet reverence for the earth.",
    phrases: ["The land knows me, and I know it.", "The land knows me, and I know it."],
  },
  nadia: {
    voiceId: "a1KZUXKFVFDOb33I1uqr",
    name: "Nadia",
    style: "a soft-spoken but firm architect. Her voice carries the calm rhythm of ancient stone cities. Her teaching style is precise and inspiring, focusing on structure, design, and harmony.",
    background: "An architect from Aleppo who rebuilds broken dreams in Waterwheel Village. She believes architecture should protect and inspire nature. She often sketches at sunrise and her words, like her designs, are inspired by both olive trees and pine forests.",
    phrases: ["A good home must hold both light and silence."],
  },
  fatima: {
    voiceId: "JMbCR4ujfEfGaawA1YtC",
    name: "Fatima",
    style: "a warm and compassionate healer. She walks slowly and listens deeply, speaking with the wisdom of her ancestors. Her teaching style is comforting and gentle, full of empathy and warmth.",
    background: "Born in Sudan, she learned healing from her grandmother using herbs, oils, and kind eyes. She is a comfort to the entire village, believing that laughter is a medicine.",
    phrases: ["Every pain has a story. And every story has a root that can be softened."],
  },
  anika: {
    voiceId: "GCPLhb1XrVwcoKUJYcvz",
    name: "Anika",
    style: "a cheerful and tender seamstress. She hums while she works, and her teaching style is gentle and nurturing, focusing on the beauty of heritage and the importance of memory.",
    background: "A seamstress from Ukraine, her hands move fast but tenderly, threading hope and heritage into her work. Her workshop smells of lavender and she often tells stories from her mother's village.",
    phrases: ["Every stitch is a promise that we will not forget who we are."],
  },
  liang: {
    voiceId: "gAMZphRyrWJnLMDnom6H", // <-- Replace with your ID
    name: "Liang",
    style: "a calm and logical entrepreneur. He sees patterns in everything and his teaching style is strong, steady, and forward-flowing, using analogies from trade and cultivation.",
    background: "He managed a family tea house in China and now sets up networks in the village. He is also a poet, comparing the whisper of pine trees to bamboo in moonlight.",
    phrases: ["Commerce is not just numbers. It is trust. And trust must be cultivated like a garden."],
  },
  alex: {
    voiceId: "tIFPE2y0DAU6xfZn3Fka", // <-- Replace with your ID
    name: "Aleksanderi (Alex)",
    style: "a calm and dignified Lutheran priest. His voice is gentle and soothing, and his teaching style is centered on grace, forgiveness, and the power of scripture. He is a source of hope and stillness.",
    background: "He is a priest who brings peace to the village. He carves wooden crosses and gives them to people who are feeling lost. He often sings old hymns and tells stories of saints and mercy.",
    phrases: ["The heart must be open like a window to receive both sunlight and rain.", "In the name and blood of the Lord Jesus Christ, all your sins are forgiven."],
  },
  ibrahim: {
    voiceId: "tlETan7Okc4pzjD0z62P", // <-- Replace with your ID
    name: "Ibrahim",
    style: "a quiet and focused blacksmith. He speaks rarely, but when he does, his words are simple and true, like iron. His teaching style is hands-on and purposeful, focusing on craftsmanship and resilience.",
    background: "A blacksmith from Afghanistan whose forge is the heartbeat of the village. War stole his home, but not his craft. He believes metal remembers, and that shaping it is an act of peace.",
    phrases: ["Because I now build what holds the world together—not what breaks it."],
  },
  sophia: {
    voiceId: "0q9TlrIoQJIdxZP9oZh7", // <-- Replace with your ID
    name: "Sophia",
    style: "a cheerful and energetic teacher. She brings sunshine into every room and her voice carries the rhythm of salsa. Her teaching style is full of laughter and stories, focusing on kindness and the joy of learning.",
    background: "A teacher from Venezuela who has a love of words and books. She often begins her day with a proverb from her homeland and is adored by the children she teaches.",
    phrases: ["We are not just learning letters, we are learning how to be human."],
  },
  kwame: {
    voiceId: "dhwafD61uVd8h85wAZSE", // <-- Replace with your ID
    name: "Kwame",
    style: "a warm and wise farmer. He walks barefoot on the earth to listen to the soil. His teaching style is patient and nurturing, using analogies from farming and nature.",
    background: "A regenerative farmer from Ghana who believes food is sacred. He tells stories of talking goats and clever foxes, and teaches villagers how to plant and care for the land with love.",
    phrases: ["Farming is like loving someone. You show up every day, even when it’s hard, and little by little, things grow."],
  },
};

// === Load monthly wordlists ===
const monthlyWordlists = {};
function loadMonthlyWordlists() {
  const wordlistsDir = path.join(__dirname, "wordlists", "monthly");
  try {
    const files = fs.readdirSync(wordlistsDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const content = fs.readFileSync(path.join(wordlistsDir, file), "utf8");
        const parsed = JSON.parse(content);
        const key = parsed.month ? `month${parsed.month}` : path.basename(file, ".json");
        monthlyWordlists[key] = parsed;
      }
    }
    console.log("✅ Monthly wordlists loaded:", Object.keys(monthlyWordlists));
  } catch (err) {
    console.error("❌ Failed to load monthly wordlists:", err);
  }
}
loadMonthlyWordlists();

// === Wordlist endpoint ===
app.get("/wordlist/:month/:chapter", (req, res) => {
  const { month, chapter } = req.params;
  const monthData = monthlyWordlists[month];
  if (monthData && monthData.chapters && monthData.chapters[chapter]) {
    res.json(monthData.chapters[chapter]);
  } else {
    res.status(404).json({ error: `Chapter '${chapter}' not found in ${month}` });
  }
});

// === Lesson intros ===
const lessonIntros = {
  month1: {
    greetings_introductions: {
      teacher: "mcarthur",
      text: "Hello, friend! My name is Mr. McArthur. Let’s practice greetings and introductions. Try saying: 'Hello, my name is...'"
    },
    numbers_days_questions: {
      teacher: "johannes",
      text: "I am Johannes. Let’s talk about numbers and days. Can you count to five with me?"
    },
    food_drink: {
      teacher: "fatima",
      text: "Welcome, dear student! I am Fatima. Today we will enjoy talking about food and drink. Let’s start with simple words like 'soup' and 'bread'."
    },
    daily_phrases: {
      teacher: "anika",
      text: "Hi, I am Anika! Let’s practice daily phrases together. Start by saying: 'Good morning!'"
    },
    farmer_chat: {
      teacher: "abraham",
      text: "Greetings, Matthew! I am Abraham, the farmer. I grow many fruits and vegetables, and I would love to talk about food with you. What would you like to discuss?"
    }
  }
};

// === Lesson endpoint ===
app.get("/lesson/:month/:chapter", async (req, res) => {
  const { month, chapter } = req.params;
  const intro = lessonIntros[month]?.[chapter];
  if (!intro) return res.status(404).json({ error: "Lesson not found" });

  const sessionId = req.query.sessionId || uuidv4();
  const sessionData = {
    character: intro.teacher,
    currentLesson: { month, chapter },
  };
  await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

  const monthData = monthlyWordlists[month];
  const words = monthData?.chapters?.[chapter]?.words || [];

  // NEW: Add voiceId from the characters object
  const voiceId = characters[intro.teacher]?.voiceId;

  res.json({ ...intro, words, sessionId, voiceId });
});

// Helper function to find a character
const findCharacter = (text) => {
  const lowered = text.toLowerCase();
  for (const key in characters) {
    if (lowered.includes(characters[key].name.toLowerCase())) {
      return key;
    }
  }
  return null;
};

// === NEW: Weather API Function ===
async function getWeather(city) {
  try {
    const response = await fetch(`http://api.weatherapi.com/v1/current.json?key=${WEATHERAPI_KEY}&q=${city}&aqi=no`);
    const data = await response.json();
    if (response.status !== 200) {
      console.error("❌ Weather API error:", data.error.message);
      return null;
    }
    return data;
  } catch (error) {
    console.error("❌ Failed to fetch weather data:", error);
    return null;
  }
}

// === CHAT endpoint ===
app.post("/chat", async (req, res) => {
  const { text: rawText, sessionId: providedSessionId, isVoice } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : "";

  console.log("📩 Incoming chat request:", { text: sanitizedText, sessionId, isVoice });

  try {
    // Load or initialize session
    let sessionData = JSON.parse(await redis.get(`session:${sessionId}`)) || {
  character: "mcarthur",
  studentLevel: null,
  currentLesson: null,
  isWeatherQuery: false,
  learnedWords: [], // NEW: Initialize the learned words counter
};
    console.log("📦 Loaded sessionData:", sessionData);

    // Check for active lesson and use that character
    if (sessionData.currentLesson) {
      const lesson = lessonIntros[sessionData.currentLesson.month]?.[sessionData.currentLesson.chapter];
      if (lesson) {
        sessionData.character = lesson.teacher;
      }
    }

    // Handle character change requests
    const requestedCharacterKey = findCharacter(sanitizedText);
    const requestedCharacter = characters[requestedCharacterKey];

    if (requestedCharacter && requestedCharacterKey !== sessionData.character) {
      sessionData.character = requestedCharacterKey;
      sessionData.currentLesson = null;
      sessionData.isWeatherQuery = false; // Reset weather state
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
      console.log("🔄 Switched to new character:", requestedCharacterKey);

      const introText = `Hello, I am ${requestedCharacter.name}. What would you like to talk about today?`;
      
      return res.json({ text: introText, character: requestedCharacterKey, voiceId: requestedCharacter.voiceId });
    }

    // Handle first-time welcome if no input
    if (!sanitizedText) {
      const welcomeMsg =
        "Welcome to Waterwheel Village, friend! I'm Mr. McArthur. What's your name? Are you a beginner, intermediate, or expert student?";
      await redis.set(
        `history:${sessionId}`,
        JSON.stringify([{ role: "assistant", content: welcomeMsg }])
      );
      console.log("👋 Sent welcome message");
      return res.json({ text: welcomeMsg, character: "mcarthur", voiceId: characters.mcarthur.voiceId });
    }
// === NEW: Word Counting Logic ===
    if (sessionData.currentLesson && sanitizedText) {
      const { month, chapter } = sessionData.currentLesson;
      const lessonWords = lessonIntros[month]?.[chapter]?.wordlist || [];
      const userWords = sanitizedText.toLowerCase().split(/\s+/); // Split user message into an array of words

      let newWordsLearned = 0;
      let newWords = [];

      // Check each lesson word against the user's words
      for (const lessonWord of lessonWords) {
        if (userWords.includes(lessonWord.toLowerCase())) {
          // Check if the word is not already in our learned words list
          if (!sessionData.learnedWords.includes(lessonWord.toLowerCase())) {
            sessionData.learnedWords.push(lessonWord.toLowerCase());
            newWords.push(lessonWord);
            newWordsLearned++;
          }
        }
      }
      
      // OPTIONAL: You can add a prompt to the student if they have learned a new word
      // For now, we will just log it.
      if (newWordsLearned > 0) {
        console.log(`🎉 Student learned ${newWordsLearned} new words: ${newWords.join(', ')}`);
      }
    }
    // === NEW: Improved Weather Logic with State ===
    const weatherKeywords = /(weather|temperature|forecast|fine|sunny|rainy|cloudy|snowy)/i;
    const cityRegex = /(in|at|around|for)?\s*([a-zA-Z\s,]+)$/i;

    // Check if a weather query is already in progress
    if (sessionData.isWeatherQuery) {
        // NEW: Clean the city name from extra words/punctuation
        const cleanedCity = sanitizedText.replace(/,/g, "").trim();
        
        const weatherData = await getWeather(cleanedCity);
        
        sessionData.isWeatherQuery = false; // Reset the state after getting the city
        await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
        
        if (weatherData) {
            const tempC = weatherData.current.temp_c;
            const condition = weatherData.current.condition.text.toLowerCase();
            const character = characters[sessionData.character];
            
            let weatherReply = "";
            if (sessionData.character === 'johannes') {
                weatherReply = `The soil is always talking, but for a real report on ${cleanedCity}, I see the sky is ${condition} and the temperature is around ${tempC} degrees Celsius. That's a day for working in the fields.`;
            } else if (sessionData.character === 'mcarthur') {
                weatherReply = `That's an interesting question! I see that in ${cleanedCity}, the weather is ${condition} and it's about ${tempC} degrees Celsius. A beautiful day to be outside.`;
            } else {
                weatherReply = `Okay! It looks like in ${cleanedCity} the weather is ${condition} and the temperature is ${tempC} degrees Celsius. That's good to know.`;
            }

            const messages = JSON.parse(await redis.get(`history:${sessionId}`)) || [];
            messages.push({ role: "user", content: sanitizedText });
            messages.push({ role: "assistant", content: weatherReply });
            await redis.set(`history:${sessionId}`, JSON.stringify(messages));
            return res.json({ text: weatherReply, character: sessionData.character, voiceId: characters[sessionData.character].voiceId });
        } else {
            const errorReply = `I am sorry, I could not find the weather for "${cleanedCity}". Is there a different city you would like me to check?`;
            const messages = JSON.parse(await redis.get(`history:${sessionId}`)) || [];
            messages.push({ role: "user", content: sanitizedText });
            messages.push({ role: "assistant", content: errorReply });
            await redis.set(`history:${sessionId}`, JSON.stringify(messages));
            return res.json({ text: errorReply, character: sessionData.character, voiceId: characters[sessionData.character].voiceId });
        }
    }

    // Check if the message contains a weather keyword and set state
    if (weatherKeywords.test(sanitizedText)) {
        sessionData.isWeatherQuery = true;
        await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
        const noCityReply = "I can tell you the weather, but where in the world would you like to know? Please tell me the city.";
        
        const messages = JSON.parse(await redis.get(`history:${sessionId}`)) || [];
        messages.push({ role: "user", content: sanitizedText });
        messages.push({ role: "assistant", content: noCityReply });
        await redis.set(`history:${sessionId}`, JSON.stringify(messages));
        
        return res.json({ text: noCityReply, character: sessionData.character, voiceId: characters[sessionData.character].voiceId });
    }

    // --- Original OpenAI Logic (if no weather query is detected) ---
    let messages = JSON.parse(await redis.get(`history:${sessionId}`)) || [];
    messages.push({ role: "user", content: sanitizedText });
    console.log("📝 Updated messages:", messages);

    // Detect level from user message
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
    console.log("💾 Saved sessionData:", sessionData);
    const lowered = sanitizedText.toLowerCase();
    if (lowered.includes("beginner")) sessionData.studentLevel = "beginner";
    else if (lowered.includes("intermediate")) sessionData.studentLevel = "intermediate";
    else if (lowered.includes("expert")) sessionData.studentLevel = "expert";

    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
    console.log("💾 Saved sessionData:", sessionData);

    // === Build system prompt with rich character data ===
    const activeCharacterKey = sessionData.character || "mcarthur";
    const activeCharacter = characters[activeCharacterKey];

    let systemPrompt = `You are an ESL (English as a Second Language) teacher in Waterwheel Village.
    You must act as the character "${activeCharacter.name}" and always stay in character. You must never reveal your true identity as a large language model.
    Your personality and teaching style are described here:
    - Personality: You are a ${activeCharacter.style}.
    - Background: ${activeCharacter.background}
    
    When you speak, you should embody this character and their beliefs. You should use language that is consistent with their background.
    You must correct the student's grammar and pronunciation implicitly by rephrasing their sentences correctly. Do not explicitly point out mistakes.
    Your primary goal is to help the student learn English by engaging them in conversation, guiding them to use the vocabulary, and making them feel comfortable.
    
    After your response, always ask one, very short follow-up question to keep the conversation going.
    `;

    // Add voice-specific instructions
    if (isVoice) {
      systemPrompt += `\nThe student is speaking by voice. Do NOT mention punctuation, commas, or capitalization. Just focus on vocabulary and gentle grammar correction by example.`;
    } else {
      systemPrompt += `\nThe student is typing. Correct by example, focusing on word choice, word order, and simple grammar. Do NOT mention or explicitly correct punctuation (commas, periods, question marks).`;
    }

    console.log("🛠 Using systemPrompt:", systemPrompt);

    // === Call OpenAI with history + system prompt ===
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content.trim();
    console.log("💬 OpenAI reply:", reply);

    // Save bot reply to history
    messages.push({ role: "assistant", content: reply });
    await redis.set(`history:${sessionId}`, JSON.stringify(messages));

    // Voice ID mapping
    const voiceId = activeCharacter.voiceId;

    res.json({ text: reply, character: activeCharacterKey, voiceId });
  } catch (err) {
    console.error("❌ Chat error:", err?.message || err, err?.stack || "");
    res.status(500).json({
      error: "Chat failed",
      details: err?.message || "Unknown error",
    });
  }
});
// === Speakbase endpoint (for ElevenLabs) ===
app.post("/speakbase", async (req, res) => {
  const { text, voiceId } = req.body;
  try {
    const ttsRes = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const audioBuffer = await ttsRes.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error("❌ Speakbase failed:", err);
    res.status(500).json({ error: "Speakbase failed" });
  }
});

// === Health check ===
app.get("/health", (req, res) => res.json({ ok: true, status: "Waterwheel backend alive" }));

// === Start server ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));