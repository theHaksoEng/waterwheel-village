window.__WWV_VERSION = "2026-2-7-full-stable";
console.log("WWV script loaded ✅", new Date().toISOString());

(() => {
  // Config
  const DEFAULT_BACKEND = "https://waterwheel-village.onrender.com";
  const MCARTHUR_VOICE = "fEVT2ExfHe1MyjuiIiU9";
  const VOICE_BY_CHAR = Object.freeze({
    mcarthur: "fEVT2ExfHe1MyjuiIiU9",
    kwame: "dhwafD61uVd8h85wAZSE",
    nadia: "a1KZUXKFVFDOb33I1uqr",
    sophia: "0q9TlrIoQJIdxZP9oZh7"
  });

  // Utilities
  const qs = (root, sel) => root.querySelector(sel);
  const ce = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  function normalizeToken(t) {
    t = String(t || "").toLowerCase().trim().replace(/[^\w\s-]/g, "");
    if (!t) return t;
    if (t.endsWith("ies") && t.length > 3) return t.slice(0, -3) + "y";
    if (t.endsWith("s") && t.length > 1) return t.slice(0, -1);
    return t;
  }

  function sanitizeForTTS(str = "") {
    return String(str).replace(/[*_`]/g, "").trim();
  }

  class WaterwheelChat extends HTMLElement {
    constructor() {
      super();
      this.starting = false;
      this.backend = (this.getAttribute("backend") || DEFAULT_BACKEND).replace(/\/+$/, "");
      this.voice = true;
      this.sessionId = localStorage.getItem("wwv-session") || crypto.randomUUID();
      localStorage.setItem("wwv-session", this.sessionId);

      this.wordlist = [];
      this.wordsetEn = new Set();
      this.learned = new Set();
      this.activeCharacter = "mcarthur";
      this.demo = true;
      this.demoVoiceUsed = 0;
      this.demoVoiceMax = 15;
      this.demoVoicedByCharacter = {};
      this.speakQueue = [];
      this.isSpeaking = false;
      this.PAUSE_GRACE_MS = 5000;

      this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
      this.render();
      this.setupListeners();
      this.setupMic();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#0f172a }
          .wrap { border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.06) }
          .top { display:flex; align-items:center; gap:10px; padding:12px; background:#0ea5e9; color:#fff; font-weight:700 }
          .grid { display:flex; height: 550px; border-top: 1px solid #e5e7eb; }
          .col-chat { flex:2; display:flex; flex-direction:column; border-right:1px solid #e5e7eb; }
          .col-words { flex:1; background:#f8fafc; padding:15px; overflow-y:auto; }
          .pane { display:flex; gap:8px; padding:10px; background:#f8fafc; border-bottom:1px solid #e5e7eb; flex-wrap:wrap; }
          .chat { flex:1; overflow-y:auto; padding:15px; display:flex; flex-direction:column; gap:12px; }
          .msg { max-width:80%; padding:10px 14px; border-radius:14px; line-height:1.45; font-size: 15px; }
          .bot { background:#f1f5f9; align-self: flex-start; border:1px solid #e2e8f0; }
          .user { background:#dcfce7; align-self: flex-end; border:1px solid #86efac; }
          .bar { display:flex; gap:8px; padding:12px; border-top:1px solid #e5e7eb; background:#fff; }
          textarea { flex:1; resize:none; height:44px; border:1px solid #d1d5db; border-radius:12px; padding:10px; outline:none; }
          .btn { border:0; background:#0ea5e9; color:#fff; padding:9px 12px; border-radius:10px; cursor:pointer; font-weight:600; }
          .char-btn { width:45px; height:45px; border-radius:50%; cursor:pointer; border:2px solid transparent; transition: 0.2s; }
          .char-btn.active { border-color: #0ea5e9; transform: scale(1.1); }
          .pill { background:#fff; border:1px solid #e2e8f0; border-radius:20px; padding:5px 10px; margin:3px; display:inline-block; font-size:13px; }
          .pill.learned { background:#dcfce7; border-color:#86efac; }
          .progress-wrap { height:10px; background:#e2e8f0; border-radius:5px; margin:10px 0; overflow:hidden; }
          .progress-bar { height:100%; background:#10b981; width:0%; transition: width 0.4s; }
        </style>

        <div class="wrap">
          <div class="top">Waterwheel Village English School</div>
          
          <div class="pane" style="justify-content:center; gap:15px;">
            <img class="char-btn active" data-char="mcarthur" src="${this.backend}/avatars/mcarthur.png">
            <img class="char-btn" data-char="kwame" src="${this.backend}/avatars/kwame.png">
            <img class="char-btn" data-char="nadia" src="${this.backend}/avatars/nadia.png">
            <img class="char-btn" data-char="sophia" src="${this.backend}/avatars/sophia.png">
          </div>

          <div class="pane">
            <input id="userName" placeholder="Your Name" style="width:120px; padding:8px; border-radius:8px; border:1px solid #d1d5db;">
            <select id="month" style="padding:8px; border-radius:8px;">
              <option value="month1">Month 1 – Greetings</option>
              <option value="month2">Month 2 – Home</option>
              <option value="month3">Month 3 – Work</option>
              <option value="month4">Month 4 – Travel</option>
              <option value="month5">Month 5 – Health</option>
              <option value="month6">Month 6 – Nature</option>
            </select>
            <select id="chapter" style="padding:8px; border-radius:8px;">
              <option value="greetings_introductions">Greetings & Introductions</option>
              <option value="food_drink">Food & Drink</option>
              <option value="daily_phrases">Daily Phrases</option>
              <option value="house_furniture">House & Furniture</option>
              <option value="professions_tools">Professions & Tools</option>
              <option value="weather_seasons">Weather & Seasons</option>
            </select>
            <button id="startBtn" class="btn" style="background:#059669">Start Lesson</button>
            <button id="voiceToggle" class="btn" style="background:#64748b">Voice: ON</button>
          </div>

          <div class="grid">
            <div class="col-chat">
              <div id="chat" class="chat"></div>
              <div id="status" style="font-size:12px; padding:5px 15px; color:#64748b;">Ready</div>
              <div class="bar">
                <button id="micBtn" class="btn" style="background:#334155">Mic</button>
                <textarea id="userInput" placeholder="Type to chat..."></textarea>
                <button id="sendBtn" class="btn">Send</button>
              </div>
            </div>
            <div class="col-words">
              <div style="font-weight:700;">Vocabulary Progress</div>
              <div class="progress-wrap"><div id="progBar" class="progress-bar"></div></div>
              <div id="wordList"></div>
            </div>
          </div>
        </div>
        <audio id="player" hidden></audio>
      `;

      this.ui = {
        chat: qs(this.shadowRoot, "#chat"),
        input: qs(this.shadowRoot, "#userInput"),
        send: qs(this.shadowRoot, "#sendBtn"),
        status: qs(this.shadowRoot, "#status"),
        progBar: qs(this.shadowRoot, "#progBar"),
        wordList: qs(this.shadowRoot, "#wordList"),
        player: qs(this.shadowRoot, "#player")
      };
    }

    setupListeners() {
      const root = this.shadowRoot;
      root.getElementById("sendBtn").onclick = () => this.handleSend();
      root.getElementById("startBtn").onclick = () => this.startLesson();
      
      root.querySelectorAll(".char-btn").forEach(btn => {
        btn.onclick = () => {
          root.querySelectorAll(".char-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          this.activeCharacter = btn.dataset.char;
          this.addMsg("bot", `I am now ${this.activeCharacter}. How are you today?`);
        };
      });

      root.getElementById("voiceToggle").onclick = (e) => {
        this.voice = !this.voice;
        e.target.textContent = `Voice: ${this.voice ? "ON" : "OFF"}`;
        if (!this.voice) { this.speakQueue = []; this.ui.player.pause(); }
      };
    }

    addMsg(role, text) {
      const bubble = ce("div", { className: `msg ${role}`, textContent: text });
      this.ui.chat.appendChild(bubble);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      if (role === 'user') this.updateLearned(text);
    }

    async handleSend() {
      const text = this.ui.input.value.trim();
      if (!text) return;
      this.addMsg("user", text);
      this.ui.input.value = "";
      
      this.ui.status.textContent = "Connecting to backend...";
      
      try {
        const r = await fetch(`${this.backend}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text, sessionId: this.sessionId, character: this.activeCharacter,
            name: this.shadowRoot.getElementById("userName").value || "Friend",
            demo: this.demo
          })
        });

        if (!r.ok) throw new Error("Connection failed");

        const data = await r.json();
        this.ui.status.textContent = "Online";
        
        if (data.text) {
          this.addMsg("bot", data.text);
          if (this.voice) this.enqueueSpeak(data.text, data.voiceId || VOICE_BY_CHAR[this.activeCharacter]);
        }
      } catch (e) {
        this.ui.status.textContent = "Error: Check backend connection";
        this.addMsg("bot", "Sorry — chat failed. If the server is waking up, try again in 30 seconds.");
      }
    }

    enqueueSpeak(text, voiceId) {
      this.speakQueue.push({ text: sanitizeForTTS(text), voiceId });
      if (!this.isSpeaking) this.processQueue();
    }

    async processQueue() {
      if (!this.speakQueue.length) { this.isSpeaking = false; return; }
      this.isSpeaking = true;
      const item = this.speakQueue.shift();

      try {
        const r = await fetch(`${this.backend}/speakbase`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: item.text, voiceId: item.voiceId })
        });
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        this.ui.player.src = url;
        await this.ui.player.play();
        this.ui.player.onended = () => { URL.revokeObjectURL(url); this.processQueue(); };
      } catch (e) { this.processQueue(); }
    }

    async startLesson() {
      const m = this.shadowRoot.getElementById("month").value;
      const c = this.shadowRoot.getElementById("chapter").value;
      this.ui.chat.innerHTML = "";
      this.addMsg("bot", `Loading ${c}...`);
      
      try {
        const r = await fetch(`${this.backend}/wordlist/${m}/${c}`);
        const words = await r.json();
        this.wordlist = words.map(w => ({ en: w.en || w, fi: w.fi || "" }));
        this.wordsetEn = new Set(this.wordlist.map(w => w.en.toLowerCase()));
        this.renderWordlist();
        this.addMsg("bot", "Lesson loaded! Let's practice these words.");
      } catch (e) { this.addMsg("bot", "Could not load wordlist."); }
    }

    updateLearned(text) {
      const tokens = text.toLowerCase().split(/\W+/);
      tokens.forEach(t => {
        const n = normalizeToken(t);
        if (this.wordsetEn.has(n)) this.learned.add(n);
      });
      this.renderWordlist();
    }

    renderWordlist() {
      this.ui.wordList.innerHTML = "";
      this.wordlist.forEach(w => {
        const learned = this.learned.has(w.en.toLowerCase());
        const pill = ce("div", { className: `pill ${learned ? 'learned' : ''}`, textContent: w.en });
        this.ui.wordList.appendChild(pill);
      });
      const pct = (this.learned.size / Math.max(1, this.wordlist.length)) * 100;
      this.ui.progBar.style.width = `${pct}%`;
    }

    setupMic() {
      const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Speech) return;
      const rec = new Speech();
      this.shadowRoot.getElementById("micBtn").onclick = () => {
        rec.start();
        this.ui.status.textContent = "Listening...";
        rec.onresult = (e) => { this.ui.input.value = e.results[0][0].transcript; };
        rec.onend = () => { this.ui.status.textContent = "Online"; };
      };
    }
  }

  customElements.define("waterwheel-chat", WaterwheelChat);
})();