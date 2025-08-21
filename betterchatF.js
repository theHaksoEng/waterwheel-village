require("dotenv").config();
const express = require("express");
const app = express();
app.set("trust proxy", 1);

function sanitize(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#x27;"
    })[char])
    .trim();
}

const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const pino = require("pino");
const sanitizeHtml = require("sanitize-html");
const { v4: uuidv4 } = require("uuid");
const { OpenAI } = require("openai");
const { characterVoices, characterAliases, voiceSettings } = require("./config");

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: process.env.NODE_ENV === 'production' ? {
    target: "pino/file",
    options: { destination: "./logs/app.log", mkdir: true }
  } : {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const DEFAULT_CHARACTER = "mcarthur";
const SESSION_TTL = parseInt(process.env.SESSION_TTL || 60 * 60, 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || 1000, 10);
const EXERCISE_TTL = parseInt(process.env.EXERCISE_TTL || 5 * 60, 10);
const exerciseMemory = new Map();
const userMemory = new Map();
const chatMemory = new Map();

const envSchema = Joi.object({
  CHATBASE_BOT_ID: Joi.string().required(),
  CHATBASE_API_KEY: Joi.string().required(),
  ELEVEN_API_KEY: Joi.string().required(),
  ELEVEN_VOICE_ID: Joi.string().optional(),
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
  OPENAI_API_KEY: Joi.string().optional(),
  EXERCISE_TTL: Joi.number().default(5 * 60)
}).unknown(true);

const PORT = process.env.PORT || 3000;
const { error: envError } = envSchema.validate(process.env, { abortEarly: false });

logger.info("Env validation result:", envError ? envError.details : "Success");
logger.info("Environment variables validated:", Object.keys(process.env).filter(k => k.startsWith("CHATBASE") || k.startsWith("ELEVEN") || k.startsWith("VOICE") || k.includes("URL") || k.includes("PORT") || k.startsWith("OPENAI") || k.includes("TTL")));
if (envError) {
  logger.error(`Environment validation failed: ${envError.details.map(d => d.message).join(", ")}`);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
logger.info("OpenAI client initialized.");

logger.info("Express app initialized");
axiosRetry(axios, { retries: 3, retryDelay: (retryCount) => retryCount * 2000 });

logger.info(`Dependencies loaded: express@${require("express/package.json").version}, axios@${require("axios/package.json").version}`);
logger.warn(`Redis disabled, using in-memory Map for session storage.`);

app.use(cors({ origin: process.env.WORDPRESS_URL }));
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: "Rate limit exceeded, please try again later", code: "RATE_LIMIT_EXCEEDED" }
  })
);

const chatSchema = Joi.object({
  text: Joi.string().trim().allow("").min(0).max(1000).required(),
  sessionId: Joi.string().uuid().required()
});

const speakbaseSchema = Joi.object({
  text: Joi.string().trim().min(1).max(1000).required(),
  userMessage: Joi.string().trim().min(0).max(1000).optional(),
  sessionId: Joi.string().uuid().required(),
  character: Joi.string().optional()
});

function detectCharacter(text, currentSessionCharacter = null) {
  if (!text || typeof text !== "string") {
    logger.debug(`detectCharacter: No valid text provided.`);
    return currentSessionCharacter;
  }

  const cleanedText = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");

  for (const charKey of Object.keys(characterVoices)) {
    const characterInfo = characterAliases.find(alias => alias.key === charKey);
    if (!characterInfo) continue;

    for (const name of characterInfo.names) {
      const lowerName = name.toLowerCase();
      const handoffPattern = new RegExp(`i\\s+(?:am|'m)\\s+${lowerName}`, 'i');
      if (handoffPattern.test(cleanedText)) {
        logger.info(`detectCharacter: Explicit handoff detected to: "${charKey}" via phrase matching "I am ${lowerName}".`);
        return charKey;
      }
    }
  }

  if (currentSessionCharacter === DEFAULT_CHARACTER) {
    const characterNamesForRegex = Object.keys(characterVoices)
      .filter(k => k !== DEFAULT_CHARACTER)
      .map(key => {
        const alias = characterAliases.find(a => a.key === key);
        return alias ? [key.toLowerCase(), ...alias.names.map(n => n.toLowerCase())].join('|') : key.toLowerCase();
      })
      .flat()
      .join('|');

    if (characterNamesForRegex) {
      const characterSuggestionRegex = new RegExp(`\\b(?:${characterNamesForRegex})\\b\\s*(\\.|!|\\?|$)`, 'i');
      const match = cleanedText.match(characterSuggestionRegex);
      if (match) {
        const suggestedCharName = match[0].toLowerCase().replace(/[\.!?,]$/,'').trim();
        const detectedKeyFromAlias = characterAliases.find(alias =>
          alias.names.some(n => suggestedCharName === n.toLowerCase() || suggestedCharName === alias.key.toLowerCase())
        )?.key;

        if (detectedKeyFromAlias && detectedKeyFromAlias !== DEFAULT_CHARACTER) {
          logger.debug(`detectCharacter: McArthur suggested character at end of response: "${detectedKeyFromAlias}".`);
          return detectedKeyFromAlias;
        }
      }
    }
  }

  if (currentSessionCharacter) {
    logger.debug(`detectCharacter: No explicit character switch detected. Maintaining current session character: "${currentSessionCharacter}".`);
    return currentSessionCharacter;
  }

  logger.debug(`detectCharacter: No specific character detected, no current session character. Defaulting to ${DEFAULT_CHARACTER}.`);
  return DEFAULT_CHARACTER;
}

