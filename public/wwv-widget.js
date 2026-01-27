window.__WWV_VERSION = "2026-01-24-FULL-FIX";
// Load confetti dynamically so we don't need to mess with WordPress HTML
if (!document.getElementById('confetti-script')) {
  const sc = document.createElement('script');
  sc.id = 'confetti-script';
  sc.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js";
  document.head.appendChild(sc);
}
(() => {
  const DEFAULT_BACKEND = "https://waterwheel-village.onrender.com";
  const MCARTHUR_VOICE = "fEVT2ExfHe1MyjuiIiU9";
  const VOICE_BY_CHAR = Object.freeze({
    mcarthur: "fEVT2ExfHe1MyjuiIiU9", kwame: "dhwafD61uVd8h85wAZSE",
    nadia: "a1KZUXKFVFDOb33I1uqr", sophia: "0q9TlrIoQJIdxZP9oZh7",
    liang: "gAMZphRyrWJnLMDnom6H", fatima: "JMbCR4ujfEfGaawA1YtC",
    ibrahim: "tlETan7Okc4pzjD0z62P", alex: "tIFPE2y0DAU6xfZn3Fka",
    anika: "GCPLhb1XrVwcoKUJYcvz", johannes: "JgHmW3ojZwT0NDP5D1JJ"
  });

  const qs = (root, sel) => root.querySelector(sel);
  const ce = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  function normalizeToken(t) {
    t = String(t || "").toLowerCase().trim().replace(/[^\w\s-]/g, "");
    if (!t) return t;
    if (t.endsWith("ies") && t.length > 3) return t.slice(0, -3) + "y";
    if (t.endsWith("es") && t.length > 2) return t.slice(0, -2);
    if (t.endsWith("s") && t.length > 1) return t.slice(0, -1);
    return t;
  }

  function sanitizeForTTS(str = "") {
    return String(str).replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/[_~]/g, "").trim();
  }

  class WaterwheelChat extends HTMLElement {
    constructor() {
      // Expand this to include everyone!
    const VOICE_BY_CHAR = Object.freeze({
     mcarthur: "fEVT2ExfHe1MyjuiIiU9", kwame: "dhwafD61uVd8h85wAZSE",
     nadia: "a1KZUXKFVFDOb33I1uqr", sophia: "0q9TlrIoQJIdxZP9oZh7",
     liang: "gAMZphRyrWJnLMDnom6H", fatima: "JMbCR4ujfEfGaawA1YtC",
     ibrahim: "tlETan7Okc4pzjD0z62P", alex: "tIFPE2y0DAU6xfZn3Fka",
     anika: "GCPLhb1XrVwcoKUJYcvz", johannes: "JgHmW3ojZwT0NDP5D1JJ"
});
      super();
      this.starting = false;
      this.isProcessing = false;
      const attrBackend = (this.getAttribute("backend") || "").trim();
      this.backend = (attrBackend || DEFAULT_BACKEND).replace(/\/+$/, "");
      this.voice = (this.getAttribute("voice") || "on") === "on";
      this.sessionId = localStorage.getItem("wwv-session") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      localStorage.setItem("wwv-session", this.sessionId);

      this.wordlist = [];
      this.wordsetEn = new Set();
      this.learned = new Set();
      this._milestone10 = false;
      this._milestoneComplete = false;
      this.activeCharacter = "mcarthur";
      this.demo = false;
      this.demoVoiceUsed = 0;
      this.demoVoiceMax = 8;
      this.demoVoicedByCharacter = {};
      this.demoMaxChars = 220;
      this.speakQueue = [];
      this.isSpeaking = false;
      
      // Mic state
      this.rec = null;
      this.recActive = false;
      this.speechBuf = "";
      this.holdTimer = null;
      this.PAUSE_GRACE_MS = 6000;

      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: -apple-system, sans-serif; color:#0f172a }
          .wrap { border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.06) }
          .top { padding:12px; background:#0ea5e9; color:#fff; font-weight:700 }
          .grid { display:flex; border-top: 1px solid #e5e7eb; }
          .col-chat { flex:2; min-width:0; border-right:1px solid #e5e7eb; display:flex; flex-direction:column; }
          .col-words { flex:1; min-width:260px; background:#fff }
          .chat { height:460px; overflow-y:auto; padding:14px; background:#fff; display:flex; flex-direction:column; }
          .msg { margin:8px 0; display:flex; }
          .msg.bot { justify-content: flex-start; }
          .msg.user { justify-content: flex-end; }
          .bubble { max-width:85%; padding:10px 14px; border-radius:14px; line-height:1.4; font-size:14px; word-break: break-word; }
          .bot .bubble { background:#f1f5f9; border:1px solid #e2e8f0 }
          .user .bubble { background:#dcfce7; border:1px solid #86efac }
          .bar { display:flex; gap:8px; padding:12px; border-top:1px solid #e5e7eb; background:#f8fafc; }
          textarea { flex:1; border:1px solid #d1d5db; border-radius:10px; padding:8px; resize:none; font-family:inherit; }
          .btn { background:#0ea5e9; color:#fff; border:0; padding:8px 16px; border-radius:10px; cursor:pointer; font-weight:600; transition: opacity 0.2s; }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .char { display:flex; align-items:center; gap:8px; padding:6px 12px; border:1px solid #e5e7eb; border-radius:20px; cursor:pointer; margin:4px; background:white; font-size:13px; font-weight:bold; }
          .char.active { background:#0ea5e9; color:#fff; border-color:#0ea5e9; }
          .pane { padding:10px; display:flex; gap:8px; flex-wrap:wrap; background:#f8fafc; align-items:center; }
          .words { padding:10px; display:flex; flex-wrap:wrap; gap:5px; }
          .pill { padding:4px 10px; background:#f1f5f9; border-radius:15px; font-size:12px; border:1px solid #e2e8f0; cursor:pointer; }
          .pill.learned { background:#dcfce7; border-color:#86efac; }
          .typing { font-size:12px; color:#94a3b8; padding:4px 14px; font-style: italic; }
          .interim { font-style: italic; color: #64748b; font-size: 13px; padding: 5px 14px; }
        </style>
        <div class="wrap">
          <div class="top">Waterwheel Village</div>
          <div class="pane" id="charRow">
            <div class="char active" data-char="mcarthur">McArthur</div>
            <div class="char" data-char="kwame">Kwame</div>
            <div class="char" data-char="nadia">Nadia</div>
            <div class="char" data-char="sophia">Sophia</div>
          </div>
          <div class="pane">
            <input id="name" placeholder="Name" style="width:80px; padding:5px; border-radius:5px; border:1px solid #ccc;"/>
            <select id="month" style="padding:5px; border-radius:5px;"><option value="">Month...</option><option value="month1">Month 1</option></select>
            <select id="chapter" style="padding:5px; border-radius:5px;"><option value="">Chapter...</option><option value="food_drink">Food & Drink</option></select>
            <button id="start" class="btn">Start</button>
            <span id="status" style="font-size:12px"></span>
          </div>
          <div class="grid">
            <div class="col-chat">
              <div id="chat" class="chat"></div>
              <div id="interimArea"></div>
              <div id="typingArea"></div>
              <div class="bar">
                <button id="mic" class="btn" style="background:#64748b">Mic</button>
                <textarea id="input" placeholder="Type message..."></textarea>
                <button id="send" class="btn">Send</button>
              </div>
            </div>
            <div class="col-words">
              <div style="padding:10px; font-weight:bold; font-size:13px; border-bottom:1px solid #eee;">Vocabulary</div>
              <div id="words" class="words"></div>
            </div>
          </div>
        </div>
        <audio id="player" playsinline></audio>
      `;

      this.ui = {
        chat: qs(this.shadowRoot, "#chat"),
        input: qs(this.shadowRoot, "#input"),
        send: qs(this.shadowRoot, "#send"),
        status: qs(this.shadowRoot, "#status"),
        words: qs(this.shadowRoot, "#words"),
        player: qs(this.shadowRoot, "#player"),
        typing: qs(this.shadowRoot, "#typingArea"),
        interim: qs(this.shadowRoot, "#interimArea"),
        name: qs(this.shadowRoot, "#name"),
        month: qs(this.shadowRoot, "#month"),
        chapter: qs(this.shadowRoot, "#chapter"),
        start: qs(this.shadowRoot, "#start"),
        mic: qs(this.shadowRoot, "#mic")
      };
    }

    connectedCallback() {
      // Load saved name
      this.ui.name.value = localStorage.getItem("wwv-name") || "";

      // TEXT SENDING (THE CORE FIX)
      this.ui.send.addEventListener("click", (e) => {
        e.preventDefault();
        this.handleSendAction();
      });

      this.ui.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.handleSendAction();
        }
      });

      // LESSON START
      this.ui.start.addEventListener("click", () => this.startLesson());

      // CHARACTER PICKER
      this.shadowRoot.querySelectorAll(".char").forEach(btn => {
        btn.addEventListener("click", async () => {
          this.shadowRoot.querySelectorAll(".char").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          this.activeCharacter = btn.dataset.char;
          this.addMsg("bot", `Switched to ${this.activeCharacter}.`);
        });
      });

      this.setupMic();
    }

    async handleSendAction() {
      const text = this.ui.input.value.trim();
      if (!text || this.isProcessing) return;

      this.isProcessing = true;
      this.addMsg("user", text);
      this.updateLearnedFromText(text);
      this.ui.input.value = "";
      this.ui.input.focus();

      try {
        await this.sendText(text, false);
      } finally {
        this.isProcessing = false;
      }
    }

    addMsg(role, text) {
      const row = ce("div", { className: `msg ${role}` });
      const bubble = ce("div", { className: "bubble", textContent: text });
      row.appendChild(bubble);
      this.ui.chat.appendChild(row);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    addTyping(show) {
      this.ui.typing.innerHTML = show ? '<div class="typing">Assistant is typing...</div>' : '';
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    async sendText(text, isVoice) {
      this.addTyping(true);
      try {
        const r = await fetch(`${this.backend}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text, sessionId: this.sessionId, isVoice,
            name: this.ui.name.value || "friend",
            character: this.activeCharacter,
            demo: this.demo
          }),
        });
        const d = await r.json();
        this.addTyping(false);
        if (d.text) {
          this.addMsg("bot", d.text);
          if (this.voice) {
             const vid = d.voiceId || VOICE_BY_CHAR[this.activeCharacter] || MCARTHUR_VOICE;
             this.enqueueSpeak(d.text, vid);
          }
        }
        if (d.newlyLearned) this.mergeNewlyLearned(d.newlyLearned);
      } catch (e) {
        this.addTyping(false);
        this.addMsg("bot", "Sorry, I'm having trouble connecting.");
      }
    }

    enqueueSpeak(text, vid) {
      const clean = sanitizeForTTS(text);
      this.speakQueue.push({ text: clean, vid });
      if (!this.isSpeaking) this.processSpeakQueue();
    }

    async processSpeakQueue() {
      if (this.isSpeaking || !this.speakQueue.length) return;
      this.isSpeaking = true;
      const { text, vid } = this.speakQueue.shift();
      try {
        const r = await fetch(`${this.backend}/speakbase`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceId: vid }),
        });
        if (r.ok) {
          const blob = await r.blob();
          this.ui.player.src = URL.createObjectURL(blob);
          await this.ui.player.play();
          this.ui.player.onended = () => {
            this.isSpeaking = false;
            this.processSpeakQueue();
          };
        } else { this.isSpeaking = false; this.processSpeakQueue(); }
      } catch { this.isSpeaking = false; this.processSpeakQueue(); }
    }

    async startLesson() {
      if (this.starting) return;
      const m = this.ui.month.value;
      const c = this.ui.chapter.value;
      if (!m || !c) return alert("Select Month and Chapter");

      this.starting = true;
      this.setStatus("Loading lesson...");
      
      try {
        const wlRes = await fetch(`${this.backend}/wordlist/${m}/${c}`);
        const data = await wlRes.json();
        this.wordlist = (data.words || data).map(w => ({ en: w.en || w, fi: w.fi || "" }));
        this.wordsetEn = new Set(this.wordlist.map(w => w.en.toLowerCase()));
        this.renderWordlist();

        const r = await fetch(`${this.backend}/lesson/${m}/${c}?sessionId=${this.sessionId}&name=${this.ui.name.value}&character=${this.activeCharacter}`);
        const d = await r.json();
        if (d.welcomeText) this.addMsg("bot", d.welcomeText);
        this.setStatus("");
      } catch (e) {
        this.setStatus("Failed to load lesson", true);
      } finally {
        this.starting = false;
      }
    }

    setupMic() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      this.rec = new SR();
      this.rec.continuous = true;
      this.rec.interimResults = true;

      this.ui.mic.addEventListener("click", () => {
        if (this.recActive) {
          this.rec.stop();
        } else {
          this.rec.start();
          this.ui.mic.style.background = "red";
          this.ui.mic.textContent = "Stop";
          this.recActive = true;
        }
      });

      this.rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            this.speechBuf += t;
            clearTimeout(this.holdTimer);
            this.holdTimer = setTimeout(() => {
               if(this.speechBuf.trim()) {
                 this.addMsg("user", this.speechBuf);
                 this.sendText(this.speechBuf, true);
                 this.speechBuf = "";
               }
            }, 2000);
          } else interim += t;
        }
        this.ui.interim.textContent = interim;
      };

      this.rec.onend = () => {
        this.recActive = false;
        this.ui.mic.style.background = "#64748b";
        this.ui.mic.textContent = "Mic";
        this.ui.interim.textContent = "";
      };
    }

    renderWordlist() {
      this.ui.words.innerHTML = "";
      this.wordlist.forEach(w => {
        const p = ce("div", { className: `pill ${this.learned.has(w.en.toLowerCase()) ? 'learned' : ''}`, textContent: w.en });
        this.ui.words.appendChild(p);
      });
    }

    updateLearnedFromText(text) {
      const words = text.toLowerCase().split(/\s+/);
      words.forEach(w => {
        const norm = normalizeToken(w);
        if (this.wordsetEn.has(norm)) this.learned.add(norm);
      });
      this.renderWordlist();
    }

   mergeNewlyLearned(list) {
      if (!list || !Array.isArray(list)) return;
      
      // 1. Add words to the "Learned" set
      list.forEach(w => this.learned.add(w.toLowerCase().trim()));
      
      // 2. Refresh the UI pills
      this.renderWordlist();
      
      // 3. Check if we hit a milestone (Confetti!)
      this.handleMilestones();
    }

    handleMilestones() {
      const count = this.learned.size;
      
      // 10 Word Milestone
      if (count >= 10 && !this._milestone10) {
        this._milestone10 = true;
        this.triggerCelebration("🌟 Milestone: 10 Words Learned!");
      }
      
      // Lesson Complete (All words learned)
      if (this.wordlist.length > 0 && count >= this.wordlist.length && !this._milestoneComplete) {
        this._milestoneComplete = true;
        this.triggerCelebration("🏆 Lesson Mastered!");
      }
    }

    triggerCelebration(msg) {
      this.addMsg("bot", msg);
      // Fire confetti if the library loaded
      if (window.confetti) {
        window.confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#0ea5e9', '#10b981', '#f59e0b']
        });
      }
    }

    setStatus(msg, isErr) {
      if (!this.ui.status) return;
      this.ui.status.textContent = msg;
      this.ui.status.style.color = isErr ? "#b91c1c" : "#334155";
    }