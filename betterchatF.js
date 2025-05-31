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
const SESSION_TTL = parseInt(process.env.SESSION_TTL || 60 * 60, 10);
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
const PORT = process.env.PORT || 3000;
const { error: envError } = envSchema.validate(process.env, { abortEarly: false });
console.log("Env validation result:", envError ? envError.details : "Success");
console.log("Environment variables validated:", Object.keys(process.env).filter(k => k.startsWith("CHATBASE") || k.startsWith("ELEVEN") || k.startsWith("VOICE") || k.includes("URL") || k.includes("PORT")));
console.log("About to check envError");
if (envError) {
  logger.error(`Environment validation failed: ${envError.details.map(d => d.message).join(", ")}`);
  process.exit(1);
}

const app = express();
console.log("Express app initialized");
let redisClient;
let useRedis = !!process.env.REDIS_URL;
const userMemory = new Map();
const chatMemory = new Map();
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

logger.info(`Dependencies loaded: express@${require("express/package.json").version}, axios@${require("axios/package.json").version}, redis@${require("redis/package.json").version}`);

if (useRedis) {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    retry_strategy: (options) => {
      if (options.attempt > 3) {
        logger.error(`Max Redis retries reached, falling back to in-memory storage`);
        useRedis = false;
        return null;
      }
      return Math.min(options.attempt * 100, 3000);
    },
  });

  redisClient.on("error", (err) => {
    logger.error({ err: err.stack, code: "REDIS_ERROR" }, `Redis connection error`);
  });

  (async () => {
    try {
      await redisClient.connect();
      logger.info(`Successfully connected to Redis`);
    } catch (err) {
      logger.error({ err: err.stack }, `Failed to connect to Redis, falling back to in-memory Map`);
      useRedis = false;
    }
  })();
} else {
  logger.warn(`No REDIS_URL provided, using in-memory Map. Consider setting REDIS_URL for persistent session storage.`);
}

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status >= 500,
});

app.use(cors({ origin: process.env.WORDPRESS_URL }));

app.use(express.json());

/*
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin !== process.env.WORDPRESS_URL) {
    logger.warn(`Invalid origin request from ${origin}`);
    return res.status(403).json({ error: "Invalid origin", code: "INVALID_ORIGIN" });
  }
  logger.debug(`Processing request for ${req.path}: ${JSON.stringify(req.body)}`);
  next();
});
*/

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Rate limit exceeded, please try again later", code: "RATE_LIMIT_EXCEEDED" },
  }),
);

const chatSchema = Joi.object({
  text: Joi.string().trim().min(1).max(1000).required(),
  sessionId: Joi.string().uuid().required(),
});

const speakbaseSchema = Joi.object({
  text: Joi.string().trim().min(1).max(1000).required(),
  userMessage: Joi.string().trim().min(1).max(1000).optional(),
  sessionId: Joi.string().uuid().required(),
});

function detectCharacter(text) {
  if (!text || typeof text !== "string") {
    logger.debug(`No valid text provided for character detection`);
    return null;
  }

  const cleaned = text.toLowerCase().replace(/[^\w\s]/g, "");
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
    logger.warn(`Multiple characters detected in text: ${matches.join(", ")}`);
    return null;
  }

  logger.debug(`Detected character: ${matches[0] || "none"}`);
  return matches[0] || null;
}

async function setSession(sessionId, data) {
  try {
    const sessionData = JSON.stringify(data);

    if (useRedis) {
      await redisClient.setEx(sessionId, SESSION_TTL, sessionData);
    } else {
      userMemory.set(sessionId, { ...data, timestamp: Date.now() });
      setTimeout(() => userMemory.delete(sessionId), SESSION_TTL * 1000);
    }

    logger.info(`Session ${sessionId}: Successfully set data ${sessionData}`);
  } catch (error) {
    logger.error({ error: error.stack, code: "SESSION_SET_ERROR" }, `Failed to set session ${sessionId}`);
    throw error;
  }
}

async function getSession(sessionId) {
  try {
    let data = useRedis ? await redisClient.get(sessionId) : userMemory.get(sessionId);

    if (useRedis && data) {
      data = JSON.parse(data);
    } else if (!useRedis && data) {
      data = { character: data.character, studentName: data.studentName };
    }

    logger.info(`Session ${sessionId}: Retrieved data ${JSON.stringify(data) || "none"}`);
    return data || null;
  } catch (error) {
    logger.error({ error: error.stack, code: "SESSION_GET_ERROR" }, `Failed to get session ${sessionId}`);
    return null;
  }
}

