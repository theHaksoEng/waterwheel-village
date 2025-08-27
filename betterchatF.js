require('dotenv').config();
console.log('REDIS_URL:', process.env.REDIS_URL);
const express = require('express');
const axios = require('axios');
const winston = require('winston');
const axiosRetry = require('axios-retry').default;
const redis = require('redis');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const cors = require('cors'); // This is a new import.

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL = 3600; // 1 hour in seconds
const MAX_SESSIONS = 1000;

// ===== Logger setup =====
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: './logs/app.log' }),
    new winston.transports.Console(),
  ],
});

logger.info('Express app initialized');
const CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;

// ===== Global, set in main() =====
let redisClient; // will be assigned in main()
let useRedis = !!process.env.REDIS_URL;

// ===== In-memory fallbacks =====
const userMemory = new Map();
const chatMemory = new Map();

// ===== Middleware =====
const corsOptions = {
  origin: 'https://www.aaronhakso.com',
  optionsSuccessStatus: 200 // For legacy browser support
};
app.use(cors(corsOptions)); // The CORS middleware is now in the correct location.
app.use(express.json({ limit: '2mb' }));

// Rate limiting (only /chat)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: 'Too many requests, please try again later.',
});
app.use('/chat', limiter);

// ===== Axios retry setup =====
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => (error.response?.status || 0) >= 500,
});

