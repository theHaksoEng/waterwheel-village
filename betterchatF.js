require("dotenv").config();
console.log("Starting betterchatF.js"); // Keep this initial console.log for quick startup check
const express = require("express");
const app = express();

app.set("trust proxy", 1);

// Simple sanitize function to clean user input
function sanitize(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/[&<>"']/g, (char) => ({
      "&": "&",
      "<": "<",
      ">": ">",
      '"': "",
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
const { v4: uuidv4 } = require("uuid");
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

// --- Use logger instead of console.log for consistency ---
logger.info("Env validation result:", envError ? envError.details : "Success");
logger.info("Environment variables validated:", Object.keys(process.env).filter(k => k.startsWith("CHATBASE") || k.startsWith("ELEVEN") || k.startsWith("VOICE") || k.includes("URL") || k.includes("PORT")));
logger.info("About to check envError");
if (envError) {
  logger.error(`Environment validation failed: ${envError.details.map(d => d.message).join(", ")}`);
  process.exit(1);
}
// --- End logger consistency update ---

logger.info("Express app initialized");
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

  const cleanedText = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");

  for (const { key, names } of characterAliases) {
    for (const name of names) {
      if (cleanedText.includes(name.toLowerCase())) {
        logger.debug(`Character detected: "${key}" from text: "${text}"`);
        return key;
      }
    }
  }

  logger.debug(`No specific character detected in text: "${text}". Falling back to default.`);
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
    if (lowerText.includes("beginner")) return "beginner";
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
      setTimeout(() => userMemory.delete(sessionId), SESSION_TTL * 1000);
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
          // Retrieve character, studentName, and studentLevel from in-memory session
          data = {
              character: storedData.character,
              studentName: storedData.studentName,
              studentLevel: storedData.studentLevel // <-- Include studentLevel here
          };
      } else if (storedData) {
          userMemory.delete(sessionId);
          chatMemory.delete(sessionId);
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

// ... (rest of your code remains the same) ...

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
    if (!sessionData.character && !sessionData.studentName && !sessionData.studentLevel && text === "") {
        logger.info(`New session ${sessionId}: Sending initial welcome message from Mr. McArthur.`);
        sessionData.character = DEFAULT_CHARACTER;
        await setSession(sessionId, sessionData); // Save character for the session
        botReplyText = `Welcome to Waterwheel Village, students! I'm Mr. McArthur, your teacher. What's your name, if you'd like to share it? And are you a beginner, intermediate, or expert student?`;
        isWelcomeMessage = true;
    }
    // 2. Handle the user's first reply where they introduce themselves and their level.
    // This block is for when Mr. McArthur is the character and we still need name/level.
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
                 botReplyText = `It's lovely to meet you, ${sessionData.studentName}! As an ${sessionData.studentLevel} student, how can I help you today?`;
            } else if (sessionData.studentName && !sessionData.studentLevel) {
                botReplyText = `It's lovely to meet you, ${sessionData.studentName}! What kind of student are you? A beginner, intermediate, or expert?`;
            } else if (!sessionData.studentName && sessionData.studentLevel) {
                botReplyText = `Oh, so you're an ${sessionData.studentLevel} student! And what name should I call you?`;
            }
            // If neither name nor level were present/detected, fall through.
            // This 'else' case should ideally not be hit if replyNeeded is true,
            // as at least one of name/level would have been detected.
            else {
                botReplyText = "I received your message, but I'm still waiting to hear your name and level. Can you tell me?";
            }

            await setSession(sessionId, sessionData); // Save the updated session with name and level

            // Store this auto-generated reply immediately to prevent Chatbase from overriding
            storeChatHistory(sessionId, [
                ...(chatMemory.get(sessionId) || []),
                { role: "user", content: sanitizedText },
                { role: "assistant", content: botReplyText }
            ]);
            return res.json({ text: botReplyText }); // Send this response immediately
        }
        // If `replyNeeded` is false, it means no new name or level was captured/needed,
        // so the input should go to Chatbase. Fall through.
    }

    // 3. Detect character for subsequent turns or if character wasn't set.
    // This happens IF a custom reply wasn't generated above (i.e., not a welcome or name/level intro)
    if (!isWelcomeMessage && !botReplyText) { // Check if botReplyText was NOT set by the above blocks
      const detectedCharacter = detectCharacter(sanitizedText);
      if (detectedCharacter && detectedCharacter !== sessionData.character) {
        sessionData.character = detectedCharacter;
        await setSession(sessionId, sessionData);
        logger.info(`Session ${sessionId}: Character updated to "${detectedCharacter}" from user input.`);
      } else if (!sessionData.character) {
        sessionData.character = DEFAULT_CHARACTER;
        await setSession(sessionId, sessionData);
        logger.info(`Session ${sessionId}: Default character "${DEFAULT_CHARACTER}" set as no character detected and no character in session.`);
      }
    }

    // 4. Call Chatbase if no specific welcome/name/level reply was generated.
    if (!isWelcomeMessage && !botReplyText) { // This condition ensures Chatbase is only called if no prior auto-reply was sent
      const previous = chatMemory.get(sessionId) || [];
      let systemPrompt = null;

      let prefix = "";
      if (sessionData.character) {
          if (sessionData.character === DEFAULT_CHARACTER && sessionData.studentName && sessionData.studentLevel) {
              prefix = `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. They are an ${sessionData.studentLevel} student. Stay in character.`;
          } else if (sessionData.character === DEFAULT_CHARACTER && sessionData.studentName) {
              prefix = `You are Mr. McArthur, a teacher in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`;
          } else if (sessionData.character === DEFAULT_CHARACTER && sessionData.studentLevel) {
              prefix = `You are Mr. McArthur, a teacher in Waterwheel Village. The student is an ${sessionData.studentLevel} student. Stay in character.`;
          } else if (sessionData.studentName && sessionData.studentLevel) {
              prefix = `You are ${sessionData.character}, a character in Waterwheel Village. Address the student as ${sessionData.studentName}. They are an ${sessionData.studentLevel} student. Stay in character.`;
          } else if (sessionData.studentName) {
              prefix = `You are ${sessionData.character}, a character in Waterwheel Village. Address the student as ${sessionData.studentName}. Stay in character.`;
          } else if (sessionData.studentLevel) {
              prefix = `You are ${sessionData.character}, a character in Waterwheel Village. The student is an ${sessionData.studentLevel} student. Stay in character.`;
          } else {
              prefix = `You are ${sessionData.character}, a character in Waterwheel Village. Stay in character.`;
          }
      } else {
          prefix = "You are a helpful assistant in Waterwheel Village. Stay in character.";
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
    }

    // Always store the history of the current interaction
    storeChatHistory(sessionId, [
      ...(chatMemory.get(sessionId) || []),
      { role: "user", content: sanitizedText },
      { role: "assistant", content: botReplyText },
    ]);

    res.json({ text: botReplyText });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_SERVER_ERROR";
    logger.error({ error: error.stack, code }, `Chat endpoint failed`);
    res.status(status).json({ error: error.message, code });
  }
});