function parseInitialMessage(text) {
  if (!text) return null;

  const lowerText = text.toLowerCase().trim();
  const skillLevels = ['beginner', 'intermediate', 'expert'];
  let extractedName = '';
  let extractedSkill = '';

  const nameMatch = lowerText.match(/(?:my name is|i'm)\s+([a-z]+)/);
  if (nameMatch) {
    extractedName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
  }

  const skillMatch = lowerText.match(/(?:and a|as a)\s+(beginner|intermediate|expert)/);
  if (skillMatch) {
    extractedSkill = skillMatch[1];
  }

  if (extractedName && extractedSkill) {
    return { name: extractedName, skill: extractedSkill };
  }

  return null;
}

function extractStudentName(text) {
  const lowerText = text.toLowerCase();
  let name = null;

  const patterns = [
    /(?:my name is|i'm|i am)\s+([\w\s\p{L}\p{N}\-']{2,})/u
  ];

  for (const pattern of patterns) {
    const match = lowerText.match(pattern);
    if (match && match[1]) {
      name = match[1].trim().split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      if (name.length > 1 && !/^\d+$/.test(name)) {
        logger.debug(`Student name extracted: "${name}" from text: "${text}"`);
        return name;
      }
    }
  }
  logger.debug(`No student name detected in text: "${text}"`);
  return null;
}

function extractStudentLevel(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.includes("beginner") || lowerText.includes("beginning")) return "beginner";
  if (lowerText.includes("intermediate")) return "intermediate";
  if (lowerText.includes("expert")) return "expert";
  logger.debug(`No student level detected in text: "${text}"`);
  return null;
}

