require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const app = express();
const cors = require('cors');

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(cors());
app.use(express.json());

// === Load wordlists.json dynamically ===
const fs = require("fs");
const path = require("path");

const wordlistsPath = path.join(__dirname, "data", "wordlists.json");
let wordlists = {};

try {
  const fileContent = fs.readFileSync(wordlistsPath, "utf-8");
  wordlists = JSON.parse(fileContent);
  console.log("✅ Wordlists loaded successfully. Levels available:", Object.keys(wordlists));
} catch (err) {
  console.error("❌ Failed to load wordlists.json", err);
}


// ===== Simple in-memory storage =====
const sessions = new Map();
const histories = new Map();

async function getSession(sessionId) { return sessions.get(sessionId); }
async function setSession(sessionId, data) { sessions.set(sessionId, data); }
async function getChatHistory(sessionId) { return histories.get(sessionId) || []; }
async function storeChatHistory(sessionId, messages) { histories.set(sessionId, messages); }

// ===== Character → ElevenLabs Voice mapping =====
const voices = {
  mcarthur: "fEVT2ExfHe1MyjuiIiU9",
  nadia: "a1KZUXKFVFDOb33I1uqr",
  fatima: "JMbCR4ujfEfGaawA1YtC",
  anika: "GCPLhb1XrVwcoKUJYcvz",
  liang: "gAMZphRyrWJnLMDnom6H",
  johannes: "JgHmW3ojZwT0NDP5D1JJ",
  aleksanderi: "tIFPE2y0DAU6xfZn3Fka",
  sophia: "0q9TlrIoQJIdxZP9oZh7",
  kwame: "dhwafD61uVd8h85wAZSE",
  ibrahim: "tlETan7Okc4pzjD0z62P",
  default: "fEVT2ExfHe1MyjuiIiU9"
};

