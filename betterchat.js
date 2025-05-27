require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const redis = require("redis");
const pino = require("pino");
const sanitizeHtml = require("sanitize-html");
const { v4: uuidv4 } = require("uuid");
const axiosRetry = require("axios-retry");

const logger = pino();
const DEFAULT_CHARACTER = "mcarthur";
const SESSION_TTL = parseInt(process.env.SESSION_TTL || 60 * 60, 10); // 1 hour
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || 1000, 10);

// Environment validation
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
  logger.error(`Environment validation failed: ${envError.details.map(d => d.message).join(', ')}`);
  process.exit(1);
}

const app = express();
let redisClient;
let useRedis = !!process.env.REDIS_URL;
const userMemory = new Map();
const chatMemory = new Map();

// Redis setup with retry
if (useRedis) {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    retry_strategy: (options) => {
      if (options.attempt > 3) {
        logger.error("Max Redis retries reached, falling back to memory");
        useRedis = false;
        return null;
      }
      return Math.min(options.attempt * 100, 3000);
    },
  });

  redisClient.on("error", (err) => logger.error({ err }, "Redis connection error"));
  (async () => {
    try {
      await redisClient.connect();
      logger.info("Connected to Redis");
    } catch (err) {
      logger.error({ err }, "Failed to connect to Redis, using in-memory Map");
      useRedis = false;
    }
  })();
} else {
  logger.warn("No REDIS_URL provided, using in-memory Map");
}

// Axios retry configuration
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status >= 500,
});

// Middleware
app.use(cors({ origin: process.env.WORDPRESS_URL }));
app.use(express.json());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Rate limit exceeded, please try again later", code: "RATE_LIMIT_EXCEEDED" },
}));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin !== process.env.WORDPRESS_URL) {
    return res.status(403).json({ error: "Invalid origin", code: "INVALID_ORIGIN" });
  }
  next();
});

// Validation schemas
const chatSchema = Joi.object({
  text: Joi.string().trim().min(1).max(1000).required(),
  sessionId: Joi.string().uuid().required(),
});
const speakbaseSchema = Joi.object({
  text: Joi.string().trim().min(1).max(1000).required(),
  userMessage: Joi.string().trim().min(1).max(1000).optional(),
  sessionId: Joi.string().uuid().required(),
});

// Character configuration
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
  mcarthur: process.env.VOICE_MCARTHUR,
};

const characterAliases = [
  { key: 'fatima', names: ['fatima'] },
  { key: 'ibrahim', names: ['ibrahim'] },
  { key: 'anika', names: ['anika'] },
  { key: 'kwame', names: ['kwame'] },
  { key: 'sophia', names: ['sophia', 'sophie'] },
  { key: 'liang', names: ['liang'] },
  { key: 'johannes', names: ['johannes'] },
  { key: 'aleksanderi', names: ['aleksanderi', 'alex', 'alexanderi', 'aleks'] },
  { key: 'nadia', names: ['nadia'] },
  { key: 'mcarthur', names: ['mcarthur', 'aaron', 'mr mcarthur'] },
];

const voiceSettings = {
  mcarthur: { stability: 0.6, similarity_boost: 0.9 },
  default: { stability: 0.5, similarity_boost: 0.8 },
};

// Character detection
function detectCharacter(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.toLowerCase().replace(/[^\w\s]/g, '');
  const matches = [];
  for (const { key, names } of characterAliases) {
    for (const name of names) {
      if (cleaned.includes(name.toLowerCase())) {
        matches.push(key);
        break;
      }
    }
  }
  if (matches.length > 1) {
    logger.warn(`Multiple characters detected: ${matches.join(', ')}`);
    return null;
  }
  return matches[0] || null;
}

// Session management
async function setSession(sessionId, data) {
  const sessionData = JSON.stringify(data);
  if (useRedis) {
    await redisClient.setEx(sessionId, SESSION_TTL, sessionData);
  } else {
    userMemory.set(sessionId, { ...data, timestamp: Date.now() });
    setTimeout(() => userMemory.delete(sessionId), SESSION_TTL * 1000);
  }
  logger.info(`Session ${sessionId}: Set data ${sessionData}`);
}

