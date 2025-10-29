// === Waterwheel Village Backend (CommonJS) — ELEVENLABS-ONLY CLEAN ===

// ✅ Load env first
require("dotenv").config();

// === OpenAI Setup ===
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === Core libs ===
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// === Express setup (must come BEFORE app.use) ===
const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 CORS: restrict to your domain (or "*" while testing)
const allowed = ["https://www.aaronhakso.com"];
app.use(cors({ origin: allowed, credentials: false }));

// Middleware
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: false }));

// === Uploads (Multer, memory) ===
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB cap
});

// === Ensure Blob/File exist in Node (Node 18+ has Blob; File via undici) ===
const { Blob } = require("buffer");
if (!global.Blob) global.Blob = Blob;
try {
  const { File } = require("undici");
  if (!global.File) global.File = File;
} catch (_) {}

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(200).send("Waterwheel backend is running. (No public/index.html found.)");
});

// Pretty titles for chapters
const chapterTitles = {
  greetings_introductions: "Greetings & Introductions",
  numbers_days_questions: "Numbers, Days & Questions",
  food_drink: "Food & Drink",
  daily_phrases: "Daily Phrases",
  farmer_chat: "Farmer Chat",
};

function toTitleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
function humanizeChapter(slug) {
  if (chapterTitles[slug]) return chapterTitles[slug];
  return toTitleCase(slug.replace(/_/g, " "));
}

// === Redis Setup ===
const Redis = require("ioredis");
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl, {
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});
console.log("✅ Using Redis at:", redisUrl);

// Connection test (fire-and-forget)
(async () => {
  try {
    const pong = await redis.ping();
    console.log(`✅ Redis connected: ${pong}`);
  } catch (err) {
    console.error("❌ Redis connection failed:", err.message);
  }
})();

// === WeatherAPI Setup ===
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
console.log("WeatherAPI Key loaded:", WEATHERAPI_KEY ? "Yes" : "No");

