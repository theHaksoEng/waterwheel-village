// betterchat.js — Fully integrated character lock and memory-aware /speakbase

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const redis = require("redis");
const pino = require("pino");
const logger = pino();

const DEFAULT_CHARACTER = "sophia";

const requiredEnvVars = [
  "CHATBASE_BOT_ID",
  "CHATBASE_API_KEY",
  "ELEVEN_API_KEY",
  "ELEVEN_VOICE_ID",
  "WORDPRESS_URL",
  "VOICE_FATIMA",
  "VOICE_IBRAHIM",
  "VOICE_ANIKA",
  "VOICE_KWAME",
  "VOICE_SOPHIA",
  "VOICE_LIANG",
  "VOICE_JOHANNES",
  "VOICE_ALEKSANDERI",
  "VOICE_NADIA",
  "VOICE_MCARTHUR",
];

// Check for all required environment variables at startup
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required env variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();

let redisClient;
let useRedis = true;

// Initialize Redis client or fall back to in-memory
(async () => {
  if (process.env.REDIS_URL) {
    redisClient = redis.createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", (err) => {
      logger.error({ err }, "Redis error, falling back to memory for sessions.");
      useRedis = false; // Disable Redis if an error occurs
    });
    try {
      await redisClient.connect();
      logger.info("Connected to Redis successfully.");
    } catch (err) {
      logger.error({ err }, "Failed to connect to Redis, falling back to memory.");
      useRedis = false; // Fallback if connection fails
    }
  } else {
    useRedis = false;
    logger.warn("No REDIS_URL provided, using in-memory Map for sessions.");
  }
})();

// In-memory stores for sessions and chat history
const userMemory = new Map(); // Stores character lock for sessions
const chatMemory = new Map(); // Stores chat history for sessions
const SESSION_TTL = 60 * 60; // Session TTL in seconds (1 hour)

// Express Middleware
app.use(cors({ origin: process.env.WORDPRESS_URL })); // Allow requests only from WordPress URL
app.use(express.json()); // Parse JSON request bodies
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: "Too many requests, please try again after 15 minutes." },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  })
);

// Joi Schemas for request validation
const chatSchema = Joi.object({
  text: Joi.string().trim().min(1).required(),
  sessionId: Joi.string().uuid().required(),
});

const speakbaseSchema = Joi.object({
  text: Joi.string().trim().min(1).required(), // Text for chatbase response
  userMessage: Joi.string().trim().allow(""), // User's actual input for character detection
  sessionId: Joi.string().uuid().required(),
});

// Mapping of character keys to Eleven Labs voice IDs
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

// Aliases for character names to improve detection
const characterAliases = [
  { key: "fatima", names: ["fatima"] },
  { key: "ibrahim", names: ["ibrahim"] },
  { key: "anika", names: ["anika"] },
  { key: "kwame", names: ["kwame"] },
  { key: "sophia", names: ["sophia", "sophie"] },
  { key: "liang", names: ["liang"] },
  { key: "johannes", names: ["johannes"] },
  { key: "aleksanderi", names: ["aleksanderi", "alex", "alexanderi", "aleks"] },
  { key: "nadia", names: ["nadia"] },
  { key: "mcarthur", names: ["mcarthur", "aaron", "mr mcarthur"] },
];

/**
 * Detects a character from the given text based on predefined aliases.
 * Prefers explicit addressing (e.g., "talk to X", "X,")
 * @param {string} text - The input text to search for character names.
 * @returns {string|null} The key of the detected character, or null if no unambiguous character is found.
 */
function detectCharacter(text) {
  if (!text || typeof text !== "string") return null;
  const cleanedText = text.toLowerCase().trim();
  const matches = new Set(); // Use a Set to store unique character keys

  // Prioritize explicit addressing patterns
  for (const { key, names } of characterAliases) {
    for (const name of names) {
      // Look for "talk to [name]", "[name]," or "[name]?" at the beginning or after punctuation
      const explicitPattern = new RegExp(
        `^(?:talk to\\s+|speak to\\s+|ask\\s+)?\\b${name}\\b(?:[,\\?.]|\\s|$)`,
        "i"
      );
      if (explicitPattern.test(cleanedText)) {
        logger.info(`Explicit character detection: ${key} via "${name}" in "${cleanedText}"`);
        matches.add(key);
        break; // Found an explicit match for this character, move to next character
      }
    }
  }

  // If exactly one explicit match, return it
  if (matches.size === 1) {
    return Array.from(matches)[0];
  }

  // If no explicit match or multiple, try general keyword detection but with lower priority
  if (matches.size === 0) {
    for (const { key, names } of characterAliases) {
      for (const name of names) {
        // General word boundary match
        const pattern = new RegExp(`\\b${name}\\b`, "i");
        if (pattern.test(cleanedText)) {
          matches.add(key);
          break; // Found a general match for this character
        }
      }
    }
  }

  // Only return a character if there's exactly one unique match
  return matches.size === 1 ? Array.from(matches)[0] : null;
}


