window.__WWV_VERSION = "2026-03-04-mic-pause-fixed";
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

  /* ===============================
     Background Music Helper
  =============================== */

  let wwvMusicStarted = false;

function startWWVMusic() {
  if (wwvMusicStarted) return;   // prevents restarting
  wwvMusicStarted = true;

    const audio = document.getElementById("wwvBgMusic");
    if (!audio) return;

    wwvMusicStarted = true;
    audio.volume = 0;

    const target = 0.2;
    const duration = 3000;
    const stepTime = 50;
    const steps = duration / stepTime;
    const volStep = target / steps;
    let i = 0;

    const fader = setInterval(() => {
      i++;
      audio.volume = Math.min(i * volStep, target);
      if (i >= steps) clearInterval(fader);
    }, stepTime);

    audio.play().catch(() => {
      document.addEventListener("click", () => {
        audio.play();
      }, { once: true });
    });
  }
let wwvMusicFadingOut = false;
function fadeOutWWVMusic(duration = 2000) {
  if (wwvMusicFadingOut) return;
  const audio = document.getElementById("wwvBgMusic");
  if (!audio) return;
  wwvMusicFadingOut = true;
  const startVol = audio.volume;
  const stepTime = 50;
  const steps = duration / stepTime;
  const volStep = startVol / steps;
  let i = 0;
  const fader = setInterval(() => {
    i++;
    audio.volume = Math.max(0, startVol - volStep * i);
    if (i >= steps) {
      clearInterval(fader);
      audio.pause();
      audio.currentTime = 0;
      // DO NOT reset wwvMusicStarted here → music stays "played" for the whole lesson
      wwvMusicFadingOut = false;
    }
  }, stepTime);
}
  // 🔁 Retry helper for sleeping Render server
async function fetchWithRetry(url, options, retries = 2, delay = 15000) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      options.signal = controller.signal;

      const res = await fetch(url, options);
      clearTimeout(timeoutId);

      if (res.ok) return res;

      if (i < retries - 1 && [502,503,504].includes(res.status)) {
        await new Promise(r => setTimeout(r, delay));
        console.log("Retrying fetch — server may be waking up...");
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      if (e.name === "AbortError") {
        console.log("Fetch timeout — retrying…");
      } else throw e;
    }
  }
  throw new Error("Max retries reached");
}

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

  function getWWVMode() {
  // Works even if currentScript is unreliable
  const scripts = Array.from(document.querySelectorAll('script[src*="wwv-widget.js"]'));
  const s = scripts[scripts.length - 1];
  if (!s) return "school";

  // 1) dataset mode if present: <script ... data-mode="demo">
  const fromData = (s.dataset && s.dataset.mode) ? s.dataset.mode : null;

  // 2) or URL param: ...wwv-widget.js?...&mode=demo
  let fromUrl = null;
  try {
    fromUrl = new URL(s.src).searchParams.get("mode");
  } catch (_) {}

  return (fromData || fromUrl || "school").toLowerCase();
}