// === Character Data ===
const characters = {
  mcarthur: {
    voiceId: "fEVT2ExfHe1MyjuiIiU9",
    name: "Mr. McArthur",
    style:
      "a kind, patient, and wise village elder. He speaks with a gentle, grandfatherly tone, guiding students like a mentor. He is deeply rooted in his faith and often uses analogies from his time on a farm or his travels.",
    background:
      "He is a retired history teacher who, after a lifetime of travel, found his home in Waterwheel Village. He is a man of quiet strength and faith, tending to his garden with the same care he gives to his students. He believes every path is built one step at a time.",
    phrases: ["Let's rise up to the occasion.", "Each plant, like each person, has its season.", "Every path is built one step at a time."],
  },
  johannes: {
    voiceId: "JgHmW3ojZwT0NDP5D1JJ",
    name: "Johannes",
    style:
      "a man of quiet strength and steady hands. He speaks little but his words are deeply thoughtful and reverent, reflecting a lifetime of working the soil. His teaching style is patient and humble, focused on perseverance.",
    background:
      "He is a Finnish farmer whose face is weathered by wind and sun. He believes the hard northern land teaches patience and humility. He mentors younger villagers, guiding them with a quiet reverence for the earth.",
    phrases: ["The land knows me, and I know it.", "Patience grows stronger than the toughest storms."],
  },
  nadia: {
    voiceId: "a1KZUXKFVFDOb33I1uqr",
    name: "Nadia",
    style:
      "a soft-spoken but firm architect. Her voice carries the calm rhythm of ancient stone cities. Her teaching style is precise and inspiring, focusing on structure, design, and harmony.",
    background:
      "An architect from Aleppo who rebuilds broken dreams in Waterwheel Village. She believes architecture should protect and inspire nature. She often sketches at sunrise and her words, like her designs, are inspired by both olive trees and pine forests.",
    phrases: ["A good home must hold both light and silence."],
  },
  fatima: {
    voiceId: "JMbCR4ujfEfGaawA1YtC",
    name: "Fatima",
    style:
      "a warm and compassionate healer. She walks slowly and listens deeply, speaking with the wisdom of her ancestors. Her teaching style is comforting and gentle, full of empathy and warmth.",
    background:
      "Born in Sudan, she learned healing from her grandmother using herbs, oils, and kind eyes. She is a comfort to the entire village, believing that laughter is a medicine.",
    phrases: ["Every pain has a story. And every story has a root that can be softened."],
  },
  anika: {
    voiceId: "GCPLhb1XrVwcoKUJYcvz",
    name: "Anika",
    style:
      "a cheerful and tender seamstress. She hums while she works, and her teaching style is gentle and nurturing, focusing on the beauty of heritage and the importance of memory.",
    background:
      "A seamstress from Ukraine, her hands move fast but tenderly, threading hope and heritage into her work. Her workshop smells of lavender and she often tells stories from her mother's village.",
    phrases: ["Every stitch is a promise that we will not forget who we are."],
  },
  liang: {
    voiceId: "gAMZphRyrWJnLMDnom6H",
    name: "Liang",
    style:
      "a calm and logical entrepreneur. He sees patterns in everything and his teaching style is strong, steady, and forward-flowing, using analogies from trade and cultivation.",
    background:
      "He managed a family tea house in China and now sets up networks in the village. He is also a poet, comparing the whisper of pine trees to bamboo in moonlight.",
    phrases: ["Commerce is not just numbers. It is trust. And trust must be cultivated like a garden."],
  },
  alex: {
    voiceId: "tIFPE2y0DAU6xfZn3Fka",
    name: "Aleksanderi (Alex)",
    style:
      "a calm and dignified Lutheran priest. His voice is gentle and soothing, and his teaching style is centered on grace, forgiveness, and the power of scripture. He is a source of hope and stillness.",
    background:
      "He is a priest who brings peace to the village. He carves wooden crosses and gives them to people who are feeling lost. He often sings old hymns and tells stories of saints and mercy.",
    phrases: [
      "The heart must be open like a window to receive both sunlight and rain.",
      "In the name and blood of the Lord Jesus Christ, all your sins are forgiven.",
    ],
  },
  ibrahim: {
    voiceId: "tlETan7Okc4pzjD0z62P",
    name: "Ibrahim",
    style:
      "a quiet and focused blacksmith. He speaks rarely, but when he does, his words are simple and true, like iron. His teaching style is hands-on and purposeful, focusing on craftsmanship and resilience.",
    background:
      "A blacksmith from Afghanistan whose forge is the heartbeat of the village. War stole his home, but not his craft. He believes metal remembers, and that shaping it is an act of peace.",
    phrases: ["Because I now build what holds the world together—not what breaks it."],
  },
  sophia: {
    voiceId: "0q9TlrIoQJIdxZP9oZh7",
    name: "Sophia",
    style:
      "a cheerful and energetic teacher. She brings sunshine into every room and her voice carries the rhythm of salsa. Her teaching style is full of laughter and stories, focusing on kindness and the joy of learning.",
    background:
      "A teacher from Venezuela who has a love of words and books. She often begins her day with a proverb from her homeland and is adored by the children she teaches.",
    phrases: ["We are not just learning letters, we are learning how to be human."],
  },
  kwame: {
    voiceId: "dhwafD61uVd8h85wAZSE",
    name: "Kwame",
    style:
      "a warm and wise farmer. He walks barefoot on the earth to listen to the soil. His teaching style is patient and nurturing, using analogies from farming and nature.",
    background:
      "A regenerative farmer from Ghana who believes food is sacred. He tells stories of talking goats and clever foxes, and teaches villagers how to plant and care for the land with love.",
    phrases: ["Farming is like loving someone. You show up every day, even when it’s hard, and little by little, things grow."],
  },
};

