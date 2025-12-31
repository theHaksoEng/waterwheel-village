// Waterwheel Village — Pro Chat Widget (WordPress-safe, no emojis)
(() => {
  // Config
const DEFAULT_BACKEND = "https://waterwheel-village.onrender.com";
  const MCARTHUR_VOICE = "fEVT2ExfHe1MyjuiIiU9"; // fixed welcome voice

  // Utility
  const qs = (root, sel) => root.querySelector(sel);
  const ce = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  // Token normalization (plural-aware)
  function normalizeToken(t) {
    t = String(t || "").toLowerCase().trim().replace(/[^\w\s-]/g, "");
    if (!t) return t;
    if (t.endsWith("ies") && t.length > 3) return t.slice(0, -3) + "y";
    if (t.endsWith("es") && t.length > 2) {
      const base = t.slice(0, -2);
      if (
        base.endsWith("s") || base.endsWith("x") || base.endsWith("z") ||
        base.endsWith("ch") || base.endsWith("sh") || base.endsWith("o")
      ) return base;
    }
    if (t.endsWith("s") && t.length > 1) return t.slice(0, -1);
    return t;
  }

  // Strip markdown-ish formatting before sending to TTS
  function sanitizeForTTS(str = "") {
    return String(str)
      .replace(/\*\*(.*?)\*\*/g, "$1") // **bold**
      .replace(/\*(.*?)\*/g, "$1")     // *italic*
      .replace(/`([^`]+)`/g, "$1")     // `code`
      .replace(/[_~]/g, "")            // stray emphasis markers
      .trim();
  }

  class WaterwheelChat extends HTMLElement {
    constructor() {
      super();
      // Attributes
const attrBackend = (this.getAttribute("backend") || "").trim();
const base = (attrBackend || DEFAULT_BACKEND || "").trim();

// Normalize (remove trailing slashes)
this.backend = base.replace(/\/+$/, "");

// Hard failsafe: if empty or localhost, force Render
if (!this.backend || /localhost|127\.0\.0\.1/i.test(this.backend)) {
  this.backend = "https://waterwheel-village.onrender.com";
}

// Debug (you can remove later)
console.log("WWV backend =", this.backend);

// HARD FAILSAFE: if backend is missing or localhost, force Render
if (!this.getAttribute("backend") || /localhost|127\.0\.0\.1/i.test(this.backend)) {
  this.backend = "https://waterwheel-village.onrender.com";
}
console.log("WWV BACKEND (final):", this.backend);      
      this.voice = (this.getAttribute("voice") || "on") === "on";

      // Session
      this.sessionId =
        localStorage.getItem("wwv-session") ||
        (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      localStorage.setItem("wwv-session", this.sessionId);

      // State
      this.wordlist = [];            // [{en, fi}]
      this.wordsetEn = new Set();    // lowercased english words
      this.learned = new Set();      // learned lowercased words
      this.lastVoiceId = null;
      this.audioReady = true;

      // Milestone flags (per lesson)
      this._milestone10 = false;
      this._milestoneComplete = false;

      // TTS queue
      this.ttsQueue = [];
      this.ttsPlaying = false;

      // Mic / SR state
      this.rec = null;
      this.recActive = false;
      this.primed = false;
      this.restartWanted = false;
      this.speechBuf = "";
      this.holdTimer = null;
      this.PAUSE_GRACE_MS = 6000;

      // Build shadow DOM
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#0f172a }
          .wrap { border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.06) }
          .top { display:flex; align-items:center; gap:10px; padding:12px 14px; background:#0ea5e9; color:#fff; font-weight:700 }
          .grid { display:flex; gap:0; align-items:stretch }
          .col-chat { flex:2; min-width:0; border-right:1px solid #e5e7eb }
          .col-words { flex:1; min-width:260px; background:#fff }

          /* 🔔 Flash animation for vocab panel on milestones */
          .col-words.flash-border {
            animation: flash-border 2s ease-in-out;
          }
          @keyframes flash-border {
            0%   { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
            25%  { box-shadow: 0 0 10px 3px rgba(255, 215, 0, 0.9); }
            50%  { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
            75%  { box-shadow: 0 0 10px 3px rgba(255, 215, 0, 0.9); }
            100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
          }

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
        </style>

        <div class="wrap" role="region" aria-label="Waterwheel Village Chat">
          <div class="top">Waterwheel Village</div>

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

              <!-- Month 1 -->
              <option value="greetings_introductions">Greetings & Introductions (M1)</option>
              <option value="numbers_days_questions">Numbers, Days & Questions (M1)</option>
              <option value="food_drink">Food & Drink (M1)</option>
              <option value="daily_phrases">Daily Phrases (M1)</option>

              <!-- Month 2 -->
              <option value="family_members">Family Members (M2)</option>
              <option value="house_furniture">House & Furniture (M2)</option>
              <option value="routines_chores">Routines & Chores (M2)</option>
              <option value="feelings_emotions">Feelings & Emotions (M2)</option>

              <!-- Month 3 -->
              <option value="professions_tools">Professions & Tools (M3)</option>
              <option value="classroom_office">Classroom & Office (M3)</option>
              <option value="common_tasks">Common Tasks (M3)</option>
              <option value="workplace_dialogues">Workplace Dialogues (M3)</option>

              <!-- Month 4 -->
              <option value="transport">Transport (M4)</option>
              <option value="shops_money">Shops & Money (M4)</option>
              <option value="asking_directions">Asking Directions (M4)</option>
              <option value="eating_restaurants">Eating & Restaurants (M4)</option>

              <!-- Month 5 -->
              <option value="body_health">Body & Health (M5)</option>
              <option value="doctor_medicine">Doctor & Medicine (M5)</option>
              <option value="community_places">Community Places (M5)</option>
              <option value="emergency_phrases">Emergency Phrases (M5)</option>

              <!-- Month 6 -->
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
      `;

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

  connectedCallback() {
  const savedName = localStorage.getItem("wwv-name") || "friend";
  this.ui.name.value = savedName;

  this.ui.name.addEventListener("change", () =>
    localStorage.setItem("wwv-name", this.ui.name.value.trim())
  );

  this.ui.start.addEventListener("click", async () => {
    const m = this.ui.month.value;
    const c = this.ui.chapter.value;
    if (!m || !c) {
      alert("Pick Month and Chapter first");
      return;
    }

    // Prime audio + try intro, but never block the lesson
    await this.unlockAudio();
    try {
      await this.playLessonIntro(m, c);
    } catch (e) {
      console.warn("Intro failed:", e);
    }

    await this.startLesson();
  });

  this.ui.voiceToggle.addEventListener("click", () => {
    this.voice = !this.voice;
    this.ui.voiceToggle.textContent = this.voice ? "Voice: ON" : "Voice: OFF";
  });

  this.ui.voiceTest.addEventListener("click", () => {
    const vid = this.lastVoiceId || MCARTHUR_VOICE;
    this.enqueueSpeak("Voice test: hello from Waterwheel Village.", vid);
  });

  this.ui.download.addEventListener("click", () => this.downloadTranscript());
  this.ui.send.addEventListener("click", () => this.send());

  this.ui.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  });

  this.ui.showFi.addEventListener("change", () => this.renderWordlist());
  this.setupMic();
}

       setStatus(msg) {
      this.ui.status.textContent = msg || "";
    }

    async unlockAudio() {
      const p = this.ui.player;
      if (!p) return;
      try {
        p.muted = true;
        // tiny silent play/pause to satisfy mobile autoplay policies
        const pr = p.play();
        if (pr && pr.catch) await pr.catch(() => {});
        p.pause();
        p.currentTime = 0;
      } catch {
        // ignore
      } finally {
        p.muted = false;
      }
    }

    async playLessonIntro(month, chapter) {
      const p = this.ui.player;
      const base = String(this.backend || "").replace(/\/+$/, "");
      const src = `${base}/audio_lessons/${month}_${chapter}_intro.mp3`;

      console.log("INTRO URL:", src);
      console.log("INTRO SRC:", src);


      try { p.pause(); } catch {}
      try { p.currentTime = 0; } catch {}

      p.preload = "auto";
      p.muted = false;
      p.volume = 1;
      p.src = src;
      p.load();

      // Wait until it can play or errors
      await new Promise((resolve) => {
        const ok = () => resolve();
        const bad = () => resolve(); // resolve so lesson still starts

        p.addEventListener("canplaythrough", ok, { once: true });
        p.addEventListener("error", bad, { once: true });
      });

      // Try to play, but never block lesson start
      try {
        const pr = p.play();
        if (pr && pr.catch) await pr.catch(() => {});
      } catch {
        // ignore
      }
    }

    // Chat bubbles
    addMsg(role, text) {
      const row = ce("div", { className: "msg " + (role === "user" ? "user" : "bot") });
      const bubble = ce("div", { className: "bubble" });
      bubble.textContent = text;
      row.appendChild(bubble);
      this.ui.chat.appendChild(row);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    addTyping(show = true) {
      if (show) {
        if (this._typing) return;
        this._typing = ce("div", { className: "typing" });
        this._typing.textContent = "Assistant is typing...";
        this.ui.chat.appendChild(this._typing);
        this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      } else {
        if (this._typing) {
          this._typing.remove();
          this._typing = null;
        }
      }
    }

    // Wordlist UI (with “Say” buttons)
    renderWordlist() {
      const wrap = this.ui.wordsWrap;
      wrap.innerHTML = "";
      const showFi = this.ui.showFi.checked;
      this.wordlist.forEach(({ en, fi }) => {
        const key = String(en || "").toLowerCase();
        const pill = ce("div", { className: "pill", role: "group" });
        if (this.learned.has(key)) pill.classList.add("learned");

        const label = ce("span", {
          textContent: showFi && fi ? en + " · " + fi : en,
        });
        pill.appendChild(label);

        // Say button
        const sayBtn = ce("button", {
          className: "say",
          type: "button",
          textContent: "Say",
        });
        sayBtn.addEventListener("click", () => this.pronounceWord(en));
        pill.appendChild(sayBtn);

        // Click pill to insert into input (but not when clicking Say button)
        pill.addEventListener("click", (ev) => {
          if (ev.target === sayBtn) return;
          this.ui.input.value =
            (this.ui.input.value ? this.ui.input.value + " " : "") + en;
          this.ui.input.focus();
        });

        wrap.appendChild(pill);
      });
      const total = this.wordlist.length;
      const got = this.learned.size;
      const pct = total ? Math.round((got * 100) / total) : 0;
      this.ui.progBar.style.width = pct + "%";
      this.ui.progLbl.textContent = `${got} / ${total} learned (${pct}%)`;
    }

    // Optimistic highlight on client side from free text
    updateLearnedFromText(text) {
      if (!text) return;
      const toks = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .split(/\s+/)
        .filter(Boolean);
      toks.forEach((tok) => {
        const raw = tok;
        const norm = normalizeToken(tok);
        if (this.wordsetEn.has(raw)) this.learned.add(raw);
        else if (this.wordsetEn.has(norm)) this.learned.add(norm);
      });
      this.renderWordlist();
    }

    mergeNewlyLearned(list) {
      if (!Array.isArray(list)) return;
      list.forEach((w) => {
        if (!w || typeof w !== "string") return;
        const s = w.trim().toLowerCase();
        if (!s || s.indexOf("you've learned all") >= 0) return;
        if (this.wordsetEn.has(s)) this.learned.add(s);
      });
      this.renderWordlist();
    }

    // 🔔 Handle milestones entirely on the frontend
    handleMilestones(_data) {
      const total = this.wordlist.length;
      const learnedCount = this.learned.size;
      if (!total) return;

      const name = (this.ui.name.value || "friend").trim();

      // First time hitting 10 learned words in this chapter
      if (!this._milestone10 && learnedCount >= 10) {
        this._milestone10 = true;

        this.addMsg(
          "bot",
          `${name}, you’ve already used 10 new words from this unit! 🎉 Great progress!`
        );

const bell = this.shadowRoot.getElementById("milestone-sound");
        if (bell) {
          try {
            bell.currentTime = 0;
            bell.play().catch(() => {});
          } catch {
            // ignore
          }
        }

        if (this.ui.vocabPanel) {
          this.ui.vocabPanel.classList.add("flash-border");
          setTimeout(() => this.ui.vocabPanel.classList.remove("flash-border"), 2000);
        }
      }

      // When all words in this chapter are learned
      if (!this._milestoneComplete && learnedCount === total && total > 0) {
        this._milestoneComplete = true;

        const slug = this.ui.chapter.value || "this_lesson";
        const pretty = slug
          .split("_")
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
          .join(" ");
        const badgeTitle = `${pretty} Explorer of Waterwheel Village 🏅`;

        this.addMsg(
          "bot",
          `🎉 You’ve learned all the words for this lesson!\n\n` +
            `(C) talk freely about your week?\n\n` +
            `You are now a ${badgeTitle}`
        );

const bell = this.shadowRoot.getElementById("milestone-sound");
        if (bell) {
          try {
            bell.currentTime = 0;
            bell.play().catch(() => {});
          } catch {
            // ignore
          }
        }

        if (this.ui.vocabPanel) {
          this.ui.vocabPanel.classList.add("flash-border");
          setTimeout(() => this.ui.vocabPanel.classList.remove("flash-border"), 2000);
        }
      }
    }

    // Audio / TTS
    stopMic() {
      this.restartWanted = false;
      if (this.recActive && this.rec) {
        try {
          this.rec.stop();
        } catch {
          // ignore
        }
      }
    }

    enqueueSpeak(text, voiceId) {
      if (!text) return;
      const clean = sanitizeForTTS(text);
      if (!clean) return;
      this.ttsQueue.push({ text: clean, voiceId });
      this.playNextSpeak();
    }

    async playNextSpeak() {
      if (this.ttsPlaying || !this.ttsQueue.length || !this.audioReady) return;
      const { text, voiceId } = this.ttsQueue.shift();
      this.ttsPlaying = true;
      this.stopMic(); // prevent echo
      try {
        const r = await fetch(this.backend + "/speakbase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceId }),
        });
        if (!r.ok) {
          this.addMsg("bot", "(Audio error)");
          this.ttsPlaying = false;
          setTimeout(() => this.playNextSpeak(), 120);
          return;
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        this.ui.player.src = url;
        await new Promise((resolve) => {
          const done = () => {
            this.ui.player.removeEventListener("ended", done);
            this.ui.player.removeEventListener("error", done);
            URL.revokeObjectURL(url);
            resolve();
          };
          this.ui.player.addEventListener("ended", done, { once: true });
          this.ui.player.addEventListener("error", done, { once: true });
          const p = this.ui.player.play();
          if (p && p.catch) {
            p.catch(() =>
              this.setStatus("If muted, click page once to allow audio.")
            );
          }
        });
      } catch {
        this.addMsg("bot", "(Audio unavailable)");
      } finally {
        this.ttsPlaying = false;
        setTimeout(() => this.playNextSpeak(), 120);
      }
    }

    // Speak a word once, mark it as learned, and ask the teacher for a one-line tip
    async pronounceWord(word) {
      if (!word) return;

      // Mark as learned when "Say" is clicked
      const key = String(word || "").toLowerCase().trim();
      if (key && this.wordsetEn && this.wordsetEn.has(key)) {
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
            text:
              'Give a one-line pronunciation tip for: "' +
              word +
              '". Use simple hyphenation with CAPITAL stress (e.g., to-MAY-to). Respond with ONLY the tip line.',
            sessionId: this.sessionId,
            isVoice: false,
            name: this.ui.name.value || "friend",
          }),
        });
        const d = await r.json().catch(() => ({}));
        this.addTyping(false);
        if (r.ok && d.text) {
          this.addMsg("bot", d.text);
        } else {
          this.addMsg("bot", "Say: " + word);
        }
      } catch {
        this.addTyping(false);
        this.addMsg("bot", "Say: " + word);
      }
    }
    // Lesson
    async startLesson() {
      const m = this.ui.month.value,
        c = this.ui.chapter.value;
      if (!m || !c) {
        alert("Pick Month and Chapter first");
        return;
      }
            // ✅ Play STATIC intro MP3 (no ElevenLabs credits)

      const name = (this.ui.name.value || "friend").trim();
      // ▶️ Play static intro audio (NO ElevenLabs)

      localStorage.setItem("wwv-name", name);

      // Reset wordlist state
      this.wordlist = [];
      this.wordsetEn = new Set();
      this.learned.clear();
      this._milestone10 = false;
      this._milestoneComplete = false;
      this.renderWordlist();

      // Clear chat UI for a fresh lesson
      this.ui.chat.innerHTML = "";
      this._typing = null;
      this._interimNode = null;

      // Load wordlist
      try {
        const wlRes = await fetch(
          this.backend +
            "/wordlist/" +
            encodeURIComponent(m) +
            "/" +
            encodeURIComponent(c)
        );
        if (!wlRes.ok) throw new Error("HTTP " + wlRes.status);
        const data = await wlRes.json();
        const raw = Array.isArray(data)
          ? data
          : Array.isArray(data && data.words)
          ? data.words
          : [];
        this.wordlist = raw
          .map((w) => ({
            en: String((w && w.en) || "").trim(),
            fi: String((w && w.fi) || "").trim(),
          }))
          .filter((w) => w.en);
        this.wordsetEn = new Set(this.wordlist.map((w) => w.en.toLowerCase()));
        this.renderWordlist();
        if (this.wordlist.length === 0)
          this.setStatus("No wordlist found for this chapter.");
      } catch (e) {
        console.error("Wordlist fetch failed:", e);
        this.setStatus("Could not load wordlist.");
        this.wordlist = [];
        this.wordsetEn = new Set();
        this.learned.clear();
        this._milestone10 = false;
        this._milestoneComplete = false;
        this.renderWordlist();
      }

      // Start lesson
      try {
        this.setStatus("Starting lesson...");
        const url =
          this.backend +
          "/lesson/" +
          encodeURIComponent(m) +
          "/" +
          encodeURIComponent(c) +
          "?sessionId=" +
          encodeURIComponent(this.sessionId) +
          "&name=" +
          encodeURIComponent(name);
        const r = await fetch(url);
        const d = await r.json();
        if (!r.ok) throw new Error((d && d.error) || "Lesson failed");

       // Show intro text
// ▶️ PLAY STATIC INTRO AUDIO FIRST
try {
} catch (e) {
  console.warn("Intro audio failed or blocked:", e);
}

// 📝 Show intro text (no TTS)
if (d.welcomeText) {
  this.addMsg("bot", d.welcomeText);
}

if (d.lessonText) {
  this.addMsg("bot", d.lessonText);
}

// Save teacher voice for later conversation
if (d.voiceId) this.lastVoiceId = d.voiceId;

        this.setStatus("");
      } catch (e) {
        this.setStatus("Could not start lesson.");
        this.addMsg("bot", "Sorry, I could not start the lesson.");
      }
    }

    // Chat
    async send() {
      const text = this.ui.input.value.trim();
      if (!text) return;
      this.addMsg("user", text);
      this.updateLearnedFromText(text); // optimistic highlight
      this.ui.input.value = "";
      await this.sendText(text, false); // typed input => isVoice=false
    }

    async sendText(text, isVoice) {
      this.addTyping(true);
      try {
        const r = await fetch(this.backend + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            sessionId: this.sessionId,
            isVoice: !!isVoice,
            name: this.ui.name.value || "friend",
          }),
        });
        const d = await r.json().catch(() => ({}));
        this.addTyping(false);
        if (!r.ok) throw new Error((d && d.error) || "Chat failed");

        const reply = d.text || "(no response)";
        if (d.voiceId) this.lastVoiceId = d.voiceId;
        this.addMsg("bot", reply);
        if (this.voice && d.voiceId) this.enqueueSpeak(reply, d.voiceId);

        if (d.newlyLearned) this.mergeNewlyLearned(d.newlyLearned);

        // 🔔 Trigger visual/audio celebration for milestones (frontend-only)
        this.handleMilestones(d);
      } catch (e) {
        this.addTyping(false);
        this.addMsg(
          "bot",
          "Sorry, something went wrong sending your message."
        );
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
        this.ui.micInfo.textContent =
          "Open the published page (not the editor) to use the mic.";
        return;
      }

      const rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      this.rec = rec;

      this.ui.micInfo.textContent =
        "Click mic, speak, pause to send, click again to stop.";

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
          this.sendText(toSend, true); // mic => isVoice=true
          this.stopMic();
        }
      };

      const queueSpeech = (finalChunk) => {
        if (finalChunk && finalChunk.trim()) {
          this.speechBuf +=
            (this.speechBuf ? " " : "") + finalChunk.trim();
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
          } catch {
            this.ui.micErr.textContent =
              "Mic permission denied (Site settings -> Microphone).";
            return;
          }
        }
        this.restartWanted = true;
        this.recActive = true;
        this.ui.mic.classList.add("rec");
        this.ui.mic.textContent = "Stop";
        this.ui.micErr.textContent = "";
        try {
          rec.start();
        } catch {
          // ignore
        }
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
        if (ev.error === "no-speech")
          this.ui.micErr.textContent =
            "No speech heard. Try again closer to the mic.";
        else if (ev.error === "not-allowed" || ev.error === "permission-denied")
          this.ui.micErr.textContent =
            "Mic blocked. Allow in Chrome site settings.";
        else if (ev.error !== "aborted")
          this.ui.micErr.textContent = "Mic error: " + ev.error;
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
            } catch {
              // ignore
            }
          }, 300);
        }
      };
      rec.onend = finish;
      rec.onaudioend = finish;
      rec.onspeechend = () => {};
    }

    downloadTranscript() {
      const nodes = this.ui.chat.querySelectorAll("div");
      let text = "";
      nodes.forEach((n) => {
        text += n.innerText + "\n";
      });
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
  }

  customElements.define("waterwheel-chat", WaterwheelChat);

  // Optional auto-mount helper (only if page has #wwv-root)
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("wwv-root");
    if (root && !root.querySelector("waterwheel-chat")) {
      const el = document.createElement("waterwheel-chat");
// Do NOT force backend here; allow your shortcode/embed to set it.
      el.setAttribute("voice", "on");
      root.appendChild(el);
    }
  });
})();
