require("dotenv").config();
// console.log("Starting betterchatF.js"); // Replace with logger.info
const express = require("express");
const app = express();

app.set("trust proxy", 1);

// Simple sanitize function to clean user input - This is a custom one.
// You are also using sanitize-html, which is more robust for general HTML sanitization.
// For simple text input, sanitize-html without allowedTags/Attributes is fine.
// I'll keep your custom sanitize but note that sanitizeHtml is also used.
function sanitize(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/[&<>"']/g, (char) => ({
      "&": "&",
      "<": "<",
      ">": ">",
      '"': "", // This removes double quotes entirely, which might be undesirable for some text
      "'": "", // This removes single quotes entirely
    })[char])
    .trim();
}
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const redis = require("redis");
const pino = require("pino");
const sanitizeHtml = require("sanitize-html");
const { v4: uuidv4 } = require("uuid"); // Ensure uuid is installed: npm install uuid
// Import node-fetch for AbortController if not already available in your Node.js version
// Node.js 14.x needs node-fetch, 16.x and higher typically have fetch built-in
// If you are on Node.js < 18, you will need to `npm install node-fetch@2` or `@latest`
// and `const fetch = require('node-fetch');`
// If you are on Node.js 18+, `fetch` is global. I will assume it's available or polyfilled.

// --- OpenAI Import ---
const { OpenAI } = require("openai"); // Add this line
// --- End OpenAI Import ---

// Make sure these paths are correct, they would be relative to betterchatF.js
const { characterVoices, characterAliases, voiceSettings } = require("./config");

// --- Logger Configuration Update ---
const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug', // Set to 'debug' for more verbose logging during development
  transport: process.env.NODE_ENV === 'production' ? {
    target: "pino/file",
    options: { destination: "./logs/app.log", mkdir: true },
  } : {
    target: 'pino-pretty', // Use pino-pretty for console output in development
    options: {
      colorize: true,
    },
  },
});
// --- End Logger Configuration Update ---

const DEFAULT_CHARACTER = "mcarthur";
const SESSION_TTL = parseInt(process.env.SESSION_TTL || 60 * 60, 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || 1000, 10);

// --- New Exercise TTL and Memory Map ---
const EXERCISE_TTL = parseInt(process.env.EXERCISE_TTL || 5 * 60, 10); // e.g., 5 minutes for exercises
const exerciseMemory = new Map(); // To store exercises for checking
// --- End New Exercise TTL and Memory Map ---


const envSchema = Joi.object({
  CHATBASE_BOT_ID: Joi.string().required(),
  CHATBASE_API_KEY: Joi.string().required(),
  ELEVEN_API_KEY: Joi.string().required(),
  // ELEVEN_VOICE_ID is redundant if you're using characterVoices from config.js
  // Make sure your config.js maps character keys to voice IDs from env or hardcoded.
  // For safety, I'll keep it here, but it might not be used directly in the code.
  ELEVEN_VOICE_ID: Joi.string().optional(), // Made optional
  WORDPRESS_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().optional(),
  PORT: Joi.number().default(3000),
  // Ensuring all specific voice ENV vars are included for schema validation
  VOICE_FATIMA: Joi.string().required(),
  VOICE_IBRAHIM: Joi.string().required(),
  VOICE_ANIKA: Joi.string().required(),
  VOICE_KWAME: Joi.string().required(),
  VOICE_SOPHIA: Joi.string().required(),
  VOICE_LIANG: Joi.string().required(),
  VOICE_JOHANNES: Joi.string().required(),
  VOICE_ALEKSANDERI: Joi.string().required(),
  VOICE_NADIA: Joi.string().required(), // Assuming Nadia is still a voice to be used
  VOICE_MCARTHUR: Joi.string().required(),
  // --- New Environment Variables for Exercise Feature ---
  const envSchema = Joi.object({
    // ... existing variables
    OPENAI_API_KEY: Joi.string().optional(), // Changed to optional()
    EXERCISE_TTL: Joi.number().default(5 * 60),
  }).unknown(true);  EXERCISE_TTL: Joi.number().default(5 * 60), // New line
  // --- End New Environment Variables ---
}).unknown(true);

const PORT = process.env.PORT || 3000;
const { error: envError } = envSchema.validate(process.env, { abortEarly: false });