// ===== Session helpers =====
async function setSession(sessionId, data) {
  try {
    const sessionDataToStore = { ...data, timestamp: Date.now() };
    if (useRedis && redisClient) {
      await redisClient.setEx(sessionId, SESSION_TTL, JSON.stringify(sessionDataToStore));
    } else {
      userMemory.set(sessionId, sessionDataToStore);
      setTimeout(() => {
        const stored = userMemory.get(sessionId);
        if (stored && Date.now() - stored.timestamp > SESSION_TTL * 1000) {
          userMemory.delete(sessionId);
          chatMemory.delete(sessionId);
          logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage`);
        }
      }, SESSION_TTL * 1000 + 1000);
    }
    logger.info(`Session ${sessionId}: Successfully set data ${JSON.stringify(sessionDataToStore)}`);
  } catch (error) {
    logger.error({ error: error.stack, code: 'SESSION_SET_ERROR' }, `Failed to set session ${sessionId}`);
    throw error;
  }
}

async function getSession(sessionId) {
  try {
    let data;
    if (useRedis && redisClient) {
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
    logger.info(`Session ${sessionId}: Retrieved data ${JSON.stringify(data) || 'none'}`);
    return data || null;
  } catch (error) {
    logger.error({ error: error.stack, code: 'SESSION_GET_ERROR' }, `Failed to get session ${sessionId}`);
    return null;
  }
}

async function storeChatHistory(sessionId, messages) {
  try {
    if (useRedis && redisClient) {
      await redisClient.setEx(`chat:${sessionId}`, SESSION_TTL, JSON.stringify(messages));
    } else {
      chatMemory.set(sessionId, messages);
    }
    logger.info(`Session ${sessionId}: Chat history stored`);
  } catch (error) {
    logger.error({ error: error.stack, code: 'CHAT_HISTORY_SET_ERROR' }, `Failed to store chat history for ${sessionId}`);
  }
}

async function getChatHistory(sessionId) {
  try {
    if (useRedis && redisClient) {
      const data = await redisClient.get(`chat:${sessionId}`);
      return data ? JSON.parse(data) : [];
    }
    return chatMemory.get(sessionId) || [];
  } catch (error) {
    logger.error({ error: error.stack, code: 'CHAT_HISTORY_GET_ERROR' }, `Failed to get chat history for ${sessionId}`);
    return [];
  }
}

// ===== Health endpoint =====
app.get('/health', async (req, res) => {
  logger.info('Health check requested');
  const health = {
    status: 'ok',
    uptime: process.uptime(),
    redis: useRedis ? 'connected' : 'in-memory',
    sessionCount: useRedis && redisClient ? undefined : userMemory.size,
  };

  if (useRedis && redisClient) {
    try {
      await redisClient.ping();
      health.redis = 'connected';
      if (typeof redisClient.dbsize === 'function') {
        health.sessionCount = await redisClient.dbsize();
      }
    } catch (err) {
      logger.error({ err: err.stack, code: 'REDIS_PING_ERROR' }, 'Redis ping failed');
      health.redis = 'disconnected';
    }
  }
  res.json(health);
});

// ===== History endpoint =====
app.post('/history', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    logger.error({ code: 'INVALID_SESSION_ID' }, 'No sessionId provided in /history');
    return res.status(400).json({ error: 'Session ID is required' });
  }
  const messages = await getChatHistory(sessionId);
  res.json({ messages });
});

// ===== Chat endpoint =====
app.post('/chat', async (req, res) => {
  const { text: rawText, sessionId: providedSessionId } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : '';
  const isWelcomeMessage = !sanitizedText;

  try {
    if (!sessionId) {
      logger.error({ code: 'INVALID_SESSION_ID' }, 'No sessionId provided or generated');
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Get existing session
    let sessionData = await getSession(sessionId);
    let character = sessionData?.character || 'mcarthur';

    // Welcome message for first-time sessions
    if (isWelcomeMessage && !sessionData) {
      sessionData = { character: 'mcarthur', studentName: null, studentLevel: null };
      await setSession(sessionId, sessionData);

      const welcomeMsg =
        "Welcome to Waterwheel Village, students! I'm Mr. McArthur, your teacher. What's your name? Are you a beginner, intermediate, or expert student?";
      await storeChatHistory(sessionId, [{ role: 'assistant', content: welcomeMsg }]);

      return res.json({ text: welcomeMsg, character });
    }

    // Load chat history
    let messages = await getChatHistory(sessionId);

    if (sanitizedText) {
      messages.push({ role: 'user', content: sanitizedText });
    } else if (!isWelcomeMessage && sessionData) {
      logger.info(`Session ${sessionId}: Empty text received—skipping Chatbase call`);
      return res.json({ text: '', character });
    }

    // Add system prompt for Chatbase context
    const systemPrompt = `You are ${character} in Waterwheel Village. You are a kind ESL teacher. Be brief, encouraging, and correct mistakes gently. Always ask one short follow-up question.`;
    const outboundMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // API keys
    const key = process.env.CHATBASE_API_KEY;
    const CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;

    if (!key || !CHATBOT_ID) {
      const fallback =
        "Nice to meet you! I heard: '" +
        sanitizedText +
        "'. Welcome, let's start with a simple warm-up. Can you say: 'My name is ____. I live in ____.'?";
      messages.push({ role: 'assistant', content: fallback });
      await storeChatHistory(sessionId, messages);
      return res.json({ text: fallback, character, note: 'local-fallback-no-chatbase' });
    }

    // ===== Chatbase Call =====
    try {
      const response = await axios.post(
        'https://www.chatbase.co/api/v1/chat',
        {
          chatbotId: CHATBOT_ID,
          conversationId: sessionId,
          messages: outboundMessages,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const responseText = response?.data?.text?.trim?.() || '';

      if (!responseText) {
        logger.warn(
          { code: 'CHATBASE_EMPTY_REPLY', data: response?.data },
          'Chatbase returned no content; using fallback'
        );
        const fb =
          "Thanks, got it! Let’s practice: say, 'I am a beginner. I want to learn about ____.' What topic interests you today?";
        messages.push({ role: 'assistant', content: fb });
        await storeChatHistory(sessionId, messages);
        return res.json({ text: fb, character, note: 'fallback-empty-reply' });
      }

      // Save Chatbase reply to history
      messages.push({ role: 'assistant', content: responseText });

      // Capture student info if mentioned
      if (sanitizedText.includes('my name is') && !sessionData?.studentName) {
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
      return res.json({ text: responseText, character });
    } catch (error) {
      const status = error.response?.status;
      let body = '';
      try {
        body =
          typeof error.response?.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response?.data);
      } catch {}
      logger.error(
        {
          error: error.stack,
          code: 'CHATBASE_ERROR',
          status,
          body: String(body).slice(0, 500),
        },
        'Error calling Chatbase API'
      );

      const fb =
        "Thanks! I understand. Let’s begin with a short exercise: tell me 3 things about yourself using simple sentences.";
      messages.push({ role: 'assistant', content: fb });
      await storeChatHistory(sessionId, messages);
      return res.json({
        text: fb,
        character,
        note: 'fallback-upstream-error',
        upstreamStatus: status,
      });
    }
  } catch (error) {
    logger.error(
      { error: error.stack, code: 'CHAT_ENDPOINT_ERROR' },
      `Error in /chat endpoint for session ${sessionId}`
    );
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== Speakbase endpoint =====
app.post('/speakbase', async (req, res) => {
  const { text, sessionId, character } = req.body || {};
  if (!text || !sessionId) {
    logger.error({ code: 'INVALID_SPEAKBASE_INPUT' }, 'Missing text or sessionId in /speakbase');
    return res.status(400).json({ error: 'Text and sessionId are required' });
  }

  try {
    // Map characters to voice IDs; fall back to env VOICE_ID
    const voiceMap = {
      mcarthur: process.env.VOICE_ID || 'your-voice-id',
    };
    const voiceId = voiceMap[character] || process.env.VOICE_ID || 'your-voice-id';

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      { text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.5 } },
      {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, Accept: 'audio/mpeg', 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    );

    const buf = Buffer.from(response.data);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', String(buf.length));
    res.set('Cache-Control', 'no-store');
    return res.send(buf);
  } catch (error) {
    const status = error.response?.status;
    const body = (() => {
      try { return error.response?.data?.toString?.() || ''; } catch { return ''; }
    })();
    logger.error({ error: error.stack, code: 'ELEVENLABS_ERROR', status, body: String(body).slice(0, 500) }, 'Error calling ElevenLabs API');
    return res.status(502).json({ error: 'Failed to generate speech', upstreamStatus: status });
  }
});

// ===== Graceful shutdown =====
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, gracefully shutting down...');
  try {
    if (redisClient && useRedis) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }
  } catch (err) {
    logger.error({ err: err.stack, code: 'REDIS_QUIT_ERROR' }, 'Error closing Redis connection');
  } finally {
    process.exit(0);
  }
});

// ===== Async startup (Option A) =====
async function main() {
  // Redis setup (optional)
  if (useRedis) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 2000;
    
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        // Here's the final, complete code you need to deploy.
        redisClient = redis.createClient({
            url: process.env.REDIS_URL,
            socket: { 
                connectTimeout: 10000,
                pingInterval: 5000,
            },
            reconnectStrategy: retries => {
                return Math.min(retries * 50, 500);
            },
        });
        
        redisClient.on('error', (err) => {
          logger.error({ err: err.stack, code: 'REDIS_CONNECTION_ERROR' }, 'Redis connection error');
        });
        
        await redisClient.connect();
        logger.info('Successfully connected to Redis');
        break; // Exit the loop on successful connection
      } catch (err) {
        if (i < MAX_RETRIES - 1) {
          logger.warn({ code: 'REDIS_CONNECT_RETRY' }, `Failed to connect to Redis, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          logger.error({ err: err.stack, code: 'REDIS_CONNECT_FAILED' }, 'Failed to connect to Redis after multiple retries, falling back to in-memory Map');
          useRedis = false; // Fallback to in-memory
        }
      }
    }
  } else {
    logger.warn('No REDIS_URL provided, using in-memory Map. Consider setting REDIS_URL for persistent session storage.');
  }

  // Start HTTP server AFTER init completes
  app.listen(PORT, () => {
    logger.info(`Server is running and listening on port ${PORT}`);
  });
}

main().catch((err) => {
  logger.error({ err: err.stack, code: 'FATAL_STARTUP' }, 'Fatal startup error');
  process.exit(1);
});