/**
 * Stores the active character for a given session.
 * @param {string} sessionId - The unique session identifier.
 * @param {string} character - The character key to set.
 */
async function setSessionCharacter(sessionId, character) {
  if (useRedis) {
    await redisClient.setEx(sessionId, SESSION_TTL, character);
  } else {
    userMemory.set(sessionId, character);
    // Set a timeout to clear the in-memory session if Redis is not used
    setTimeout(() => userMemory.delete(sessionId), SESSION_TTL * 1000);
  }
  logger.info(`Session ${sessionId}: Character set to ${character}`);
}

/**
 * Retrieves the active character for a given session.
 * @param {string} sessionId - The unique session identifier.
 * @returns {string|null} The character key, or null if not found.
 */
async function getSessionCharacter(sessionId) {
  const character = useRedis ? await redisClient.get(sessionId) : userMemory.get(sessionId);
  if (character) {
    logger.info(`Session ${sessionId}: Retrieved character ${character}`);
  } else {
    logger.info(`Session ${sessionId}: No character found in session.`);
  }
  return character || null;
}

/**
 * Manages chat history for a session, keeping it limited to the last N messages.
 * @param {string} sessionId - The unique session identifier.
 * @param {object} userMessage - The user's message object {role: 'user', content: '...'}.
 * @param {object} assistantMessage - The assistant's message object {role: 'assistant', content: '...'}.
 */
function updateChatHistory(sessionId, userMessage, assistantMessage) {
  let history = chatMemory.get(sessionId) || [];
  history = [...history, userMessage, assistantMessage];
  // Keep only the last 12 messages (6 user-assistant pairs)
  chatMemory.set(sessionId, history.slice(-12));
  logger.debug(`Session ${sessionId}: Chat history updated. Current length: ${chatMemory.get(sessionId).length}`);
}

/**
 * Centralized function to call the Chatbase API.
 * @param {Array<object>} messages - Array of message objects for the API.
 * @param {string} chatbotId - The Chatbase chatbot ID.
 * @param {string} apiKey - The Chatbase API key.
 * @returns {Promise<string>} The content of the assistant's reply.
 * @throws {Error} If the Chatbase API call fails.
 */
async function callChatbaseAPI(messages, chatbotId, apiKey) {
  try {
    const chatbaseResponse = await axios.post(
      "https://www.chatbase.co/api/v1/chat",
      { messages, chatbotId },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000, // 10 second timeout for Chatbase API
      }
    );
    const reply = chatbaseResponse.data?.messages?.[0]?.content || chatbaseResponse.data?.text;
    if (!reply) {
      throw new Error("Chatbase returned an empty or invalid response.");
    }
    logger.info("Chatbase API call successful.");
    return reply;
  } catch (err) {
    logger.error({ err_name: err.name, err_message: err.message, err_status: err.response?.status, err_data: err.response?.data }, "Error calling Chatbase API");
    if (err.response?.status === 401) {
        throw new Error("Authentication failed with Chatbase. Check API key.");
    } else if (err.response?.status === 400) {
        throw new Error("Chatbase request was malformed. Check message structure.");
    } else if (err.code === 'ECONNABORTED') {
        throw new Error("Chatbase API timed out. Please try again.");
    }
    throw new Error("Failed to get response from chat service. Please try again later.");
  }
}

/**
 * Centralized function to call the Eleven Labs API for text-to-speech.
 * @param {string} text - The text to convert to speech.
 * @param {string} voiceId - The Eleven Labs voice ID.
 * @param {string} apiKey - The Eleven Labs API key.
 * @returns {Promise<Buffer>} The audio data as a Buffer.
 * @throws {Error} If the Eleven Labs API call fails.
 */
async function callElevenLabsAPI(text, voiceId, apiKey) {
  try {
    const voiceResponse = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      data: {
        text: text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      },
      responseType: "arraybuffer", // Crucial for receiving binary data
      timeout: 15000, // 15 second timeout for Eleven Labs API
    });
    logger.info("Eleven Labs API call successful.");
    return voiceResponse.data;
  } catch (err) {
    logger.error({ err_name: err.name, err_message: err.message, err_status: err.response?.status, err_data: err.response?.data }, "Error calling Eleven Labs API");
    if (err.response?.status === 401) {
        throw new Error("Authentication failed with Eleven Labs. Check API key or voice ID.");
    } else if (err.response?.status === 400) {
        throw new Error("Eleven Labs request was malformed. Check text content.");
    } else if (err.code === 'ECONNABORTED') {
        throw new Error("Eleven Labs API timed out. Please try again.");
    }
    throw new Error("Failed to generate speech. Please try again later.");
  }
}

// --- Routes ---