async function getSession(sessionId) {
  let data = useRedis ? await redisClient.get(sessionId) : userMemory.get(sessionId);
  if (useRedis && data) {
    data = JSON.parse(data);
  } else if (!useRedis && data) {
    data = { character: data.character, studentName: data.studentName };
  }
  logger.info(`Session ${sessionId}: Retrieved data ${JSON.stringify(data) || 'none'}`);
  return data || null;
}

function storeChatHistory(sessionId, messages) {
  if (chatMemory.size >= MAX_SESSIONS && !chatMemory.has(sessionId)) {
    const oldestSession = chatMemory.keys().next().value;
    chatMemory.delete(oldestSession);
    logger.warn(`Max sessions reached, evicted session ${oldestSession}`);
  }
  const sanitizedMessages = messages.map(msg => ({
    role: msg.role,
    content: sanitizeHtml(msg.content, { allowedTags: [], allowedAttributes: {} }).slice(0, 1000),
  }));
  chatMemory.set(sessionId, sanitizedMessages.length > 12 ? sanitizedMessages.slice(-12) : sanitizedMessages);
}

// Periodic cleanup for in-memory sessions
if (!useRedis) {
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, data] of userMemory) {
      if (now - data.timestamp > SESSION_TTL * 1000) {
        userMemory.delete(sessionId);
        chatMemory.delete(sessionId);
        logger.info(`Session ${sessionId}: Expired and deleted`);
      }
    }
  }, 60 * 1000);
}

// Error handling utility
function streamlinedError(err, code) {
  const error = new Error(err.message || 'An error occurred');
  error.code = code;
  error.status = err.response?.status || 500;
  return error;
}

// Routes
app.get("/", (req, res) => {
  res.send("🌍 Waterwheel Village - BetterChat is online!");
});

app.get("/health", async (req, res) => {
  const health = { status: "ok", uptime: process.uptime(), redis: useRedis ? "connected" : "in-memory" };
  if (useRedis) {
    try {
      await redisClient.ping();
      health.redis = "connected";
    } catch (err) {
      health.redis = "disconnected";
    }
  }
  res.json(health);
});

app.post("/chat", async (req, res) => {
  try {
    const { error, value } = chatSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message, code: "INVALID_INPUT" });

    const { text, sessionId } = value;
    const sanitizedText = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
    const sessionData = await getSession(sessionId);
    const previous = chatMemory.get(sessionId) || [];
    let systemPrompt = null;

    if (sessionData?.character) {
      const prefix = sessionData.studentName && sessionData.character === 'mcarthur'
        ? `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`
        : `You are ${sessionData.character}, a character in Waterwheel Village. Stay in character.`;
      systemPrompt = { role: "system", content: prefix };
    }

    const chatbaseResponse = await axios.post(
      "https://www.chatbase.co/api/v1/chat",
      {
        messages: [
          ...(systemPrompt ? [systemPrompt] : []),
          ...previous,
          { role: "user", content: sanitizedText },
        ],
        chatbotId: process.env.CHATBASE_BOT_ID,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CHATBASE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    ).catch((err) => {
      throw streamlinedError(err, "CHATBASE_ERROR");
    });

    logger.info("Chatbase API call successful");
    const replyText = chatbaseResponse.data?.messages?.[0]?.content || chatbaseResponse.data?.text || "Sorry, I had trouble understanding you.";
    storeChatHistory(sessionId, [...previous, { role: "user", content: sanitizedText }, { role: "assistant", content: replyText }]);
    res.json({ text: replyText });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_SERVER_ERROR";
    logger.error({ error, code }, "Chat endpoint failed");
    res.status(status).json({ error: error.message, code });
  }
});