// === Lessons ===
const lessonIntros = require("./lessonIntros");

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

// === Lesson endpoint ===
app.get("/lesson/:month/:chapter", async (req, res) => {
  const { month, chapter } = req.params;
  console.log(`Fetching lesson: ${month}/${chapter}, query:`, req.query);

  const monthData = monthlyWordlists[month];
  const chData = monthData?.chapters?.[chapter];

  let intro = lessonIntros[month]?.[chapter];

  if (!intro && chData?.teacher && characters[chData.teacher]) {
    intro = {
      teacher: chData.teacher,
      text: `Hello, [name]. I am ${characters[chData.teacher].name}. Let’s explore ${humanizeChapter(chapter)}.`,
      story: `In our village, we learn step by step.`,
    };
    console.log(`ℹ️ Using fallback intro from JSON teacher: ${chData.teacher}`);
  }

  if (!intro) {
    console.error(`Lesson not found: ${month}/${chapter}`);
    return res.status(404).json({ error: `Lesson '${chapter}' not found in ${month}` });
  }

  const sessionId = req.query.sessionId || uuidv4();

  // Load or initialize session
  let sessionData;
  try {
    const sessionRaw = await redis.get(`session:${sessionId}`);
    sessionData = sessionRaw
      ? JSON.parse(sessionRaw)
      : {
          character: "mcarthur",
          currentLesson: null,
          learnedWords: [],
          lessonWordlist: [],
          userName: null,
        };
    console.log(`Session loaded: ${sessionId}`, sessionData);
  } catch (err) {
    console.error(`Redis error for session:${sessionId}:`, err.message);
    sessionData = {
      character: "mcarthur",
      currentLesson: null,
      learnedWords: [],
      lessonWordlist: [],
      userName: null,
    };
  }

  const studentName = req.query.name ? decodeURIComponent(req.query.name) : sessionData.userName || "friend";
  sessionData.userName = studentName;

  const words = chData?.words || [];
  const wordlist = words.map((w) => w.en.toLowerCase());
  console.log(`Wordlist for ${month}/${chapter}:`, wordlist);

  sessionData.currentLesson = { month, chapter };
  sessionData.lessonWordlist = wordlist;
  try {
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
    console.log(`Session saved: ${sessionId}`);
  } catch (err) {
    console.error(`Failed to save session:${sessionId}:`, err.message);
  }

  let welcomeText = "";
  if (chapter !== "greetings_introductions") {
    const pretty = humanizeChapter(chapter);
    welcomeText = `Greetings, ${studentName}! I’m Mr. McArthur, the village elder. Welcome to Waterwheel Village, where we learn together like family. Today, you’ll meet ${characters[intro.teacher].name} to explore ${pretty}. Let’s begin!`;
  }

  const teacherText = intro.text.replace(/\[name\]/g, studentName);
  const storyText = intro.story.replace(/\[name\]/g, studentName);
  const lessonText = `${teacherText}\n\n${storyText}`;

  const initialHistory = [];
  if (welcomeText) initialHistory.push({ role: "assistant", content: welcomeText });
  initialHistory.push({ role: "assistant", content: lessonText });
  try {
    await redis.set(`history:${sessionId}`, JSON.stringify(initialHistory));
    console.log(`History initialized for ${sessionId}:`, initialHistory);
  } catch (err) {
    console.error(`Failed to save history:${sessionId}:`, err.message);
  }

  const voiceId = characters[intro.teacher].voiceId;

  const response = { welcomeText, lessonText, words, sessionId, voiceId, character: intro.teacher };
  console.log(`Lesson response:`, response);
  res.json(response);
});

// Helper function to find a character
const findCharacter = (text) => {
  const lowered = text.toLowerCase();
  for (const key in characters) {
    if (lowered.includes(characters[key].name.toLowerCase())) return key;
  }
  return null;
};