// --- Use logger instead of console.log for consistency ---
logger.info("Env validation result:", envError ? envError.details : "Success");
logger.info("Environment variables validated:", Object.keys(process.env).filter(k => k.startsWith("CHATBASE") || k.startsWith("ELEVEN") || k.startsWith("VOICE") || k.includes("URL") || k.includes("PORT") || k.startsWith("OPENAI") || k.includes("TTL"))); // Added OpenAI and TTL
logger.info("About to check envError");
if (envError) {
  logger.error(`Environment validation failed: ${envError.details.map(d => d.message).join(", ")}`);
  process.exit(1);
}
// --- End logger consistency update ---

// --- OpenAI Client Initialization ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
logger.info("OpenAI client initialized.");
// --- End OpenAI Client Initialization ---


logger.info("Express app initialized");
let redisClient;
let useRedis = !!process.env.REDIS_URL;
const userMemory = new Map();
const chatMemory = new Map();
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

logger.info(`Dependencies loaded: express@${require("express/package.json").version}, axios@${require("axios/package.json").version}`);
// Check if redis is installed before attempting to log its version
try {
  logger.info(`redis@${require("redis/package.json").version}`);
} catch (e) {
  logger.warn(`Redis package not found, but REDIS_URL is set. Continuing without Redis version check.`);
}


if (useRedis) {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    // Add command_timeout for Redis commands
    socket: {
        connectTimeout: 10000, // 10 seconds to connect
        // Other socket options if needed
    }
  });

  redisClient.on("error", (err) => {
    logger.error({ err: err.stack, code: "REDIS_CONNECTION_ERROR" }, `Redis connection error`);
    // Consider setting useRedis to false here to fall back to in-memory if a persistent error
    // For now, retry strategy handles transient issues.
  });

  (async () => {
    try {
      await redisClient.connect();
      logger.info(`Successfully connected to Redis`);
    } catch (err) {
      logger.error({ err: err.stack, code: "REDIS_CONNECT_FAILED" }, `Failed to connect to Redis, falling back to in-memory Map`);
      useRedis = false; // Fallback immediately if initial connection fails
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

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Rate limit exceeded, please try again later", code: "RATE_LIMIT_EXCEEDED" },
  }),
);

// --- chatSchema fix: allow empty string for initial load ---
const chatSchema = Joi.object({
  text: Joi.string().trim().allow("").min(0).max(1000).required(), // Allow empty string for initial load
  sessionId: Joi.string().uuid().required(),
});
// --- End chatSchema fix ---

const speakbaseSchema = Joi.object({
  text: Joi.string().trim().min(1).max(1000).required(),
  userMessage: Joi.string().trim().min(0).max(1000).optional(), // Changed min(1) to min(0) as it's optional
  sessionId: Joi.string().uuid().required(),
  character: Joi.string().optional(),
});

function detectCharacter(text) {
  if (!text || typeof text !== "string") {
    logger.debug(`No valid text provided for character detection.`);
    return null;
  }

  // Remove punctuation and convert to lowercase for robust matching
  const cleanedText = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");

  for (const { key, names } of characterAliases) {
    for (const name of names) {
      // Ensure the name is a whole word match or part of a very specific phrase
      const namePattern = new RegExp(`\\b${name.toLowerCase()}\\b`, 'u');
      if (cleanedText.match(namePattern)) {
        logger.debug(`Character detected: "${key}" from text: "${text}" via alias "${name}"`);
        return key;
      }
    }
  }

  logger.debug(`No specific character detected in text: "${text}". Falling back to null.`);
  return null;
}

/**
 * Extracts a student name from the given text using common patterns.
 * @param {string} text - The user's input text.
 * @returns {string|null} The extracted name, or null if not found.
 */
