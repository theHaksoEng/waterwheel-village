const express = require("express");
const axios = require("axios");
const winston = require("winston");
const axiosRetry = require("axios-retry").default;
const redis = require("redis");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL = 3600; // 1 hour in seconds
const MAX_SESSIONS = 1000;

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "./logs/app.log" }),
    new winston.transports.Console()
  ],
});

logger.info("Express app initialized");

// Redis setup
let redisClient;
let useRedis = !!process.env.REDIS_URL;

if (useRedis) {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 10000 },
  });
  redisClient.on("error", (err) => {
    logger.error({ err: err.stack, code: "REDIS_CONNECTION_ERROR" }, "Redis connection error");
    useRedis = false;
  });
  (async () => {
    try {
      await redisClient.connect();
      logger.info("Successfully connected to Redis");
    } catch (err) {
      logger.error({ err: err.stack, code: "REDIS_CONNECT_FAILED" }, "Failed to connect to Redis, falling back to in-memory Map");
      useRedis = false;
    }
  })();
} else {
  logger.warn("No REDIS_URL provided, using in-memory Map.");
}

// In-memory fallback
const userMemory = new Map();
const chatMemory = new Map();

// Rate limiting
const rateLimit = require("express-rate-limit");
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: "Too many requests, please try again later.",
});
app.use("/chat", limiter);

// Middleware
app.use(express.json());

// Axios retry setup
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => error.response?.status >= 500,
});

