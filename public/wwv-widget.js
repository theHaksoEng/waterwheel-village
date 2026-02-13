window.__WWV_VERSION = "2026-02-09-split-1";
console.log("WWV script loaded VERSION:", window.__WWV_VERSION);

// @ts-nocheck
// CACHE BUST 20260123 - v80
// Waterwheel Village — Pro Chat Widget (WordPress-safe, no emojis)
console.log("WWV script loaded ✅", new Date().toISOString());
(() => {
  // Config
  const DEFAULT_BACKEND = "https://waterwheel-village.onrender.com";
  const MCARTHUR_VOICE = "fEVT2ExfHe1MyjuiIiU9"; // fixed welcome voice
  const VOICE_BY_CHAR = Object.freeze({
  mcarthur: "fEVT2ExfHe1MyjuiIiU9",
  kwame:    "dhwafD61uVd8h85wAZSE",
  nadia:    "a1KZUXKFVFDOb33I1uqr",
  sophia:   "0q9TlrIoQJIdxZP9oZh7",
  liang:    "gAMZphRyrWJnLMDnom6H",
  fatima:   "JMbCR4ujfEfGaawA1YtC",
  ibrahim:  "tlETan7Okc4pzjD0z62P",
  alex:     "tIFPE2y0DAU6xfZn3Fka",
  anika:    "GCPLhb1XrVwcoKUJYcvz",
  johannes: "JgHmW3ojZwT0NDP5D1JJ"
});

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
this.starting = false;

      // Attributes / backend normalize
      const attrBackend = (this.getAttribute("backend") || "").trim();
      const base = (attrBackend || DEFAULT_BACKEND || "").trim();
      this.backend = base.replace(/\/+$/, "");

      // Hard failsafe: if empty or localhost, force Render
      if (!this.backend || /localhost|127\.0\.0\.1/i.test(this.backend)) {
        this.backend = DEFAULT_BACKEND;
      }

      this.voice = (this.getAttribute("voice") || "on") === "on";
      // ====== WWV PATCH: MODE + SEPARATE SESSIONS (DEMO vs SCHOOL) ======
this.mode = (this.getAttribute("mode") || "demo").toLowerCase();
this.demo = (this.mode === "demo");

// Session (separate keys so demo never pollutes school)
const sessionKey = this.demo ? "wwv-demo-session" : "wwv-school-session";
this.sessionId =
  localStorage.getItem(sessionKey) ||
  (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
localStorage.setItem(sessionKey, this.sessionId);

// Demo limits (only apply when this.demo === true)
this.demoVoiceMax = 5;                 // voiced replies per session
this.demoVoiceUsed = 0;
this.demoVoicedByCharacter = {};       // optional per-character cap
this.demoMaxChars = 220;               // max chars spoken per demo reply
this.activeCharacter = "mcarthur";
// ====== END PATCH ======

      // State
      this.wordlist = [];            // [{en, fi}]
      this.wordsetEn = new Set();    // lowercased english words
      this.learned = new Set();      // learned lowercased words
      this.lastVoiceId = null;
      this._lastAudioUrl = null;

      // ====== WWV PATCH: MODE + SEPARATE SESSIONS (DEMO vs SCHOOL) ======
this.mode = (this.getAttribute("mode") || "demo").toLowerCase();
this.demo = (this.mode === "demo");

// Demo limits (only apply when this.demo === true)
this.demoVoiceMax = 5;
this.demoVoiceUsed = 0;
this.demoVoicedByCharacter = {};
this.demoMaxChars = 220;
this.activeCharacter = "mcarthur";
// ====== END PATCH ======


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
      const demoOnlyUI = this.demo ? `

  <div id="demoRow" class="demoRow">
    <button class="char" data-char="mcarthur">
      <img class="avatar" src="${this.avatarUrl("mcarthur")}" alt="Mr. McArthur">
      <span>McArthur</span>
    </button>
    <button class="char" data-char="kwame">
      <img class="avatar" src="${this.avatarUrl("kwame")}" alt="Kwame">
      <span>Kwame</span>
    </button>
    <button class="char" data-char="nadia">
      <img class="avatar" src="${this.avatarUrl("nadia")}" alt="Nadia">
      <span>Nadia</span>
    </button>
    <button class="char" data-char="sophia">
      <img class="avatar" src="${this.avatarUrl("sophia")}" alt="Sophia">
      <span>Sophia</span>
    </button>
  </div>
` : ``;

const isDemo = !!this.getAttribute("demo"); 
const headerText = isDemo ? "Waterwheel Village Academy — Demo" : "Waterwheel Village Academy";

      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#0f172a }
          .wrap { border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.06) }
          .top { display:flex; align-items:center; gap:10px; padding:12px 14px; background:#0ea5e9; color:#fff; font-weight:700 }
          .grid { display:flex; gap:0; align-items:stretch }
          .col-chat { flex:2; min-width:0; border-right:1px solid #e5e7eb }
          .col-words { flex:1; min-width:260px; background:#fff }

          /* Flash animation for vocab panel on milestones */
          .col-words.flash-border { animation: flash-border 2s ease-in-out; }
          @keyframes flash-border {
            0%   { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
            25%  { box-shadow: 0 0 10px 3px rgba(255, 215, 0, 0.9); }
            50%  { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
            75%  { box-shadow: 0 0 10px 3px rgba(255, 215, 0, 0.9); }
            100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.0); }
          }
            .avatar{
  width:40px;
  height:40px;
  border-radius:50%;
  object-fit:cover;
  margin-right:6px;
}
.char{
  display:flex;
  align-items:center;
  gap:6px;
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

          /* Demo character buttons w/ avatars */
.demoRow { display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:10px 12px; border-bottom:1px solid #e5e7eb; background:#ffffff }

.char{
  display:flex;
  align-items:center;
  gap:10px;
  border:1px solid #e2e8f0;
  background:#ffffff;
  color:#0f172a;
  border-radius:9999px;
  padding:8px 12px 8px 8px;
  cursor:pointer;
  font-weight:700;
  transition: background .2s ease, color .2s ease, border-color .2s ease;
}

.char:hover{ background:#f1f5f9; }

.char.active{
  background:#0ea5e9;
  color:#ffffff;
  border-color:#0ea5e9;
}

.char img{
  width:32px;
  height:32px;
  border-radius:9999px;
  border:1px solid #e2e8f0;
  object-fit:cover;
  flex:0 0 32px;
}

.char.active img{
  border-color: rgba(255,255,255,.55);
}

        </style>

       <div class="wrap" role="region" aria-label="Waterwheel Village Chat">
<div class="top">${headerText}</div>

  ${demoOnlyUI}

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
        <audio id="milestone-sound" preload="auto"></audio>
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
        demoHint: qs(this.shadowRoot, "#demoHint"),
      };
    }
avatarUrl(name) {
  return `${this.backend}/avatars/${name}.png`;
}
celebrateMilestone() {
  this.confettiBurst();
  this.playChime().catch(() => {});
}

confettiBurst() {
  const layer = document.createElement("div");
  layer.style.position = "fixed";
  layer.style.left = "0";
  layer.style.top = "0";
  layer.style.width = "100vw";
  layer.style.height = "100vh";
  layer.style.pointerEvents = "none";
  layer.style.overflow = "hidden";
  layer.style.zIndex = "999999";
  document.body.appendChild(layer);

  const colors = ["#f44336", "#ff9800", "#ffeb3b", "#4caf50", "#2196f3", "#9c27b0"];
  const count = 90;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    const size = 6 + Math.random() * 8;

    p.style.position = "absolute";
    p.style.width = `${size}px`;
    p.style.height = `${Math.max(4, size * 0.6)}px`;
    p.style.left = `${Math.random() * 100}vw`;
    p.style.top = `-20px`;
    p.style.background = colors[(Math.random() * colors.length) | 0];
    p.style.opacity = "0.95";
    p.style.borderRadius = "2px";

    const drift = (Math.random() - 0.5) * 240;
    const spin = (Math.random() - 0.5) * 900;
    const duration = 1200 + Math.random() * 900;

    p.animate(
      [
        { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${drift}px, 110vh) rotate(${spin}deg)`, opacity: 1 }
      ],
      { duration, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }
    );

    layer.appendChild(p);
  }

  setTimeout(() => layer.remove(), 2500);
}

async playChime() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  // Create once and reuse
  this._chimeCtx = this._chimeCtx || new AudioCtx();
  const ctx = this._chimeCtx;

  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return; }
  }

  const now = ctx.currentTime;

  const o = ctx.createOscillator();
  const g = ctx.createGain();

  o.type = "triangle";
  o.frequency.setValueAtTime(880, now);
  o.frequency.exponentialRampToValueAtTime(1320, now + 0.08);

  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

  o.connect(g);
  g.connect(ctx.destination);

  o.start(now);
  o.stop(now + 0.25);
}

connectedCallback() {
  if (this._didInit) return;
  this._didInit = true;
if (!this.demo) {
  this.shadowRoot.getElementById("demoBanner")?.remove();
  this.shadowRoot.getElementById("demoRow")?.remove();
}
  // 1. Setup Name & LocalStorage
  const savedName = localStorage.getItem("wwv-name") || "friend";
  this.ui.name.value = savedName;
  this.ui.name.addEventListener("change", () =>
    localStorage.setItem("wwv-name", this.ui.name.value.trim())
  );

  // 2. Character Picker Logic
  const allChars = Array.from(this.shadowRoot.querySelectorAll(".char"));
  const highlight = () => {
    allChars.forEach((b) => b.classList.toggle("active", (b.getAttribute("data-char") || "") === this.activeCharacter));
  };

 allChars.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const newChar = btn.getAttribute("data-char") || "mcarthur";
    if (newChar === this.activeCharacter) return;
    this.activeCharacter = newChar;
    highlight();
// 3. Text input + Send button wiring (single source of truth)
this.ui = this.ui || {};
this.ui.input = this.shadowRoot.querySelector("#input");
this.ui.send  = this.shadowRoot.querySelector("#send");

this.ui.send?.addEventListener("click", (e) => {
  e.preventDefault();
  this.handleSendAction();
});

this.ui.input?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    this.handleSendAction();
  }
});

    // Map char key to full name for reliable switching
    const nameMap = {
      mcarthur: "Mr. McArthur",
      kwame: "Kwame",
      nadia: "Nadia",
      sophia: "Sophia"
    };
    const fullName = nameMap[newChar] || newChar;

    this.addMsg("bot", `Switched to ${fullName}. Say hello!`);

    // Auto-send a greeting to trigger backend character switch (uses findCharacter + intro)
    const greeting = `Hello ${fullName}`;
    this.addMsg("user", greeting);
    await this.sendText(greeting, false); // false = not from mic
  });
});

  if (!this.activeCharacter) this.activeCharacter = "mcarthur";
  highlight();

 this.ui.start.addEventListener("click", async () => {
  if (this._lessonStarting) return; // Prevent double-click start

  const m = this.ui.month.value;
  const c = this.ui.chapter.value;
  if (!m || !c) {
    alert("Pick Month and Chapter first");
    return;
  }

  this._lessonStarting = true;

  try {
    this.unlockAudio();       // fire-and-forget (don’t await)
    await this.startLesson(); // lesson starts immediately
  } finally {
    // ✅ ALWAYS release the lock, even if something fails
    this._lessonStarting = false;
  }
});

  // 4. Voice Controls
  this.ui.voiceToggle.addEventListener("click", () => {
    this.voice = !this.voice;
    this.ui.voiceToggle.textContent = this.voice ? "Voice: ON" : "Voice: OFF";
  });

  this.ui.voiceTest.addEventListener("click", async () => {
    await this.unlockAudio();
    const vid = VOICE_BY_CHAR[this.activeCharacter] || this.lastVoiceId || MCARTHUR_VOICE;
    this.enqueueSpeak("Voice test. If you hear this, TTS works.", vid);
  });

  // 5. Send & Input Logic (CRITICAL FIX)
  this.ui.send.addEventListener("click", () => this.handleSendAction());

  this.ui.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSendAction();
    }
  });

  // 6. Others
  this.ui.download.addEventListener("click", () => this.downloadTranscript());
  this.ui.showFi.addEventListener("change", () => this.renderWordlist());
  
  this.setupMic();

  this.shadowRoot.querySelectorAll(".demoRow img").forEach((img) => {
    img.addEventListener("error", () => { img.src = "/avatars/mcarthur.png"; });
  });
}

// Helper to prevent the "Double Trigger"
async handleSendAction() {
  const text = (this.ui.input?.value || "").trim();
  if (!text || this.isProcessing) return;

  this.isProcessing = true;

  // 1️⃣ show user message immediately
  this.addMsg("user", text);

  // 2️⃣ clear input immediately (prevents double-send)
  this.ui.input.value = "";
  this.ui.input.focus();

  try {
    // 3️⃣ send to backend
    await this.sendText(text, false);
  } finally {
    this.isProcessing = false;
  }
}
    // Chat bubbles
  addMsg(role, text) {
  console.log("ADDMSG called:", role, text, "chatEl=", this.ui.chat);
  const row = ce("div", { className: "msg " + (role === "user" ? "user" : "bot") });
  const bubble = ce("div", { className: "bubble" });
  bubble.textContent = text;
  row.appendChild(bubble);
  this.ui.chat.appendChild(row);
  this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
  console.log("ADDMSG appended. new count=", this.ui.chat.children.length);
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

    // Wordlist UI
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

        const sayBtn = ce("button", {
          className: "say",
          type: "button",
          textContent: "Say",
        });
        sayBtn.addEventListener("click", () => this.pronounceWord(en));
        pill.appendChild(sayBtn);

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

 handleMilestones() {
  const total = this.wordlist.length;
  const learnedCount = this.learned.size;
  if (!total) return;

  const name = (this.ui.name.value || "friend").trim();

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
    try {
      this.rec.stop();
    } catch (err) {
      console.warn("Error stopping microphone:", err);
    }
  }
}

enqueueSpeak(text, voiceId) {
  if (!text) return;

  // Ensure valid voiceId (fallback chain)
  const vid = voiceId || this.lastVoiceId || MCARTHUR_VOICE;

  let clean = sanitizeForTTS(text);
  if (!clean) return;

  // Demo mode limits
  if (this.demo) {
    if (this.demoVoiceUsed >= this.demoVoiceMax) {
      this.setStatus("Demo voice limit reached. Turn Voice OFF or upgrade.");
      return;
    }

    // Optional: per-character limit (remove if not needed)
    const char = this.activeCharacter || "mcarthur";
    this.demoVoicedByCharacter = this.demoVoicedByCharacter || {};
    const used = this.demoVoicedByCharacter[char] || 0;
    if (used >= 2) {
      this.setStatus("Voice limit for this character in demo mode.");
      return;
    }
  }

  // Deduplication to avoid spamming same audio
  const dedupeKey = `${vid || ""}::${clean}`;
  this._speakDedup = this._speakDedup || new Set();
  if (this._speakDedup.has(dedupeKey)) return;
  if (this._speakDedup.size > 200) this._speakDedup.clear();
  this._speakDedup.add(dedupeKey);

  // Queue and start playback if idle
  this.speakQueue = this.speakQueue || [];
  this.speakQueue.push({ text: clean, voiceId: vid, dedupeKey });

  if (!this.isSpeaking) {
    this.playSpeakQueue();
  }
}

async playSpeakQueue() {
  if (this.isSpeaking) return;
  this.isSpeaking = true;

  // ✅ Use ONE shared audio element (prevents overlap)
  const a = this.ui.player;

  try {
    while (this.speakQueue && this.speakQueue.length) {
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

      // ✅ Handle errors cleanly
      if (!r.ok) {
        const err = await r.text().catch(() => "");
        console.error("TTS failed:", r.status, err);
        this.setStatus("TTS failed (" + r.status + ")");
        this._speakDedup?.delete(dedupeKey);
        continue;
      }

      // ✅ Ensure we actually got audio
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("audio")) {
        const err = await r.text().catch(() => "");
        console.error("TTS returned non-audio:", ct, err.slice(0, 300));
        this.setStatus("TTS returned non-audio");
        this._speakDedup?.delete(dedupeKey);
        continue;
      }

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);

      // ✅ Stop anything currently playing BEFORE starting next chunk
      try {
        if (a) {
          a.pause();
          a.currentTime = 0;
        }
      } catch {}

      // ✅ Play using the same <audio> element (Safari-safe)
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        // Longer timeout prevents early "done" while audio still playing (overlap cause)
        const timer = setTimeout(done, 30000);

        if (!a) {
          clearTimeout(timer);
          done();
          return;
        }

        a.onended = () => { clearTimeout(timer); done(); };
        a.onerror = () => { clearTimeout(timer); done(); };

        a.playsInline = true;
        a.preload = "auto";
        a.src = url;
        a.load();

        const pr = a.play();
        if (pr && pr.catch) {
          pr.catch(() => {
            clearTimeout(timer);
            // Don't block queue forever; just move on
            done();
          });
        }
      });

      // ✅ Revoke after playback finishes
      try { URL.revokeObjectURL(url); } catch {}

      // ✅ allow same exact line later again
      this._speakDedup?.delete(dedupeKey);
    }
  } catch (e) {
    console.error("TTS error:", e);
    this.setStatus("TTS error. Check backend / network.");
  } finally {
    this.isSpeaking = false;
  }
}

    async pronounceWord(word) {
      if (!word) return;

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
  // Standard pattern to unlock audio on a user gesture (Safari/iOS friendly)
  try {
    if (this._audioUnlocked) return;        // ✅ don’t spam attempts
    this._audioUnlocked = true;

    const silent = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
    );
    silent.playsInline = true;

    const pr = silent.play();
    if (pr && pr.catch) await pr.catch((e) => {
      // ✅ Safari often throws AbortError here; ignore it
      if (e && (e.name === "AbortError" || /aborted/i.test(String(e)))) return;
      // ✅ also ignore NotAllowedError if user gesture missing (it’s normal)
      if (e && (e.name === "NotAllowedError" || /notallowed/i.test(String(e)))) return;

      console.warn("Audio unlock failed:", e);
    });
  } catch (e) {
    // last resort: only log non-abort errors
    if (e && (e.name === "AbortError" || /aborted/i.test(String(e)))) return;
    console.warn("Audio unlock failed:", e);
  }
}

setStatus(msg = "", isError = false) {
  if (!this.ui || !this.ui.status) {
    console.log("[STATUS]", isError ? "ERROR:" : "", msg);
    return;
  }
  this.ui.status.textContent = msg;
  this.ui.status.className = isError ? "err" : "hint";
  this.ui.status.style.color = isError ? "#b91c1c" : "#334155";
}  // ← THIS CLOSING BRACE WAS MISSING – ADD IT HERE

// Lesson
async startLesson() {
  if (this.starting) return;
  this.starting = true;
  this.setStatus("Starting lesson...");

  const m = this.ui.month.value;
  const c = this.ui.chapter.value;
  if (!m || !c) {
    alert("Pick Month and Chapter first");
    this.starting = false;
    return;
  }

  const name = (this.ui.name.value || "friend").trim();
  localStorage.setItem("wwv-name", name);

  // Reset UI
  this.wordlist = [];
  this.wordsetEn = new Set();
  this.learned.clear();
  this._milestone10 = false;
  this._milestoneComplete = false;
  this.renderWordlist();
  this.ui.chat.innerHTML = "";
  this.addTyping(false);

  try {
    // Load wordlist
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

    // Start lesson
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
const parts = String(d.lessonText || "")
  .split(/\n\s*\n/)     // paragraphs
  .map(s => s.trim())
  .filter(Boolean);

for (const p of parts) {
  this.enqueueSpeak(p, d.voiceId);
}
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

// Chat
async send() {
  const text = this.ui.input.value.trim();
  if (!text) return;
  this.addMsg("user", text);
  this.updateLearnedFromText(text);
  this.ui.input.value = "";
  await this.sendText(text, false);
}

async sendText(text, isVoice) {
  console.log("sendText ENTERED", { text, isVoice, voice: this.voice });
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
        character: this.activeCharacter,
        demo: !!this.demo,
      }),
    });
async function fetchWithRetry(url, options, retries = 2, delay = 15000) {  // 15s delay for wake-up
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);  // 45s timeout
      options.signal = controller.signal;
      const res = await fetch(url, options);
      clearTimeout(timeoutId);
      if (res.ok) return res;
      if (i < retries - 1 && [502, 503, 504].includes(res.status)) {  // Retry on gateway errors (sleep)
        await new Promise(res => setTimeout(res, delay));
        console.log(`Retrying fetch (${i+1}/${retries}) due to possible server wake-up...`);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        this.setStatus("Request timed out—server may be waking up. Retrying...", true);
      } else throw e;
    }
  }
  throw new Error('Max retries reached');
}
// Usage in sendText/startLesson: const r = await fetchWithRetry(url, { method: 'POST', ... });
    // ✅ DEBUG BIT #1: confirm request success/failure
    console.log("SENDTEXT fetch done. status=", r.status, "ok=", r.ok);

    const d = await r.json().catch(() => ({}));

    // ✅ DEBUG BIT #2: show what came back
    console.log("SENDTEXT response json:", d);

    this.addTyping(false);

    if (!r.ok) {
      console.error("SENDTEXT HTTP error:", r.status, d);
      throw new Error((d && d.error) || "Chat failed");
    }

    const reply = d.text || "(no response)";
    if (d.voiceId) this.lastVoiceId = d.voiceId;

    // Your existing behavior: add bot reply here
    this.addMsg("bot", reply);

    // FIXED VOICE LOGIC (unchanged)
    const charKey = d.character || this.activeCharacter || "mcarthur";
    const usedByChar = this.demoVoicedByCharacter?.[charKey] || 0;
    const canVoice =
      this.voice &&
      (!this.demo || (this.demoVoiceUsed < this.demoVoiceMax && usedByChar < 2));

    if (canVoice) {
      const vid = d.voiceId || this.lastVoiceId || MCARTHUR_VOICE;
      const spokenText = this.demo ? reply.slice(0, this.demoMaxChars) : reply;

      const parts = String(reply || "")
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const p of parts) this.enqueueSpeak(p, vid);

      if (this.demo) {
        this.demoVoiceUsed++;
        this.demoVoicedByCharacter[charKey] = usedByChar + 1;
      }
    }

    if (d.newlyLearned) this.mergeNewlyLearned(d.newlyLearned);
    this.handleMilestones();

    // ✅ DEBUG BIT #3: prove bot message was appended
    console.log("SENDTEXT done. msg count now =", this.ui.chat?.children?.length);

    return d; // ✅ helpful if you ever want handleSendAction to read the reply
  } catch (e) {
    console.error("SENDTEXT error:", e);
    this.addTyping(false);
    this.addMsg("bot", "Sorry, something went wrong sending your message.");
    throw e; // ✅ so calling code can detect failure if needed
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
// ===================== AUTO-MOUNT INTO #wwv-root =====================
function mountWWV() {
  const root = document.getElementById("wwv-root");
  if (!root) return;

  const path = (location.pathname || "").toLowerCase();
  const isSchoolPage = path.includes("/school"); // <-- change if your slug differs

  // ===================== SCHOOL PAGE =====================
  if (isSchoolPage) {
    // ONLY school, no demo, no gate
    root.innerHTML = `
      <waterwheel-chat mode="school" backend="${DEFAULT_BACKEND}" voice="on"></waterwheel-chat>
    `;
    return;
  }

  // ===================== DEMO PAGE =====================
  root.innerHTML = `
    <div id="wwv-demo-host"></div>
    <div id="wwv-gate-host"></div>
  `;

  // DEMO widget
  document.getElementById("wwv-demo-host").innerHTML = `
    <waterwheel-chat mode="demo" backend="${DEFAULT_BACKEND}" voice="on"></waterwheel-chat>
  `;

  // GATE
  document.getElementById("wwv-gate-host").innerHTML = `
    <div style="
      margin:18px 0; padding:18px; border-radius:18px; color:#fff;
      background:linear-gradient(180deg,#081424 0%,#071b2f 45%,#061125 100%);
      box-shadow:0 22px 60px rgba(0,0,0,.35);
      border:1px solid rgba(255,255,255,.10);
      text-align:center;">
      <div style="display:inline-flex; gap:10px; align-items:center; padding:10px 14px; border-radius:999px;
        background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); font-weight:900;">
        🌀 Waterwheel Village Academy
      </div>
      <div style="margin:16px 0 8px; font-size:28px; font-weight:900;">Ready to go beyond the demo?</div>
      <div style="opacity:.85; max-width:60ch; margin:0 auto 16px; line-height:1.6;">
        Unlock all months, all characters, unlimited speaking, and progress tracking.
      </div>
      <button id="enterSchoolBtn" style="
        border:0; border-radius:14px; padding:14px 18px; font-weight:900; font-size:16px; cursor:pointer; color:#fff;
        background:linear-gradient(90deg, rgba(0,255,209,.95), rgba(73,171,255,.95), rgba(165,96,255,.95));
        box-shadow:0 18px 45px rgba(0,0,0,.35), 0 10px 28px rgba(0,255,209,.14);
      ">Start My English Journey →</button>
      <div style="margin-top:10px; font-size:13px; opacity:.75;">Secure checkout • Instant access</div>
    </div>
  `;

  // Button click -> checkout
  document.getElementById("enterSchoolBtn")?.addEventListener("click", () => {
    window.location.href = "/checkout"; // <-- your payment page
  });
}

// Run safely even if script loads before DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountWWV);
} else {
  mountWWV();
}

})(); // ✅ end of IIFE (only if you started the file with an IIFE)