function extractStudentName(text) {
    const lowerText = text.toLowerCase();
    let name = null;

    // Common phrases for introducing a name
    const patterns = [
        /(?:my name is|i'm|i am)\s+([\w\s\p{L}\p{N}\-']{2,})/u, // e.g., "my name is John Doe", "i'm Jane", "i am Mary-Ann"
    ];

    for (const pattern of patterns) {
        const match = lowerText.match(pattern);
        if (match && match[1]) {
            // Capitalize first letter of each word in the name
            name = match[1].trim().split(/\s+/)
                       .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                       .join(' ');
            // Basic validation for name length and to avoid single letters or numbers
            if (name.length > 1 && !/^\d+$/.test(name)) {
                logger.debug(`Student name extracted: "${name}" from text: "${text}"`);
                return name;
            }
        }
    }
    logger.debug(`No student name detected in text: "${text}"`);
    return null;
}

// --- ADDED FUNCTION: extractStudentLevel ---
/**
 * Extracts a student level (beginner, intermediate, expert) from the given text.
 * @param {string} text - The user's input text.
 * @returns {string|null} The extracted level, or null if not found.
 */
function extractStudentLevel(text) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes("beginner") || lowerText.includes("beginning")) return "beginner"; // Added 'beginning'
    if (lowerText.includes("intermediate")) return "intermediate";
    if (lowerText.includes("expert")) return "expert";
    logger.debug(`No student level detected in text: "${text}"`);
    return null;
}
// --- END ADDED FUNCTION ---