app.post("/speakbase", async (req, res) => {
  try {
    const { error, value } = speakbaseSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message, code: "INVALID_INPUT" });

    const { text, userMessage, sessionId } = value;
    const sanitizedText = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
    const sanitizedUserMessage = userMessage ? sanitizeHtml(userMessage, { allowedTags: [], allowedAttributes: {} }) : null;

    let sessionData = await getSession(sessionId);
    let detectedCharacter = sanitizedUserMessage ? detectCharacter(sanitizedUserMessage) : null;

    if (detectedCharacter) {
      sessionData = { character: detectedCharacter, studentName: sessionData?.studentName };
      await setSession(sessionId, sessionData);
      logger.info(`Session ${sessionId}: Character set to ${detectedCharacter}`);
    } else if (sessionData?.character) {
      detectedCharacter = sessionData.character;
      logger.info(`Session ${sessionId}: Using existing character ${detectedCharacter}`);
    } else {
      detectedCharacter = DEFAULT_CHARACTER;
      sessionData = { character: detectedCharacter, studentName: null };
      await setSession(sessionId, sessionData);
      logger.info(`Session ${sessionId}: No character found, defaulting to ${detectedCharacter}`);
    }

    const previous = chatMemory.get(sessionId) || [];
    let systemPrompt = null;
    let replyText;

    if (detectedCharacter === 'mcarthur' && previous.length === 0 && !sessionData.studentName) {
      // New session with Mr. McArthur: Send welcome message
      replyText = "Welcome to the lesson! I'm Mr. McArthur. May I have your name, please?";
      storeChatHistory(sessionId, [{ role: "assistant", content: replyText }]);
    } else {
      // Existing session or name provided
      if (detectedCharacter === 'mcarthur' && !sessionData.studentName && sanitizedUserMessage) {
        // Assume userMessage contains the name
        const name = sanitizedUserMessage.trim().slice(0, 50); // Limit name length
        if (name) {
          sessionData.studentName = name;
          await setSession(sessionId, sessionData);
          logger.info(`Session ${sessionId}: Student name set to ${name}`);
          replyText = `Great to meet you, ${name}! Let's begin the lesson. ${sanitizedText}`;
        } else {
          replyText = "I'm sorry, I didn't catch your name. Could you please tell me your name?";
          storeChatHistory(sessionId, [
            ...previous,
            { role: "user", content: sanitizedUserMessage || sanitizedText },
            { role: "assistant", content: replyText },
          ]);
        }
      } else {
        // Normal conversation
        const prefix = sessionData.studentName && detectedCharacter === 'mcarthur'
          ? `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`
          : `You are ${detectedCharacter}, a character in Waterwheel Village. Stay in character.`;
        systemPrompt = { role: "system", content: prefix };

        const chatbaseResponse = await axios.post(
          "https://www.chatbase.co/api/v1/chat",
          {
            messages: [
              ...(systemPrompt ? [systemPrompt] : []),
              ...previous,
              { role: "user", content: sanitizedUserMessage || sanitizedText },
            ],
            chatbotId: process.env.CHATBASE_BOT_ID,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.CHATBASE_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        ).catch((err) => {
          throw streamlinedError(err, "CHATBASE_ERROR");
        });

        logger.info("Chatbase API call successful");
        replyText = chatbaseResponse.data?.messages?.[0]?.content || chatbaseResponse.data?.text || "Sorry, I had trouble understanding you.";
        storeChatHistory(sessionId, [
          ...previous,
          { role: "user", content: sanitizedUserMessage || sanitizedText },
          { role: "assistant", content: replyText },
        ]);
      }
    }

    const spokenText = replyText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/~~(.*?)~~/g, '$1').replace(/`(.*?)`/g, '$1').trim();
    if (!spokenText) return res.status(400).json({ error: "No text provided for speech", code: "NO_SPEECH_TEXT" });

    const selectedVoiceId = characterVoices[detectedCharacter] || characterVoices[DEFAULT_CHARACTER];
    const settings = voiceSettings[detectedCharacter] || voiceSettings.default;

    const voiceResponse = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json",
      },
      data: {
        text: spokenText,
        model_id: "eleven_monolingual_v1",
        voice_settings: settings,
      },
      responseType: "arraybuffer",
    }).catch((err) => {
      throw streamlinedError(err, "ELEVENLABS_ERROR");
    });

    if (!voiceResponse.headers['content-type'].includes('audio')) {
      throw streamlinedError(new Error("Invalid audio response from ElevenLabs"), "INVALID_AUDIO_RESPONSE");
    }

    logger.info("Eleven Labs API call successful");
    res.set({ "Content-Type": "audio/mpeg", "Content-Length": voiceResponse.data.length });
    res.send(voiceResponse.data);
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_SERVER_ERROR";
    logger.error({ error, code }, "Speakbase endpoint failed");
    res.status(status).json({ error: error.message, code });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`🚀 BetterChat running on port ${PORT}`));

process.on("SIGTERM", async () => {
  logger.info("Gracefully shutting down...");
  if (redisClient) await redisClient.quit();
  process.exit(0);
});