const isDemoMode = getWWVMode() === "demo";

  // Strip markdown-ish formatting before sending to TTS
  function sanitizeForTTS(str = "") {
    return String(str)
      .replace(/\*\*(.*?)\*\*/g, "$1") // **bold**
      .replace(/\*(.*?)\*/g, "$1")     // *italic*
      .replace(/`([^`]+)`/g, "$1")     // `code`
      .replace(/[_~]/g, "")            // stray emphasis markers
      .trim();
  }
//const params = new URLSearchParams(window.location.search);
//const isDemo = params.get("demo") === "1";

class WaterwheelChat extends HTMLElement {   
  constructor() {
    super();
    this.activeCharacter = this.activeCharacter || "mcarthur";
    this.isProcessing = false; // The safety lock
    this.starting = false;

    // Attributes / backend normalize
    const attrBackend = (this.getAttribute("backend") || "").trim();

    const base = (attrBackend || DEFAULT_BACKEND || "").trim();
    this.backend = base.replace(/\/+$/, "");

    if (!this.backend || /localhost|127\.0\.0\.1/i.test(this.backend)) {
      this.backend = DEFAULT_BACKEND;
    }

    this.voice = (this.getAttribute("voice") || "on") === "on";

    // ⭐ CALL IT HERE (this part was correct)
    this.initSession();

    // State
    this.wordlist = [];

      this.wordsetEn = new Set();    // lowercased english words
      this.learned = new Set();      // learned lowercased words
      this.lastVoiceId = null;
      this._lastAudioUrl = null;

      // ====== WWV PATCH: MODE + SEPARATE SESSIONS (DEMO vs SCHOOL) ======
this.mode = (this.getAttribute("mode") || "school").toLowerCase();
this.demo = (this.mode === "demo");

// Demo limits (only apply when this.demo === true)
this.demoVoiceMax = 5;
this.demoVoiceUsed = 0;
this.demoVoicedByCharacter = {};
this.demoMaxChars = 220;
this.activeCharacter = this.activeCharacter || "mcarthur";

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
      this.PAUSE_GRACE_MS = 9000;

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

const headerText = this.demo 
  ? "Waterwheel Village Academy — Demo"
  : "Waterwheel Village Academy";

/* --- PREMIUM STYLING --- */
this.shadowRoot.innerHTML = `
<style>
  :host { 
    --primary: #0ea5e9; 
    --success: #10b981; 
    --bg-main: #f8fafc;
    --text-dark: #0f172a;
    font-family: 'Inter', -apple-system, sans-serif;
  }
  .wrap { 
    border: none; 
    border-radius: 24px; 
    overflow: hidden; 
    background: var(--bg-main); 
    box-shadow: 0 20px 50px rgba(0,0,0,0.1); 
    display: flex; flex-direction: column;
  }
  .top { 
    padding: 20px; 
    background: linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%); 
    color: #fff; font-weight: 800; font-size: 1.2rem;
    text-align: center; letter-spacing: -0.5px;
  }
  .dash { 
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); 
    gap: 15px; padding: 20px; background: white; border-bottom: 1px solid #f1f5f9;
  }
  .card { 
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; 
    padding: 15px; transition: transform 0.2s;
  }
  .card:hover { transform: translateY(-2px); }
  .card .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .card .value { font-size: 20px; font-weight: 800; color: var(--text-dark); margin: 4px 0; }

  /* Premium Word Cards */
  .words { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; padding: 20px; }
  .pill { 
    background: white; border: 1px solid #e2e8f0; border-radius: 12px; 
    padding: 12px; display: flex; flex-direction: column; align-items: center;
    transition: all 0.2s; cursor: pointer; text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.02);
  }
  .pill:hover { border-color: var(--primary); box-shadow: 0 4px 12px rgba(14, 165, 233, 0.1); }
  .pill.learned { background: #f0fdf4; border-color: #86efac; }
  .pill .en-text { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .pill .fi-text { font-size: 12px; color: #64748b; font-weight: 500; }
  .pill .say { 
    margin-top: 8px; width: 100%; background: #f1f5f9; border-radius: 8px; 
    font-size: 11px; padding: 4px; font-weight: 700;
  }

  /* Chat Bubbles */
  .chat { height: 500px; padding: 20px; background: #fff; scroll-behavior: smooth; }
  .bubble { 
    padding: 14px 18px; border-radius: 20px; font-size: 15px; line-height: 1.6;
    box-shadow: 0 2px 5px rgba(0,0,0,0.03);
  }
  .bot .bubble { background: #f1f5f9; color: var(--text-dark); border-bottom-left-radius: 4px; }
  .user .bubble { background: var(--primary); color: white; border-bottom-right-radius: 4px; }

  /* Input Bar */
  .bar { padding: 20px; background: white; border-top: 1px solid #f1f5f9; display: flex; gap: 12px; }
  textarea { 
    border-radius: 15px; border: 1px solid #e2e8f0; padding: 12px; 
    background: #f8fafc; font-size: 15px;
  }
  .btn-primary { 
    background: var(--primary); color: white; padding: 0 20px; border-radius: 15px; 
    font-weight: 700; transition: opacity 0.2s;
  }
  .mic-btn { 
    width: 50px; height: 50px; border-radius: 15px; background: #f1f5f9; 
    display: flex; align-items: center; justify-content: center;
  }
  .mic-btn.rec { background: #ef4444; color: white; animation: pulse 1.5s infinite; }
  
  @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
</style>

<div class="wrap">
  <div class="top">${headerText}</div>
  
  <!-- Dashboard Section -->
  <div class="dash">
     <div class="card">
       <div class="label">Progress</div>
       <div class="value" id="dashCompletion">0%</div>
     </div>
     <div class="card">
       <div class="label">Vocabulary</div>
       <div class="value"><span id="dashWords">0</span> / <span id="dashWordsTotal">0</span></div>
     </div>
     <div class="card">
       <div class="label">Unit</div>
       <div class="value" style="font-size:14px;" id="dashCourse">Ready to start</div>
     </div>
  </div>

  <div class="grid">
    <div class="col-chat">
      <div id="chat" class="chat"></div>
      <div class="bar">
        <button id="mic" class="mic-btn">🎤</button>
        <textarea id="input" placeholder="Type in English..."></textarea>
        <button id="send" class="btn-primary">Send</button>
      </div>
    </div>
    
    <div class="col-words">
       <div style="padding:20px 20px 0; font-weight:800; display:flex; justify-content:space-between;">
         Unit Wordlist
         <label style="font-weight:400; font-size:12px;"><input type="checkbox" id="showFi"> Finnish</label>
       </div>
       <div id="words" class="words"></div>
    </div>
  </div>
</div>
`;
      const sr = this.shadowRoot;
if (sr) {
  sr.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target : null);
    if (!target) return;

    const btn = target.closest("button.char");
    if (!btn) return;

    const nextChar = btn.getAttribute("data-char");
    if (!nextChar) return;

    // Visual active state
    sr.querySelectorAll("button.char").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Set active character
    this.activeCharacter = nextChar;

    console.log("✅ Character switched to:", nextChar);
  });
}

// UI refs
this.ui = {
  // Common UI (always present in both demo and school)
  chat: qs(this.shadowRoot, "#chat"),
  input: qs(this.shadowRoot, "#input"),
  send: qs(this.shadowRoot, "#send"),
  mic: qs(this.shadowRoot, "#mic"),
  micInfo: qs(this.shadowRoot, "#micInfo"),
  micErr: qs(this.shadowRoot, "#micErr"),
  player: qs(this.shadowRoot, "#player"),
  demoHint: qs(this.shadowRoot, "#demoHint"),  // Assuming this is common; move to school if not
};

if (!this.demo) {
  // School-only UI
  this.ui.name = qs(this.shadowRoot, "#name");
  this.ui.month = qs(this.shadowRoot, "#month");
  this.ui.chapter = qs(this.shadowRoot, "#chapter");
  this.ui.start = qs(this.shadowRoot, "#start");
  this.ui.voiceToggle = qs(this.shadowRoot, "#voiceToggle");
  this.ui.voiceTest = qs(this.shadowRoot, "#voiceTest");
  this.ui.download = qs(this.shadowRoot, "#download");
  this.ui.status = qs(this.shadowRoot, "#status");
  this.ui.wordsWrap = qs(this.shadowRoot, "#words");
  this.ui.showFi = qs(this.shadowRoot, "#showFi");
  this.ui.progBar = qs(this.shadowRoot, "#progBar");
  this.ui.progLbl = qs(this.shadowRoot, "#progLbl");
  this.ui.vocabPanel = qs(this.shadowRoot, ".col-words");
  this.ui.month = qs(this.shadowRoot, "#month");
  this.ui.chapter = qs(this.shadowRoot, "#chapter");
  // Keep dashboard course line in sync
if (this.ui.month) {
  this.ui.month.addEventListener("change", this._updateDashCourseLine.bind(this));
}
if (this.ui.chapter) {
  this.ui.chapter.addEventListener("change", this._updateDashCourseLine.bind(this));
}

// Set it once now (removes placeholder Month 5)
this._updateDashCourseLine();
}
}

/* ---------- Dashboard Course Line ---------- */
_updateDashCourseLine() {
  const sr = this.shadowRoot;
  if (!sr) return;

  const monthText = this.ui && this.ui.month && this.ui.month.selectedOptions[0]
    ? this.ui.month.selectedOptions[0].textContent
    : "";

  const chapterText = this.ui && this.ui.chapter && this.ui.chapter.selectedOptions[0]
    ? this.ui.chapter.selectedOptions[0].textContent
    : "";

  const monthShort = monthText ? monthText.split("–")[0].trim() : "";

  const course = sr.querySelector("#dashCourse");
  if (course) course.textContent = monthShort + " • " + chapterText;
}

initSession() {
  const isDemo = this.getAttribute("mode") === "demo";

  if (isDemo) {
  this.sessionId =
    "demo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);

  localStorage.removeItem("wwv-sessionId");
  this.demoVoiceUsed = 0;
  this.demoVoicedByCharacter = {};
  this.demoTextUsed = 0;
  this.demoTextMax = 8;

  console.log("🚀 WWV DEMO forced fresh sessionId =", this.sessionId);
  return;
}

  // Main school - normal persistent session
  this.demoVoiceUsed = 0;
  this.demoVoicedByCharacter = {};

  let sid = localStorage.getItem("wwv-sessionId");

  if (!sid) {
    sid = crypto?.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(36).slice(2);

    localStorage.setItem("wwv-sessionId", sid);
  }

  this.sessionId = sid;
  console.log("WWV MAIN sessionId =", this.sessionId);
}

avatarUrl(name) {
  return `${this.backend}/avatars/${name}.png`;
}
// 🎉 Milestone celebration (optionally pass milestone number: 10,20,30...)
celebrateMilestone(milestone = null) {
  // Longer + feels “bigger” on higher milestones
  const baseMs = 3500;                 // overall celebration length
  const extra = milestone ? Math.min(milestone * 15, 2500) : 0; // scale a bit
  const totalMs = baseMs + extra;

  this.confettiBurst(totalMs);
  this.playChime().catch(() => {});
}

confettiBurst(totalMs = 3500) {
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

  // We’ll spawn multiple waves over time
  const start = performance.now();
  const waveEveryMs = 260;        // how often to add a wave
  const perWave = 32;             // pieces each wave
  const maxPieces = 260;          // safety cap
  let spawned = 0;

  const spawnWave = () => {
    if (!layer.isConnected) return;

    const now = performance.now();
    if (now - start > totalMs) return;

    // Spawn one wave
    for (let i = 0; i < perWave && spawned < maxPieces; i++) {
      spawned++;

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

      const drift = (Math.random() - 0.5) * 260;
      const spin = (Math.random() - 0.5) * 1100;
      const duration = 1600 + Math.random() * 1200;

      p.animate(
        [
          { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${drift}px, 110vh) rotate(${spin}deg)`, opacity: 1 }
        ],
        { duration, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }
      );

      layer.appendChild(p);
    }

    // Schedule next wave
    setTimeout(spawnWave, waveEveryMs);
  };

  spawnWave();

  // Remove layer after everything has had time to fall
  setTimeout(() => layer.remove(), totalMs + 2200);
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

  // Common UI/event setups (demo + school)
  // 3. Text input + Send button wiring (single source of truth) – moved here from inside click handler
  this.ui.input = this.shadowRoot.querySelector("#input");
  this.ui.send = this.shadowRoot.querySelector("#send");
  this.ui.send?.addEventListener("click", (e) => {
    e.preventDefault();
    this.handleSendAction();
  });
 this.ui.input?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); 
    // Make sure this matches the name of your function (send or handleSendAction)
    this.send(); 
  }
});
  // School-only setups
  if (!this.demo) {
    // 1. Setup Name & LocalStorage
    const savedName = localStorage.getItem("wwv-name") || "friend";
    if (this.ui.name) this.ui.name.value = savedName;
    this.ui.name?.addEventListener("change", () =>
      localStorage.setItem("wwv-name", this.ui.name.value.trim())
    );

    // Other school listeners
    this.ui.start?.addEventListener("click", async () => {
      if (this._lessonStarting) return; // Prevent double-click start
      const m = this.ui.month.value;
      const c = this.ui.chapter.value;
      if (!m || !c) {
        alert("Pick Month and Chapter first");
        return;
      }
      this._lessonStarting = true;
      try {
        this.unlockAudio(); // fire-and-forget (don’t await)
        await this.startLesson(); // lesson starts immediately
      } finally {
        // ✅ ALWAYS release the lock, even if something fails
        this._lessonStarting = false;
      }
    });

    this.ui.voiceToggle?.addEventListener("click", () => {
      this.voice = !this.voice;
      this.ui.voiceToggle.textContent = this.voice ? "Voice: ON" : "Voice: OFF";
    });

    this.ui.voiceTest?.addEventListener("click", async () => {
      await this.unlockAudio();
      const vid = VOICE_BY_CHAR[this.activeCharacter] || this.lastVoiceId || MCARTHUR_VOICE;
      this.enqueueSpeak("Voice test. If you hear this, TTS works.", vid);
    });

    this.ui.download?.addEventListener("click", () => this.downloadTranscript());

    this.ui.showFi?.addEventListener("change", () => this.renderWordlist());
  }

  // Demo-only setups (character picker)
  if (this.demo) {
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

    // Optional: Auto-select initial character or trigger initial greeting if needed
  }

  // Common final inits (both modes)
  this.setupMic();
  this.shadowRoot.querySelectorAll(".demoRow img").forEach((img) => {
    img.addEventListener("error", () => { img.src = "/avatars/mcarthur.png"; });
  });
}
  
  async handleSendAction() {
    const text = (this.ui.input?.value || "").trim();
    if (!text) return;

    this.ui.input.value = "";
    this.ui.input.focus();

    await this.sendText(text, false);
  }

  async send() {
    // This often maps to the 'Send' button
    await this.handleSendAction();
  }
    // Chat bubbles
  addMsg(role, text) {
if (role === "bot" && !wwvMusicStarted) {
  startWWVMusic();
  setTimeout(() => fadeOutWWVMusic(2000), 45000);
}  console.log("ADDMSG called:", role, text, "chatEl=", this.ui.chat);
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
  const wrap = this.ui?.wordsWrap;
  if (!wrap) return;                 // ✅ check the element you actually render into
  wrap.innerHTML = "";

  const showFi = !!this.ui?.showFi?.checked;

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
      if (this.ui?.input) {
        this.ui.input.value =
          (this.ui.input.value ? this.ui.input.value + " " : "") + en;
        this.ui.input.focus();
      }
    });

    wrap.appendChild(pill);
  });

  const total = this.wordlist.length;
  const got = this.learned.size;
  const pct = total ? Math.round((got * 100) / total) : 0;

  if (this.ui?.progBar) this.ui.progBar.style.width = pct + "%";
  if (this.ui?.progLbl) this.ui.progLbl.textContent = `${got} / ${total} learned (${pct}%)`;
  this._updateDashboardFromProgress({
  got,
  total
});
}
_updateDashCourseLine() {
  const sr = this.shadowRoot;
  if (!sr) return;

  const monthText = this.ui?.month?.selectedOptions?.[0]?.textContent || "";
  const chapterText = this.ui?.chapter?.selectedOptions?.[0]?.textContent || "";

  // Keep it short/clean: "Month 2 • House & Furniture (M2)"
  const monthShort = monthText ? monthText.split("–")[0].trim() : "";
  const course = sr.querySelector("#dashCourse");
  if (course) course.textContent = `${monthShort} • ${chapterText}`.trim();
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

  const name = ((this.ui && this.ui.name && this.ui.name.value) ? this.ui.name.value : "friend").trim();

  // ✅ Repeatable milestones: 10,20,30...
  if (this._nextMilestone == null) this._nextMilestone = 10;

  while (learnedCount >= this._nextMilestone) {
    this.addMsg(
      "bot",
      `${name}, you’ve already used ${this._nextMilestone} new words from this unit! Great progress!`
    );
    this.celebrateMilestone(this._nextMilestone);

    if (this.ui.vocabPanel) {
      this.ui.vocabPanel.classList.add("flash-border");
      setTimeout(() => this.ui.vocabPanel.classList.remove("flash-border"), 2000);
    }

    this._nextMilestone += 10;
  }

  // ✅ Chapter complete (unchanged)
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
     const r = await fetchWithRetry(this.backend + "/speakbase", {
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

    const messageId =
      (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const r = await fetchWithRetry(this.backend + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        text:
          'Give a one-line pronunciation tip for: "' +
          word +
          '". Use simple hyphenation with CAPITAL stress (e.g., to-MAY-to). Respond with ONLY the tip line.',
        sessionId: this.sessionId,
        isVoice: false,
        name: ((this.ui && this.ui.name && this.ui.name.value)
          ? this.ui.name.value.trim()
          : "friend"),
        character: this.activeCharacter,
        demo: !!this.demo,
      }),
    });

    const d = await r.json().catch(() => ({}));
    this.addTyping(false);

    if (!r.ok) {
      console.error("pronounceWord chat error:", d);
    }

    if (r.ok && d.text) this.addMsg("bot", d.text);
    else this.addMsg("bot", "Say: " + word);
  } catch (e) {
    this.addTyping(false);
    console.error("pronounceWord failed:", e);
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
}

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
 this._nextMilestone = 10;
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