async function setSession(sessionId, data) {
  try {
    const sessionDataToStore = { ...data, timestamp: Date.now() };

    if (useRedis) {
      await redisClient.setEx(sessionId, SESSION_TTL, JSON.stringify(sessionDataToStore));
    } else {
      userMemory.set(sessionId, sessionDataToStore);
      // Remove expired sessions to prevent memory leak
      setTimeout(() => {
        if (userMemory.has(sessionId) && (Date.now() - userMemory.get(sessionId).timestamp > SESSION_TTL * 1000)) {
          userMemory.delete(sessionId);
          chatMemory.delete(sessionId); // Also clear associated chat history
          logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage via set timeout.`);
        }
      }, SESSION_TTL * 1000 + 1000); // A bit after the TTL
    }

    logger.info(`Session ${sessionId}: Successfully set data ${JSON.stringify(sessionDataToStore)}`);
  } catch (error) {
    logger.error({ error: error.stack, code: "SESSION_SET_ERROR" }, `Failed to set session ${sessionId}`);
    throw error;
  }
}

async function getSession(sessionId) {
  try {
    let data;
    if (useRedis) {
      const redisData = await redisClient.get(sessionId);
      data = redisData ? JSON.parse(redisData) : null;
    } else {
      const storedData = userMemory.get(sessionId);
      if (storedData && (Date.now() - storedData.timestamp <= SESSION_TTL * 1000)) {
          data = storedData; // Return full storedData
      } else if (storedData) {
          userMemory.delete(sessionId);
          chatMemory.delete(sessionId); // Also clear associated chat history
          logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage during getSession.`);
          data = null;
      } else {
          data = null;
      }
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
      // Find and evict the oldest session
      const oldestSessionId = Array.from(chatMemory.keys())[0];
      chatMemory.delete(oldestSessionId);
      logger.warn(`Max sessions reached (${MAX_SESSIONS}), evicted oldest session ${oldestSessionId}`);
    }

    const sanitizedMessages = messages.map((msg) => ({
      role: msg.role,
      content: sanitizeHtml(msg.content, { allowedTags: [], allowedAttributes: {} }).slice(0, 1000),
    }));

    // Only store messages with content to avoid Chatbase errors
    const filteredMessages = sanitizedMessages.filter(msg => msg.content && msg.content.length > 0);

    chatMemory.set(sessionId, filteredMessages.length > 12 ? filteredMessages.slice(-12) : filteredMessages);
    logger.debug(`Stored chat history for session ${sessionId}: ${JSON.stringify(filteredMessages)}`);
  } catch (error) {
    logger.error({ error: error.stack, code: "CHAT_HISTORY_ERROR" }, `Failed to store chat history for ${sessionId}`);
  }
}

function streamlinedError(err, code) {
  const error = new Error(err.message || "Unknown Error");
  error.code = code;
  error.status = err.response?.status || 500;
  return error;
}

async function callChatbase(sessionId, messages, chatbotId, apiKey) {
  try {
    const response = await axios.post(
      "https://www.chatbase.co/api/v1/chat",
      { messages, chatbotId },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 30000 // Add a 30-second timeout for Chatbase API calls
      },
    );

    logger.info(`Chatbase API call successful for session ${sessionId}`);
    return response.data?.messages?.[0]?.content || response.data?.text || "Sorry, I had trouble understanding you.";
  } catch (err) {
    if (axios.isCancel(err) || err.code === 'ECONNABORTED') {
      logger.error({ err: err.message, code: "CHATBASE_TIMEOUT", sessionId }, `Chatbase API call timed out for session ${sessionId}.`);
      throw streamlinedError(new Error("Chatbase API call timed out."), "CHATBASE_TIMEOUT");
    }
    logger.error({ err: err.stack, code: "CHATBASE_REQUEST_ERROR" }, `Chatbase API request failed. Details: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
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

app.get("/session/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const sessionData = await getSession(sessionId);
    if (sessionData) {
      logger.info(`Session data requested for ${sessionId}: ${JSON.stringify(sessionData)}`);
      res.json(sessionData);
    } else {
      logger.warn(`Session data not found for ${sessionId}`);
      res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
    }
  } catch (error) {
    logger.error({ error: error.stack, code: "GET_SESSION_ENDPOINT_ERROR" }, `Failed to retrieve session data for ${sessionId}`);
    res.status(500).json({ error: "Internal server error", code: "SERVER_ERROR" });
  }
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

    // Retrieve existing session data
    const sessionData = await getSession(sessionId) || {};

    let botReplyText = "";
    let isWelcomeMessage = false;

    // 1. Initial Welcome message from Mr. McArthur when frontend sends empty string on new session.
    // Also, if session is new or character somehow got unset AND frontend sends empty text
    if ((!sessionData.character || !sessionData.studentName || !sessionData.studentLevel) && text === "") {
        logger.info(`New/Reset session ${sessionId}: Sending initial welcome message from Mr. McArthur due to empty text and missing session info.`);
        sessionData.character = DEFAULT_CHARACTER;
        sessionData.studentName = null; // Ensure these are reset on "new" session condition
        sessionData.studentLevel = null;
        await setSession(sessionId, sessionData); // Save character for the session
        botReplyText = `Welcome to Waterwheel Village, students! I'm Mr. McArthur, your teacher. What's your name, if you'd like to share it? And are you a beginner, intermediate, or expert student?`;
        isWelcomeMessage = true;
    }
    // 2. Handle the user's first reply where they introduce themselves and their level.
    // This block is for when Mr. McArthur is the character and we still need name/level, and actual text is provided.
    else if (sessionData.character === DEFAULT_CHARACTER && (!sessionData.studentName || !sessionData.studentLevel) && text !== "") {
        const detectedName = extractStudentName(sanitizedText);
        const detectedLevel = extractStudentLevel(sanitizedText);

        let replyNeeded = false; // Flag to indicate if a specific reply is needed for name/level capture

        if (detectedName && !sessionData.studentName) {
            sessionData.studentName = detectedName;
            logger.info(`Session ${sessionId}: Student name "${detectedName}" captured.`);
            replyNeeded = true;
        }
        if (detectedLevel && !sessionData.studentLevel) {
            sessionData.studentLevel = detectedLevel;
            logger.info(`Session ${sessionId}: Student level "${detectedLevel}" captured.`);
            replyNeeded = true;
        }

        if (replyNeeded) {
            // Construct a dynamic reply based on the *current* state of sessionData
            if (sessionData.studentName && sessionData.studentLevel) {
                // --- GRAMMAR FIX: 'a' vs 'an' for student level ---
                const article = (sessionData.studentLevel === 'intermediate' || sessionData.studentLevel === 'expert') ? 'an' : 'a';
                // --- END GRAMMAR FIX ---
                botReplyText = `It's lovely to meet you, ${sessionData.studentName}! As ${article} ${sessionData.studentLevel} student, how can I help you today?`;
            } else if (sessionData.studentName && !sessionData.studentLevel) {
                // Fixed variable name: sessionName.studentName -> sessionData.studentName
                botReplyText = `It's lovely to meet you, ${sessionData.studentName}! What kind of student are you? A beginner, intermediate, or expert?`;
            } else if (!sessionData.studentName && sessionData.studentLevel) {
                const article = (sessionData.studentLevel === 'intermediate' || sessionData.studentLevel === 'expert') ? 'an' : 'a';
                botReplyText = `Oh, so you're ${article} ${sessionData.studentLevel} student! And what name should I call you?`;
            }
            // If neither name nor level were present/detected, or if it's the specific edge case of just "Fred"
            // we will let Chatbase handle it by not setting botReplyText here.
            else {
                 // Fall through to Chatbase if no specific info was detected to update session
                 botReplyText = ""; // Clear for Chatbase processing
            }

            if (botReplyText) { // Only set session and return if a specific reply was generated
                await setSession(sessionId, sessionData); // Save the updated session with name and level

                const historyForNameLevel = chatMemory.get(sessionId) || [];
                if (text !== "") {
                    historyForNameLevel.push({ role: "user", content: sanitizedText });
                }
                historyForNameLevel.push({ role: "assistant", content: botReplyText });
                storeChatHistory(sessionId, historyForNameLevel);

                return res.json({ text: botReplyText });
            }
        }
    }

    // 3. Detect character for subsequent turns or if character wasn't set after welcome/name capture.
    // This runs if no specific botReplyText was generated above.
    // ADDED LOGGING HERE
    logger.debug(`Character detection phase started. isWelcomeMessage: ${isWelcomeMessage}, botReplyText: "${botReplyText}" (length ${botReplyText.length}).`);
    logger.debug(`Current session character (before detection logic): ${sessionData.character || "N/A"}. User input text (sanitized): "${sanitizedText}".`);

    // --- IMPORTANT FIX FOR CHARACTER SWITCHING ---
    // The detectCharacter(sanitizedText) on every user input can prematurely change the bot's persona.
    // We want the character to switch only when Chatbase explicitly "directs" the conversation
    // to a new character, or when the user explicitly "I want to talk to X".
    // For now, to stop the premature switching, we'll *prevent* `sessionData.character` from being
    // updated by `detectCharacter` based solely on the user's general input.
    // Chatbase's response will implicitly change the character's voice in /speakbase if the text
    // generated is from a new character.
    //
    // The primary way character should change is that Chatbase's response itself is for a new character.
    // We will revisit explicit character switching if needed later.
    if (!isWelcomeMessage && !botReplyText) {
      const detectedCharacter = detectCharacter(sanitizedText);
      logger.debug(`'detectCharacter("${sanitizedText}")' returned: "${detectedCharacter}".`);

      // Prevent user input like "who can I talk to" from changing the character.
      // The `sessionData.character` should be managed by the Chatbase response for now,
      // or a very explicit user command.
      // If the character is currently default (McArthur) and user asks "who can I talk to",
      // Chatbase replies as McArthur, listing options. The character should only change
      // when the user *selects* a character to talk to.
      //
      // If Chatbase outputs a response that clearly starts as a new character's intro,
      // *then* the /speakbase endpoint's logic can correctly pick it up.
      if (detectedCharacter && detectedCharacter !== sessionData.character) {
        logger.warn(`Character "${detectedCharacter}" was detected in user input ("${sanitizedText}"), but NOT updating session character "${sessionData.character}". This will be handled by Chatbase response or explicit command.`);
        // TEMPORARILY COMMENTING OUT THESE LINES TO PREVENT PREMATURE CHARACTER SWITCH
        // sessionData.character = detectedCharacter;
        // await setSession(sessionId, sessionData);
        // logger.info(`Session ${sessionId}: Character updated to "${detectedCharacter}" from user input.`);
      } else if (!sessionData.character) {
        // This case should ideally mean a very fresh session that wasn't caught by welcome message
        // or a session where character was explicitly unset. Default to McArthur.
        sessionData.character = DEFAULT_CHARACTER;
        await setSession(sessionId, sessionData);
        logger.info(`Session ${sessionId}: Default character "${DEFAULT_CHARACTER}" set as no character detected and no character in session.`);
      }
    }
    logger.debug(`After character detection phase, session character is now: ${sessionData.character || "N/A"}.`);
    // --- END IMPORTANT FIX FOR CHARACTER SWITCHING ---


    // 4. Call Chatbase if no specific welcome/name/level reply was generated.
    if (!isWelcomeMessage && !botReplyText) { // Ensure botReplyText is still empty
      const previousRaw = chatMemory.get(sessionId) || [];
      // Filter out any messages with empty content from previous history before sending to Chatbase
      const previous = previousRaw.filter(msg => msg.content && msg.content.length > 0);
      let systemPrompt = null;

      let prefix = "";
      // Ensure sessionData.character is set BEFORE attempting to build prefix.
      // If it's still null here, default it to DEFAULT_CHARACTER to proceed with Chatbase.
      if (!sessionData.character) {
          sessionData.character = DEFAULT_CHARACTER;
          logger.warn(`sessionData.character was null before Chatbase call, defaulting to "${DEFAULT_CHARACTER}".`);
      }


      if (sessionData.character) {
          // More robust article selection for system prompt
          const studentArticle = (sessionData.studentLevel === 'intermediate' || sessionData.studentLevel === 'expert') ? 'an' : 'a';

          if (sessionData.character === DEFAULT_CHARACTER && sessionData.studentName && sessionData.studentLevel) {
              prefix = `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. They are ${studentArticle} ${sessionData.studentLevel} student. Stay in character.`;
          } else if (sessionData.character === DEFAULT_CHARACTER && sessionData.studentName) {
              prefix = `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`;
          } else if (sessionData.character === DEFAULT_CHARACTER && sessionData.studentLevel) {
              prefix = `You are Mr. McArthur, a teacher in Waterwheel Village. The student is ${studentArticle} ${sessionData.studentLevel} student. Stay in character.`;
          } else if (sessionData.studentName && sessionData.studentLevel) {
              // Retrieve the character's full name/role from characterAliases for the prompt
              const characterInfo = characterAliases.find(c => c.key === sessionData.character);
              const characterDisplayName = characterInfo ? characterInfo.names[0] : sessionData.character; // Use first alias name or key
              prefix = `You are ${characterDisplayName}, a character in Waterwheel Village. Address the student as ${sessionData.studentName}. They are ${studentArticle} ${sessionData.studentLevel} student. Stay in character.`;
          } else if (sessionData.studentName) {
              const characterInfo = characterAliases.find(c => c.key === sessionData.character);
              const characterDisplayName = characterInfo ? characterInfo.names[0] : sessionData.character;
              prefix = `You are ${characterDisplayName}, a character in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`;
          } else if (sessionData.studentLevel) {
              const characterInfo = characterAliases.find(c => c.key === sessionData.character);
              const characterDisplayName = characterInfo ? characterInfo.names[0] : sessionData.character;
              prefix = `You are ${characterDisplayName}, a character in Waterwheel Village. The student is ${studentArticle} ${sessionData.studentLevel} student. Stay in character.`;
          } else {
              const characterInfo = characterAliases.find(c => c.key === sessionData.character);
              const characterDisplayName = characterInfo ? characterInfo.names[0] : sessionData.character;
              prefix = `You are ${characterDisplayName}, a character in Waterwheel Village. Stay in character.`;
          }
      } else {
          // This case should ideally not be hit after the initial character setting logic.
          prefix = "You are a helpful assistant in Waterwheel Village. Stay in character."; // Fallback, though sessionData.character should now be set
      }
      systemPrompt = { role: "system", content: prefix };
      logger.debug(`System prompt set for character: ${sessionData.character}`);

      const replyMessages = [...(systemPrompt ? [systemPrompt] : []), ...previous, { role: "user", content: sanitizedText }];
      logger.debug(`Calling Chatbase with messages: ${JSON.stringify(replyMessages)}`);

      botReplyText = await callChatbase(
        sessionId,
        replyMessages,
        process.env.CHATBASE_BOT_ID,
        process.env.CHATBASE_API_KEY
      );

      // --- Post-Chatbase Character Update Logic ---
      // After Chatbase generates a reply, check if that reply indicates a character switch.
      // This is crucial: Chatbase is providing the *response text*. If that response text
      // says "You are now talking to Kwame", then we update the character.
      // This is still using `detectCharacter` on the *bot's reply*, which may or may not be explicit enough.
      // A more robust solution would involve Chatbase generating a specific JSON structure for intent.
      // For now, let's try to detect the character *from the bot's generated reply*.
      const detectedCharacterInBotReply = detectCharacter(botReplyText);
      logger.debug(`Character detected in Chatbase's reply: "${detectedCharacterInBotReply || "None"}" for session ${sessionId}.`);

      // ONLY update session character if the bot's *own reply* explicitly mentions
      // a new character (e.g., "You are now talking to Kwame").
      // This logic relies on Chatbase generating specific phrasing.
      // If Chatbase just starts talking *as* Kwame without saying "You are talking to Kwame",
      // this won't trigger a switch here.
      if (detectedCharacterInBotReply && detectedCharacterInBotReply !== sessionData.character) {
          sessionData.character = detectedCharacterInBotReply;
          await setSession(sessionId, sessionData);
          logger.info(`Session ${sessionId}: Character updated to "${detectedCharacterInBotReply}" based on Chatbase's reply text.`);
      }
      // --- End Post-Chatbase Character Update Logic ---

    }

    // Always store the history of the current interaction
    const finalHistoryMessages = chatMemory.get(sessionId) || [];

    // Add current user message if it's not the initial empty trigger
    if (text !== "") { // Use original 'text' here, as 'sanitizedText' might be empty after sanitizing if input was just spaces
        finalHistoryMessages.push({ role: "user", content: sanitizedText });
    }

    finalHistoryMessages.push({ role: "assistant", content: botReplyText });

    storeChatHistory(sessionId, finalHistoryMessages);

    res.json({ text: botReplyText });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_SERVER_ERROR";
    logger.error({ error: error.stack, code }, `Chat endpoint failed`);
    res.status(status).json({ error: error.message, code });
  }
});