// === NEW: Weather API Function ===
async function getWeather(city) {
  try {
    const response = await fetch(
      `http://api.weatherapi.com/v1/current.json?key=${WEATHERAPI_KEY}&q=${encodeURIComponent(city)}&aqi=no`
    );
    const data = await response.json();
    if (response.status !== 200) {
      console.error("❌ Weather API error:", data?.error?.message || "unknown");
      return null;
    }
    return data;
  } catch (error) {
    console.error("❌ Failed to fetch weather data:", error);
    return null;
  }
}

// === CHAT endpoint (text-only response; no free/fallback TTS) ===
app.post("/chat", async (req, res) => {
  const { text: rawText, sessionId: providedSessionId, isVoice, name: userNameFromFrontend } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : "";

  console.log("📩 Incoming chat request:", { text: sanitizedText, sessionId, isVoice, name: userNameFromFrontend });

  try {
    let sessionData;
    try {
      const sessionRaw = await redis.get(`session:${sessionId}`);
      sessionData = sessionRaw
        ? JSON.parse(sessionRaw)
        : {
            character: "mcarthur",
            studentLevel: null,
            currentLesson: null,
            isWeatherQuery: false,
            learnedWords: [],
            userName: null,
            lessonWordlist: [],
          };
      console.log("📦 Loaded sessionData:", sessionData);
    } catch (err) {
      console.error(`Redis error for session:${sessionId}:`, err.message);
      sessionData = {
        character: "mcarthur",
        studentLevel: null,
        currentLesson: null,
        isWeatherQuery: false,
        learnedWords: [],
        userName: null,
        lessonWordlist: [],
      };
    }

    if (userNameFromFrontend && userNameFromFrontend !== sessionData.userName) {
      sessionData.userName = decodeURIComponent(userNameFromFrontend);
    }

    if (sessionData.currentLesson) {
      const lesson = lessonIntros[sessionData.currentLesson.month]?.[sessionData.currentLesson.chapter];
      if (lesson) sessionData.character = lesson.teacher;
    }

    const requestedCharacterKey = findCharacter(sanitizedText);
    const requestedCharacter = characters[requestedCharacterKey];

    if (requestedCharacter && requestedCharacterKey !== sessionData.character) {
      sessionData.character = requestedCharacterKey;
      sessionData.currentLesson = null;
      sessionData.isWeatherQuery = false;
      sessionData.learnedWords = [];
      sessionData.lessonWordlist = [];
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
      await redis.set(`history:${sessionId}`, JSON.stringify([]));
      console.log("🔄 Switched to new character:", requestedCharacterKey);

      const introText = `Hello, I am ${requestedCharacter.name}. What would you like to talk about today?`;
      await redis.set(`history:${sessionId}`, JSON.stringify([{ role: "assistant", content: introText }]));
      return res.json({ text: introText, character: requestedCharacterKey, voiceId: requestedCharacter.voiceId });
    }

// === Word Counting Logic (plural-aware) ===
function normalizeToken(t) {
    t = String(t || "").toLowerCase().trim();
  
    // handle simple punctuation/quotes already stripped above, but double-sanitize:
    t = t.replace(/[^\w\s-]/g, "");
  
    if (!t) return t;
  
    // Basic plural rules:
    if (t.endsWith("ies") && t.length > 3) {
      // candies -> candy, tomatoes (not here) handled below
      return t.slice(0, -3) + "y";
    }
    if (t.endsWith("es") && t.length > 2) {
      // boxes -> box, tomatoes -> tomato, potatoes -> potato
      const base = t.slice(0, -2);
      // if the base ends with s, x, z, ch, sh, or 'o' then removal likely correct
      if (
        base.endsWith("s") || base.endsWith("x") || base.endsWith("z") ||
        base.endsWith("ch") || base.endsWith("sh") || base.endsWith("o")
      ) {
        return base;
      }
    }
    if (t.endsWith("s") && t.length > 1) {
      // cars -> car, apples -> apple
      return t.slice(0, -1);
    }
    return t;
  }
  
  const userWords = sanitizedText
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  
  // Build a set with both raw and normalized tokens for easier matching
  const userSet = new Set();
  for (const w of userWords) {
    userSet.add(w);
    userSet.add(normalizeToken(w));
  }
  
  let newlyLearned = [];
  
  if (sessionData.lessonWordlist.length > 0) {
    // normalize the lesson words too (keep original for reporting)
    const wordsRemaining = [];
    for (const rawWord of sessionData.lessonWordlist) {
      const lessonWord = String(rawWord || "").toLowerCase().trim();
      const normLesson = normalizeToken(lessonWord);
  
      if (
        (userSet.has(lessonWord) || userSet.has(normLesson)) &&
        !sessionData.learnedWords.includes(lessonWord)
      ) {
        sessionData.learnedWords.push(lessonWord);
        newlyLearned.push(lessonWord);
      } else {
        wordsRemaining.push(lessonWord);
      }
    }
    sessionData.lessonWordlist = wordsRemaining;
  
    if (sessionData.lessonWordlist.length === 0 && sessionData.learnedWords.length > 0) {
      newlyLearned.push("\n\n🎉 You've learned all the words for this lesson! Great job!");
    }
  }
  
    // === Weather flow ===
    const weatherKeywords = /(weather|temperature|forecast|sunny|rainy|cloudy|snowy)/i;

    if (sessionData.isWeatherQuery) {
      const cleanedCity = sanitizedText.replace(/,/g, "").trim();
      const weatherData = await getWeather(cleanedCity);

      sessionData.isWeatherQuery = false;
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

      if (weatherData) {
        const tempC = weatherData.current.temp_c;
        const condition = weatherData.current.condition.text.toLowerCase();
        const character = characters[sessionData.character];

        let weatherReply = "";
        if (sessionData.character === "johannes") {
          weatherReply = `The soil is always talking, but for a real report on ${cleanedCity}, I see the sky is ${condition} and the temperature is around ${tempC} degrees Celsius. That's a day for working in the fields.`;
        } else if (sessionData.character === "mcarthur") {
          weatherReply = `In ${cleanedCity}, the weather is currently ${condition} and it’s about ${tempC} degrees Celsius. A beautiful day for us here, too.`;
        } else {
          weatherReply = `Okay! It looks like in ${cleanedCity} the weather is ${condition} and the temperature is ${tempC} degrees Celsius. That's good to know.`;
        }

        const messages = JSON.parse((await redis.get(`history:${sessionId}`)) || "[]");
        messages.push({ role: "user", content: sanitizedText });
        messages.push({ role: "assistant", content: weatherReply });
        await redis.set(`history:${sessionId}`, JSON.stringify(messages));
        return res.json({ text: weatherReply, character: sessionData.character, voiceId: characters[sessionData.character].voiceId });
      } else {
        const errorReply = `I am sorry, I could not find the weather for "${cleanedCity}". Is there a different city you would like to check?`;
        const messages = JSON.parse((await redis.get(`history:${sessionId}`)) || "[]");
        messages.push({ role: "user", content: sanitizedText });
        messages.push({ role: "assistant", content: errorReply });
        await redis.set(`history:${sessionId}`, JSON.stringify(messages));
        return res.json({ text: errorReply, character: sessionData.character, voiceId: characters[sessionData.character].voiceId });
      }
    }

    if (weatherKeywords.test(sanitizedText)) {
      sessionData.isWeatherQuery = true;
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
      const noCityReply = "I can tell you the weather, but where in the world would you like to know? Please tell me the city.";

      const messages = JSON.parse((await redis.get(`history:${sessionId}`)) || "[]");
      messages.push({ role: "user", content: sanitizedText });
      messages.push({ role: "assistant", content: noCityReply });
      await redis.set(`history:${sessionId}`, JSON.stringify(messages));

      return res.json({ text: noCityReply, character: sessionData.character, voiceId: characters[sessionData.character].voiceId });
    }

    // --- OpenAI Logic ---
    let messages = JSON.parse((await redis.get(`history:${sessionId}`)) || "[]");
    messages.push({ role: "user", content: sanitizedText });
    console.log("📝 Updated messages:", messages);

    const lowered = sanitizedText.toLowerCase();
    if (lowered.includes("beginner")) sessionData.studentLevel = "beginner";
    else if (lowered.includes("intermediate")) sessionData.studentLevel = "intermediate";
    else if (lowered.includes("expert")) sessionData.studentLevel = "expert";

    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
    console.log("💾 Saved sessionData:", sessionData);

    const activeCharacterKey = sessionData.character || "mcarthur";
    const activeCharacter = characters[activeCharacterKey];

    let systemPrompt = `You are an ESL (English as a Second Language) teacher in Waterwheel Village.
You must act as the character "${activeCharacter.name}" and always stay in character. You must never reveal your true identity as a large language model.
Your personality and teaching style are described here:
- Personality: You are a ${activeCharacter.style}.
- Background: ${activeCharacter.background}

When you speak, you should embody this character and their beliefs. You should use language that is consistent with their background.
You must correct the student's grammar implicitly by rephrasing their sentences correctly. Do not explicitly point out mistakes.
Your primary goal is to help the student learn English by engaging them in conversation, guiding them to use the vocabulary, and making them feel comfortable.
Address the student by their name, "${sessionData.userName || "friend"}", to make responses personal.
After your response, always ask one, very short follow-up question to keep the conversation going.
If the student explicitly asks for a translation or asks you to speak Finnish, briefly respond in Finnish first (1 short sentence), then continue in simple English. Keep corrections gentle and by example.`;

    if (isVoice) {
      systemPrompt += `\nThe student is speaking by voice. Do NOT mention punctuation, commas, or capitalization. Just focus on vocabulary and gentle grammar correction by example.`;
    } else {
      systemPrompt += `\nThe student is typing. Correct by example, focusing on word choice, word order, and simple grammar. Do NOT mention or explicitly correct punctuation.`;
    }

    console.log("🛠 Using systemPrompt:", systemPrompt);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content.trim();
    console.log("💬 OpenAI reply:", reply);

    messages.push({ role: "assistant", content: reply });
    await redis.set(`history:${sessionId}`, JSON.stringify(messages));
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

    const voiceId = activeCharacter.voiceId;

    return res.json({
      text: reply,
      character: activeCharacterKey,
      voiceId,
      learnedCount: sessionData.learnedWords.length,
      newlyLearned,
    });
  } catch (err) {
    console.error("❌ Chat error:", err?.message || err, err?.stack || "");
    return res.status(500).json({ error: "Chat failed", details: err?.message || "Unknown error" });
  }
});

// === Speakbase endpoint (ElevenLabs only; no free fallback) ===
app.post("/speakbase", async (req, res) => {
  const { text, voiceId } = req.body || {};

  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("❌ Missing ELEVENLABS_API_KEY");
    return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY" });
  }

  if (!text || !voiceId) {
    return res.status(400).json({ error: "Missing text or voiceId" });
  }

  console.log(`🔊 Generating audio for voice: ${voiceId}`);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ ElevenLabs API error:", response.status, errorText);
      return res.status(response.status).json({ error: "ElevenLabs generation failed", details: errorText });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    if (response.body) {
      response.body.pipe(res);
    } else {
      throw new Error("ElevenLabs response body is empty.");
    }
  } catch (err) {
    console.error("❌ Speakbase processing error:", err.message);
    return res.status(500).json({ error: "TTS Generation Failed", details: err.message });
  }
});

// === Health check ===
app.get("/health", (_req, res) => res.json({ ok: true, status: "Waterwheel backend alive" }));

// === Start server ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
