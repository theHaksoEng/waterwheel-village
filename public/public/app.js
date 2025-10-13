(function() {
  const API_BASE_URL = "https://waterwheel-village.onrender.com";

  const $ = (id) => document.getElementById(id);

  // DOM
  const chatHistoryDiv = $("chatHistory");
  const userInput = $("userInput");
  const welcomeForm = $("welcome-form");
  const studentNameInput = $("student-name");
  const startChatBtn = $("start-chat-btn");
  const chatContainer = $("chatContainer");
  const contentsMenu = $("contentsMenu");
  const voiceOutput = $("voiceOutput");
  const sendBtn = $("sendBtn");
  const clearChatBtn = $("clearChatBtn");
  const startVoiceBtn = $("startVoiceBtn");
  const stopVoiceBtn = $("stopVoiceBtn");
  const spinner = $("spinner");
  const uploadLessonInput = $("uploadLessonInput");
  const downloadLessonBtn = $("downloadLessonBtn");
  const uploadLessonBtn = $("uploadLessonBtn");
  const restartLessonBtn = $("restartLessonBtn");
  const endLessonBtn = $("endLessonBtn");
  const resumeLessonBtn = $("resumeLessonBtn");
  const wordProgressDiv = $("wordProgress");
  const micSelect = $("micSelect");
  const sttLang = $("sttLang");
  const meterBar = $("meterBar");
const forceRecorderChk = document.getElementById("forceRecorderChk");
const useBrowserTTSChk = document.getElementById("useBrowserTTSChk");

  // Simple UI gates
  function showWelcome() {
    if (welcomeForm) welcomeForm.style.display = "flex";
    if (contentsMenu) contentsMenu.style.display = "none";
    if (chatContainer) chatContainer.style.display = "none";
  }
  function showMenu() {
    if (welcomeForm) welcomeForm.style.display = "none";
    if (contentsMenu) contentsMenu.style.display = "block";
  }

  // Name/session
  let studentName = localStorage.getItem("studentName") || "";
  if (!studentName) showWelcome(); else showMenu();

  function getSessionId() {
    let id = localStorage.getItem("waterwheelSessionId");
    if (!id) {
      id = (self.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem("waterwheelSessionId", id);
    }
    return id;
  }
  let currentSessionId = getSessionId();
  let currentLesson = null;
  let initialLoad = true;

  // Helpers
  function addMessageToHistory(message, sender, isWelcome = false) {
    if (!chatHistoryDiv) return;
    const el = document.createElement("div");
    el.classList.add(isWelcome ? "welcome-message" : (sender === "user" ? "user-message" : "bot-message"));
    el.textContent = message;
    chatHistoryDiv.appendChild(el);
    chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight;
  }
  function addLearnedWordsMessage(words) {
    if (!chatHistoryDiv || !words || !words.length) return;
    const msg = `✨ Great job, ${studentName || "friend"}! You learned these new words: ${words.join(", ")}!`;
    const el = document.createElement("div");
    el.classList.add("newly-learned");
    el.textContent = msg;
    chatHistoryDiv.appendChild(el);
    chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight;
  }

  // TTS
 // === Browser TTS preference ===
const useBrowserTTSChk = document.getElementById("useBrowserTTSChk");
if (useBrowserTTSChk) {
  const saved = localStorage.getItem("useBrowserTTS");
  if (saved !== null) useBrowserTTSChk.checked = saved === "1";
  useBrowserTTSChk.addEventListener("change", () => {
    localStorage.setItem("useBrowserTTS", useBrowserTTSChk.checked ? "1" : "0");
  });
}

// Cancel any ongoing browser speech (handy before mic starts)
function stopBrowserSpeech() {
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
}

// Load voices (Safari/Chrome need this)
function getVoicesAsync() {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve([]);
    const voices = speechSynthesis.getVoices();
    if (voices && voices.length) return resolve(voices);
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices() || []);
  });
}