// === MODIFIED app.post("/speakbase") ===
app.post("/speakbase", async (req, res) => {
  // Validate incoming request body with Joi schema
  const { error: validationError, value } = speakbaseSchema.validate(req.body);
  if (validationError) {
    logger.warn(`Invalid speakbase input: ${validationError.details[0].message}`);
    return res.status(400).json({ error: validationError.details[0].message, code: "INVALID_INPUT" });
  }

  const { text, sessionId, character: frontendCharacter } = value;
  const botReplyForSpeech = text;

  logger.info(`🔉 /speakbase route hit for session ${sessionId}. Text: "${botReplyForSpeech.substring(0, Math.min(botReplyForSpeech.length, 50))}..."`);
  logger.debug(`Requested Character (from frontend): "${frontendCharacter}"`);

  let finalCharacterKey = frontendCharacter;

  // IMPORTANT: Backend should primarily determine character from session for consistency.
  const sessionData = await getSession(sessionId); // Fetch session data here
  if (sessionData && sessionData.character) {
      finalCharacterKey = sessionData.character; // Use character from session if available
      logger.debug(`Using character from session for speech: "${finalCharacterKey}"`);
  } else if (!finalCharacterKey) {
    // If no character from session and no character from frontend, try to detect from text
    // This part should primarily catch the *initial* detection from a new bot reply
    // if the Chatbase response *implicitly* changed character without explicit session update.
    const detectedCharacterFromText = detectCharacter(botReplyForSpeech);
    finalCharacterKey = detectedCharacterFromText || DEFAULT_CHARACTER;
    logger.info(`No session or frontend character. Detected from text: "${detectedCharacterFromText || 'None'}", Final character for speech: "${finalCharacterKey}"`);
  } else {
    // Frontend provided a character, but no session character. Validate it against known characters.
    if (!Object.keys(characterVoices).includes(finalCharacterKey)) {
        logger.warn(`Frontend requested character "${finalCharacterKey}" not found in characterVoices. Falling back to default.`);
        finalCharacterKey = DEFAULT_CHARACTER;
    }
    logger.debug(`Using frontend-provided character: "${finalCharacterKey}" for speech (no session character).`);
  }

  // Get voiceId from the characterVoices object (from config.js)
  let voiceId = characterVoices[finalCharacterKey];
  const voiceSettingsForCharacter = voiceSettings[finalCharacterKey] || voiceSettings.default;

  if (!voiceId) {
    logger.error({ character: finalCharacterKey }, `No voice ID found in config for character "${finalCharacterKey}". Falling back to ${DEFAULT_CHARACTER}.`);
    // Fallback to default character's voice if the specific one is not found
    voiceId = characterVoices[DEFAULT_CHARACTER] || process.env.VOICE_MCARTHUR;
    if (!voiceId) { // If even default is not found (shouldn't happen with validation)
      logger.error(`FATAL: No valid voice ID found for any character, including default "${DEFAULT_CHARACTER}".`);
      return res.status(500).json({ error: `No valid voice ID found for any character.` });
    }
    finalCharacterKey = DEFAULT_CHARACTER; // Update character key to match the voice used
  }

  if (!process.env.ELEVEN_API_KEY) {
    logger.error("ELEVEN_API_KEY environment variable is not set.");
    return res.status(500).json({ error: "ElevenLabs API key is not configured." });
  }

  try {
    const controller = new AbortController();
    // Set a timeout for the ElevenLabs API call (e.g., 20 seconds)
    const timeout = 20 * 1000;
    const timeoutId = setTimeout(() => {
      controller.abort();
      logger.warn(`ElevenLabs fetch timed out after ${timeout / 1000} seconds for session ${sessionId}.`);
    }, timeout);

    const elevenlabsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "xi-api-key": process.env.ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: botReplyForSpeech,
          model_id: "eleven_multilingual_v2", // Assuming this is the correct model
          voice_settings: {
            stability: voiceSettingsForCharacter.stability,
            similarity_boost: voiceSettingsForCharacter.similarity_boost,
          },
        }),
        signal: controller.signal // Apply the abort signal
      }
    );

    clearTimeout(timeoutId); // Clear the timeout if the fetch completes within the time

    if (!elevenlabsRes.ok) {
      const errorText = await elevenlabsRes.text();
      // --- Improved ElevenLabs error logging ---
      logger.error({
        status: elevenlabsRes.status,
        details: errorText,
        character: finalCharacterKey,
        voiceId: voiceId,
        textSample: botReplyForSpeech.substring(0, Math.min(botReplyForSpeech.length, 100)), // Log first 100 chars
        code: "ELEVENLABS_NON_OK_RESPONSE"
      }, `ElevenLabs API returned non-OK status for session ${sessionId}.`);
      // --- End Improved ElevenLabs error logging ---
      return res.status(elevenlabsRes.status).json({
        error: "Failed to generate speech from ElevenLabs.",
        details: errorText,
      });
    }

    const audioBuffer = await elevenlabsRes.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
    logger.info(`🔊 Speech generated successfully for session ${sessionId}.`);

  } catch (error) {
    // Log specific error if timeout or network issue occurs
    if (error.name === 'AbortError') {
      logger.error(
        { error: error.message, code: "ELEVENLABS_TIMEOUT", character: finalCharacterKey, voiceId: voiceId, textSample: botReplyForSpeech.substring(0, Math.min(botReplyForSpeech.length, 100)) },
        `ElevenLabs API call timed out for session ${sessionId}.`
      );
      res.status(504).json({ error: "Speech generation timed out." }); // 504 Gateway Timeout
    } else {
      logger.error(
        { error: error.stack, code: "ELEVENLABS_API_CALL_ERROR", character: finalCharacterKey, voiceId: voiceId, textSample: botReplyForSpeech.substring(0, Math.min(botReplyForSpeech.length, 100)) },
        `Error during ElevenLabs API call (network or unexpected) for session ${sessionId}.`
      );
      res.status(500).json({ error: "Internal server error during speech generation." });
    }
  }
});
// === END MODIFIED app.post("/speakbase") ===

// --- Placeholder for Exercise Endpoints ---
// You will add the /generate-exercises and /check-exercises endpoints here.
// Example structure (don't uncomment this until you're ready to add the full code):
/*
app.post("/generate-exercises", async (req, res) => {
  // ... (code for exercise generation, as discussed previously)
});

app.post("/check-exercises", async (req, res) => {
  // ... (code for exercise checking, as discussed previously)
});
*/
// --- End Placeholder ---

app.listen(PORT, () => {
  logger.info(`Server is running and listening on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  logger.info(`Received SIGTERM, gracefully shutting down...`);
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info(`Redis connection closed`);
    } catch (err) {
      logger.error({ err: err.stack, code: "REDIS_QUIT_ERROR" }, `Error closing Redis connection on SIGTERM`);
    }
  }
  process.exit(0);
});