// ✅ Update dashboard immediately after wordlist loads
this._updateDashboardFromProgress({
  month: m,
  chapter: this.ui?.chapter?.selectedOptions?.[0]?.textContent || c,
  got: this.learned?.size || 0,
  total: this.wordlist?.length || 0
});

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

// Reset background music for new lesson
wwvMusicStarted = false;

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

async send() {
    if (this.isProcessing) return;

    const text = this.ui.input.value.trim();
    if (!text) return;

    this.addMsg("user", text);
    this.updateLearnedFromText(text);
    this.ui.input.value = "";
    await this.sendText(text, false);
  }

async sendText(text, isVoice) {
  if (this.isProcessing) {
    console.warn("Blocked a duplicate sendText call.");
    return;
  }

  const isDemo = this.getAttribute("mode") === "demo";

  // Demo text cap
  this.demoTextUsed = Number(this.demoTextUsed || 0);
  this.demoTextMax = Number(this.demoTextMax || 8);

  if (isDemo && this.demoTextUsed >= this.demoTextMax) {
    this.addMsg("bot", "That is the end of the demo. Please continue in the full version.");
    if (this.ui.input) this.ui.input.disabled = true;
    if (this.ui.send) this.ui.send.disabled = true;
    return;
  }

  console.log("sendText ENTERED", {
    text,
    isVoice,
    demo: isDemo,
    character: this.activeCharacter,
    demoTextUsed: this.demoTextUsed,
    demoTextMax: this.demoTextMax
  });

  this.isProcessing = true;
  this.addTyping(true);

  const userName = (this.ui?.name?.value || "friend").trim();
  const messageId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    const r = await fetchWithRetry(this.backend + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        text,
        sessionId: this.sessionId,
        isVoice: !!isVoice,
        name: userName,
        character: this.activeCharacter,
        mode: isDemo ? "demo" : "school",
        demo: isDemo,
      }),
    });

    console.log("SENDTEXT fetch done. status=", r.status);
    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error((d && d.error) || `HTTP ${r.status}`);
    }

    const reply = d.text || "(no response)";
    if (d.voiceId) this.lastVoiceId = d.voiceId;

    this.addMsg("bot", reply);

    // Count demo TEXT replies
    if (isDemo) {
      this.demoTextUsed += 1;
      console.log("[DEMO TEXT COUNT]", this.demoTextUsed, "/", this.demoTextMax);
    }

    const charKey = d.character || this.activeCharacter || "mcarthur";
    const usedByChar = this.demoVoicedByCharacter?.[charKey] || 0;
    const canVoice = this.voice && (
      !isDemo || (this.demoVoiceUsed < this.demoVoiceMax && usedByChar < 2)
    );

    if (canVoice) {
      const vid = d.voiceId || this.lastVoiceId || MCARTHUR_VOICE;
      const parts = String(reply || "")
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean);

      for (const p of parts) this.enqueueSpeak(p, vid);

      if (isDemo) {
        this.demoVoiceUsed++;
        this.demoVoicedByCharacter = this.demoVoicedByCharacter || {};
        this.demoVoicedByCharacter[charKey] = usedByChar + 1;
      }
    }

    if (d.newlyLearned) this.mergeNewlyLearned(d.newlyLearned);

    if (d.limitReached || d.action === "DEMO_LIMIT_REACHED") {
      if (this.ui.input) this.ui.input.disabled = true;
      if (this.ui.send) this.ui.send.disabled = true;
      return d;
    }

    // Hard stop immediately after the last allowed demo reply
    if (isDemo && this.demoTextUsed >= this.demoTextMax) {
      this.addMsg("bot", "That is the end of the demo. Please continue in the full version.");
      if (this.ui.input) this.ui.input.disabled = true;
      if (this.ui.send) this.ui.send.disabled = true;
    }

    console.log("SENDTEXT done. msg count =", this.ui.chat?.children?.length);
    return d;

  } catch (e) {
    console.error("SENDTEXT error:", e);
    this.addMsg("bot", `Server error: ${e.message}`);
  } finally {
    this.addTyping(false);
    this.isProcessing = false;
    console.log("Gate reset: isProcessing is now false.");
  }
}

