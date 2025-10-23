// === API base URL ===
const API_BASE = location.hostname.includes("localhost")
  ? "http://localhost:3000/api"
  : "https://waterwheel-village.onrender.com/api"; // Replace with your actual Render URL

// 2) DOM helpers & state
const $ = (id) => document.getElementById(id);

const state = {
  sessionId: localStorage.getItem("wwv_session") || crypto.randomUUID(),
  name: localStorage.getItem("studentName") || "",
  currentLesson: null, // {month, chapter}
  character: "mcarthur",
  voiceId: null,
  isListening: false,
};

localStorage.setItem("wwv_session", state.sessionId);

// cache DOM from your HTML
const welcomeForm     = $("welcome-form");
const contentsMenu    = $("contentsMenu");
const chatContainer   = $("chatContainer");
const startChatBtn    = $("start-chat-btn");
const nameInput       = $("student-name");

const sendBtn         = $("sendBtn");
const clearChatBtn    = $("clearChatBtn");
const restartLessonBtn= $("restartLessonBtn");
const endLessonBtn    = $("endLessonBtn");
const resumeLessonBtn = $("resumeLessonBtn");

const changeNameBtn   = $("changeNameBtn");
const newSessionBtn   = $("newSessionBtn");

const downloadLessonBtn = $("downloadLessonBtn");
const uploadLessonBtn   = $("uploadLessonBtn");
const uploadLessonInput = $("uploadLessonInput");

const sttLangSel      = $("sttLang");
const micSelect       = $("micSelect");
const meter           = $("meter");
const meterBar        = $("meterBar");
const useBrowserTTSChk= $("useBrowserTTSChk");
const startVoiceBtn   = $("startVoiceBtn");
const stopVoiceBtn    = $("stopVoiceBtn");

const chatHistory     = $("chatHistory");
const userInput       = $("userInput");
const spinner         = $("spinner");
const wordProgress    = $("wordProgress");
const voiceOutput     = $("voiceOutput"); // <audio>, we hide unless needed

if (voiceOutput) voiceOutput.style.display = "none";

// 3) UI helpers
function showScreen(which) {
  if (!welcomeForm || !contentsMenu || !chatContainer) return;
  if (which === "welcome") {
    welcomeForm.style.display = "block";
    contentsMenu.style.display = "none";
    chatContainer.style.display = "none";
  } else if (which === "contents") {
    welcomeForm.style.display = "none";
    contentsMenu.style.display = "block";
    chatContainer.style.display = "none";
  } else {
    welcomeForm.style.display = "none";
    contentsMenu.style.display = "none";
    chatContainer.style.display = "block";
  }
}

function addBubble(role, text) {
  if (!chatHistory) return;
  const w = document.createElement("div");
  w.className = `bubble ${role}`;
  w.textContent = text;
  chatHistory.appendChild(w);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function setSpinner(on) {
  if (!spinner) return;
  spinner.style.display = on ? "block" : "none";
}

function speak(text) {
  if (!useBrowserTTSChk || !useBrowserTTSChk.checked) return;
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// 4) Networking
async function fetchJSON(url, options) {
  const resp = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options && options.headers) },
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${msg}`);
  }
  return resp.json();
}

// 5) Lesson & Chat
async function startLessonInternal(month, chapter) {
  try {
    setSpinner(true);
    const url = `${API_BASE}/lesson/${encodeURIComponent(month)}/${encodeURIComponent(chapter)}?sessionId=${encodeURIComponent(state.sessionId)}&name=${encodeURIComponent(state.name || "friend")}`;
    console.log('Fetching lesson from:', url);
    const data = await fetchJSON(url);
    console.log('Lesson data received:', data);

    if (data.sessionId) {
      state.sessionId = data.sessionId;
      localStorage.setItem("wwv_session", state.sessionId);
    }
    state.character = data.character || state.character;
    state.voiceId = data.voiceId || state.voiceId;
    state.currentLesson = { month, chapter };

    showScreen("chat");
    if (data.welcomeText) {
      addBubble("assistant", data.welcomeText);
      speak(data.welcomeText);
    }
    if (data.lessonText) {
      addBubble("assistant", data.lessonText);
      speak(data.lessonText);
    }

    if (wordProgress) {
      const total = Array.isArray(data.words) ? data.words.length : 0;
      wordProgress.style.display = total ? "block" : "none";
      wordProgress.textContent = total ? `Words in this lesson: ${total}` : "";
    }
  } catch (e) {
    console.error("startLesson failed:", e.message, e.stack);
    state.currentLesson = { month, chapter };
    state.character = "mcarthur";
    showScreen("chat");
    const fallbackWelcome = `Welcome to ${chapter} from ${month}, ${state.name}!`;
    const fallbackLesson = `Let's learn about ${chapter.replace('_', ' ')}. Type a message to start!`;
    addBubble("assistant", fallbackWelcome);
    addBubble("assistant", fallbackLesson);
    speak(fallbackWelcome);
    speak(fallbackLesson);
    if (wordProgress) wordProgress.style.display = "none";
  } finally {
    setSpinner(false);
  }
}