async function setSession(sessionId, data) {
  try {
    const sessionDataToStore = { ...data, timestamp: Date.now() };
    userMemory.set(sessionId, sessionDataToStore);
    setTimeout(() => {
      if (userMemory.has(sessionId) && (Date.now() - userMemory.get(sessionId).timestamp > SESSION_TTL * 1000)) {
        userMemory.delete(sessionId);
        chatMemory.delete(sessionId);
        logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage.`);
      }
    }, SESSION_TTL * 1000 + 1000);
    logger.info(`Session ${sessionId}: Successfully set data ${JSON.stringify(sessionDataToStore)}`);
  } catch (error) {
    logger.error({ error: error.stack, code: "SESSION_SET_ERROR" }, `Failed to set session ${sessionId}`);
    throw error;
  }
}

async function getSession(sessionId) {
  try {
    const storedData = userMemory.get(sessionId);
    if (storedData && (Date.now() - storedData.timestamp <= SESSION_TTL * 1000)) {
      logger.info(`Session ${sessionId}: Retrieved data ${JSON.stringify(storedData)}`);
      return storedData;
    } else if (storedData) {
      userMemory.delete(sessionId);
      chatMemory.delete(sessionId);
      logger.info(`Session ${sessionId}: Expired and deleted from in-memory storage.`);
      return null;
    }
    logger.info(`Session ${sessionId}: No data found`);
    return null;
  } catch (error) {
    logger.error({ error: error.stack, code: "SESSION_GET_ERROR" }, `Failed to get session ${sessionId}`);
    return null;
  }
}

function storeChatHistory(sessionId, messages) {
  try {
    if (chatMemory.size >= MAX_SESSIONS && !chatMemory.has(sessionId)) {
      const oldestSessionId = Array.from(chatMemory.keys())[0];
      chatMemory.delete(oldestSessionId);
      logger.warn(`Max sessions reached (${MAX_SESSIONS}), evicted oldest session ${oldestSessionId}`);
    }

    const sanitizedMessages = messages.map((msg) => ({
      role: msg.role,
      content: sanitizeHtml(msg.content, { allowedTags: [], allowedAttributes: {} }).slice(0, 1000)
    }));

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
    logger.info(`Calling Chatbase for session ${sessionId} with BOT_ID=${chatbotId}`);
    const response = await axios.post(
      "https://www.chatbase.co/api/v1/chat",
      { messages, chatbotId },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 60000
      }
    );
    logger.info(`Chatbase API call successful for session ${sessionId}`);
    return response.data?.messages?.[0]?.content || response.data?.text || "Sorry, I had trouble understanding you.";
  } catch (err) {
    if (axios.isCancel(err) || err.code === 'ECONNABORTED') {
      logger.error({ err: err.message, code: "CHATBASE_TIMEOUT", sessionId }, `Chatbase API call timed out for session ${sessionId}.`);
      return "I'm having trouble connecting right now. Please try again in a moment!";
    }
    if (err.response?.status === 401 || err.response?.data?.message?.includes("Invalid API Key")) {
      logger.error({ err: err.message, code: "CHATBASE_INVALID_KEY", sessionId, details: err.response?.data }, `Invalid Chatbase API key for session ${sessionId}.`);
      return "Sorry, the chat service is misconfigured. Please contact support.";
    }
    logger.error({ err: err.stack, code: "CHATBASE_REQUEST_ERROR", status: err.response?.status, details: err.response?.data }, `Chatbase API request failed for session ${sessionId}.`);
    return "Sorry, something went wrong with the chat service. Please try again later.";
  }
}

app.get("/", (req, res) => {
  logger.info(`Root endpoint accessed`);
  res.send("🌍 Waterwheel Village - BetterChat is online!");
});

app.get("/health", async (req, res) => {
  logger.info(`Health check requested`);
  const health = { status: "ok", uptime: process.uptime(), redis: "in-memory" };
  res.json(health);
});

app.get("/session/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const sessionData = await getSession(sessionId);
    if (sessionData) {
      logger.info(`Session data requested for ${sessionId}: ${JSON.stringify(sessionData)}`);
      res.json({ character: sessionData.character || DEFAULT_CHARACTER });
    } else {
      logger.warn(`Session data not found for ${sessionId}. Returning default character.`);
      res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND", character: DEFAULT_CHARACTER });
    }
  } catch (error) {
    logger.error({ error: error.stack, code: "GET_SESSION_ENDPOINT_ERROR" }, `Failed to retrieve session data for ${sessionId}`);
    res.status(500).json({ error: "Internal server error", code: "SERVER_ERROR", character: DEFAULT_CHARACTER });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { error, value } = chatSchema.validate(req.body);
    if (error) {
      logger.warn(`Invalid chat input: ${error.details[0].message}`);
      return res.status(400).json({ error: error.details[0].message, code: "INVALID_INPUT" });
    }

    const { text, sessionId } = value;
    const sanitizedText = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });

    let sessionData = await getSession(sessionId);
    let botReplyText = "";
    let isWelcomeMessage = false;

    if (!sessionData || (!sessionData.character && !sessionData.studentName && !sessionData.studentLevel)) {
      logger.info(`New/Reset session ${sessionId}: Sending initial welcome message.`);
      sessionData = {
        character: DEFAULT_CHARACTER,
        studentName: null,
        studentLevel: null,
        timestamp: Date.now()
      };
      await setSession(sessionId, sessionData);
      botReplyText = `Welcome to Waterwheel Village, students! I'm Mr. McArthur, your teacher. What's your name? Are you a beginner, intermediate, or expert student?`;
      isWelcomeMessage = true;
    } else if (sessionData.character === DEFAULT_CHARACTER && (!sessionData.studentName || !sessionData.studentLevel) && text !== "") {
      const parsedInfo = parseInitialMessage(sanitizedText);
      let replyNeeded = false;

      if (parsedInfo) {
        if (parsedInfo.name && !sessionData.studentName) {
          sessionData.studentName = parsedInfo.name;
          logger.info(`Session ${sessionId}: Student name "${parsedInfo.name}" captured.`);
          replyNeeded = true;
        }
        if (parsedInfo.skill && !sessionData.studentLevel) {
          sessionData.studentLevel = parsedInfo.skill;
          logger.info(`Session ${sessionId}: Student level "${parsedInfo.skill}" captured.`);
          replyNeeded = true;
        }
      }

      if (replyNeeded) {
        if (sessionData.studentName && sessionData.studentLevel) {
          const article = (sessionData.studentLevel === 'intermediate' || sessionData.studentLevel === 'expert') ? 'an' : 'a';
          botReplyText = `It's lovely to meet you, ${sessionData.studentName}! As ${article} ${sessionData.studentLevel} student, how can I help you today?`;
        } else if (sessionData.studentName && !sessionData.studentLevel) {
          botReplyText = `It's lovely to meet you, ${sessionData.studentName}! What kind of student are you? A beginner, intermediate, or expert?`;
        } else if (!sessionData.studentName && sessionData.studentLevel) {
          const article = (sessionData.studentLevel === 'intermediate' || sessionData.studentLevel === 'expert') ? 'an' : 'a';
          botReplyText = `Oh, so you're ${article} ${sessionData.studentLevel} student! And what name should I call you?`;
        }

        if (botReplyText) {
          await setSession(sessionId, sessionData);
          const historyForNameLevel = chatMemory.get(sessionId) || [];
          if (text !== "") {
            historyForNameLevel.push({ role: "user", content: sanitizedText });
          }
          historyForNameLevel.push({ role: "assistant", content: botReplyText });
          storeChatHistory(sessionId, historyForNameLevel);
          return res.json({ text: botReplyText, character: sessionData.character });
        }
      }
    }

    if (!isWelcomeMessage && !botReplyText) {
      const previousRaw = chatMemory.get(sessionId) || [];
      const previous = previousRaw.filter(msg => msg.content && msg.content.length > 0);
      let systemPrompt = null;

      if (!sessionData.character) {
        sessionData.character = DEFAULT_CHARACTER;
        logger.warn(`sessionData.character was null, defaulting to "${DEFAULT_CHARACTER}".`);
      }

      const studentArticle = (sessionData.studentLevel === 'intermediate' || sessionData.studentLevel === 'expert') ? 'an' : 'a';
      const characterInfo = characterAliases.find(c => c.key === sessionData.character);
      const characterDisplayName = characterInfo ? characterInfo.names[0] : sessionData.character;

      let prefix = sessionData.character === DEFAULT_CHARACTER
        ? `You are Mr. McArthur, a teacher in Waterwheel Village.`
        : `You are ${characterDisplayName}, a character in Waterwheel Village.`;

      if (sessionData.studentName) {
        prefix += ` Address the student as ${sessionData.studentName}.`;
      }
      if (sessionData.studentLevel) {
        prefix += ` They are ${studentArticle} ${sessionData.studentLevel} student.`;
      }
      prefix += ` Stay in character.`;

      if (sessionData.character === DEFAULT_CHARACTER) {
        prefix += ` IMPORTANT RULE: When the student asks to speak with another villager, first, confirm the request. Then, if you are introducing the student to a new villager, generate a response that **begins with the new villager greeting the student directly, using their own name** (e.g., "Greetings, [StudentName]! I am [New Character's Name]..."). This signals the handoff. If you are just suggesting options, you may refer to them by their role (e.g., 'the healer') or briefly by name if necessary for clarity, but primarily aim for a direct handoff when requested. Your primary role is to guide and facilitate introductions.`;
      }

      systemPrompt = { role: "system", content: prefix };
      logger.debug(`System prompt: ${systemPrompt.content.substring(0, 200)}...`);

      const replyMessages = [...(systemPrompt ? [systemPrompt] : []), ...previous, { role: "user", content: sanitizedText }];
      botReplyText = await callChatbase(
        sessionId,
        replyMessages,
        process.env.CHATBASE_BOT_ID,
        process.env.CHATBASE_API_KEY
      );

      const detectedCharacterInBotReply = detectCharacter(botReplyText, sessionData.character);
      if (detectedCharacterInBotReply && detectedCharacterInBotReply !== sessionData.character) {
        sessionData.character = detectedCharacterInBotReply;
        await setSession(sessionId, sessionData);
        logger.info(`Session ${sessionId}: Character updated to "${detectedCharacterInBotReply}".`);
      } else if (!sessionData.character && detectedCharacterInBotReply) {
        sessionData.character = detectedCharacterInBotReply;
        await setSession(sessionId, sessionData);
        logger.info(`Session ${sessionId}: Set character to "${detectedCharacterInBotReply}".`);
      } else if (!sessionData.character && !detectedCharacterInBotReply) {
        sessionData.character = DEFAULT_CHARACTER;
        await setSession(sessionId, sessionData);
        logger.info(`Session ${sessionId}: Defaulted to "${DEFAULT_CHARACTER}".`);
      }
    }

    const finalHistoryMessages = chatMemory.get(sessionId) || [];
    if (text !== "") {
      finalHistoryMessages.push({ role: "user", content: sanitizedText });
    }
    finalHistoryMessages.push({ role: "assistant", content: botReplyText });
    storeChatHistory(sessionId, finalHistoryMessages);

    res.json({ text: botReplyText, character: sessionData.character });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_SERVER_ERROR";
    logger.error({ error: error.stack, code }, `Chat endpoint failed`);
    res.status(status).json({ error: error.message, code, character: DEFAULT_CHARACTER });
  }
});