// Speak with browser TTS (free)
async function speakBrowser(text) {
  if (!text) return;
  if (!("speechSynthesis" in window)) {
    console.warn("SpeechSynthesis not supported in this browser.");
    return;
  }
  const voices = await getVoicesAsync();
  const lang = (sttLang?.value || "en-US").toLowerCase();

  // Pick a voice matching the full lang, otherwise same language, otherwise default
  let voice = voices.find(v => (v.lang || "").toLowerCase() === lang)
          || voices.find(v => (v.lang || "").slice(0,2).toLowerCase() === lang.slice(0,2))
          || voices[0];

  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang || (sttLang?.value || "en-US");
  u.rate = 1;   // adjust if you want faster/slower
  u.pitch = 1;

  // Ensure we don't overlap
  stopBrowserSpeech();

  return new Promise((resolve) => {
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// Replace your current playVoice with this:
// - Uses ElevenLabs when available and toggle is OFF
// - Falls back to browser TTS on error or if toggle is ON
async function playVoice(text, voiceId) {
 if (useBrowserTTSChk && useBrowserTTSChk.checked && "speechSynthesis" in window) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return;
}
// else fall back to your /speakbase fetch…


  // Try backend (ElevenLabs) first
  try {
    // Pause any in-flight audio / browser speech to avoid feedback
    try { voiceOutput.pause(); } catch {}
    stopBrowserSpeech();

    const audioRes = await fetch(`${API_BASE_URL}/speakbase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId })
    });

    if (!audioRes.ok) throw new Error(`speakbase ${audioRes.status}`);

    const audioBlob = await audioRes.blob();
    const url = URL.createObjectURL(audioBlob);
    voiceOutput.src = url;
    voiceOutput.style.display = "block";

    await new Promise((resolve) => {
      const cleanup = () => { voiceOutput.onended = null; voiceOutput.onerror = null; resolve(); };
      voiceOutput.onended = cleanup;
      voiceOutput.onerror = cleanup;
      voiceOutput.play().catch(() => cleanup());
    });
  } catch (err) {
    console.warn("Backend TTS failed, falling back to browser:", err?.message || err);
    await speakBrowser(text);
  }
}

// (Optional) Before starting mic recognition/recording, stop TTS so it doesn't feed back:
if (startVoiceBtn) {
  const originalStart = startVoiceBtn.onclick;
  startVoiceBtn.addEventListener("click", () => {
    try { voiceOutput.pause(); } catch {}
    stopBrowserSpeech();
    if (originalStart) originalStart();
  });
}

  // Start chat (robust)
  function goToMenuWithName(name) {
    const n = (name || "").trim();
    if (!n) { alert("Please enter your name to start!"); return; }
    studentName = n;
    localStorage.setItem("studentName", studentName);
    showMenu();
  }
  if (startChatBtn) {
    startChatBtn.addEventListener("click", (e) => { e.preventDefault(); goToMenuWithName(studentNameInput ? studentNameInput.value : ""); });
  }
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.id === "start-chat-btn") {
      e.preventDefault();
      goToMenuWithName(studentNameInput ? studentNameInput.value : "");
    }
  });
  if (studentNameInput) {
    studentNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); goToMenuWithName(studentNameInput.value); }
    });
  }

  // Change name / New session
  const changeNameBtn = $("changeNameBtn");
  if (changeNameBtn) {
    changeNameBtn.addEventListener("click", () => {
      localStorage.removeItem("studentName");
      studentName = "";
      showWelcome();
    });
  }
  const newSessionBtn = $("newSessionBtn");
  if (newSessionBtn) {
    newSessionBtn.addEventListener("click", () => {
      localStorage.removeItem("waterwheelSessionId");
      currentSessionId = getSessionId();
      if (chatHistoryDiv) chatHistoryDiv.innerHTML = "";
      addMessageToHistory("🧹 New session started. Pick a chapter.", "bot");
    });
  }

  // Lessons
  async function startLesson(month, chapter) {
    if (!contentsMenu || !chatContainer) return;
    contentsMenu.style.display = "none";
    chatContainer.style.display = "flex";
    chatHistoryDiv.innerHTML = "";
    currentLesson = { month, chapter };
    localStorage.setItem("currentLesson", JSON.stringify(currentLesson));

    try {
      const url = `${API_BASE_URL}/lesson/${month}/${chapter}?sessionId=${encodeURIComponent(currentSessionId)}&name=${encodeURIComponent(studentName || "friend")}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Lesson fetch failed: ${res.status}`);
      const lesson = await res.json();

      if (lesson.welcomeText) {
        addMessageToHistory(lesson.welcomeText, "bot", true);
        await playVoice(lesson.welcomeText, "fEVT2ExfHe1MyjuiIiU9");
      }
      if (lesson.lessonText) {
        addMessageToHistory(lesson.lessonText, "bot");
        if (lesson.voiceId) await playVoice(lesson.lessonText, lesson.voiceId);
      }
      if (Array.isArray(lesson.words) && lesson.words.length) {
        const list = lesson.words.map(w => (w && w.fi) ? `${w.en} — ${w.fi}` : w.en).join(", ");
        addMessageToHistory(`📖 Here are some useful words: ${list}.`, "bot");
      }
      if (!lesson.welcomeText && !lesson.lessonText) {
        addMessageToHistory("⚠️ Sorry, this lesson could not be loaded.", "bot");
      }
    } catch {
      addMessageToHistory("⚠️ Sorry, this lesson could not be loaded.", "bot");
    }
  }
  window.startLesson = startLesson;

  // Chat flow
  async function handleFullChatFlow(inputText, isVoice = false) {
    if (inputText.trim() === "" && initialLoad === false) return;
    if (inputText.trim() !== "") addMessageToHistory(inputText, "user");
    userInput.value = "";
    if (spinner) { spinner.textContent = "🤖 Thinking..."; spinner.style.display = "block"; }
    initialLoad = false;

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText, sessionId: currentSessionId, isVoice, name: studentName })
      });
      const data = await response.json();

      if (data.text) {
        addMessageToHistory(data.text, "bot");
        if (data.voiceId) await playVoice(data.text, data.voiceId);
        if (Array.isArray(data.newlyLearned) && data.newlyLearned.length > 0) addLearnedWordsMessage(data.newlyLearned);
        if (typeof data.learnedCount === "number" && wordProgressDiv) {
          wordProgressDiv.style.display = "block";
          wordProgressDiv.textContent = `Words learned: ${data.learnedCount}`;
        }
      }
    } catch {
      addMessageToHistory("⚠️ Sorry, the chat service is not available.", "bot");
    } finally {
      if (spinner) spinner.style.display = "none";
    }
  }
  if (sendBtn) sendBtn.addEventListener("click", () => handleFullChatFlow(userInput.value));
  if (userInput) userInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleFullChatFlow(userInput.value); });

  // Mic meter
  let audioCtx = null, analyser = null, meterRAF = null;
  function startMeter(stream) {
    stopMeter();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v*v;
      }
      const rms = Math.sqrt(sum / data.length);
      const pct = Math.min(100, Math.max(0, Math.round(rms * 200)));
      meterBar.style.width = pct + "%";
      meterRAF = requestAnimationFrame(tick);
    };
    meterRAF = requestAnimationFrame(tick);
  }
  function stopMeter() {
    try { if (audioCtx) audioCtx.close(); } catch {}
    audioCtx = null; analyser = null;
    if (meterRAF) cancelAnimationFrame(meterRAF);
    meterRAF = null; if (meterBar) meterBar.style.width = "0%";
  }

  async function populateMics(afterPermissionStream) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === "audioinput");
      const prev = micSelect.value || localStorage.getItem("preferredMicId") || "";
      micSelect.innerHTML = "";
      inputs.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId || "";
        opt.textContent = d.label || `Microphone ${i+1}`;
        micSelect.appendChild(opt);
      });
      if (prev && [...micSelect.options].some(o => o.value === prev)) {
        micSelect.value = prev;
      }
    } catch {}
    if (afterPermissionStream) { try { afterPermissionStream.getTracks().forEach(t => t.stop()); } catch {} }
  }
  async function ensureMicPermission() {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      await populateMics(tmp);
      return true;
    } catch {
      addMessageToHistory("🎙️ Microphone permission denied or unavailable.", "bot");
      return false;
    }
  }
  if (navigator.mediaDevices?.enumerateDevices) populateMics();

  // Voice: WebSpeech + fallback recorder
  let recognition = null, rec = null, recStream = null;

  async function startRecordingFallback() {
    try {
      const deviceId = micSelect.value || undefined;
      if (deviceId) localStorage.setItem("preferredMicId", deviceId);
      const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
      recStream = await navigator.mediaDevices.getUserMedia(constraints);
      startMeter(recStream);

      const mime =
        (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) ? "audio/webm;codecs=opus" :
        (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm")) ? "audio/webm" : "";

      rec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstart = () => {
        if (spinner) { spinner.textContent = "🎤 Recording… speak normally"; spinner.style.display = "block"; }
        startVoiceBtn.style.display = "none";
        stopVoiceBtn.style.display = "inline-block";
      };
      rec.onstop = async () => {
        stopMeter();
        if (spinner) spinner.style.display = "none";
        startVoiceBtn.style.display = "inline-block";
        stopVoiceBtn.style.display = "none";

        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, mime.includes("mp4") ? "speech.m4a" : "speech.webm");
        form.append("lang", sttLang ? (sttLang.value || "en-US") : "en-US");

        try {
          const res = await fetch(`${API_BASE_URL}/stt`, { method: "POST", body: form });
          const data = await res.json().catch(() => ({}));
          const text = (data && data.text ? String(data.text) : "").trim();
          if (text) handleFullChatFlow(text, true);
          else addMessageToHistory("🤔 I didn’t catch that (server). Try again and speak close to the mic.", "bot");
        } finally {
          try { recStream.getTracks().forEach(t => t.stop()); } catch {}
          recStream = null; rec = null;
        }
      };
      rec.start();
      setTimeout(() => { try { rec && rec.state === "recording" && rec.stop(); } catch {} }, 5000);
    } catch (e) {
      console.error("Fallback recorder failed:", e);
      addMessageToHistory("⚠️ Could not access microphone.", "bot");
    }
  }

  async function startListening() {
    const ok = await ensureMicPermission();
    if (!ok) return;

    if (forceRecorderChk && forceRecorderChk.checked) {
  await startRecordingFallback();
  return;
}

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { await startRecordingFallback(); return; }

    try { voiceOutput.pause(); } catch {}
    let gotResult = false;
    recognition = new SpeechRecognition();
    if (sttLang) recognition.lang = sttLang.value || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = async () => {
      if (spinner) { spinner.textContent = "🎤 Listening..."; spinner.style.display = "block"; }
      startVoiceBtn.style.display = "none";
      stopVoiceBtn.style.display = "inline-block";
      try {
        const deviceId = micSelect.value || undefined;
        const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
        const tmp = await navigator.mediaDevices.getUserMedia(constraints);
        startMeter(tmp);
        recognition.addEventListener("end", () => {
          stopMeter();
          try { tmp.getTracks().forEach(t => t.stop()); } catch {}
        }, { once: true });
      } catch {}
    };
    recognition.onresult = (event) => {
      let interim = "", finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (interim && userInput) userInput.placeholder = interim.trim();
      if (finalText && userInput) {
        gotResult = true;
        userInput.value = (userInput.value + " " + finalText).trim();
        userInput.placeholder = "";
      }
    };
    recognition.onerror = async () => {
      stopMeter();
      if (spinner) spinner.style.display = "none";
      await startRecordingFallback();
    };
    recognition.onend = async () => {
      if (spinner) spinner.style.display = "none";
      startVoiceBtn.style.display = "inline-block";
      stopVoiceBtn.style.display = "none";
      const textToSend = (userInput && userInput.value || "").trim();
      if (textToSend) handleFullChatFlow(textToSend, true);
      else if (!gotResult) await startRecordingFallback();
    };
    recognition.start();
  }
  function stopListening() {
    try { if (recognition) { recognition.stop(); recognition = null; } } catch {}
    try { if (rec && rec.state === "recording") rec.stop(); } catch {}
    stopMeter();
    if (spinner) spinner.style.display = "none";
    startVoiceBtn.style.display = "inline-block";
    stopVoiceBtn.style.display = "none";
  }
  if (startVoiceBtn) startVoiceBtn.addEventListener("click", startListening);
  if (stopVoiceBtn)  stopVoiceBtn.addEventListener("click", stopListening);

  // Controls
  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", () => {
      localStorage.removeItem("waterwheelSessionId");
      if (chatHistoryDiv) chatHistoryDiv.innerHTML = "";
      addMessageToHistory("Chat history has been cleared. Start a new lesson!", "bot");
      window.location.reload();
    });
  }
  if (restartLessonBtn) {
    restartLessonBtn.addEventListener("click", () => {
      if (currentLesson) startLesson(currentLesson.month, currentLesson.chapter);
      else addMessageToHistory("No lesson is currently active. Please select one from the menu.", "bot");
    });
  }
  if (endLessonBtn) {
    endLessonBtn.addEventListener("click", () => {
      currentLesson = null;
      if (chatHistoryDiv) chatHistoryDiv.innerHTML = "";
      chatContainer.style.display = "none";
      contentsMenu.style.display = "block";
      localStorage.removeItem("waterwheelSessionId");
      currentSessionId = getSessionId();
      stopMeter();
    });
  }
  if (resumeLessonBtn) {
    resumeLessonBtn.addEventListener("click", () => {
      const saved = JSON.parse(localStorage.getItem("currentLesson") || "null");
      if (saved) startLesson(saved.month, saved.chapter);
      else addMessageToHistory("No saved lesson found. Start a new one!", "bot");
    });
  }

  // Progress: save .json + readable .txt
  if (downloadLessonBtn) {
    downloadLessonBtn.addEventListener("click", () => {
      const chatHistory = Array.from(chatHistoryDiv.children).map(el => ({
        sender: el.classList.contains("user-message") ? "user"
               : (el.classList.contains("welcome-message") ? "welcome" : "bot"),
        text: el.textContent
      }));
      const json = JSON.stringify({ chatHistory }, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "waterwheel_progress.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      const txt = chatHistory.map(m => (m.sender === "user" ? "You: " : "Tutor: ") + m.text).join("\n\n");
      const blob2 = new Blob([txt], { type: "text/plain" });
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(blob2);
      a2.download = "waterwheel_transcript.txt";
      document.body.appendChild(a2);
      a2.click();
      document.body.removeChild(a2);

      addMessageToHistory("Download complete! Saved .json and .txt.", "bot");
    });
  }
  if (uploadLessonInput) {
    uploadLessonInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.chatHistory) {
            chatHistoryDiv.innerHTML = "";
            data.chatHistory.forEach(msg => {
              addMessageToHistory(msg.text, msg.sender === "user" ? "user" : "bot", msg.sender === "welcome");
            });
            addMessageToHistory("Upload complete!", "bot");
          } else {
            addMessageToHistory("⚠️ Invalid file format.", "bot");
          }
        } catch {
          addMessageToHistory("⚠️ Failed to read file.", "bot");
        }
      };
      reader.readAsText(file);
    });
  }
  if (uploadLessonBtn) uploadLessonBtn.addEventListener("click", () => uploadLessonInput.click());

  // Persist language choice
  if (sttLang) {
    const savedLang = localStorage.getItem("sttLang");
    if (savedLang) sttLang.value = savedLang;
    sttLang.addEventListener("change", () => localStorage.setItem("sttLang", sttLang.value));
  }
})();