async function sendChatToServer(text, { isVoice = false } = {}) {
  addBubble("user", text);
  try {
    setSpinner(true);
    const payload = {
      text,
      sessionId: state.sessionId,
      isVoice,
      name: state.name || "friend",
    };
    const data = await fetchJSON(`${API_BASE}/chat`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const reply = data.text || "";
    state.character = data.character || state.character;
    state.voiceId = data.voiceId || state.voiceId;

    addBubble("assistant", reply);
    speak(reply);

    if (wordProgress && (data.learnedCount || data.newlyLearned?.length)) {
      const learned = data.learnedCount ?? 0;
      const gained  = (data.newlyLearned || []).filter(w => !!w && !/🎉/.test(w));
      wordProgress.style.display = "block";
      wordProgress.textContent = `Learned so far: ${learned}${gained.length ? ` (+${gained.length})` : ""}`;
    }
  } catch (e) {
    console.error("chat error:", e);
    addBubble("system", "Sorry, the conversation failed. Please try again.");
  } finally {
    setSpinner(false);
  }
}

// 6) STT (optional)
let mediaRecorder = null;
let chunks = [];
let audioStream = null;

async function listMics() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");
    if (micSelect) {
      micSelect.innerHTML = "";
      for (const d of mics) {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone ${micSelect.length + 1}`;
        micSelect.appendChild(opt);
      }
    }
  } catch (e) {
    console.warn("enumerateDevices failed:", e);
  }
}

async function startListening() {
  if (!navigator.mediaDevices) {
    addBubble("system", "Microphone is not available in this browser.");
    return;
  }
  const constraints = { audio: { deviceId: micSelect && micSelect.value ? { exact: micSelect.value } : undefined } };
  audioStream = await navigator.mediaDevices.getUserMedia(constraints);
  mediaRecorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
  chunks = [];
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    try {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const lang = sttLangSel ? sttLangSel.value : "";
      if (lang) form.append("lang", lang);

      const resp = await fetch(`${API_BASE}/stt`, { method: "POST", body: form });
      if (!resp.ok) throw new Error(`STT ${resp.status}`);
      const { text } = await resp.json();
      if (text && text.trim()) {
        await sendChatToServer(text, { isVoice: true });
      } else {
        addBubble("system", "I could not understand the audio. Please try again.");
      }
    } catch (e) {
      console.error("STT failed:", e);
      addBubble("system", "Speech-to-text failed. Please try again.");
    } finally {
      if (audioStream) {
        audioStream.getTracks().forEach(t => t.stop());
        audioStream = null;
      }
      state.isListening = false;
      if (startVoiceBtn) startVoiceBtn.style.display = "";
      if (stopVoiceBtn) stopVoiceBtn.style.display = "none";
    }
  };
  mediaRecorder.start();
  state.isListening = true;
  if (startVoiceBtn) startVoiceBtn.style.display = "none";
  if (stopVoiceBtn)  stopVoiceBtn.style.display = "";
}

function stopListening() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

let meterRAF = null;
function startMeter(stream) {
  if (!meter || !meterBar) return;
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  function tick() {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] - 128);
      if (v > peak) peak = v;
    }
    const pct = Math.min(100, Math.round((peak / 128) * 100));
    meterBar.style.width = pct + "%";
    meterRAF = requestAnimationFrame(tick);
  }
  meterRAF = requestAnimationFrame(tick);
}

function stopMeter() {
  if (meterRAF) cancelAnimationFrame(meterRAF);
  meterRAF = null;
  if (meterBar) meterBar.style.width = "0%";
}

// 7) Global function for your onclick buttons in HTML
window.startLesson = async function(month, chapter) {
  if (!state.name) {
    showScreen("welcome");
    nameInput && nameInput.focus();
    return;
  }
  await startLessonInternal(month, chapter);
};

// 8) Event listeners
document.addEventListener("DOMContentLoaded", async () => {
  if (state.name) {
    showScreen("contents");
  } else {
    showScreen("welcome");
  }

  if (nameInput) nameInput.value = state.name;

  if (startChatBtn) {
    startChatBtn.addEventListener("click", () => {
      const val = (nameInput && nameInput.value.trim()) || "";
      if (!val) {
        alert("Please enter your name to start.");
        nameInput && nameInput.focus();
        return;
      }
      state.name = val;
      localStorage.setItem("studentName", state.name);
      showScreen("contents");
    });
  }

  if (sendBtn && userInput) {
    sendBtn.addEventListener("click", async () => {
      const text = userInput.value.trim();
      if (!text) return;
      userInput.value = "";
      await sendChatToServer(text);
    });
    userInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !userInput.disabled) {
        e.preventDefault();
        sendBtn.click();
      }
    });
  }

  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", () => {
      if (chatHistory) chatHistory.innerHTML = "";
    });
  }
  if (endLessonBtn) {
    endLessonBtn.addEventListener("click", () => {
      state.currentLesson = null;
      showScreen("contents");
    });
  }
  if (restartLessonBtn) {
    restartLessonBtn.addEventListener("click", () => {
      if (state.currentLesson) {
        startLessonInternal(state.currentLesson.month, state.currentLesson.chapter);
      }
    });
  }
  if (resumeLessonBtn) {
    resumeLessonBtn.addEventListener("click", () => {
      if (state.currentLesson) showScreen("chat");
      else showScreen("contents");
    });
  }
  if (changeNameBtn) {
    changeNameBtn.addEventListener("click", () => {
      showScreen("welcome");
      nameInput && nameInput.focus();
    });
  }
  if (newSessionBtn) {
    newSessionBtn.addEventListener("click", () => {
      state.sessionId = crypto.randomUUID();
      localStorage.setItem("wwv_session", state.sessionId);
      addBubble("system", "Started a new session.");
      showScreen("welcome");
    });
  }

  if (downloadLessonBtn) {
    downloadLessonBtn.addEventListener("click", () => {
      const data = {
        sessionId: state.sessionId,
        name: state.name,
        currentLesson: state.currentLesson,
        character: state.character,
        ts: Date.now(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "waterwheel-progress.json";
      a.click();
    });
  }
  if (uploadLessonBtn && uploadLessonInput) {
    uploadLessonBtn.addEventListener("click", () => uploadLessonInput.click());
    uploadLessonInput.addEventListener("change", async () => {
      const file = uploadLessonInput.files?.[0];
      if (!file) return;
      const txt = await file.text();
      try {
        const data = JSON.parse(txt);
        state.sessionId = data.sessionId || state.sessionId;
        state.name = data.name || state.name;
        state.currentLesson = data.currentLesson || state.currentLesson;
        state.character = data.character || state.character;
        localStorage.setItem("wwv_session", state.sessionId);
        localStorage.setItem("studentName", state.name);
        addBubble("system", "Progress loaded.");
        if (state.currentLesson) showScreen("chat"); else showScreen("contents");
      } catch (_) {
        addBubble("system", "Invalid progress file.");
      }
    });
  }

  if (startVoiceBtn) {
    startVoiceBtn.addEventListener("click", async () => {
      try {
        await listMics();
        await startListening();
      } catch (e) {
        console.error(e);
        addBubble("system", "Cannot access microphone.");
      }
    });
  }
  if (stopVoiceBtn) {
    stopVoiceBtn.addEventListener("click", () => {
      stopListening();
    });
  }
});