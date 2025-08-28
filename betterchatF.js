require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ===== Simple in-memory storage (replace with Redis/DB in production) =====
const sessions = new Map();
const histories = new Map();

async function getSession(sessionId) {
  return sessions.get(sessionId);
}
async function setSession(sessionId, data) {
  sessions.set(sessionId, data);
}
async function getChatHistory(sessionId) {
  return histories.get(sessionId) || [];
}
async function storeChatHistory(sessionId, messages) {
  histories.set(sessionId, messages);
}

// ===== Character → ElevenLabs Voice mapping =====
const voices = {
  mcarthur: "fEVT2ExfHe1MyjuiIiU9",
  nadia: "a1KZUXKFVFDOb33I1uqr",
  fatima: "JMbCR4ujfEfGaawA1YtC",
  anika: "GCPLhb1XrVwcoKUJYcvz",
  liang: "gAMZphRyrWJnLMDnom6H",
  johannes: "JgHmW3ojZwT0NDP5D1JJ",
  aleksanderi: "tIFPE2y0DAU6xfZn3Fka",
  sophia: "0q9TlrIoQJIdxZP9oZh7",
  kwame: "dhwafD61uVd8h85wAZSE",
  ibrahim: "tlETan7Okc4pzjD0z62P",
  default: "fEVT2ExfHe1MyjuiIiU9" // fallback = McArthur
};

// ===== Helper: normalize & detect character =====
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCharacter(text, fallback = "mcarthur") {
  if (!text) return fallback;
  const lower = normalize(text);

  for (const name of Object.keys(voices)) {
    if (name === "default") continue;
    if (lower.includes(name)) {
      return name;
    }
  }
  return fallback;
}

// ===== /chat endpoint =====
app.post('/chat', async (req, res) => {
  const { text: rawText, sessionId: providedSessionId } = req.body || {};
  const sessionId = providedSessionId || uuidv4();
  const sanitizedText = rawText ? String(rawText).trim() : '';
  const isWelcomeMessage = !sanitizedText;

  try {
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    let sessionData = await getSession(sessionId);
    let character = sessionData?.character || 'mcarthur';

    // Welcome message
    if (isWelcomeMessage && !sessionData) {
      sessionData = { character: 'mcarthur', studentName: null, studentLevel: null };
      await setSession(sessionId, sessionData);

      const welcomeMsg =
        "Welcome to Waterwheel Village, students! I'm Mr. McArthur, your teacher. What's your name? Are you a beginner, intermediate, or expert student?";

      await storeChatHistory(sessionId, [{ role: 'assistant', content: welcomeMsg }]);

      return res.json({
        text: welcomeMsg,
        character: 'mcarthur',
        voiceId: voices.mcarthur
      });
    }

    // Load history
    let messages = await getChatHistory(sessionId);
    if (sanitizedText) {
      messages.push({ role: 'user', content: sanitizedText });
    } else if (!isWelcomeMessage && sessionData) {
      return res.json({
        text: '',
        character,
        voiceId: voices[character] || voices.mcarthur
      });
    }

    // Add system prompt
    const systemPrompt = `You are ${character} in Waterwheel Village. You are a kind ESL teacher. Be brief, encouraging, and correct mistakes gently. Always ask one short follow-up question.`;
    const outboundMessages = [{ role: 'system', content: systemPrompt }, ...messages];

    // API keys
    const key = process.env.CHATBASE_API_KEY;
    const CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;

    if (!key || !CHATBOT_ID) {
      const fallback = `Nice to meet you! I heard: '${sanitizedText}'. Can you say: 'My name is ____. I live in ____.'?`;
      messages.push({ role: 'assistant', content: fallback });
      await storeChatHistory(sessionId, messages);

      return res.json({
        text: fallback,
        character,
        voiceId: voices[character] || voices.mcarthur,
        note: 'local-fallback-no-chatbase'
      });
    }

    // ===== Chatbase API Call =====
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

    // Detect character from reply
    let detectedCharacter = detectCharacter(responseText, "mcarthur");
    console.log("=== RAW TEXT ===", responseText);
    console.log("=== DETECTED CHARACTER ===", detectedCharacter);

    // Save assistant reply
    messages.push({ role: 'assistant', content: responseText });
    await storeChatHistory(sessionId, messages);

    // Update session if user gave name/level
    if (sanitizedText.includes('my name is') && !sessionData?.studentName) {
      const nameMatch = sanitizedText.match(/my name is (\w+)/i);
      const levelMatch = sanitizedText.match(/I am a (beginner|intermediate|expert)/i);
      sessionData = {
        ...sessionData,
        studentName: nameMatch ? nameMatch[1] : sessionData?.studentName,
        studentLevel: levelMatch ? levelMatch[1] : sessionData?.studentLevel,
        character: detectedCharacter,
      };
      await setSession(sessionId, sessionData);
    }

    return res.json({
      text: responseText,
      character: detectedCharacter,
      voiceId: voices[detectedCharacter] || voices.mcarthur
    });

  } catch (error) {
    console.error('Error in /chat:', error.response?.data || error.message);
    const fb = "Thanks! Let’s begin with a short exercise: tell me 3 things about yourself.";
    return res.json({
      text: fb,
      character: 'mcarthur',
      voiceId: voices.mcarthur,
      note: 'fallback-error'
    });
  }
});

// ===== /chat-test endpoint =====
app.get('/chat-test', async (req, res) => {
  try {
    const key = process.env.CHATBASE_API_KEY;
    const CHATBOT_ID = process.env.CHATBASE_CHATBOT_ID;

    const response = await axios.post(
      'https://www.chatbase.co/api/v1/chat',
      {
        chatbotId: CHATBOT_ID,
        conversationId: 'test-debug',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json({ success: true, chatbaseResponse: response.data });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: error.response?.status || 'no status',
      data: error.response?.data || error.message,
    });
  }
});

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