function storeChatHistory(sessionId, messages) {
  try {
    if (chatMemory.size >= MAX_SESSIONS && !chatMemory.has(sessionId)) {
      const oldestSession = chatMemory.keys().next().value;
      chatMemory.delete(oldestSession);
      logger.warn(`Max sessions reached, evicted oldest session ${oldestSession}`);
    }

    const sanitizedMessages = messages.map((msg) => ({
      role: msg.role,
      content: sanitizeHtml(msg.content, { allowedTags: [], allowedAttributes: {} }).slice(0, 1000),
    }));

    chatMemory.set(sessionId, sanitizedMessages.length > 12 ? sanitizedMessages.slice(-12) : sanitizedMessages);
    logger.debug(`Stored chat history for session ${sessionId}: ${JSON.stringify(sanitizedMessages)}`);
  } catch (error) {
    logger.error({ error: error.stack, code: "CHAT_HISTORY_ERROR" }, `Failed to store chat history for ${sessionId}`);
  }
}

if (!useRedis) {
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, data] of userMemory) {
      if (now - data.timestamp > SESSION_TTL * 1000) {
        userMemory.delete(sessionId);
        chatMemory.delete(sessionId);
        logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage`);
      }
    }
  }, 60 * 1000);
}

function streamlinedError(err, code) {
  const error = new Error(err.message || "OK");
  error.code = code;
  error.status = err.response?.status || 500;
  return error;
}

async function callChatbase(sessionId, messages, chatbotId, apiKey) {
  try {
    const response = await axios.post(
      "https://www.chatbase.co/api/v1/chat",
      { messages, chatbotId },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } },
    );

    logger.info(`Chatbase API call successful for session ${sessionId}`);
    return response.data?.messages?.[0]?.content || response.data?.text || "Sorry, I had trouble understanding you.";
  } catch (err) {
    logger.error({ err: err.stack, code: "CHATBASE_REQUEST_ERROR" }, `Chatbase API request failed`);
    throw streamlinedError(err, "CHATBASE_REQUEST_ERROR");
  }
}

app.get("/", (req, res) => {
  logger.info(`Root endpoint accessed`);
  res.send("🌍 Waterwheel Village - BetterChat is online!");
});

app.get("/health", async (req, res) => {
  logger.info(`Health check requested`);

  const health = { status: "ok", uptime: process.uptime(), redis: useRedis ? "connected" : "in-memory" };

  if (useRedis) {
    try {
      await redisClient.ping();
      health.redis = "connected";
    } catch (err) {
      logger.error({ err: err.stack, code: "REDIS_PING_ERROR" }, `Redis ping failed`);
      health.redis = "disconnected";
    }
  }

  res.json(health);
});

app.post("/chat", async (req, res) => {
  try {
    logger.debug(`Chat request received: ${JSON.stringify(req.body)}`);

    const { error, value } = chatSchema.validate(req.body);

    if (error) {
      logger.warn(`Invalid chat input: ${error.details[0].message}`);
      return res.status(400).json({ error: error.details[0].message, code: "INVALID_INPUT" });
    }

    const { text, sessionId } = value;
    const sanitizedText = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });

    const sessionData = await getSession(sessionId);
    const previous = chatMemory.get(sessionId) || [];
    let systemPrompt = null;

    if (sessionData?.character) {
      const prefix =
        sessionData.studentName && sessionData.character === "mcarthur"
          ? `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`
          : `You are ${sessionData.character}, a character in Waterwheel Village. Stay in character.`;

      systemPrompt = { role: "system", content: prefix };
      logger.debug(`System prompt set for character: ${sessionData.character}`);
    }

    const replyText = await callChatbase(
      sessionId,
      [...(systemPrompt ? [systemPrompt] : []), ...previous, { role: "user", content: sanitizedText }],
      process.env.CHATBASE_BOT_ID,
      process.env.CHATBASE_API_KEY,
    );

    storeChatHistory(sessionId, [
      ...previous,
      { role: "user", content: sanitizedText },
      { role: "assistant", content: replyText },
    ]);

    res.json({ text: replyText });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_SERVER_ERROR";
    logger.error({ error: error.stack, code }, `Chat endpoint failed`);
    res.status(status).json({ error: error.message, code });
  }
});

app.post("/speakbase", async (req, res) => {
  try {
    logger.debug(`Speakbase request received: ${JSON.stringify(req.body)}`);

    const { error, value } = speakbaseSchema.validate(req.body);
    if (error) {
      logger.warn(`Invalid speakbase input: ${error.details[0].message}`);
      return res.status(400).json({ error: error.details[0].message, code: "INVALID_INPUT" });
    }

    const { text, userMessage, sessionId } = value;
    const sanitizedText = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
    const sanitizedUserMessage = userMessage ? sanitizeHtml(userMessage, { allowedTags: [], allowedAttributes: {} }) : null;

    let sessionData = await getSession(sessionId);
    let detectedCharacter = sessionData?.character || DEFAULT_CHARACTER;

    // Handle character switching
    const requestedCharacter = sanitizedUserMessage ? detectCharacter(sanitizedUserMessage) : null;
    const askedToSwitch = sanitizedUserMessage?.toLowerCase().includes("talk to") || sanitizedUserMessage?.toLowerCase().includes("can i speak with");

    if (requestedCharacter && requestedCharacter !== detectedCharacter && askedToSwitch) {
      detectedCharacter = requestedCharacter;
      sessionData = { character: detectedCharacter, studentName: sessionData?.studentName || null };
      await setSession(sessionId, sessionData);
      logger.info(`Session ${sessionId}: Character switched to ${detectedCharacter}`);
    } else if (!sessionData) {
      sessionData = { character: detectedCharacter, studentName: null };
      await setSession(sessionId, sessionData);
      logger.info(`Session ${sessionId}: Defaulted to character ${detectedCharacter}`);
    } else {
      logger.debug(`Session ${sessionId}: Keeping character as ${detectedCharacter}`);
    }

    const previous = chatMemory.get(sessionId) || [];
    let replyText;

    if (detectedCharacter === "mcarthur" && previous.length === 0 && !sessionData.studentName) {
      replyText = `Welcome to the lesson! I'm Mr. McArthur. May I have your name, please?`;
      storeChatHistory(sessionId, [{ role: "assistant", content: replyText }]);
      logger.info(`Session ${sessionId}: Initiated Mr. McArthur lesson, requesting student name`);
    } else {
      if (detectedCharacter === "mcarthur" && !sessionData.studentName && sanitizedUserMessage) {
        const name = sanitizedUserMessage.match(/^[a-zA-Z\s]+$/) ? sanitizedUserMessage.trim().slice(0, 50) : null;
        if (name) {
          sessionData.studentName = name;
          await setSession(sessionId, sessionData);
          logger.info(`Session ${sessionId}: Set student name to ${name}`);
          replyText = `Great to meet you, ${name}! Let's begin the lesson. ${sanitizedText}`;
        } else {
          replyText = `I'm sorry, I didn't catch a valid name. Could you please tell me your name using only letters?`;
          storeChatHistory(sessionId, [
            ...previous,
            { role: "user", content: sanitizedUserMessage || sanitizedText },
            { role: "assistant", content: replyText },
          ]);
          logger.debug(`Session ${sessionId}: Invalid name provided, requesting again`);
        }
      } else {
        const prefix =
          sessionData.studentName && detectedCharacter === "mcarthur"
            ? `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`
            : `You are ${detectedCharacter}, a character in Waterwheel Village. Stay in character.`;

        const systemPrompt = { role: "system", content: prefix };

        replyText = await callChatbase(
          sessionId,
          [...(systemPrompt ? [systemPrompt] : []), ...previous, { role: "user", content: sanitizedUserMessage || sanitizedText }],
          process.env.CHATBASE_BOT_ID,
          process.env.CHATBASE_API_KEY,
        );

        storeChatHistory(sessionId, [
          ...previous,
          { role: "user", content: sanitizedUserMessage || sanitizedText },
          { role: "assistant", content: replyText },
        ]);
      }
    }

    const spokenText = replyText
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/(.*?)/g, "$1")
      .trim();

    if (!spokenText) {
      logger.warn(`No valid text provided for speech synthesis in session ${sessionId}`);
      return res.status(400).json({ error: "No text provided for speech", code: "NO_SPEECH_TEXT" });
    }

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
      logger.error({ error: err.stack, code: "ELEVENLABS_ERROR" }, `ElevenLabs API request failed`);
      throw streamlinedError(err, "ELEVENLABS_ERROR");
    });

    if (!voiceResponse.headers["content-type"].includes("audio")) {
      logger.error(
        { code: "INVALID_AUDIO_RESPONSE", contentType: voiceResponse.headers["content-type"] },
        `Invalid audio response from ElevenLabs`,
      );
      throw streamlinedError(new Error("Invalid audio response from ElevenLabs"), "INVALID_AUDIO_RESPONSE");
    }

    logger.info(`ElevenLabs API call successful for session ${sessionId}`);
    res.set({ "Content-Type": "audio/mpeg", "Content-Length": voiceResponse.data.length });
    res.send(voiceResponse.data);
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_SERVER_ERROR";
    logger.error({ error: error.stack, code }, `Speakbase endpoint failed`);
    res.status(status).json({ error: error.message, code });
  }
});

console.log(`Attempting to start server on port ${PORT}`);
console.log(`Attempting to start server on port ${PORT}`);
const server = app.listen(PORT, (err) => {
  if (err) {
    console.error(`Server failed to start: ${err.message}`);
    logger.error({ err: err.stack, code: "SERVER_STARTUP_ERROR" }, `Failed to start server on port ${PORT}`);
    process.exit(1);
  }
  console.log(`Server successfully started on port ${PORT}`);
  logger.info(`🚖 BetterChat server running on port ${PORT}`);
});
server.on('error', (err) => {
  console.error(`Server error: ${err.message}`);
  logger.error({ err: err.stack, code: "SERVER_ERROR" }, `Server error on port ${PORT}`);
  process.exit(1);
});
process.on("SIGTERM", async () => {
  logger.info(`Received SIGTERM, gracefully shutting down...`);
  if (redisClient) {
    await redisClient.quit();
    logger.info(`Redis connection closed`);
  }
  process.exit(0);
});