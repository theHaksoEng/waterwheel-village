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

      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; }
          .wrap { 
            max-width: 900px; margin: 20px auto; border-radius: 24px; overflow: hidden; 
            background: #ffffff; box-shadow: 0 20px 50px rgba(0,0,0,0.15); border: 1px solid #e2e8f0; 
          }
          .top { 
            padding: 24px; background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); 
            color: #fff; font-weight: 800; font-size: 20px; text-align: center; 
            letter-spacing: -0.5px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }
          
          /* Character Selection Row */
          .char-pane { 
            padding: 15px; display: flex; gap: 8px; overflow-x: auto; 
            background: #f8fafc; border-bottom: 1px solid #e2e8f0; scrollbar-width: none;
          }
          .char-pane::-webkit-scrollbar { display: none; }
          .char { 
            flex: 0 0 auto; padding: 8px 16px; border: 2px solid #e2e8f0; border-radius: 20px; 
            cursor: pointer; transition: all 0.2s; font-size: 13px; font-weight: 600; 
            background: white; white-space: nowrap;
          }
          .char.active { 
            background: #0ea5e9; color: #fff; border-color: #0ea5e9; 
            transform: translateY(-2px); box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3); 
          }

          /* Control Bar (Start Lesson) */
          .control-pane { 
            padding: 15px; display: flex; gap: 10px; flex-wrap: wrap; 
            background: #fff; border-bottom: 1px solid #f1f5f9; align-items: center; 
          }
          .control-pane input, .control-pane select { 
            padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; 
          }

          .grid { display: flex; background: #fff; min-height: 500px; }
          .col-chat { flex: 2; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; }
          .col-words { flex: 1; background: #f8fafc; display: flex; flex-direction: column; }

          .chat { 
            height: 480px; overflow-y: auto; padding: 20px; display: flex; 
            flex-direction: column; gap: 15px; background: #ffffff;
          }

          /* Message Bubbles */
          .msg { display: flex; gap: 10px; align-items: flex-end; }
          .msg.bot { justify-content: flex-start; }
          .msg.user { justify-content: flex-end; flex-direction: row-reverse; }
          .bubble { 
            max-width: 85%; padding: 12px 18px; border-radius: 18px; line-height: 1.5; 
            font-size: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); 
          }
          .bot .bubble { background: #f1f5f9; color: #334155; border-bottom-left-radius: 4px; }
          .user .bubble { background: #0ea5e9; color: #fff; border-bottom-right-radius: 4px; }

          /* Vocab Column */
          .vocab-header { padding: 15px; font-weight: 800; font-size: 14px; border-bottom: 1px solid #e2e8f0; color: #475569; }
          .words { padding: 15px; display: flex; flex-wrap: wrap; gap: 8px; }
          .pill { 
            padding: 6px 14px; background: white; border-radius: 15px; font-size: 12px; 
            border: 1px solid #e2e8f0; color: #64748b; font-weight: 600; transition: 0.3s; 
          }
          .pill.learned { background: #dcfce7; color: #166534; border-color: #86efac; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }

          /* Bottom Bar */
          .bar { padding: 20px; display: flex; gap: 12px; background: #fff; border-top: 1px solid #e2e8f0; }
          textarea { 
            flex: 1; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; 
            resize: none; height: 44px; font-family: inherit; transition: border 0.2s; 
          }
          textarea:focus { border-color: #0ea5e9; outline: none; }
          .btn { 
            background: #0ea5e9; color: white; border: none; padding: 0 20px; 
            border-radius: 12px; font-weight: 700; cursor: pointer; transition: 0.2s; 
          }
          .btn-mic { background: #64748b; }
          .btn:hover { opacity: 0.9; transform: translateY(-1px); }
          
          .typing { padding: 0 20px 10px; font-size: 12px; color: #94a3b8; font-style: italic; }
        </style>

        <div class="wrap">
          <div class="top">🌊 Waterwheel Village Academy</div>
          
          <div class="char-pane" id="charRow">
            <div class="char active" data-char="mcarthur">McArthur</div>
            <div class="char" data-char="fatima">Fatima</div>
            <div class="char" data-char="nadia">Nadia</div>
            <div class="char" data-char="kwame">Kwame</div>
            <div class="char" data-char="liang">Liang</div>
            <div class="char" data-char="sophia">Sophia</div>
            <div class="char" data-char="ibrahim">Ibrahim</div>
            <div class="char" data-char="alex">Alex</div>
            <div class="char" data-char="anika">Anika</div>
            <div class="char" data-char="johannes">Johannes</div>
          </div>

          <div class="control-pane">
            <input id="name" type="text" placeholder="Your Name" style="width: 120px;">
            <select id="month">
              <option value="">Month...</option>
              <option value="month1">Month 1</option>
              <option value="month2">Month 2</option>
              <option value="month3">Month 3</option>
            </select>
            <select id="chapter">
              <option value="">Chapter...</option>
              <option value="food_drink">Food & Drink</option>
              <option value="common_tasks">Common Tasks</option>
              <option value="village_life">Village Life</option>
            </select>
            <button id="start" class="btn">Start Lesson</button>
            <span id="status" style="font-size:12px"></span>
          </div>

          <div class="grid">
            <div class="col-chat">
              <div id="chat" class="chat"></div>
              <div id="typingArea" class="typing"></div>
              <div id="interimArea" class="typing" style="color:#0ea5e9"></div>
              <div class="bar">
                <button id="mic" class="btn btn-mic">Mic</button>
                <textarea id="input" placeholder="Type your message here..."></textarea>
                <button id="send" class="btn">Send</button>
              </div>
            </div>
            <div class="col-words">
              <div class="vocab-header">Vocabulary Progress</div>
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
      list.forEach(w => this.learned.add(w.toLowerCase().trim()));
      this.renderWordlist();
      this.handleMilestones();
    }

    handleMilestones() {
      const count = this.learned.size;
      // 10 Word Milestone
      if (count >= 10 && !this._milestone10) {
        this._milestone10 = true;
        this.triggerCelebration("🌟 Milestone: 10 Words Learned!");
      }
      // Lesson Complete
      if (this.wordlist.length > 0 && count >= this.wordlist.length && !this._milestoneComplete) {
        this._milestoneComplete = true;
        this.triggerCelebration("🏆 Lesson Mastered!");
      }
    }

    triggerCelebration(msg) {
      this.addMsg("bot", msg);
      if (window.confetti) {
        window.confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#0ea5e9', '#10b981', '#f59e0b']
        });
      }
    }

    renderWordlist() {
      if (!this.ui.words) return;
      this.ui.words.innerHTML = "";
      this.wordlist.forEach(w => {
        const isLearned = this.learned.has(w.en.toLowerCase());
        const pill = ce("div", { 
          className: `pill ${isLearned ? 'learned' : ''}`, 
          textContent: w.en 
        });
        if (isLearned) pill.style.background = "#dcfce7"; // Visual "Goodie"
        this.ui.words.appendChild(pill);
      });
    }

    setStatus(msg, isErr) {
      if (!this.ui.status) return;
      this.ui.status.textContent = msg;
      this.ui.status.style.color = isErr ? "#b91c1c" : "#334155";
    }

  } // Closes the Class

  customElements.define("waterwheel-chat", WaterwheelChat);

})(); // Closes the IIFE
