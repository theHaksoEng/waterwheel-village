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

  // Utilities
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

      // Backend URL
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

      // Demo mode
      this.demo = true;
      this.demoVoiceMax = 5;
      this.demoVoiceUsed = 0;
      this.demoVoicedByCharacter = {};
      this.demoMaxChars = 220;
      this.activeCharacter = "mcarthur";
      this.audioReady = true;

      // Milestones & queues
      this._milestone10 = false;
      this._milestoneComplete = false;
      this.ttsQueue = [];
      this.ttsPlaying = false;

      // Mic
      this.rec = null;
      this.recActive = false;
      this.primed = false;
      this.restartWanted = false;
      this.speechBuf = "";
      this.holdTimer = null;
      this.PAUSE_GRACE_MS = 6000;

      // Shadow DOM
      this.attachShadow({ mode: "open" });

      // === FULL TEMPLATE ===
      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#0f172a }
          .wrap { border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.06) }
          .top { display:flex; align-items:center; gap:10px; padding:12px 14px; background:#0ea5e9; color:#fff; font-weight:700 }
          .grid { display:flex; gap:0; align-items:stretch }
          .col-chat { flex:2; min-width:0; border-right:1px solid #e5e7eb }
          .col-words { flex:1; min-width:260px; background:#fff }
          .col-words.flash-border { animation: flash-border 2s ease-in-out; }
          @keyframes flash-border {
            0% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
            25% { box-shadow: 0 0 10px 3px rgba(255, 215, 0, 0.9); }
            50% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
            75% { box-shadow: 0 0 10px 3px rgba(255, 215, 0, 0.9); }
            100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
          }
          .avatar { width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:6px; }
          .char { display:flex; align-items:center; gap:6px; }
          .pane { display:flex; gap:8px; padding:10px 12px; background:#f8fafc; border-bottom:1px solid #e5e7eb; flex-wrap:wrap; align-items:center }
          .pane input, .pane select { border:1px solid #d1d5db; border-radius:10px; padding:8px 10px; outline:none; min-width:140px }
          .btn { border:0; background:#0ea5e9; color:#fff; padding:9px 12px; border-radius:10px; cursor:pointer; font-weight:600 }
          .btn.secondary { background:#334155 }
          .btn.ghost { background:#e2e8f0; color:#0f172a }
          .chat { height:460px; overflow:auto; padding:14px; background:#fff }
          .msg { margin:10px 0; display:flex; gap:10px }
          .msg.user { justify-content:flex-end }
          .bubble { max-width:78%; padding:10px 12px; border-radius:14px; line-height:1.45; white-space:pre-wrap; word-wrap:break-word }
          .bot .bubble { background:#f1f5f9; border:1px solid #e2e8f0 }
          .user .bubble { background:#dcfce7; border:1px solid #86efac }
          .typing { font-size:12px; color:#64748b; padding:0 2px }
          .bar { display:flex; gap:8px; padding:12px; border-top:1px solid #e5e7eb; background:#f8fafc; align-items:center }
          textarea { flex:1; resize:none; min-height:44px; max-height:140px; border:1px solid #d1d5db; border-radius:12px; padding:10px; outline:none }
          .mic { background:#e2e8f0; color:#0f172a; padding:9px 12px; border-radius:10px; cursor:pointer }
          .mic.rec { background:#ef4444; color:#fff }
          .hint { font-size:12px; color:#334155 }
          .err { color:#b91c1c; font-size:12px }
          .interim { font-style:italic; color:#64748b; }
          .words-head { padding:12px 12px 6px 12px; border-bottom:1px solid #e2e8f0 }
          .progress-wrap { margin-top:8px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:10px; height:14px; overflow:hidden }
          .progress-bar { height:100%; width:0%; background:#10b981; transition:width .3s ease }
          .progress-label { font-size:12px; color:#64748b; margin-top:6px }
          .words { padding:10px; display:flex; flex-wrap:wrap; gap:6px }
          .pill { border:1px solid #e2e8f0; border-radius:9999px; padding:6px 10px; font-size:13px; cursor:pointer; background:#f8fafc; color:#0f172a }
          .pill.learned { background:#dcfce7; color:#065f46; border-color:#86efac }
          .pill .say { margin-left:6px; border:0; background:#e2e8f0; color:#0f172a; border-radius:9999px; padding:2px 8px; font-size:12px; cursor:pointer }
          .pill .say:hover { background:#cbd5e1 }
          .demoRow { display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:10px 12px; border-bottom:1px solid #e5e7eb; background:#ffffff }
          .char {
            display:flex; align-items:center; gap:10px;
            border:1px solid #e2e8f0; background:#ffffff; color:#0f172a;
            border-radius:9999px; padding:8px 12px 8px 8px; cursor:pointer; font-weight:700;
            transition: background .2s ease, color .2s ease, border-color .2s ease;
          }
          .char:hover { background:#f1f5f9; }
          .char.active { background:#0ea5e9; color:#ffffff; border-color:#0ea5e9; }
          .char img { width:32px; height:32px; border-radius:9999px; border:1px solid #e2e8f0; object-fit:cover; flex:0 0 32px; }
          .char.active img { border-color: rgba(255,255,255,.55); }
        </style>

        <div class="wrap" role="region" aria-label="Waterwheel Village Chat">
          <div class="top">Waterwheel Village</div>
          <div class="demoRow">
            <button class="char" data-char="mcarthur">
              <img class="avatar" src="${this.backend}/avatars/mcarthur.png" alt="Mr. McArthur">
              <span>McArthur</span>
            </button>
            <button class="char" data-char="kwame">
              <img class="avatar" src="${this.backend}/avatars/kwame.png" alt="Kwame">
              <span>Kwame</span>
            </button>
            <button class="char" data-char="nadia">
              <img class="avatar" src="${this.backend}/avatars/nadia.png" alt="Nadia">
              <span>Nadia</span>
            </button>
            <button class="char" data-char="sophia">
              <img class="avatar" src="${this.backend}/avatars/sophia.png" alt="Sophia">
              <span>Sophia</span>
            </button>
          </div>
          <div class="pane">
            <input id="name" placeholder="Your name" />
            <select id="month">
              <option value="">Month...</option>
              <option value="month1">Month 1 – Greetings & Daily Life</option>
              <option value="month2">Month 2 – Home & Feelings</option>
              <option value="month3">Month 3 – Work & School</option>
              <option value="month4">Month 4 – Travel & Shopping</option>
              <option value="month5">Month 5 – Health & Community</option>
              <option value="month6">Month 6 – Nature & Culture</option>
            </select>
            <select id="chapter">
              <option value="">Chapter...</option>
              <option value="greetings_introductions">Greetings & Introductions (M1)</option>
              <option value="numbers_days_questions">Numbers, Days & Questions (M1)</option>
              <option value="food_drink">Food & Drink (M1)</option>
              <option value="daily_phrases">Daily Phrases (M1)</option>
              <option value="family_members">Family Members (M2)</option>
              <option value="house_furniture">House & Furniture (M2)</option>
              <option value="routines_chores">Routines & Chores (M2)</option>
              <option value="feelings_emotions">Feelings & Emotions (M2)</option>
              <option value="professions_tools">Professions & Tools (M3)</option>
              <option value="classroom_office">Classroom & Office (M3)</option>
              <option value="common_tasks">Common Tasks (M3)</option>
              <option value="workplace_dialogues">Workplace Dialogues (M3)</option>
              <option value="transport">Transport (M4)</option>
              <option value="shops_money">Shops & Money (M4)</option>
              <option value="asking_directions">Asking Directions (M4)</option>
              <option value="eating_restaurants">Eating & Restaurants (M4)</option>
              <option value="body_health">Body & Health (M5)</option>
              <option value="doctor_medicine">Doctor & Medicine (M5)</option>
              <option value="community_places">Community Places (M5)</option>
              <option value="emergency_phrases">Emergency Phrases (M5)</option>
              <option value="weather_seasons">Weather & Seasons (M6)</option>
              <option value="animals_plants_environment">Animals, Plants & Environment (M6)</option>
              <option value="traditions_celebrations">Traditions & Celebrations (M6)</option>
              <option value="review_integration">Review & Integration (M6)</option>
            </select>
            <button id="start" class="btn secondary">Start Lesson</button>
            <button id="voiceToggle" class="btn ghost">Voice: ON</button>
            <button id="voiceTest" class="btn ghost">Test Voice</button>
            <button id="download" class="btn">Download</button>
            <span id="status" class="hint" aria-live="polite" style="margin-left:auto"></span>
          </div>
          <div class="grid">
            <div class="col-chat">
              <div id="chat" class="chat"></div>
              <div class="bar">
                <button id="mic" class="mic" aria-label="Start recording">Mic</button>
                <textarea id="input" placeholder="Type or use the mic... (Shift+Enter = newline)"></textarea>
                <button id="send" class="btn" aria-label="Send message">Send</button>
              </div>
              <div class="pane">
                <span id="micInfo" class="hint"></span>
                <span id="micErr" class="err"></span>
              </div>
            </div>
            <div class="col-words">
              <div class="words-head">
                <div style="font-weight:700; color:#0f172a">Wordlist & Progress</div>
                <div class="progress-wrap">
                  <div id="progBar" class="progress-bar"></div>
                </div>
                <div id="progLbl" class="progress-label">0 / 0 learned (0%)</div>
                <label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12px;color:#334155">
                  <input type="checkbox" id="showFi"> Show Finnish
                </label>
              </div>
              <div id="words" class="words"></div>
            </div>
          </div>
        </div>
        <audio id="player" controls playsinline></audio>
        <audio id="milestone-sound" preload="auto"></audio>
      `;

      // UI refs with null-safety
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

    connectedCallback() {
      if (this._didInit) return;
      this._didInit = true;

      // Name persistence
      const savedName = localStorage.getItem("wwv-name") || "friend";
      if (this.ui.name) {
        this.ui.name.value = savedName;
        this.ui.name.addEventListener("change", () => {
          localStorage.setItem("wwv-name", this.ui.name.value.trim());
        });
      }

      // Character picker
      const allChars = Array.from(this.shadowRoot.querySelectorAll(".char") || []);
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
      if (this.ui.start) {
        this.ui.start.addEventListener("click", async () => {
          if (this._lessonStarting) return;
          const m = this.ui.month?.value;
          const c = this.ui.chapter?.value;
          if (!m || !c) return alert("Pick Month and Chapter first");

          this._lessonStarting = true;
          try {
            await this.unlockAudio();
            await this.startLesson();
          } finally {
            this._lessonStarting = false;
          }
        });
      }

      // Voice controls
      if (this.ui.voiceToggle) {
        this.ui.voiceToggle.addEventListener("click", () => {
          this.voice = !this.voice;
          this.ui.voiceToggle.textContent = this.voice ? "Voice: ON" : "Voice: OFF";
        });
      }

      if (this.ui.voiceTest) {
        this.ui.voiceTest.addEventListener("click", async () => {
          await this.unlockAudio();
          const vid = VOICE_BY_CHAR[this.activeCharacter] || this.lastVoiceId || MCARTHUR_VOICE;
          this.enqueueSpeak("Voice test. If you hear this, TTS works.", vid);
        });
      }

      // Send logic
      const sendHandler = () => this.handleSendAction();
      if (this.ui.send) this.ui.send.addEventListener("click", sendHandler);
      if (this.ui.input) {
        this.ui.input.addEventListener("keydown", e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendHandler();
          }
        });
      }

      if (this.ui.download) this.ui.download.addEventListener("click", () => this.downloadTranscript());
      if (this.ui.showFi) this.ui.showFi.addEventListener("change", () => this.renderWordlist());

      this.setupMic();

      this.shadowRoot.querySelectorAll(".demoRow img").forEach(img => {
        img.addEventListener("error", () => { img.src = `${this.backend}/avatars/mcarthur.png`; });
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
      this.ui.chat?.appendChild(row);
      if (this.ui.chat) this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      console.log("ADDMSG count:", this.ui.chat?.children.length || 0);
    }

    addTyping(show = true) {
      if (show) {
        if (this._typing) return;
        this._typing = ce("div", { className: "typing" });
        this._typing.textContent = "Assistant is typing...";
        this.ui.chat?.appendChild(this._typing);
        if (this.ui.chat) this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      } else {
        if (this._typing) {
          this._typing.remove();
          this._typing = null;
        }
      }
    }

    renderWordlist() {
      const wrap = this.ui.wordsWrap;
      if (!wrap) return;
      wrap.innerHTML = "";
      const showFi = this.ui.showFi?.checked || false;
      this.wordlist.forEach(({ en, fi }) => {
        const key = String(en || "").toLowerCase();
        const pill = ce("div", { className: "pill", role: "group" });
        if (this.learned.has(key)) pill.classList.add("learned");
        const label = ce("span", {
          textContent: showFi && fi ? `${en} · ${fi}` : en,
        });
        pill.appendChild(label);
        const sayBtn = ce("button", {
          className: "say",
          type: "button",
          textContent: "Say",
        });
        sayBtn.addEventListener("click", () => this.pronounceWord(en));
        pill.appendChild(sayBtn);
        pill.addEventListener("click", (ev) => {
          if (ev.target === sayBtn) return;
          if (this.ui.input) {
            this.ui.input.value = (this.ui.input.value ? this.ui.input.value + " " : "") + en;
            this.ui.input.focus();
          }
        });
        wrap.appendChild(pill);
      });
      const total = this.wordlist.length;
      const got = this.learned.size;
      const pct = total ? Math.round((got * 100) / total) : 0;
      if (this.ui.progBar) this.ui.progBar.style.width = pct + "%";
      if (this.ui.progLbl) this.ui.progLbl.textContent = `${got} / ${total} learned (${pct}%)`;
    }

    updateLearnedFromText(text) {
      if (!text) return;
      const toks = text.toLowerCase().replace(/[^\w\s-]/g, "").split(/\s+/).filter(Boolean);
      toks.forEach(tok => {
        const raw = tok;
        const norm = normalizeToken(tok);
        if (this.wordsetEn.has(raw)) this.learned.add(raw);
        else if (this.wordsetEn.has(norm)) this.learned.add(norm);
      });
      this.renderWordlist();
    }

    mergeNewlyLearned(list) {
      if (!Array.isArray(list)) return;
      list.forEach(w => {
        if (!w || typeof w !== "string") return;
        const s = w.trim().toLowerCase();
        if (!s || s.includes("you've learned all")) return;
        if (this.wordsetEn.has(s)) this.learned.add(s);
      });
      this.renderWordlist();
    }

    handleMilestones() {
      const total = this.wordlist.length;
      const learnedCount = this.learned.size;
      if (!total) return;
      const name = (this.ui.name?.value || "friend").trim();
      if (!this._milestone10 && learnedCount >= 10) {
        this._milestone10 = true;
        this.addMsg("bot", `${name}, you’ve already used 10 new words from this unit! Great progress!`);
        this.celebrateMilestone();
        if (this.ui.vocabPanel) {
          this.ui.vocabPanel.classList.add("flash-border");
          setTimeout(() => this.ui.vocabPanel.classList.remove("flash-border"), 2000);
        }
      }
      if (!this._milestoneComplete && learnedCount === total && total > 0) {
        this._milestoneComplete = true;
        this.addMsg("bot", `You’ve learned all the words for this lesson. Nice work!`);
        if (this.ui.vocabPanel) {
          this.ui.vocabPanel.classList.add("flash-border");
          setTimeout(() => this.ui.vocabPanel.classList.remove("flash-border"), 2000);
        }
      }
    }

    stopMic() {
      this.restartWanted = false;
      if (this.recActive && this.rec) {
        try { this.rec.stop(); } catch (err) { console.warn("Error stopping mic:", err); }
      }
    }

    enqueueSpeak(text, voiceId) {
      if (!text) return;
      const vid = voiceId || this.lastVoiceId || MCARTHUR_VOICE;
      let clean = sanitizeForTTS(text);
      if (!clean) return;

      if (this.demo) {
        if (this.demoVoiceUsed >= this.demoVoiceMax) {
          this.setStatus("Demo voice limit reached. Turn Voice OFF or upgrade.");
          return;
        }
        const char = this.activeCharacter || "mcarthur";
        this.demoVoicedByCharacter = this.demoVoicedByCharacter || {};
        const used = this.demoVoicedByCharacter[char] || 0;
        if (used >= 2) {
          this.setStatus("Voice limit for this character in demo mode.");
          return;
        }
      }

      const dedupeKey = `${vid || ""}::${clean}`;
      this._speakDedup = this._speakDedup || new Set();
      if (this._speakDedup.has(dedupeKey)) return;
      if (this._speakDedup.size > 200) this._speakDedup.clear();
      this._speakDedup.add(dedupeKey);

      this.speakQueue = this.speakQueue || [];
      this.speakQueue.push({ text: clean, voiceId: vid, dedupeKey });
      if (!this.isSpeaking) this.playSpeakQueue();
    }

    async playSpeakQueue() {
      if (this.isSpeaking) return;
      this.isSpeaking = true;
      const a = this.ui.player;
      try {
        while (this.speakQueue?.length) {
          const { text, voiceId, dedupeKey } = this.speakQueue.shift();
          if (!this.voice) {
            this._speakDedup?.delete(dedupeKey);
            continue;
          }
          const base = String(this.backend || "").replace(/\/+$/, "");
          const r = await fetch(`${base}/speakbase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voiceId }),
          });
          if (!r.ok) {
            const err = await r.text().catch(() => "");
            console.error("TTS failed:", r.status, err);
            this.setStatus("TTS failed (" + r.status + ")");
            this._speakDedup?.delete(dedupeKey);
            continue;
          }
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          if (!ct.includes("audio")) {
            const err = await r.text().catch(() => "");
            console.error("TTS non-audio:", ct, err.slice(0, 300));
            this.setStatus("TTS returned non-audio");
            this._speakDedup?.delete(dedupeKey);
            continue;
          }
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          try { if (a) { a.pause(); a.currentTime = 0; } } catch {}
          await new Promise(resolve => {
            let settled = false;
            const done = () => { if (!settled) { settled = true; resolve(); } };
            const timer = setTimeout(done, 30000);
            if (!a) { clearTimeout(timer); done(); return; }
            a.onended = () => { clearTimeout(timer); done(); };
            a.onerror = () => { clearTimeout(timer); done(); };
            a.playsInline = true;
            a.preload = "auto";
            a.src = url;
            a.load();
            const pr = a.play();
            if (pr?.catch) pr.catch(() => { clearTimeout(timer); done(); });
          });
          try { URL.revokeObjectURL(url); } catch {}
          this._speakDedup?.delete(dedupeKey);
        }
      } catch (e) {
        console.error("TTS queue error:", e);
        this.setStatus("TTS error. Check backend.");
      } finally {
        this.isSpeaking = false;
      }
    }

    async pronounceWord(word) {
      if (!word) return;
      const key = String(word || "").toLowerCase().trim();
      if (key && this.wordsetEn?.has(key)) {
        this.learned.add(key);
        this.renderWordlist();
      }
      const voiceId = this.lastVoiceId || MCARTHUR_VOICE;
      this.stopMic();
      this.enqueueSpeak(word, voiceId);
      try {
        this.addTyping(true);
        const r = await fetch(this.backend + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Give a one-line pronunciation tip for: "${word}". Use simple hyphenation with CAPITAL stress (e.g., to-MAY-to). Respond with ONLY the tip line.`,
            sessionId: this.sessionId,
            isVoice: false,
            name: this.ui.name?.value || "friend",
            character: this.activeCharacter,
            demo: !!this.demo,
          }),
        });
        const d = await r.json().catch(() => ({}));
        this.addTyping(false);
        if (r.ok && d.text) this.addMsg("bot", d.text);
        else this.addMsg("bot", "Say: " + word);
      } catch (e) {
        this.addTyping(false);
        this.addMsg("bot", "Say: " + word);
      }
    }

    async unlockAudio() {
      try {
        if (this._audioUnlocked) return;
        this._audioUnlocked = true;
        const silent = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=");
        silent.playsInline = true;
        const pr = silent.play();
        if (pr?.catch) await pr.catch(e => {
          if (e.name === "AbortError" || /aborted/i.test(e)) return;
          if (e.name === "NotAllowedError" || /notallowed/i.test(e)) return;
          console.warn("Audio unlock failed:", e);
        });
      } catch (e) {
        if (e.name !== "AbortError" && !/aborted/i.test(e)) console.warn("Audio unlock failed:", e);
      }
    }

    setStatus(msg = "", isError = false) {
      if (!this.ui?.status) {
        console.log("[STATUS]", isError ? "ERROR:" : "", msg);
        return;
      }
      this.ui.status.textContent = msg;
      this.ui.status.className = isError ? "err" : "hint";
      this.ui.status.style.color = isError ? "#b91c1c" : "#334155";
    }

    async startLesson() {
      if (this.starting) return;
      this.starting = true;
      this.setStatus("Starting lesson...");
      const m = this.ui.month?.value;
      const c = this.ui.chapter?.value;
      if (!m || !c) {
        alert("Pick Month and Chapter first");
        this.starting = false;
        return;
      }
      const name = (this.ui.name?.value || "friend").trim();
      localStorage.setItem("wwv-name", name);

      this.wordlist = [];
      this.wordsetEn = new Set();
      this.learned.clear();
      this._milestone10 = false;
      this._milestoneComplete = false;
      this.renderWordlist();
      this.ui.chat.innerHTML = "";
      this.addTyping(false);

      try {
        const wlRes = await fetch(`${this.backend}/wordlist/${encodeURIComponent(m)}/${encodeURIComponent(c)}`);
        if (!wlRes.ok) throw new Error(`Wordlist HTTP ${wlRes.status}`);
        const data = await wlRes.json();
        const raw = Array.isArray(data) ? data : (data.words || data.vocab || data.wordlist || []);
        this.wordlist = raw.map(w => ({
          en: String(w?.en || w || "").trim(),
          fi: String(w?.fi || "").trim()
        })).filter(w => w.en);
        this.wordsetEn = new Set(this.wordlist.map(w => w.en.toLowerCase()));
        this.renderWordlist();
        console.log("Wordlist loaded:", this.wordlist.length, "words");

        const url = `${this.backend}/lesson/${encodeURIComponent(m)}/${encodeURIComponent(c)}?sessionId=${encodeURIComponent(this.sessionId)}&name=${encodeURIComponent(name)}&character=${encodeURIComponent(this.activeCharacter)}&demo=${encodeURIComponent(this.demo ? "1" : "0")}`;
        console.log("Fetching lesson:", url);
        const r = await fetch(url);
        if (!r.ok) {
          const errText = await r.text().catch(() => "");
          throw new Error(`Lesson HTTP ${r.status}: ${errText}`);
        }
        const d = await r.json();
        console.log("Lesson response:", d);

        if (d.welcomeText) {
          this.addMsg("bot", d.welcomeText);
          if (this.voice) {
            await this.unlockAudio();
            this.enqueueSpeak(d.welcomeText, MCARTHUR_VOICE);
          }
        }
        if (d.lessonText) {
          this.addMsg("bot", d.lessonText);
          if (this.voice && d.voiceId) {
            await this.unlockAudio();
            const parts = String(d.lessonText || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
            for (const p of parts) this.enqueueSpeak(p, d.voiceId);
          }
        }
        if (d.voiceId) this.lastVoiceId = d.voiceId;
        this.setStatus("");
      } catch (e) {
        console.error("Start lesson failed:", e);
        this.setStatus("Could not start lesson: " + e.message, true);
        this.addMsg("bot", "Sorry, lesson failed to load. Try again or check connection.");
      } finally {
        this.starting = false;
      }
    }

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
            name: this.ui.name?.value || "friend",
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

        // Handle demo end
        if (d.demoEnded === true) {
          if (this.ui.input) this.ui.input.disabled = true;
          if (this.ui.input) this.ui.input.placeholder = "Demo complete — thank you!";
          if (this.ui.send) this.ui.send.disabled = true;
          if (this.ui.mic) this.ui.mic.disabled = true;

          const endNote = ce("div", { className: "msg system" });
          const bubble = ce("div", { className: "bubble", style: "background:#e2e8f0; text-align:center; font-weight:bold;" });
          bubble.textContent = "→ This concludes the demo. Refresh page to start again!";
          endNote.appendChild(bubble);
          this.ui.chat?.appendChild(endNote);
          if (this.ui.chat) this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
          this.setStatus("Demo session ended.", false);
        }

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

        console.log("SENDTEXT done. msg count =", this.ui.chat?.children.length || 0);
        return d;
      } catch (e) {
        console.error("SENDTEXT error:", e);
        this.addTyping(false);
        this.addMsg("bot", "Sorry — chat failed. Try again or refresh.");
        this.setStatus("Communication error. Check connection.", true);
        throw e;
      }
    }

    setupMic() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const isHttps = location.protocol === "https:";
      const isTop = window.top === window.self;
      if (!SR) {
        if (this.ui.micInfo) this.ui.micInfo.textContent = "Mic not supported in this browser.";
        return;
      }
      if (!isHttps) {
        if (this.ui.micInfo) this.ui.micInfo.textContent = "Mic requires HTTPS.";
        return;
      }
      if (!isTop) {
        if (this.ui.micInfo) this.ui.micInfo.textContent = "Open the published page (not the editor) to use the mic.";
        return;
      }

      const rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      this.rec = rec;

      if (this.ui.micInfo) this.ui.micInfo.textContent = "Click mic, speak, pause to send, click again to stop.";

      const showInterim = (t) => {
        if (!this._interimNode) {
          this._interimNode = ce("div", { className: "interim" });
          this.ui.chat?.appendChild(this._interimNode);
        }
        this._interimNode.textContent = t || "";
        if (!t) {
          this._interimNode.remove();
          this._interimNode = null;
        }
        if (this.ui.chat) this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      };

      const flushSpeech = () => {
        clearTimeout(this.holdTimer);
        const toSend = this.speechBuf.trim();
        this.speechBuf = "";
        if (toSend) {
          this.addMsg("user", toSend);
          this.updateLearnedFromText(toSend);
          if (this.ui.input) this.ui.input.value = "";
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

      if (this.ui.mic) {
        this.ui.mic.addEventListener("click", async () => {
          if (this.recActive) {
            flushSpeech();
            this.stopMic();
            return;
          }
          if (!this.primed && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
              const s = await navigator.mediaDevices.getUserMedia({ audio: true });
              s.getTracks().forEach(t => t.stop());
              this.primed = true;
              if (this.ui.micErr) this.ui.micErr.textContent = "";
            } catch (e) {
              if (this.ui.micErr) this.ui.micErr.textContent = "Mic permission denied (Site settings -> Microphone).";
              return;
            }
          }
          this.restartWanted = true;
          this.recActive = true;
          this.ui.mic.classList.add("rec");
          this.ui.mic.textContent = "Stop";
          if (this.ui.micErr) this.ui.micErr.textContent = "";
          try { rec.start(); } catch {}
        });
      }

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
        if (ev.error === "no-speech") {
          if (this.ui.micErr) this.ui.micErr.textContent = "No speech heard. Try again closer to the mic.";
        } else if (ev.error === "not-allowed" || ev.error === "permission-denied") {
          if (this.ui.micErr) this.ui.micErr.textContent = "Mic blocked. Allow in browser site settings.";
        } else if (ev.error !== "aborted") {
          if (this.ui.micErr) this.ui.micErr.textContent = "Mic error: " + ev.error;
        }
      };

      const finish = () => {
        this.recActive = false;
        if (this.ui.mic) {
          this.ui.mic.classList.remove("rec");
          this.ui.mic.textContent = "Mic";
        }
        showInterim("");
        if (this.restartWanted) {
          setTimeout(() => {
            try {
              rec.start();
              this.recActive = true;
              if (this.ui.mic) {
                this.ui.mic.classList.add("rec");
                this.ui.mic.textContent = "Stop";
              }
            } catch {}
          }, 300);
        }
      };

      rec.onend = finish;
      rec.onaudioend = finish;
    }

    downloadTranscript() {
      const nodes = this.ui.chat?.querySelectorAll("div") || [];
      let text = "";
      nodes.forEach(n => { text += n.innerText + "\n"; });
      const blob = new Blob([text.trim()], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = ce("a", { href: url });
      a.download = "Waterwheel_Lesson_" +
        (this.ui.chapter?.value || "unknown") + "_" +
        new Date().toISOString().slice(0, 19) + ".txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }

  customElements.define("waterwheel-chat", WaterwheelChat);
})();