// ===== Word lists for 1000 Words program =====
const wordLists = {
  week1: {
    beginner: [
      { eng: "family", fin: "perhe" },
      { eng: "mother", fin: "äiti" },
      { eng: "father", fin: "isä" },
      { eng: "brother", fin: "veli" },
      { eng: "sister", fin: "sisko" },
      { eng: "child", fin: "lapsi" },
      { eng: "son", fin: "poika" },
      { eng: "daughter", fin: "tytär" },
      { eng: "grandmother", fin: "isoäiti / mummo" },
      { eng: "grandfather", fin: "isoisä / vaari" },
      { eng: "parents", fin: "vanhemmat" },
      { eng: "home", fin: "koti" },
      { eng: "house", fin: "talo" },
      { eng: "room", fin: "huone" },
      { eng: "kitchen", fin: "keittiö" },
      { eng: "living room", fin: "olohuone" },
      { eng: "bedroom", fin: "makuuhuone" },
      { eng: "bathroom", fin: "kylpyhuone" },
      { eng: "door", fin: "ovi" },
      { eng: "window", fin: "ikkuna" },
      { eng: "table", fin: "pöytä" },
      { eng: "chair", fin: "tuoli" },
      { eng: "bed", fin: "sänky" },
      { eng: "food", fin: "ruoka" },
      { eng: "bread", fin: "leipä" },
      { eng: "milk", fin: "maito" },
      { eng: "water", fin: "vesi" },
      { eng: "coffee", fin: "kahvi" },
      { eng: "tea", fin: "tee" },
      { eng: "apple", fin: "omena" },
      { eng: "banana", fin: "banaani" },
      { eng: "fish", fin: "kala" },
      { eng: "meat", fin: "liha" },
      { eng: "chicken", fin: "kana" },
      { eng: "soup", fin: "keitto" },
      { eng: "school", fin: "koulu" },
      { eng: "teacher", fin: "opettaja" },
      { eng: "student", fin: "oppilas / opiskelija" },
      { eng: "book", fin: "kirja" },
      { eng: "pen", fin: "kynä" },
      { eng: "paper", fin: "paperi" },
      { eng: "car", fin: "auto" },
      { eng: "bus", fin: "bussi" },
      { eng: "bicycle", fin: "polkupyörä" },
      { eng: "road", fin: "tie" },
      { eng: "shop", fin: "kauppa" },
      { eng: "money", fin: "raha" },
      { eng: "day", fin: "päivä" },
      { eng: "night", fin: "yö" },
      { eng: "morning", fin: "aamu" },
      { eng: "evening", fin: "ilta" }
    ],
    intermediate: [
      { eng: "uncle", fin: "setä / eno" },
      { eng: "aunt", fin: "täti" },
      { eng: "cousin", fin: "serkku" },
      { eng: "nephew", fin: "veljen-/siskonpoika" },
      { eng: "niece", fin: "veljen-/siskontytär" },
      { eng: "neighbour", fin: "naapuri" },
      { eng: "baby", fin: "vauva" },
      { eng: "husband", fin: "aviomies" },
      { eng: "wife", fin: "vaimo" },
      { eng: "relative", fin: "sukulainen" },
      { eng: "address", fin: "osoite" },
      { eng: "village", fin: "kylä" },
      { eng: "town", fin: "kaupunki" },
      { eng: "country", fin: "maa" },
      { eng: "world", fin: "maailma" },
      { eng: "earth", fin: "maa / maapallo" },
      { eng: "sky", fin: "taivas" },
      { eng: "sun", fin: "aurinko" },
      { eng: "moon", fin: "kuu" },
      { eng: "star", fin: "tähti" },
      { eng: "weather", fin: "sää" },
      { eng: "rain", fin: "sade" },
      { eng: "snow", fin: "lumi" },
      { eng: "wind", fin: "tuuli" },
      { eng: "cold", fin: "kylmä" },
      { eng: "warm", fin: "lämmin" },
      { eng: "hot", fin: "kuuma" },
      { eng: "clothes", fin: "vaatteet" },
      { eng: "shirt", fin: "paita" },
      { eng: "pants", fin: "housut" },
      { eng: "dress", fin: "mekko" },
      { eng: "shoes", fin: "kengät" },
      { eng: "coat", fin: "takki" },
      { eng: "hat", fin: "hattu" },
      { eng: "train", fin: "juna" },
      { eng: "airplane", fin: "lentokone" },
      { eng: "ship", fin: "laiva" },
      { eng: "station", fin: "asema" },
      { eng: "airport", fin: "lentokenttä" },
      { eng: "ticket", fin: "lippu" },
      { eng: "travel", fin: "matkustaa" },
      { eng: "journey", fin: "matka" },
      { eng: "work", fin: "työ" },
      { eng: "job", fin: "ammatti / työ" },
      { eng: "office", fin: "toimisto" },
      { eng: "factory", fin: "tehdas" },
      { eng: "computer", fin: "tietokone" },
      { eng: "phone", fin: "puhelin" },
      { eng: "message", fin: "viesti" },
      { eng: "language", fin: "kieli" },
      { eng: "English", fin: "englanti" },
      { eng: "Finnish", fin: "suomi" },
      { eng: "question", fin: "kysymys" },
      { eng: "answer", fin: "vastaus" },
      { eng: "example", fin: "esimerkki" },
      { eng: "story", fin: "tarina" },
      { eng: "song", fin: "laulu" },
      { eng: "music", fin: "musiikki" },
      { eng: "friend", fin: "ystävä" },
      { eng: "people", fin: "ihmiset" },
      { eng: "man", fin: "mies" },
      { eng: "woman", fin: "nainen" },
      { eng: "young", fin: "nuori" },
      { eng: "old", fin: "vanha" },
      { eng: "happy", fin: "iloinen" },
      { eng: "sad", fin: "surullinen" },
      { eng: "big", fin: "iso" },
      { eng: "small", fin: "pieni" },
      { eng: "good", fin: "hyvä" },
      { eng: "bad", fin: "huono" },
      { eng: "beautiful", fin: "kaunis" },
      { eng: "ugly", fin: "ruma" },
      { eng: "easy", fin: "helppo" },
      { eng: "difficult", fin: "vaikea" }
    ],
    expert: [
      { eng: "generation", fin: "sukupolvi" },
      { eng: "ancestor", fin: "esi-isä" },
      { eng: "descendant", fin: "jälkeläinen" },
      { eng: "heritage", fin: "perintö" },
      { eng: "civilization", fin: "sivistys" },
      { eng: "architecture", fin: "arkkitehtuuri" },
      { eng: "philosophy", fin: "filosofia" },
      { eng: "tradition", fin: "perinne" },
      { eng: "responsibility", fin: "vastuu" },
      { eng: "community", fin: "yhteisö" },
      { eng: "society", fin: "yhteiskunta" },
      { eng: "politics", fin: "politiikka" },
      { eng: "government", fin: "hallitus" },
      { eng: "freedom", fin: "vapaus" },
      { eng: "justice", fin: "oikeudenmukaisuus" },
      { eng: "equality", fin: "tasa-arvo" },
      { eng: "environment", fin: "ympäristö" },
      { eng: "pollution", fin: "saastuminen" },
      { eng: "sustainability", fin: "kestävyys" },
      { eng: "energy", fin: "energia" },
      { eng: "electricity", fin: "sähkö" },
      { eng: "invention", fin: "keksintö" },
      { eng: "discovery", fin: "löytö" },
      { eng: "knowledge", fin: "tieto" },
      { eng: "wisdom", fin: "viisaus" },
      { eng: "education", fin: "koulutus" },
      { eng: "university", fin: "yliopisto" },
      { eng: "research", fin: "tutkimus" },
      { eng: "medicine", fin: "lääketiede" },
      { eng: "disease", fin: "sairaus" },
      { eng: "health", fin: "terveys" },
      { eng: "treatment", fin: "hoito" },
      { eng: "science", fin: "tiede" },
      { eng: "experiment", fin: "koe" },
      { eng: "result", fin: "tulos" },
      { eng: "machine", fin: "kone" },
      { eng: "technology", fin: "teknologia" },
      { eng: "industry", fin: "teollisuus" },
      { eng: "economy", fin: "talous" },
      { eng: "business", fin: "liiketoiminta" },
      { eng: "company", fin: "yritys" },
      { eng: "market", fin: "markkinat" },
      { eng: "customer", fin: "asiakas" },
      { eng: "service", fin: "palvelu" },
      { eng: "product", fin: "tuote" },
      { eng: "price", fin: "hinta" },
      { eng: "value", fin: "arvo" },
      { eng: "competition", fin: "kilpailu" },
      { eng: "success", fin: "menestys" },
      { eng: "failure", fin: "epäonnistuminen" },
      { eng: "opportunity", fin: "mahdollisuus" },
      { eng: "challenge", fin: "haaste" },
      { eng: "future", fin: "tulevaisuus" },
      { eng: "past", fin: "mennyt" },
      { eng: "present", fin: "nykyhetki" },
      { eng: "history", fin: "historia" },
      { eng: "culture", fin: "kulttuuri" },
      { eng: "literature", fin: "kirjallisuus" },
      { eng: "art", fin: "taide" },
      { eng: "painting", fin: "maalaus" },
      { eng: "sculpture", fin: "veistos" },
      { eng: "music", fin: "musiikki" },
      { eng: "poetry", fin: "runous" },
      { eng: "novel", fin: "romaani" },
      { eng: "theater", fin: "teatteri" },
      { eng: "cinema", fin: "elokuva" },
      { eng: "religion", fin: "uskonto" },
      { eng: "belief", fin: "usko" },
      { eng: "faith", fin: "usko" },
      { eng: "hope", fin: "toivo" },
      { eng: "love", fin: "rakkaus" },
      { eng: "friendship", fin: "ystävyys" },
      { eng: "marriage", fin: "avioliitto" },
      { eng: "family", fin: "perhe" },
      { eng: "society", fin: "yhteiskunta" },
      { eng: "individual", fin: "yksilö" },
      { eng: "personality", fin: "persoonallisuus" },
      { eng: "character", fin: "luonne" },
      { eng: "emotion", fin: "tunne" },
      { eng: "intelligence", fin: "älykkyys" },
      { eng: "imagination", fin: "mielikuvitus" },
      { eng: "memory", fin: "muisti" },
      { eng: "dream", fin: "uni / unelma" },
      { eng: "goal", fin: "tavoite" },
      { eng: "decision", fin: "päätös" },
      { eng: "choice", fin: "valinta" },
      { eng: "plan", fin: "suunnitelma" },
      { eng: "change", fin: "muutos" },
      { eng: "development", fin: "kehitys" },
      { eng: "progress", fin: "edistys" }
    ]
  }
};

