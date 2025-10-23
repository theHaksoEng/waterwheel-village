// publicjshint esversion: 9
console.log('app.js LOADED SUCCESSFULLY');

// === CORRECT API BASE (HARD CODED FOR RENDER) ===
const API_BASE = 'https://waterwheel-village.onrender.com/api';

// === Safe DOM Helper (wait for elements) ===
function $(id, callback) {
  const el = document.getElementById(id);
  if (el && callback) callback(el);
  return el;
}

function waitFor(id, callback, maxTries = 50) {
  let tries = 0;
  const check = () => {
    const el = document.getElementById(id);
    if (el || tries++ > maxTries) {
      clearInterval(interval);
      if (el) callback(el);
    }
  };
  const interval = setInterval(check, 200);
  check();
}

// === State ===
const state = {
  sessionId: localStorage.getItem('wwv_session') || crypto.randomUUID(),
  name: localStorage.getItem('studentName') || '',
  currentLesson: null,
  character: 'mcarthur',
  voiceId: null,
  isListening: false,
};
localStorage.setItem('wwv_session', state.sessionId);

// === DOM Elements (wait for them) ===
let welcomeForm, contentsMenu, chatContainer, studentNameInput, startChatBtn;
let chatHistory, userInput, sendBtn, clearChatBtn, spinner, wordProgress;
let startVoiceBtn, stopVoiceBtn, uploadLessonInput;

waitFor('welcome-form', el => welcomeForm = el);
waitFor('contentsMenu', el => contentsMenu = el);
waitFor('chatContainer', el => chatContainer = el);
waitFor('student-name', el => studentNameInput = el);
waitFor('start-chat-btn', el => startChatBtn = el);
waitFor('chatHistory', el => chatHistory = el);
waitFor('userInput', el => userInput = el);
waitFor('sendBtn', el => sendBtn = el);
waitFor('clearChatBtn', el => clearChatBtn = el);
waitFor('spinner', el => spinner = el);
waitFor('wordProgress', el => wordProgress = el);
waitFor('startVoiceBtn', el => startVoiceBtn = el);
waitFor('stopVoiceBtn', el => stopVoiceBtn = el);
waitFor('uploadLessonInput', el => uploadLessonInput = el);

// === UI Helpers ===
function showScreen(screen) {
  if (!welcomeForm || !contentsMenu || !chatContainer) return;
  welcomeForm.style.display = screen === 'welcome' ? 'block' : 'none';
  contentsMenu.style.display = screen === 'contents' ? 'block' : 'none';
  chatContainer.style.display = screen === 'chat' ? 'block' : 'none';
}

function addBubble(role, text) {
  if (!chatHistory) return;
  const div = document.createElement('div');
  div.className = role === 'assistant' ? 'bot-message' : 'user-message';
  div.textContent = text;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function setSpinner(show) {
  if (spinner) spinner.style.display = show ? 'block' : 'none';
}

function speak(text) {
  const chk = document.getElementById('useBrowserTTSChk');
  if (!chk?.checked || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// === API ===
async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// === Lesson ===
window.startLesson = async function(month, chapter) {
  if (!state.name) {
    showScreen('welcome');
    studentNameInput?.focus();
    return;
  }
  try {
    setSpinner(true);
    const url = `${API_BASE}/lesson/${month}/${chapter}?sessionId=${state.sessionId}&name=${encodeURIComponent(state.name)}`;
    console.log('Fetching:', url);
    const data = await fetchJSON(url);

    state.sessionId = data.sessionId || state.sessionId;
    localStorage.setItem('wwv_session', state.sessionId);
    state.currentLesson = { month, chapter };

    showScreen('chat');
    if (data.welcomeText) { addBubble('assistant', data.welcomeText); speak(data.welcomeText); }
    if (data.lessonText) { addBubble('assistant', data.lessonText); speak(data.lessonText); }

    if (wordProgress && data.words) {
      wordProgress.style.display = 'block';
      wordProgress.textContent = `Words: ${data.words.length}`;
    }
  } catch (e) {
    console.error('Lesson failed:', e);
    addBubble('assistant', `Welcome, ${state.name}! Let's learn.`);
  } finally {
    setSpinner(false);
  }
};

// === DOM Ready ===
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready, initializing...');

  if (state.name) {
    showScreen('contents');
    if (studentNameInput) studentNameInput.value = state.name;
  } else {
    showScreen('welcome');
  }

  // Start Chat
  waitFor('start-chat-btn', btn => {
    btn.addEventListener('click', () => {
      const val = studentNameInput?.value.trim();
      if (!val) { alert('Enter your name'); return; }
      state.name = val;
      localStorage.setItem('studentName', val);
      showScreen('contents');
    });
  });

  // Send Message
  waitFor('sendBtn', btn => {
    btn.addEventListener('click', async () => {
      const text = userInput?.value.trim();
      if (!text) return;
      userInput.value = '';
      addBubble('user', text);
      try {
        setSpinner(true);
        const data = await fetchJSON(`${API_BASE}/chat`, {
          method: 'POST',
          body: JSON.stringify({ text, sessionId: state.sessionId, name: state.name }),
        });
        addBubble('assistant', data.text || '');
        speak(data.text || '');
      } catch (e) {
        addBubble('system', 'Error. Try again.');
      } finally {
        setSpinner(false);
      }
    });
  });

  // Enter key
  waitFor('userInput', input => {
    input.addEventListener('keypress', e => {
      if (e.key === 'Enter') sendBtn?.click();
    });
  });
});