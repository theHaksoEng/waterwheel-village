window.__WWV_VERSION = "2026-2-7-demo-limit-fixed";
console.log("WWV script loaded VERSION:", window.__WWV_VERSION);
console.log("WWV script loaded ✅", new Date().toISOString());

(() => {
  // Config
  const DEFAULT_BACKEND = "https://waterwheel-village.onrender.com";
  const MCARTHUR_VOICE = "fEVT2ExfHe1MyjuiIiU9";
  const VOICE_BY_CHAR = Object.freeze({
    mcarthur: "fEVT2ExfHe1MyjuiIiU9",
    kwame: "dhwafD61uVd8h85wAZSE",
    nadia: "a1KZUXKFVFDOb33I1uqr",
    sophia: "0q9TlrIoQJIdxZP9oZh7",
    liang: "gAMZphRyrWJnLMDnom6H",
    fatima: "JMbCR4ujfEfGaawA1YtC",
    ibrahim: "tlETan7Okc4pzjD0z62P",
    alex: "tIFPE2y0DAU6xfZn3Fka",
    anika: "GCPLhb1XrVwcoKUJYcvz",
    johannes: "JgHmW3ojZwT0NDP5D1JJ"
  });

  // Utility
  const qs = (root, sel) => root.querySelector(sel);
  const ce = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  function normalizeToken(t) {
    t = String(t || "").toLowerCase().trim().replace(/[^\w\s-]/g, "");
    if (!t) return t;
    if (t.endsWith("ies") && t.length > 3) return t.slice(0, -3) + "y";
    if (t.endsWith("es") && t.length > 2) {
      const base = t.slice(0, -2);
      if (base.endsWith("s") || base.endsWith("x") || base.endsWith("z") ||
          base.endsWith("ch") || base.endsWith("sh") || base.endsWith("o")) return base;
    }
    if (t.endsWith("s") && t.length > 1) return t.slice(0, -1);
    return t;
  }

  function sanitizeForTTS(str = "") {
    return String(str)
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[_~]/g, "")
      .trim();
  }

  class WaterwheelChat extends HTMLElement {
    constructor() {
      super();
      this.starting = false;
      const attrBackend = (this.getAttribute("backend") || "").trim();
      const base = (attrBackend || DEFAULT_BACKEND || "").trim();
      this.backend = base.replace(/\/+$/, "");
      if (!this.backend || /localhost|127\.0\.0\.1/i.test(this.backend)) {
        this.backend = DEFAULT_BACKEND;
      }
      this.voice = (this.getAttribute("voice") || "on") === "on";
      this.sessionId = localStorage.getItem("wwv-session") ||
        (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      localStorage.setItem("wwv-session", this.sessionId);

      // State
      this.wordlist = [];
      this.wordsetEn = new Set();
      this.learned = new Set();
      this.lastVoiceId = null;
      this._lastAudioUrl = null;

      // === Demo mode ===
      this.demo = true;                     // ← Set to true for testing demo limit
      this.demoVoiceMax = 5;
      this.demoVoiceUsed = 0;
      this.demoVoicedByCharacter = {};
      this.demoMaxChars = 220;
      this.activeCharacter = "mcarthur";
      this.audioReady = true;

      // Milestone flags
      this._milestone10 = false;
      this._milestoneComplete = false;

      // TTS queue
      this.ttsQueue = [];
      this.ttsPlaying = false;

      // Mic state
      this.rec = null;
      this.recActive = false;
      this.primed = false;
      this.restartWanted = false;
      this.speechBuf = "";
      this.holdTimer = null;
      this.PAUSE_GRACE_MS = 6000;

      // Shadow DOM
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `...`;  // ← Keep your existing HTML/style block here (it's correct)

      // UI refs
      this.ui = {
        name: qs(this.shadowRoot, "#name"),
        month: qs(this.shadowRoot, "#month"),
        chapter: qs(this.shadowRoot, "#chapter"),
        start: qs(this.shadowRoot, "#start"),
        voiceToggle: qs(this.shadowRoot, "#voiceToggle"),
        voiceTest: qs(this.shadowRoot, "#voiceTest"),
        download: qs(this.shadowRoot, "#download"),
        status: qs(this.shadowRoot, "#status"),
        chat: qs(this.shadowRoot, "#chat"),
        input: qs(this.shadowRoot, "#input"),
        send: qs(this.shadowRoot, "#send"),
        mic: qs(this.shadowRoot, "#mic"),
        micInfo: qs(this.shadowRoot, "#micInfo"),
        micErr: qs(this.shadowRoot, "#micErr"),
        wordsWrap: qs(this.shadowRoot, "#words"),
        showFi: qs(this.shadowRoot, "#showFi"),
        progBar: qs(this.shadowRoot, "#progBar"),
        progLbl: qs(this.shadowRoot, "#progLbl"),
        player: qs(this.shadowRoot, "#player"),
        vocabPanel: qs(this.shadowRoot, ".col-words"),
      };
    }

    // ... keep avatarUrl, celebrateMilestone, confettiBurst, playChime as-is ...

    connectedCallback() {
      if (this._didInit) return;
      this._didInit = true;

      // Name persistence
      const savedName = localStorage.getItem("wwv-name") || "friend";
      this.ui.name.value = savedName;
      this.ui.name.addEventListener("change", () =>
        localStorage.setItem("wwv-name", this.ui.name.value.trim())
      );

      // Character picker
      const allChars = Array.from(this.shadowRoot.querySelectorAll(".char"));
      const highlight = () => {
        allChars.forEach(b => b.classList.toggle("active", b.dataset.char === this.activeCharacter));
      };

      allChars.forEach(btn => {
        btn.addEventListener("click", async () => {
          const newChar = btn.dataset.char || "mcarthur";
          if (newChar === this.activeCharacter) return;
          this.activeCharacter = newChar;
          highlight();

          const nameMap = {
            mcarthur: "Mr. McArthur",
            kwame: "Kwame",
            nadia: "Nadia",
            sophia: "Sophia"
          };
          const fullName = nameMap[newChar] || newChar;
          this.addMsg("bot", `Switched to ${fullName}. Say hello!`);

          const greeting = `Hello ${fullName}`;
          this.addMsg("user", greeting);
          await this.sendText(greeting, false);
        });
      });

      if (!this.activeCharacter) this.activeCharacter = "mcarthur";
      highlight();

      // Lesson start
      this.ui.start.addEventListener("click", async () => {
        if (this._lessonStarting) return;
        const m = this.ui.month.value;
        const c = this.ui.chapter.value;
        if (!m || !c) return alert("Pick Month and Chapter first");

        this._lessonStarting = true;
        try {
          this.unlockAudio();
          await this.startLesson();
        } finally {
          this._lessonStarting = false;
        }
      });

      // Voice toggle & test
      this.ui.voiceToggle.addEventListener("click", () => {
        this.voice = !this.voice;
        this.ui.voiceToggle.textContent = this.voice ? "Voice: ON" : "Voice: OFF";
      });

      this.ui.voiceTest.addEventListener("click", async () => {
        await this.unlockAudio();
        const vid = VOICE_BY_CHAR[this.activeCharacter] || this.lastVoiceId || MCARTHUR_VOICE;
        this.enqueueSpeak("Voice test. If you hear this, TTS works.", vid);
      });

      // Send logic – ONLY ONE listener
      const sendHandler = () => this.handleSendAction();
      this.ui.send.addEventListener("click", sendHandler);
      this.ui.input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendHandler();
        }
      });

      this.ui.download.addEventListener("click", () => this.downloadTranscript());
      this.ui.showFi.addEventListener("change", () => this.renderWordlist());

      this.setupMic();

      this.shadowRoot.querySelectorAll(".demoRow img").forEach(img => {
        img.addEventListener("error", () => { img.src = "/avatars/mcarthur.png"; });
      });
    }

    async handleSendAction() {
      const text = (this.ui.input?.value || "").trim();
      if (!text || this.isProcessing) return;
      this.isProcessing = true;

      this.addMsg("user", text);
      this.ui.input.value = "";
      this.ui.input.focus();

      try {
        await this.sendText(text, false);
      } finally {
        this.isProcessing = false;
      }
    }

    addMsg(role, text) {
      console.log("ADDMSG:", role, text);
      const row = ce("div", { className: `msg ${role === "user" ? "user" : "bot"}` });
      const bubble = ce("div", { className: "bubble" });
      bubble.textContent = text;
      row.appendChild(bubble);
      this.ui.chat.appendChild(row);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      console.log("ADDMSG count:", this.ui.chat.children.length);
    }

    // ... keep addTyping, renderWordlist, updateLearnedFromText, mergeNewlyLearned, handleMilestones as-is ...

    async sendText(text, isVoice) {
      console.log("sendText ENTERED", { text, isVoice, voice: this.voice });
      this.addTyping(true);

      try {
        const r = await fetch(`${this.backend}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            sessionId: this.sessionId,
            isVoice: !!isVoice,
            name: this.ui.name.value || "friend",
            character: this.activeCharacter,
            demo: !!this.demo,
          }),
        });

        console.log("SENDTEXT status:", r.status, "ok:", r.ok);
        const d = await r.json().catch(() => ({}));
        console.log("SENDTEXT response:", d);

        this.addTyping(false);

        if (!r.ok) {
          console.error("HTTP error:", r.status, d);
          throw new Error(d.error || "Chat failed");
        }

        const reply = d.text || "(no response)";
        if (d.voiceId) this.lastVoiceId = d.voiceId;

        this.addMsg("bot", reply);

        // NEW: Handle demo end
        if (d.demoEnded === true) {
          this.ui.input.disabled = true;
          this.ui.input.placeholder = "Demo complete — thank you!";
          this.ui.send.disabled = true;
          this.ui.mic.disabled = true;

          // Visual end note
          const endNote = ce("div", { className: "msg system" });
          const bubble = ce("div", { className: "bubble", style: "background:#e2e8f0; text-align:center; font-weight:bold;" });
          bubble.textContent = "→ This concludes the demo. Refresh page to start again!";
          endNote.appendChild(bubble);
          this.ui.chat.appendChild(endNote);
          this.ui.chat.scrollTop = this.ui.chat.scrollHeight;

          this.setStatus("Demo session ended.", false);
        }

        // Voice handling (unchanged)
        const charKey = d.character || this.activeCharacter || "mcarthur";
        const usedByChar = this.demoVoicedByCharacter?.[charKey] || 0;
        const canVoice = this.voice &&
          (!this.demo || (this.demoVoiceUsed < this.demoVoiceMax && usedByChar < 2));

        if (canVoice) {
          const vid = d.voiceId || this.lastVoiceId || MCARTHUR_VOICE;
          const spokenText = this.demo ? reply.slice(0, this.demoMaxChars) : reply;
          const parts = String(spokenText || "").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
          for (const p of parts) this.enqueueSpeak(p, vid);
          if (this.demo) {
            this.demoVoiceUsed++;
            this.demoVoicedByCharacter[charKey] = (usedByChar || 0) + 1;
          }
        }

        if (d.newlyLearned) this.mergeNewlyLearned(d.newlyLearned);
        this.handleMilestones();

        console.log("SENDTEXT done. msg count =", this.ui.chat.children.length);
        return d;
      } catch (e) {
        console.error("SENDTEXT error:", e);
        this.addTyping(false);
        this.addMsg("bot", "Sorry — chat failed. Try again or refresh.");
        this.setStatus("Communication error. Check connection.", true);
        throw e;
      }
    }

// Mic with pause buffer
setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isHttps = location.protocol === "https:";
  const isTop = window.top === window.self;
  if (!SR) {
    this.ui.micInfo.textContent = "Mic not supported in this browser.";
    return;
  }
  if (!isHttps) {
    this.ui.micInfo.textContent = "Mic requires HTTPS.";
    return;
  }
  if (!isTop) {
    this.ui.micInfo.textContent = "Open the published page (not the editor) to use the mic.";
    return;
  }

  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  this.rec = rec;

  this.ui.micInfo.textContent = "Click mic, speak, pause to send, click again to stop.";

  const showInterim = (t) => {
    if (!this._interimNode) {
      this._interimNode = ce("div", { className: "interim" });
      this.ui.chat.appendChild(this._interimNode);
    }
    this._interimNode.textContent = t || "";
    if (!t) {
      this._interimNode.remove();
      this._interimNode = null;
    }
    this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
  };

  const flushSpeech = () => {
    clearTimeout(this.holdTimer);
    const toSend = this.speechBuf.trim();
    this.speechBuf = "";
    if (toSend) {
      this.addMsg("user", toSend);
      this.updateLearnedFromText(toSend);
      this.ui.input.value = "";
      this.sendText(toSend, true);
      this.stopMic();
    }
  };

  const queueSpeech = (finalChunk) => {
    if (finalChunk && finalChunk.trim()) {
      this.speechBuf += (this.speechBuf ? " " : "") + finalChunk.trim();
    }
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(flushSpeech, this.PAUSE_GRACE_MS);
  };

  this.ui.mic.addEventListener("click", async () => {
    if (this.recActive) {
      flushSpeech();
      this.stopMic();
      return;
    }

    if (!this.primed && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        this.primed = true;
        this.ui.micErr.textContent = "";
      } catch (e) {
        this.ui.micErr.textContent = "Mic permission denied (Site settings -> Microphone).";
        return;
      }
    }

    this.restartWanted = true;
    this.recActive = true;
    this.ui.mic.classList.add("rec");
    this.ui.mic.textContent = "Stop";
    this.ui.micErr.textContent = "";

    try { rec.start(); } catch {}
  });

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) queueSpeech(t);
      else interim += t;
    }
    showInterim(interim);
  };

  rec.onstart = () => showInterim("(listening...)");
  rec.onsoundstart = () => showInterim("(capturing speech...)");

  rec.onerror = (ev) => {
    if (ev.error === "no-speech") this.ui.micErr.textContent = "No speech heard. Try again closer to the mic.";
    else if (ev.error === "not-allowed" || ev.error === "permission-denied") this.ui.micErr.textContent = "Mic blocked. Allow in browser site settings.";
    else if (ev.error !== "aborted") this.ui.micErr.textContent = "Mic error: " + ev.error;
  };

  const finish = () => {
    this.recActive = false;
    this.ui.mic.classList.remove("rec");
    this.ui.mic.textContent = "Mic";
    showInterim("");
    if (this.restartWanted) {
      setTimeout(() => {
        try {
          rec.start();
          this.recActive = true;
          this.ui.mic.classList.add("rec");
          this.ui.mic.textContent = "Stop";
        } catch {}
      }, 300);
    }
  };

  rec.onend = finish;
  rec.onaudioend = finish;
}

downloadTranscript() {
  const nodes = this.ui.chat.querySelectorAll("div");
  let text = "";
  nodes.forEach((n) => { text += n.innerText + "\n"; });
  const blob = new Blob([text.trim()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = ce("a", { href: url });
  a.download =
    "Waterwheel_Lesson_" +
    (this.ui.chapter.value || "unknown") +
    "_" +
    new Date().toISOString().slice(0, 19) +
    ".txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

} // ✅ CLOSE CLASS WaterwheelChat

customElements.define("waterwheel-chat", WaterwheelChat);

})(); // ✅ end of IIFE (only if you started the file with (() => { )