// ===== Helper: normalize & detect character =====
function normalize(text) {
  return text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}
function detectCharacter(text, fallback = "mcarthur") {
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (/(^|\s)(i am|my name is)\s+nadia/.test(lower) || /nadia[:,]?/.test(lower)) return "nadia";
  if (/(^|\s)(i am|my name is)\s+fatima/.test(lower) || /fatima[:,]?/.test(lower)) return "fatima";
  if (/(^|\s)(i am|my name is)\s+anika/.test(lower) || /anika[:,]?/.test(lower)) return "anika";
  if (/(^|\s)(i am|my name is)\s+liang/.test(lower) || /liang[:,]?/.test(lower)) return "liang";
  if (/(^|\s)(i am|my name is)\s+johannes/.test(lower) || /johannes[:,]?/.test(lower)) return "johannes";
  if (/(^|\s)(i am|my name is)\s+aleksanderi/.test(lower) || /aleksanderi[:,]?/.test(lower)) return "aleksanderi";
  if (/(^|\s)(i am|my name is)\s+sophia/.test(lower) || /sophia[:,]?/.test(lower)) return "sophia";
  if (/(^|\s)(i am|my name is)\s+kwame/.test(lower) || /kwame[:,]?/.test(lower)) return "kwame";
  if (/(^|\s)(i am|my name is)\s+ibrahim/.test(lower) || /ibrahim[:,]?/.test(lower)) return "ibrahim";
  if (/(^|\s)(i am|my name is)\s+mcarthur/.test(lower) || /mcarthur[:,]?/.test(lower)) return "mcarthur";
  return fallback;
}