app.get("/", (req, res) => {
  res.send("🌍 Waterwheel Village - BetterChat is online!");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/chat", async (req, res) => {
  try {
    const { error, value } = chatSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { text, sessionId } = value;
    const userMessage = { role: "user", content: text };

    let currentCharacter = await getSessionCharacter(sessionId);
    // If no character is set or detected, use the default
    const effectiveCharacter = currentCharacter || DEFAULT_CHARACTER;

    const systemPrompt = {
      role: "system",
      content: `You are ${effectiveCharacter}, a character in Waterwheel Village. Stay in this character. Do not switch roles unless explicitly asked.`,
    };

    const previousMessages = chatMemory.get(sessionId) || [];
    const messagesToSend = [systemPrompt, ...previousMessages, userMessage];

    const replyText = await callChatbaseAPI(
      messagesToSend,
      process.env.CHATBASE_BOT_ID,
      process.env.CHATBASE_API_KEY
    );

    const assistantMessage = { role: "assistant", content: replyText };
    updateChatHistory(sessionId, userMessage, assistantMessage);

    res.json({ text: replyText });
  } catch (error) {
    logger.error({ route: "/chat", error_message: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || "Failed to process chat request." });
  }
});

app.post("/speakbase", async (req, res) => {
  try {
    const { error, value } = speakbaseSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { text, userMessage, sessionId } = value; // `text` is for Eleven Labs, `userMessage` is for Chatbase + detection
    const chatbaseInput = userMessage || text; // Use userMessage for Chatbase if available, else text

    let currentCharacter = await getSessionCharacter(sessionId);
    let detectedCharacter = detectCharacter(chatbaseInput);

    // If a new character is detected from the user's input, override the session character
    if (detectedCharacter && detectedCharacter !== currentCharacter) {
      await setSessionCharacter(sessionId, detectedCharacter);
      logger.info(`Session ${sessionId}: Character switched from ${currentCharacter || 'none'} to ${detectedCharacter}.`);
      currentCharacter = detectedCharacter; // Update currentCharacter for this request
    } else if (!currentCharacter) {
      // If no character is set in session AND no new one detected, set default
      await setSessionCharacter(sessionId, DEFAULT_CHARACTER);
      logger.info(`Session ${sessionId}: No character set, defaulting to ${DEFAULT_CHARACTER}.`);
      currentCharacter = DEFAULT_CHARACTER;
    }

    const effectiveCharacter = currentCharacter; // This is the character that will be used for the current interaction

    const systemPrompt = {
      role: "system",
      content: `You are ${effectiveCharacter}, a character in Waterwheel Village. Stay in this character. Do not switch roles unless explicitly asked.`,
    };

    const previousMessages = chatMemory.get(sessionId) || [];
    const messagesToSend = [systemPrompt, ...previousMessages, { role: "user", content: chatbaseInput }];

    const replyText = await callChatbaseAPI(
      messagesToSend,
      process.env.CHATBASE_BOT_ID,
      process.env.CHATBASE_API_KEY
    );

    const assistantMessage = { role: "assistant", content: replyText };
    updateChatHistory(sessionId, { role: "user", content: chatbaseInput }, assistantMessage);

    // Strip markdown before sending to Eleven Labs
    const spokenText = replyText
      .replace(/\*\*(.*?)\*\*/g, "$1") // bold
      .replace(/\*(.*?)\*/g, "$1") // italic
      .replace(/~~(.*?)~~/g, "$1") // strikethrough
      .replace(/`(.*?)`/g, "$1") // inline code
      .trim();

    if (!spokenText) {
      logger.warn(`No spoken text generated for session ${sessionId}. Chatbase reply was: "${replyText}"`);
      return res.status(400).json({ error: "Chatbot provided an empty response to speak." });
    }

    const selectedVoiceId =
      characterVoices[effectiveCharacter] ||
      characterVoices[DEFAULT_CHARACTER] ||
      process.env.ELEVEN_VOICE_ID;

    const audioBuffer = await callElevenLabsAPI(
      spokenText,
      selectedVoiceId,
      process.env.ELEVEN_API_KEY
    );

    res.set({ "Content-Type": "audio/mpeg", "Content-Length": audioBuffer.length });
    res.send(audioBuffer);
  } catch (error) {
    logger.error({ route: "/speakbase", error_message: error.message, stack: error.stack });
    // Use the error message from the helper functions, or a generic one
    res.status(500).json({ error: error.message || "Failed to process speak request." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`🚀 BetterChat running on port ${PORT}`));

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Gracefully shutting down...");
  if (redisClient && redisClient.isOpen) { // Check if client is open before quitting
    await redisClient.quit();
    logger.info("Redis client disconnected.");
  }
  process.exit(0);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ promise, reason }, "Unhandled Rejection at:");
  // Application specific logging, throwing an error, or other logic here
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught Exception:");
  process.exit(1); // mandatory exit after uncaught exception
});