app.post("/speakbase", async (req, res) => {
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
  const sessionData = await getSession(sessionId);
  if (sessionData && sessionData.character) {
    finalCharacterKey = sessionData.character;
    logger.debug(`Using character from session for speech: "${finalCharacterKey}"`);
  } else if (!finalCharacterKey) {
    const detectedCharacterFromText = detectCharacter(botReplyForSpeech, DEFAULT_CHARACTER);
    finalCharacterKey = detectedCharacterFromText || DEFAULT_CHARACTER;
    logger.info(`No session or frontend character. Detected from text: "${detectedCharacterFromText || 'None'}", Final character for speech: "${finalCharacterKey}"`);
  } else {
    if (!Object.keys(characterVoices).includes(finalCharacterKey)) {
      logger.warn(`Frontend requested character "${finalCharacterKey}" not found in characterVoices. Falling back to default.`);
      finalCharacterKey = DEFAULT_CHARACTER;
    }
    logger.debug(`Using frontend-provided character: "${finalCharacterKey}" for speech (no session character).`);
  }

  let voiceId = characterVoices[finalCharacterKey];
  const voiceSettingsForCharacter = voiceSettings[finalCharacterKey] || voiceSettings.default;

  if (!voiceId) {
    logger.error({ character: finalCharacterKey }, `No voice ID found for character "${finalCharacterKey}". Falling back to ${DEFAULT_CHARACTER}.`);
    voiceId = characterVoices[DEFAULT_CHARACTER] || process.env.VOICE_MCARTHUR;
    if (!voiceId) {
      logger.error(`FATAL: No valid voice ID found for any character.`);
      return res.status(500).json({ error: `No valid voice ID found for any character.` });
    }
    finalCharacterKey = DEFAULT_CHARACTER;
  }

  if (!process.env.ELEVEN_API_KEY) {
    logger.error("ELEVEN_API_KEY environment variable is not set.");
    return res.status(500).json({ error: "ElevenLabs API key is not configured." });
  }

  try {
    const controller = new AbortController();
    const timeout = 30000;
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: botReplyForSpeech,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: voiceSettingsForCharacter.stability,
            similarity_boost: voiceSettingsForCharacter.similarity_boost
          }
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);

    if (!elevenlabsRes.ok) {
      const errorText = await elevenlabsRes.text();
      logger.error({
        status: elevenlabsRes.status,
        details: errorText,
        character: finalCharacterKey,
        voiceId: voiceId,
        textSample: botReplyForSpeech.substring(0, Math.min(botReplyForSpeech.length, 100)),
        code: "ELEVENLABS_NON_OK_RESPONSE"
      }, `ElevenLabs API returned non-OK status for session ${sessionId}.`);
      return res.status(elevenlabsRes.status).json({
        error: "Failed to generate speech from ElevenLabs.",
        details: errorText
      });
    }

    const audioBuffer = await elevenlabsRes.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
    logger.info(`🔊 Speech generated successfully for session ${sessionId}.`);
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error({ error: error.message, code: "ELEVENLABS_TIMEOUT" }, `ElevenLabs API call timed out`);
      res.status(504).json({ error: "Speech generation timed out. Please try again later." });
    } else {
      logger.error({ error: error.stack, code: "ELEVENLABS_API_CALL_ERROR" }, `Error during ElevenLabs API call`);
      res.status(500).json({ error: "Failed to generate speech. Please try again later." });
    }
  }
});

app.listen(PORT, () => {
  logger.info(`Server is running and listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  logger.info(`Received SIGTERM, shutting down...`);
  process.exit(0);
});