app.post("/speakbase", async (req, res) => {
  const { text, sessionId, character: frontendCharacter } = req.body;
  const botReplyForSpeech = text;

  if (!botReplyForSpeech) {
    return res.status(400).json({ error: "Text is required for speech generation." });
  }

  logger.info(`🔉 /speakbase route hit for session ${sessionId}. Text: "${botReplyForSpeech.substring(0, 50)}..."`);
  logger.info(`Requested Character (from frontend): "${frontendCharacter}"`);

  let finalCharacterKey = frontendCharacter;

  // IMPORTANT: Backend should primarily determine character from session, not just frontend hint.
  // We'll fetch session data here to ensure character is consistent.
  const sessionData = await getSession(sessionId); // Fetch session data here
  if (sessionData && sessionData.character) {
      finalCharacterKey = sessionData.character; // Use character from session if available
      logger.info(`Using character from session for speech: "${finalCharacterKey}"`);
  } else if (!finalCharacterKey) {
    const detectedCharacterFromText = detectCharacter(botReplyForSpeech);
    finalCharacterKey = detectedCharacterFromText || DEFAULT_CHARACTER;
    logger.info(`No session character, and frontend did not provide. Detected from text: "${detectedCharacterFromText || 'None'}", Final character for speech: "${finalCharacterKey}"`);
  } else {
    // Frontend provided a character, but no session character. Validate it.
    if (!Object.keys(characterVoices).includes(finalCharacterKey)) {
        logger.warn(`Frontend requested character "${finalCharacterKey}" not found in characterVoices. Falling back to default.`);
        finalCharacterKey = DEFAULT_CHARACTER;
    }
    logger.info(`Using frontend-provided character: "${finalCharacterKey}" for speech (no session character).`);
  }

  let voiceId = characterVoices[finalCharacterKey];
  const voiceSettingsForCharacter = voiceSettings[finalCharacterKey] || voiceSettings.default;

  if (!voiceId) {
    logger.error(`No voice ID found for character: ${finalCharacterKey}. Falling back to ${DEFAULT_CHARACTER}.`);
    const defaultVoiceId = characterVoices[DEFAULT_CHARACTER] || process.env.VOICE_MCARTHUR;
    if (defaultVoiceId) {
      finalCharacterKey = DEFAULT_CHARACTER;
      voiceId = defaultVoiceId;
    } else {
      return res.status(500).json({ error: `No valid voice ID found for any character, including default.` });
    }
  }

  try {
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
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: voiceSettingsForCharacter.stability,
            similarity_boost: voiceSettingsForCharacter.similarity_boost,
          },
        }),
      }
    );

    if (!elevenlabsRes.ok) {
      const errorText = await elevenlabsRes.text();
      logger.error(`ElevenLabs API error for character ${finalCharacterKey}: ${elevenlabsRes.status} - ${errorText}`);
      return res.status(elevenlabsRes.status).json({
        error: "Failed to generate speech from ElevenLabs.",
        details: errorText,
      });
    }

    const audioBuffer = await elevenlabsRes.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (error) {
    logger.error({ error: error.stack, code: "ELEVENLABS_ERROR" }, "Error during ElevenLabs API call.");
    res.status(500).json({ error: "Internal server error during speech generation." });
  }
});

app.listen(PORT, () => {
  logger.info(`Server is running and listening on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  logger.info(`Received SIGTERM, gracefully shutting down...`);
  if (redisClient) {
    await redisClient.quit();
    logger.info(`Redis connection closed`);
  }
  process.exit(0);
});