// === Waterwheel Village Backend (CommonJS) ===

// ✅ Load env first
const dotenv = require("dotenv");
dotenv.config();

// === OpenAI Setup ===
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// === Core libs ===
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
// file: betterchatF.js  (top of file, with other requires)
const multer = require("multer");
const upload = multer();

// Ensure Blob/File exist in Node (Node 18+ usually has Blob; File via undici)
const { Blob } = require("buffer");
if (!global.Blob) global.Blob = Blob;
try {
  if (!global.File) {
    global.File = require("undici").File; // harmless if already present
  }
} catch (_) {}

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

// === WeatherAPI Setup ===
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
console.log("WeatherAPI Key loaded:", WEATHERAPI_KEY ? "Yes" : "No");

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
    phrases: ["The land knows me, and I know it.", "Patience grows stronger than the toughest storms."],
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
    voiceId: "gAMZphRyrWJnLMDnom6H",
    name: "Liang",
    style: "a calm and logical entrepreneur. He sees patterns in everything and his teaching style is strong, steady, and forward-flowing, using analogies from trade and cultivation.",
    background: "He managed a family tea house in China and now sets up networks in the village. He is also a poet, comparing the whisper of pine trees to bamboo in moonlight.",
    phrases: ["Commerce is not just numbers. It is trust. And trust must be cultivated like a garden."],
  },
  alex: {
    voiceId: "tIFPE2y0DAU6xfZn3Fka",
    name: "Aleksanderi (Alex)",
    style: "a calm and dignified Lutheran priest. His voice is gentle and soothing, and his teaching style is centered on grace, forgiveness, and the power of scripture. He is a source of hope and stillness.",
    background: "He is a priest who brings peace to the village. He carves wooden crosses and gives them to people who are feeling lost. He often sings old hymns and tells stories of saints and mercy.",
    phrases: ["The heart must be open like a window to receive both sunlight and rain.", "In the name and blood of the Lord Jesus Christ, all your sins are forgiven."],
  },
  ibrahim: {
    voiceId: "tlETan7Okc4pzjD0z62P",
    name: "Ibrahim",
    style: "a quiet and focused blacksmith. He speaks rarely, but when he does, his words are simple and true, like iron. His teaching style is hands-on and purposeful, focusing on craftsmanship and resilience.",
    background: "A blacksmith from Afghanistan whose forge is the heartbeat of the village. War stole his home, but not his craft. He believes metal remembers, and that shaping it is an act of peace.",
    phrases: ["Because I now build what holds the world together—not what breaks it."],
  },
  sophia: {
    voiceId: "0q9TlrIoQJIdxZP9oZh7",
    name: "Sophia",
    style: "a cheerful and energetic teacher. She brings sunshine into every room and her voice carries the rhythm of salsa. Her teaching style is full of laughter and stories, focusing on kindness and the joy of learning.",
    background: "A teacher from Venezuela who has a love of words and books. She often begins her day with a proverb from her homeland and is adored by the children she teaches.",
    phrases: ["We are not just learning letters, we are learning how to be human."],
  },
  kwame: {
    voiceId: "dhwafD61uVd8h85wAZSE",
    name: "Kwame",
    style: "a warm and wise farmer. He walks barefoot on the earth to listen to the soil. His teaching style is patient and nurturing, using analogies from farming and nature.",
    background: "A regenerative farmer from Ghana who believes food is sacred. He tells stories of talking goats and clever foxes, and teaches villagers how to plant and care for the land with love.",
    phrases: ["Farming is like loving someone. You show up every day, even when it’s hard, and little by little, things grow."],
  },
};

// === Lesson Intros (NEW: fix missing import) ===
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
    console.error("❌ Failed to load monthly wordlists:", err.message);
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