// Session management
async function setSession(sessionId, data) {
  try {
    const sessionDataToStore = { ...data, timestamp: Date.now() };
    if (useRedis) {
      await redisClient.setEx(sessionId, SESSION_TTL, JSON.stringify(sessionDataToStore));
    } else {
      userMemory.set(sessionId, sessionDataToStore);
      setTimeout(() => {
        if (userMemory.has(sessionId) && (Date.now() - userMemory.get(sessionId).timestamp > SESSION_TTL * 1000)) {
          userMemory.delete(sessionId);
          chatMemory.delete(sessionId);
          logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage`);
        }
      }, SESSION_TTL * 1000 + 1000);
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
      if (storedData && Date.now() - storedData.timestamp <= SESSION_TTL * 1000) {
        data = storedData;
      } else if (storedData) {
        userMemory.delete(sessionId);
        chatMemory.delete(sessionId);
        logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage during getSession`);
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

async function storeChatHistory(sessionId, messages) {
  try {
    if (useRedis) {
      await redisClient.setEx(`chat:${sessionId}`, SESSION_TTL, JSON.stringify(messages));
    } else {
      chatMemory.set(sessionId, messages);
    }
    logger.info(`Session ${sessionId}: Chat history stored`);
  } catch (error) {
    logger.error({ error: error.stack, code: "CHAT_HISTORY_SET_ERROR" }, `Failed to store chat history for ${sessionId}`);
  }
}

async function getChatHistory(sessionId) {
  try {
    if (useRedis) {
      const data = await redisClient.get(`chat:${sessionId}`);
      return data ? JSON.parse(data) : [];
    }
    return chatMemory.get(sessionId) || [];
  } catch (error) {
    logger.error({ error: error.stack, code: "CHAT_HISTORY_GET_ERROR" }, `Failed to get chat history for ${sessionId}`);
    return [];
  }
}

// Health endpoint
app.get("/health", async (req, res) => {
  logger.info("Health check requested");
  const health = {
    status: "ok",
    uptime: process.uptime(),
    redis: useRedis ? "connected" : "in-memory",
    sessionCount: useRedis ? await redisClient.dbsize() : userMemory.size,
  };
  if (useRedis) {
    try {
      await redisClient.ping();
      health.redis = "connected";
    } catch (err) {
      logger.error({ err: err.stack, code: "REDIS_PING_ERROR" }, "Redis ping failed");
      health.redis = "disconnected";
    }
  }
  res.json(health);
});

// History endpoint
app.post("/history", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    logger.error({ code: "INVALID_SESSION_ID" }, "No sessionId provided in /history");
    return res.status(400).json({ error: "Session ID is required" });
  }
  const messages = await getChatHistory(sessionId);
  res.json({ messages });
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  const { text: rawText, sessionId: providedSessionId } = req.body;
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : "";
  const isWelcomeMessage = !sanitizedText;

  try {
    if (!sessionId) {
      logger.error({ code: "INVALID_SESSION_ID" }, "No sessionId provided or generated");
      return res.status(400).json({ error: "Session ID is required" });
    }

    // Skip empty text for ongoing sessions
    let sessionData = await getSession(sessionId);
    if (!sanitizedText && !isWelcomeMessage && sessionData) {
      logger.info(`Session ${sessionId}: Empty text received—skipping Chatbase call`);
      return res.json({ text: "", character: sessionData.character });
    }

    let messages = await getChatHistory(sessionId);
    let character = sessionData?.character || "mcarthur";

    if (isWelcomeMessage && !sessionData) {
      sessionData = { character: "mcarthur", studentName: null, studentLevel: null };
      await setSession(sessionId, sessionData);
      messages.push({
        role: "assistant",
        content: "Welcome to Waterwheel Village, students! I'm Mr. McArthur, your teacher. What's your name? Are you a beginner, intermediate, or expert student?",
      });
      await storeChatHistory(sessionId, messages);
      return res.json({ text: messages[messages.length - 1].content, character });
    }

    if (sanitizedText) {
      messages.push({ role: "user", content: sanitizedText });
    }

    const prompt = `You are ${character} in Waterwheel Village...`; // Customize as needed
    try {
      const response = await axios.post(
        "https://api.chatbase.io/v1/chat/completions",
        {
          model: "mistral-7b",
          messages,
          max_tokens: 150,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.CHATBASE_API_KEY}`,
          },
          timeout: 30000,
        }
      );

      const responseText = response.data.choices[0].message.content.trim();
      messages.push({ role: "assistant", content: responseText });

      if (sanitizedText.includes("my name is") && !sessionData?.studentName) {
        const nameMatch = sanitizedText.match(/my name is (\w+)/i);
        const levelMatch = sanitizedText.match(/I am a (beginner|intermediate|expert)/i);
        sessionData = {
          ...sessionData,
          studentName: nameMatch ? nameMatch[1] : sessionData?.studentName,
          studentLevel: levelMatch ? levelMatch[1] : sessionData?.studentLevel,
          character,
        };
        await setSession(sessionId, sessionData);
      }

      await storeChatHistory(sessionId, messages);
      res.json({ text: responseText, character });
    } catch (error) {
      logger.error({ error: error.stack, code: "CHATBASE_ERROR" }, "Error calling Chatbase API");
      res.status(500).json({ error: "Failed to process chat request" });
    }
  } catch (error) {
    logger.error({ error: error.stack, code: "CHAT_ENDPOINT_ERROR" }, `Error in /chat endpoint for session ${sessionId}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Speakbase endpoint
app.post("/speakbase", async (req, res) => {
  const { text, sessionId, character } = req.body;
  if (!text || !sessionId) {
    logger.error({ code: "INVALID_SPEAKBASE_INPUT" }, "Missing text or sessionId in /speakbase");
    return res.status(400).json({ error: "Text and sessionId are required" });
  }

  try {
    const voiceId = character === "mcarthur" ? "your-voice-id" : "another-voice-id"; // Customize
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      { text, voice_settings: { stability: 0.5, similarity_boost: 0.5 } },
      {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
        responseType: "arraybuffer",
      }
    );
    res.set("Content-Type", "audio/mpeg");
    res.send(response.data);
  } catch (error) {
    logger.error({ error: error.stack, code: "ELEVENLABS_ERROR" }, "Error calling ElevenLabs API");
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, gracefully shutting down...");
  if (redisClient && useRedis) {
    try {
      await redisClient.quit();
      logger.info("Redis connection closed");
    } catch (err) {
      logger.error({ err: err.stack, code: "REDIS_QUIT_ERROR" }, "Error closing Redis connection");
    }
  }
  process.exit(0);
});

app.listen(PORT, () => {
  logger.info(`Server is running and listening on port ${PORT}`);
});