setupMic() {
  if (this._micSetupDone) return;
  this._micSetupDone = true;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isHttps = location.protocol === "https:";
  if (!SR) {
    if (this.ui.micInfo) this.ui.micInfo.textContent = "Mic not supported.";
    return;
  }
  if (!isHttps) {
    if (this.ui.micInfo) this.ui.micInfo.textContent = "Mic requires HTTPS.";
    return;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  this.rec = rec;
  this.PAUSE_GRACE_MS = this.PAUSE_GRACE_MS || 3000;
  this.speechBuf = "";
  this.lastSentText = "";
  const showInterim = (t) => {
    if (!this._interimNode) {
      this._interimNode = document.createElement("div");
      this._interimNode.className = "interim";
      if (this.ui.chat) this.ui.chat.appendChild(this._interimNode);
    }
    this._interimNode.textContent = t || "";
    if (!t && this._interimNode) {
      this._interimNode.remove();
      this._interimNode = null;
    }
    if (this.ui.chat) this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
  };
  const flushSpeech = () => {
    clearTimeout(this.holdTimer);
    const toSend = (this.speechBuf || "").trim();
    this.speechBuf = "";
    if (!toSend) return;
    if (toSend === this.lastSentText) {
      console.warn("Blocked duplicate mic transcript:", toSend);
      return;
    }
    if (this.isProcessing) {
      console.warn("Mic flush blocked: System busy.");
      return;
    }
    this.lastSentText = toSend;
    console.log("Mic sending UNIQUE message:", toSend);
    this.addMsg("user", toSend);
    this.updateLearnedFromText(toSend);
    if (this.ui.input) this.ui.input.value = "";
    this.sendText(toSend, true);
  };
  const resetPauseTimer = () => {
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(flushSpeech, this.PAUSE_GRACE_MS);
  };
  this.ui.mic.addEventListener("click", async () => {
    console.log("Mic button clicked. Active:", this.recActive);
    if (this.recActive) {
      this.rec.stop();
      flushSpeech();
      return;
    }
    this.lastSentText = "";
    this.speechBuf = "";
    if (!this.primed && navigator.mediaDevices) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        this.primed = true;
      } catch (e) {
        if (this.ui.micErr) this.ui.micErr.textContent = "Mic permission denied.";
        return;
      }
    }
    this.recActive = true;
    this.ui.mic.classList.add("rec");
    this.ui.mic.textContent = "Stop";
    try {
      rec.start();
    } catch (e) {
      console.error("Mic start error:", e);
    }
  });
  rec.onresult = (e) => {
    if (!e.results.length) return;

    // Fix: Concatenate ALL results' transcripts for full accumulation
    let transcript = '';
    for (let i = 0; i < e.results.length; ++i) {
      transcript += e.results[i][0].transcript;
    }
    transcript = transcript.trim();

    const latest = e.results[e.results.length - 1];

    if (transcript && transcript !== this.lastSentText) {
      this.speechBuf = transcript;
      resetPauseTimer();
    }
    showInterim(latest.isFinal ? "" : transcript);  // Show full interim transcript

    // Fix: Remove this to allow continuous listening
    // if (latest.isFinal) { rec.stop(); }
  };
  rec.onstart = () => {
    showInterim("(listening...)");
  };
  const finish = () => {
    this.recActive = false;
    this.ui.mic.classList.remove("rec");
    this.ui.mic.textContent = "Mic";
    showInterim("");
    clearTimeout(this.holdTimer);
  };
  rec.onend = () => {
    finish();
  };
  rec.onerror = (ev) => {
    console.error("Mic Error:", ev.error);
    finish();
  };
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
_updateDashboardFromProgress(payload) {
  try {
    const sr = this.shadowRoot;
    if (!sr) return;

    const got = Number(payload && payload.got) || 0;
    const total = Number(payload && payload.total) || 0;
    const pct = total ? Math.round((got * 100) / total) : 0;

    const elCompletion = sr.querySelector("#dashCompletion");
    if (elCompletion) elCompletion.textContent = pct + "%";

    const elBar = sr.querySelector("#dashCompletionBar");
    if (elBar) elBar.style.width = pct + "%";

    const elWords = sr.querySelector("#dashWords");
    if (elWords) elWords.textContent = String(got);

    const elWordsTotal = sr.querySelector("#dashWordsTotal");
    if (elWordsTotal) elWordsTotal.textContent = String(total);

    const elWordsPct = sr.querySelector("#dashWordsPct");
    if (elWordsPct) elWordsPct.textContent = pct + "% mastered";
  } catch (e) {
    console.warn("Dashboard update failed:", e);
  }
}
} // ✅ CLOSE CLASS WaterwheelChat

customElements.define("waterwheel-chat", WaterwheelChat);
// ===================== AUTO-MOUNT INTO #wwv-root =====================
function mountWWV() {
  const root = document.getElementById("wwv-root");
  if (!root) return;

  const forcedMode = (root.getAttribute("data-mode") || "").toLowerCase();

  if (forcedMode === "school") {
    // ===================== SCHOOL PAGE (full dashboard) =====================
    root.innerHTML = `
      <waterwheel-chat 
        mode="school" 
        backend="${DEFAULT_BACKEND}" 
        voice="on">
      </waterwheel-chat>
    `;
  } else {
    // ===================== DEMO PAGE (small widget + sales gate) =====================
    root.innerHTML = `
      <div id="wwv-demo-host"></div>
      <div id="wwv-gate-host"></div>
    `;

    // DEMO widget
    document.getElementById("wwv-demo-host").innerHTML = `
      <waterwheel-chat mode="demo" backend="${DEFAULT_BACKEND}" voice="on"></waterwheel-chat>
    `;

    // SALES GATE (unchanged)
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
      window.location.href = "/checkout";
    });
  }
}

// Run safely even if script loads before DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountWWV);
} else {
  mountWWV();
}
})(); // ✅ end of IIFE (only if you started the file with an IIFE)