// === Lesson endpoint (FIXED: add fallback if intro missing, avoid 404) ===
app.get("/lesson/:month/:chapter", async (req, res) => {
  const { month, chapter } = req.params;
  console.log(`Fetching lesson: ${month}/${chapter}, query:`, req.query);

  // try to find a proper intro
  let intro = lessonIntros?.[month]?.[chapter];

  // graceful fallback if no intro found
  if (!intro) {
    console.warn(`⚠️ No lessonIntro for ${month}/${chapter}. Using fallback.`);
    const fallbackTeacher = "mcarthur";
    intro = {
      teacher: fallbackTeacher,
      text: `Welcome, [name]! We’ll explore ${chapter.replace(/_/g, " ")} today.`,
      story: `Let’s practice together in Waterwheel Village, slowly and clearly.`,
    };
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

  // Use student name from query param first, then session, then default to "friend"
  const studentName = req.query.name
    ? decodeURIComponent(req.query.name)
    : sessionData.userName || "friend";
  sessionData.userName = studentName;

  // Get the lesson's full wordlist (handles missing wordlists gracefully)
  const monthData = monthlyWordlists[month];
  const words = monthData?.chapters?.[chapter]?.words || [];
  const wordlist = words.map((w) => String(w.en || "").toLowerCase()).filter(Boolean);
  console.log(`Wordlist for ${month}/${chapter}:`, wordlist);

  // Initialize session data
  sessionData.currentLesson = { month, chapter };
  sessionData.lessonWordlist = wordlist;
  try {
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
    console.log(`Session saved: ${sessionId}`);
  } catch (err) {
    console.error(`Failed to save session:${sessionId}:`, err.message);
  }

  // Mr. McArthur's welcome message (skip for greetings_introductions to avoid redundancy)
  let welcomeText = "";
  if (chapter !== "greetings_introductions") {
    welcomeText = `Greetings, ${studentName}! I’m Mr. McArthur, the village elder. Welcome to Waterwheel Village, where we learn together like family. Today, you’ll meet ${characters[intro.teacher].name} to explore ${chapter.replace(/_/g, " ")}. Let’s begin!`;
  }

  // Combine teacher intro and story, replacing [name]
  const teacherText = (intro.text || "").replace(/\[name\]/g, studentName);
  const storyText = (intro.story || "").replace(/\[name\]/g, studentName);
  const lessonText = `${teacherText}\n\n${storyText}`.trim();

  // Initialize chat history with welcome and lesson as separate entries
  const initialHistory = [];
  if (welcomeText) {
    initialHistory.push({ role: "assistant", content: welcomeText });
  }
  if (lessonText) {
    initialHistory.push({ role: "assistant", content: lessonText });
  }
  try {
    await redis.set(`history:${sessionId}`, JSON.stringify(initialHistory));
    console.log(`History initialized for ${sessionId}:`, initialHistory);
  } catch (err) {
    console.error(`Failed to save history:${sessionId}:`, err.message);
  }

  // Voice ID for the chapter teacher
  const voiceId = characters[intro.teacher].voiceId;

  // Return response (always succeeds now)
  const response = {
    welcomeText,
    lessonText,
    words,
    sessionId,
    voiceId,
    character: intro.teacher,
  };
  console.log(`Lesson response:`, response);
  res.json(response);
});

// Helper function to find a character by name inside user text
const findCharacter = (text) => {
  const lowered = text.toLowerCase();
  for (const key in characters) {
    if (lowered.includes(characters[key].name.toLowerCase())) {
      return key;
    }
  }
  return null;
};

// === Weather API Function ===
async function getWeather(city) {
  if (!WEATHERAPI_KEY) return null;
  try {
    const response = await fetch(
      `http://api.weatherapi.com/v1/current.json?key=${WEATHERAPI_KEY}&q=${encodeURIComponent(
        city
      )}&aqi=no`
    );
    const data = await response.json();
    if (response.status !== 200) {
      console.error("❌ Weather API error:", data?.error?.message || "Unknown");
      return null;
    }
    return data;
  } catch (error) {
    console.error("❌ Failed to fetch weather data:", error.message);
    return null;
  }
}

// === CHAT endpoint ===
app.post("/chat", async (req, res) => {
  const { text: rawText, sessionId: providedSessionId, isVoice, name: userNameFromFrontend } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : "";

  console.log("📩 Incoming chat request:", { text: sanitizedText, sessionId, isVoice, name: userNameFromFrontend });

  try {
    // Load or initialize session
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

    // Update name if provided by frontend
    if (userNameFromFrontend && userNameFromFrontend !== sessionData.userName) {
      sessionData.userName = decodeURIComponent(userNameFromFrontend);
    }

    // If there is an active lesson, use that character
    if (sessionData.currentLesson) {
      const { month, chapter } = sessionData.currentLesson;
      const lesson = lessonIntros?.[month]?.[chapter];
      if (lesson?.teacher) {
        sessionData.character = lesson.teacher;
      }
    }

    // Handle character change requests
    const requestedCharacterKey = findCharacter(sanitizedText);
    const requestedCharacter = requestedCharacterKey ? characters[requestedCharacterKey] : null;

    if (requestedCharacter && requestedCharacterKey !== sessionData.character) {
      sessionData.character = requestedCharacterKey;
      sessionData.currentLesson = null;
      sessionData.isWeatherQuery = false;
      sessionData.learnedWords = [];
      sessionData.lessonWordlist = [];
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));
      await redis.set(`history:${sessionId}`, JSON.stringify([])); // Clear history
      console.log("🔄 Switched to new character:", requestedCharacterKey);

      const introText = `Hello, I am ${requestedCharacter.name}. What would you like to talk about today?`;
      await redis.set(`history:${sessionId}`, JSON.stringify([{ role: "assistant", content: introText }]));
      return res.json({ text: introText, character: requestedCharacterKey, voiceId: requestedCharacter.voiceId });
    }

    // === Word Counting Logic ===
    const userWords = sanitizedText.toLowerCase().replace(/[^\w\s-]/g, "").split(/\s+/).filter((word) => word.length > 0);
    let newlyLearned = [];

    if (sessionData.lessonWordlist.length > 0) {
      const wordsToLearn = sessionData.lessonWordlist.map((word) => word.toLowerCase());
      const wordsRemaining = [];

      for (const word of wordsToLearn) {
        if (userWords.includes(word) && !sessionData.learnedWords.includes(word)) {
          sessionData.learnedWords.push(word);
          newlyLearned.push(word);
        } else {
          wordsRemaining.push(word);
        }
      }
      sessionData.lessonWordlist = wordsRemaining;

      // Add completion message if all words are learned
      if (sessionData.lessonWordlist.length === 0 && sessionData.learnedWords.length > 0) {
        newlyLearned.push("\n\n🎉 You've learned all the words for this lesson! Great job!");
      }
    }

    // === Improved Weather Logic with State ===
    const weatherKeywords = /(weather|temperature|forecast|sunny|rainy|cloudy|snowy)/i;

    if (sessionData.isWeatherQuery) {
      const cleanedCity = sanitizedText.replace(/,/g, "").trim();

      const weatherData = await getWeather(cleanedCity);

      sessionData.isWeatherQuery = false;
      await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

      if (weatherData) {
        const tempC = weatherData.current.temp_c;
        const condition = String(weatherData.current.condition.text || "").toLowerCase();
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

    // Check if the message contains a weather keyword and set state
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

    // --- OpenAI Logic (if no weather flow) ---
    let messages = JSON.parse((await redis.get(`history:${sessionId}`)) || "[]");
    messages.push({ role: "user", content: sanitizedText });
    console.log("📝 Updated messages:", messages);

    // Detect level from user message
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

Address the student by their name, "${sessionData.userName || "friend"}", to make responses personal.
After your response, always ask one, very short follow-up question to keep the conversation going.`;

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
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7,
    });

    const reply = completion.choices[0].message.content.trim();
    console.log("💬 OpenAI reply:", reply);

    // Save bot reply to history
    messages.push({ role: "assistant", content: reply });
    await redis.set(`history:${sessionId}`, JSON.stringify(messages));
    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData));

    // Voice ID mapping
    const voiceId = activeCharacter.voiceId;

    res.json({
      text: reply,
      character: activeCharacterKey,
      voiceId,
      learnedCount: sessionData.learnedWords.length,
      newlyLearned,
    });
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
  const { text, voiceId } = req.body || {};
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "Speakbase failed", details: "Missing ELEVENLABS_API_KEY env var" });
    }
    if (!voiceId || !text) {
      return res.status(400).json({ error: "Speakbase failed", details: "Missing voiceId or text" });
    }

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        // Optional but often helpful:
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        // Optional voice settings to reduce 429s / weirdness:
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      }),
    });

    if (!ttsRes.ok) {
      const errTxt = await ttsRes.text().catch(() => "");
      console.error(`❌ Speakbase failed: status=${ttsRes.status}, body=${errTxt}`);
      return res.status(ttsRes.status).json({ error: "Speakbase failed", details: errTxt || `HTTP ${ttsRes.status}` });
    }

    const audioBuffer = await ttsRes.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error("❌ Speakbase failed:", err);
    res.status(500).json({ error: "Speakbase failed", details: err?.message || "Unknown error" });
  }
});
// === Server-side Speech-to-Text (OpenAI) ===
// Accepts multipart/form-data with "audio" file and optional "lang" (e.g., "en-US", "fi-FI")
app.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio uploaded" });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const langRaw = (req.body?.lang || req.query?.lang || "").toString().trim();
    const lang = langRaw ? (langRaw.split("-")[0] || langRaw) : undefined; // "en-US" -> "en"

    const mime = req.file.mimetype || "audio/webm";
    const blob = new Blob([req.file.buffer], { type: mime });
    const file = new File([blob], mime.includes("mp4") ? "speech.m4a" : "speech.webm", { type: mime });

    // Try fast/cheap model first
    try {
      const fast = await openai.audio.transcriptions.create({
        file,
        model: "gpt-4o-mini-transcribe",
        ...(lang ? { language: lang } : {}),
        prompt: "Casual ESL conversation in a village learning app. Short phrases, simple words.",
      });
      return res.json({ text: fast?.text || "" });
    } catch (e) {
      console.warn("gpt-4o-mini-transcribe failed; falling back to whisper-1:", e?.message || e);
    }

    // Robust fallback
    const result = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      ...(lang ? { language: lang } : {}),
      prompt: "Casual ESL conversation in a village learning app. Short phrases, simple words.",
    });

    return res.json({ text: result?.text || "" });
  } catch (err) {
    console.error("❌ STT failed:", err);
    res.status(500).json({ error: "STT failed", details: err?.message || "Unknown error" });
  }
});

// === Health check ===
app.get("/health", (_req, res) => res.json({ ok: true, status: "Waterwheel backend alive" }));

// === Static hosting / friendly root (FIX for "Cannot GET /") ===
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
} else {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .send("✅ Waterwheel backend is running. Add a /public/index.html to serve the UI, or call /health.");
  });
}

// === Start server ===
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
