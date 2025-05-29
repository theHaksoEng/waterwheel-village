require("dotenv").config();
const express = require("express");
const axios = require("axios");
const axiosRetry = require("axios-retry").default; // Fixed import
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const redis = require("redis");
const pino = require("pino");
const sanitizeHtml = require("sanitize-html");
const { v4: uuidv4 } = require("uuid");

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino/file',
    options: { destination: './logs/app.log' }
  }
});
const DEFAULT_CHARACTER = "sophia";
const SESSION_TTL = parseInt(process.env.SESSION_TTL || 60 * 60, 10);
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

// Redis setup
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

  redisClient.on("error", (err) => logger.error({ err: err.stack }, "Redis connection error"));
  (async () => {
    try {
      await redisClient.connect();
      logger.info("Connected to Redis");
    } catch (err) {
      logger.error({ err: err.stack }, "Failed to connect to Redis, using in-memory Map");
      useRedis = false;
    }
  })();
} else {
  logger.warn("No REDIS_URL provided, using in-memory Map. Consider setting REDIS_URL for persistent session storage.");
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
  logger.debug(`Processing request for ${req.path}: ${JSON.stringify(req.body)}`);
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
    logger.error({ error: error.stack, code }, "Chat endpoint failed");
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
      replyText = "Welcome to the lesson! I'm Mr. McArthur. May I have your name, please?";
      storeChatHistory(sessionId, [{ role: "assistant", content: replyText }]);
    } else {
      if (detectedCharacter === 'mcarthur' && !sessionData.studentName && sanitizedUserMessage) {
        const name = sanitizedUserMessage.match(/^[a-zA-Z\s]+$/) ? sanitizedUserMessage.trim().slice(0, 50) : null;
        if (name) {
          sessionData.studentName = name;
          await setSession(sessionId, sessionData);
          logger.info(`Session ${sessionId}: Student name set to ${name}`);
          replyText = `Great to meet you, ${name}! Let's begin the lesson. ${sanitizedText}`;
        } else {
          replyText = "I'm sorry, I didn't catch a valid name. Could you please tell me your name using only letters?";
          storeChatHistory(sessionId, [
            ...previous,
            { role: "user", content: sanitizedUserMessage || Monograph
System: It looks like your message was cut off at the end, ending with "Monograph". I assume you intended to continue the conversation about the deployment issue or the `betterchat.js` code. Since the primary focus of your message is the Render deployment log and the `TypeError: axiosRetry is not a function` error, I’ll proceed with completing the fix for the deployment issue and provide the full corrected `betterchat.js` code, incorporating the changes needed to resolve the error and enhance logging. I’ll also address the incomplete code snippet and ensure the Mr. McArthur feature (welcoming the student and using their name) is fully functional.

---

### Addressing the Deployment Error

The Render log indicates that the deployment failed because `axiosRetry` is not recognized as a function at line 80 of `betterchat.js`. This was due to an incorrect import of the `axios-retry` module. The corrected import (`require("axios-retry").default`) was provided in my previous response, and I’ve included it in the updated code below. Additionally, the log shows that the application is using in-memory storage due to the absence of a `REDIS_URL`, which we’ll address by recommending a Redis setup on Render.

To ensure a successful deployment, you need to:
1. Update the `axios-retry` import.
2. Verify that all dependencies (including `axios-retry`, `sanitize-html`, and `uuid`) are listed in `package.json` and installed.
3. Commit and push the changes.
4. Set up Redis for persistent session storage (optional but recommended).
5. Improve log management using Render CLI or a log stream.

---

### Corrected `betterchat.js`

Below is the complete, corrected version of `betterchat.js`. It includes:
- The fixed `axios-retry` import (`require("axios-retry").default`).
- Enhanced logging with file output and detailed error stacks.
- Stricter name validation for Mr. McArthur’s feature (allowing only letters and spaces).
- The Mr. McArthur welcome message and name personalization logic.
- All previous improvements (e.g., input sanitization, session management, retry logic).

<xaiArtifact artifact_id="ef79f639-6607-4460-89c5-5add7d10da95" artifact_version_id="7d81a8ea-d936-4441-9e74-b6befe7b75fb" title="betterchat.js" contentType="text/javascript">
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const axiosRetry = require("axios-retry").default; // Fixed import
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const redis = require("redis");
const pino = require("pino");
const sanitizeHtml = require("sanitize-html");
const { v4: uuidv4 } = require("uuid");

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino/file',
    options: { destination: './logs/app.log', mkdir: true }
  }
});
const DEFAULT_CHARACTER = "sophia";
const SESSION_TTL = parseInt(process.env.SESSION_TTL || 60 * 60, 10);
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

// Redis setup
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

  redisClient.on("error", (err) => logger.error({ err: err.stack }, "Redis connection error"));
  (async () => {
    try {
      await redisClient.connect();
      logger.info("Connected to Redis");
    } catch (err) {
      logger.error({ err: err.stack }, "Failed to connect to Redis, using in-memory Map");
      useRedis = false;
    }
  })();
} else {
  logger.warn("No REDIS_URL provided, using in-memory Map. Consider setting REDIS_URL for persistent session storage.");
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
  logger.debug(`Processing request for ${req.path}: ${JSON.stringify(req.body)}`);
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
    logger.error({ error: error.stack, code }, "Chat endpoint failed");
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
      replyText = "Welcome to the lesson! I'm Mr. McArthur. May I have your name, please?";
      storeChatHistory(sessionId, [{ role: "assistant", content: replyText }]);
    } else {
      if (detectedCharacter === 'mcarthur' && !sessionData.studentName && sanitizedUserMessage) {
        const name = sanitizedUserMessage.match(/^[a-zA-Z\s]+$/) ? sanitizedUserMessage.trim().slice(0, 50) : null;
        if (name) {
          sessionData.studentName = name;
          await setSession(sessionId, sessionData);
          logger.info(`Session ${sessionId}: Student name set to ${name}`);
          replyText = `Great to meet you, ${name}! Let's begin the lesson. ${sanitizedText}`;
        } else {
          replyText = "I'm sorry, I didn't catch a valid name. Could you please tell me your name using only letters?";
          storeChatHistory(sessionId, [
            ...previous,
            { role: "user", content: sanitizedUserMessage || sanitizedText },
            { role: "assistant", content: replyText },
          ]);
        }
      } else {
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
    logger.error({ error: error.stack, code }, "Speakbase endpoint failed");
    res.status(status).json({ error: error.message, code });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 BetterChat running on port ${PORT}`);
  logger.info(`Dependencies: ${JSON.stringify(require('./package.json').dependencies)}`);
});

process.on("SIGTERM", async () => {
  logger.info("Gracefully shutting down...");
  if (redisClient) await redisClient.quit();
  process.exit(0);
});