// ===== /chat endpoint =====
app.post('/chat', async (req, res) => {
  const { text: rawText, sessionId: providedSessionId } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : '';
  const isWelcomeMessage = !sanitizedText;

  try {
    if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

    let sessionData = await getSession(sessionId);
    if (!sessionData) {
      sessionData = { character: 'mcarthur', studentName: null, studentLevel: null };
      await setSession(sessionId, sessionData);
    }
    let character = sessionData.character;

    // === Welcome Message ===
    if (isWelcomeMessage && !sessionData.studentName) {
      const welcomeMsg = "Welcome to Waterwheel Village, friends! I'm Mr. McArthur. What's your name? Are you a beginner, intermediate, or expert student?";
      await storeChatHistory(sessionId, [{ role: 'assistant', content: welcomeMsg }]);
      return res.json({
        text: welcomeMsg,
        character: 'mcarthur',
        voiceId: voices.mcarthur,
        level: sessionData.studentLevel
      });
    }

    // === Detect Level from User Input ===
    if (sanitizedText) {
      const lower = sanitizedText.toLowerCase();
      if (!sessionData.studentLevel) {
        if (lower.includes("beginner")) sessionData.studentLevel = "beginner";
        else if (lower.includes("intermediate")) sessionData.studentLevel = "intermediate";
        else if (lower.includes("expert")) sessionData.studentLevel = "expert";
      }
    }

    let messages = await getChatHistory(sessionId);
    if (sanitizedText) messages.push({ role: 'user', content: sanitizedText });

    const systemPrompt = `You are ${character} in Waterwheel Village. You are a kind ESL teacher. Be brief, encouraging, and correct mistakes gently. Always ask one short follow-up question.`;
    const outboundMessages = [{ role: 'system', content: systemPrompt }, ...messages];

    const key = process.env.CHATBASE_API_KEY;
    const CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;

    const response = await axios.post(
      'https://www.chatbase.co/api/v1/chat',
      { chatbotId: CHATBOT_ID, conversationId: sessionId, messages: outboundMessages },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const responseText = response?.data?.text?.trim?.() || '';
    let detectedCharacter = detectCharacter(responseText, sessionData.character || "mcarthur");
    sessionData.character = detectedCharacter;

    // Save updated session (now with studentLevel if set)
    await setSession(sessionId, sessionData);

    console.log("=== RAW TEXT ===", responseText);
    console.log("=== DETECTED CHARACTER ===", detectedCharacter);
    console.log("=== LEVEL ===", sessionData.studentLevel);

    messages.push({ role: 'assistant', content: responseText });
    await storeChatHistory(sessionId, messages);

    return res.json({
      text: responseText,
      character: detectedCharacter,
      voiceId: voices[detectedCharacter] || voices.mcarthur,
      level: sessionData.studentLevel || null
    });

  } catch (error) {
    console.error('Error in /chat:', error.response?.data || error.message);
    return res.json({
      text: "Thanks! Let’s begin with a short exercise: tell me 3 things about yourself.",
      character: 'mcarthur',
      voiceId: voices.mcarthur,
      note: 'fallback-error',
      level: null
    });
  }
});

// ===== /speakbase endpoint =====
app.post('/speakbase', async (req, res) => {
  try {
    const { text, voiceId, character } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    const finalVoiceId = voiceId || voices[character] || voices.default;

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`,
      { text, voice_settings: { stability: 0.3, similarity_boost: 0.8 } },
      { headers: { "Accept": "audio/mpeg", "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY }, responseType: "arraybuffer" }
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(response.data);
  } catch (error) {
    console.error("Error in /speakbase:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

// ===== Word list & quiz endpoints =====
app.get('/wordlist/:week/:level', (req, res) => {
  const { week, level } = req.params;
  const data = wordLists[`week${week}`]?.[level];
  if (!data) return res.status(404).json({ error: "Word list not found" });
  res.json(data);
});

// ===== Quiz endpoint =====
app.get('/quiz/:week/:level', (req, res) => {
  const { week, level } = req.params;
  const data = wordLists[`week${week}`]?.[level];
  if (!data) return res.status(404).json({ error: "Quiz data not found" });

  // Shuffle and pick 5 words
  const shuffled = [...data].sort(() => 0.5 - Math.random());
  const quizQuestions = shuffled.slice(0, 5).map(item => ({
    fin: item.fin,    // show Finnish as the question
    eng: item.eng     // expected English answer
  }));

  res.json(quizQuestions);
});

// ===== Healthcheck endpoint =====
app.get('/health', (req, res) => { res.json({ ok: true, status: "Waterwheel backend alive" }); });

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
