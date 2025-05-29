// betterchatF-fixed.js - Fully Restored Version for Waterwheel Village Learning
require("dotenv").config();
console.log("Starting betterchatF.js");
const express = require("express");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const redis = require("redis");
const pino = require("pino");
const sanitizeHtml = require("sanitize-html");
const { v4: uuidv4 } = require("uuid");
const { characterVoices, characterAliases, voiceSettings } = require("./config");

const logger = pino({
  level: "info",
  transport: {
    target: "pino/file",
    options: { destination: "./logs/app.log", mkdir: true },
  },
});

const DEFAULT_CHARACTER = "mcarthur";
const SESSION_TTL = parseInt(process.env.SESSION_TTL || 3600, 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || 1000, 10);

const envSchema = Joi.object({
  CHATBASE_BOT_ID: Joi.string().required(),
  CHATBASE_API_KEY: Joi.string().required(),
  ELEVEN_API_KEY: Joi.string().required(),
  ELEVEN_VOICE_ID: Joi.string().required(),
  WORDPRESS_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().optional(),
  PORT: Joi.number().default(3000),
  VOICE_FATIMA: Joi.string().required(),
  VOICE_IBRAHIM: Joi.string().required(),
  VOICE_ANIKA: Joi.string().required(),
  VOICE_KWAME: Joi.string().required(),
  VOICE_SOPHIA: Joi.string().required(),
  VOICE_LIANG: Joi.string().required(),
  VOICE_JOHANNES: Joi.string().required(),
  VOICE_ALEKSANDERI: Joi.string().required(),
  VOICE_NADIA: Joi.string().required(),
  VOICE_MCARTHUR: Joi.string().required(),
}).unknown(true);

const { error: envError } = envSchema.validate(process.env, { abortEarly: false });
if (envError) {
  logger.error(`Environment validation failed: ${envError.details.map(d => d.message).join(", ")}`);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const app = express();
let redisClient;
let useRedis = !!process.env.REDIS_URL;
const userMemory = new Map();
const chatMemory = new Map();

axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

if (useRedis) {
  redisClient = redis.createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (err) => logger.error({ err: err.stack }, "Redis error"));
  (async () => {
    try {
      await redisClient.connect();
      logger.info("Connected to Redis");
    } catch (err) {
      logger.error({ err: err.stack }, "Redis connection failed");
      useRedis = false;
    }
  })();
}

app.use(cors({ origin: process.env.WORDPRESS_URL }));
app.use(express.json());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Rate limit exceeded" },
}));

function detectCharacter(text) {
  const lower = text.toLowerCase();
  for (const { key, names } of characterAliases) {
    for (const name of names) {
      if (lower.includes(name.toLowerCase())) return key;
    }
  }
  return null;
}

function isSwitchRequest(text) {
  return /can i (speak|talk) (to|with)/i.test(text);
}

async function setSession(sessionId, data) {
  const value = JSON.stringify({ ...data, timestamp: Date.now() });
  if (useRedis) await redisClient.setEx(sessionId, SESSION_TTL, value);
  else {
    userMemory.set(sessionId, JSON.parse(value));
    setTimeout(() => userMemory.delete(sessionId), SESSION_TTL * 1000);
  }
}

async function getSession(sessionId) {
  const data = useRedis ? await redisClient.get(sessionId) : userMemory.get(sessionId);
  return data ? JSON.parse(data) : null;
}

app.post("/chat", async (req, res) => {
  const { text, sessionId } = req.body;
  if (!text || !sessionId) return res.status(400).json({ error: "Missing fields" });
  const clean = sanitizeHtml(text);

  let session = await getSession(sessionId) || { character: DEFAULT_CHARACTER };
  const requested = detectCharacter(clean);
  if (requested && requested !== session.character && isSwitchRequest(clean)) {
    session.character = requested;
    await setSession(sessionId, session);
  }

  const previous = chatMemory.get(sessionId) || [];
  let prompt = { role: "system", content: `You are ${session.character}, a character in Waterwheel Village. Stay in character.` };
  if (session.studentName && session.character === "mcarthur") {
    prompt.content = `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${session.studentName}. Stay in character.`;
  }

  const response = await axios.post(
    "https://www.chatbase.co/api/v1/chat",
    { chatbotId: process.env.CHATBASE_BOT_ID, messages: [prompt, ...previous, { role: "user", content: clean }] },
    { headers: { Authorization: `Bearer ${process.env.CHATBASE_API_KEY}` } }
  );

  const reply = response.data.messages?.[0]?.content || "Sorry, I didn’t understand.";

  // Name capture logic
  if (session.character === "mcarthur" && !session.studentName) {
    const match = clean.match(/my name is ([a-zA-Z\s]{2,50})/i);
    if (match) {
      session.studentName = match[1].trim();
      await setSession(sessionId, session);
    }
  }

  const chatLog = [...previous, { role: "user", content: clean }, { role: "assistant", content: reply }];
  chatMemory.set(sessionId, chatLog.length > 12 ? chatLog.slice(-12) : chatLog);

  res.json({ text: reply });
});

app.post("/speakbase", async (req, res) => {
  const { text, sessionId } = req.body;
  if (!text || !sessionId) return res.status(400).json({ error: "Missing fields" });

  const clean = sanitizeHtml(text).replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
  const session = await getSession(sessionId) || { character: DEFAULT_CHARACTER };
  const voiceId = characterVoices[session.character] || process.env.ELEVEN_VOICE_ID;
  const settings = voiceSettings[session.character] || { stability: 0.5, similarity_boost: 0.5 };

  const voiceResponse = await axios({
    method: "POST",
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    headers: {
      "xi-api-key": process.env.ELEVEN_API_KEY,
      "Content-Type": "application/json",
    },
    data: {
      text: clean,
      model_id: "eleven_monolingual_v1",
      voice_settings: settings,
    },
    responseType: "arraybuffer",
  });

  res.set({ "Content-Type": "audio/mpeg", "Content-Length": voiceResponse.data.length });
  res.send(voiceResponse.data);
});

app.listen(PORT, (err) => {
  if (err) {
    logger.error(err);
    process.exit(1);
  }
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

process.on("SIGTERM", async () => {
  logger.info("Graceful shutdown...");
  if (redisClient) await redisClient.quit();
  process.exit(0);
});
