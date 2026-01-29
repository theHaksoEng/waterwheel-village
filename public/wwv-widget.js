/* 🌊 Waterwheel Village Academy - FULL MASTER VERSION 2026 */
if (!document.getElementById('confetti-script')) {
  const sc = document.createElement('script');
  sc.id = 'confetti-script';
  sc.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js";
  document.head.appendChild(sc);
}

(() => {
  const ce = (t, a = {}, c = []) => {
    const e = document.createElement(t);
    Object.assign(e, a);
    c.forEach(child => e.appendChild(child));
    return e;
  };

  const VOICE_BY_CHAR = Object.freeze({
    mcarthur: "fEVT2ExfHe1MyjuiIiU9", kwame: "dhwafD61uVd8h85wAZSE",
    nadia: "a1KZUXKFVFDOb33I1uqr", sophia: "0q9TlrIoQJIdxZP9oZh7",
    liang: "gAMZphRyrWJnLMDnom6H", fatima: "JMbCR4ujfEfGaawA1YtC",
    ibrahim: "tlETan7Okc4pzjD0z62P", alex: "tIFPE2y0DAU6xfZn3Fka",
    anika: "GCPLhb1XrVwcoKUJYcvz", johannes: "JgHmW3ojZwT0NDP5D1JJ"
  });

  class WaterwheelChat extends HTMLElement {
    constructor() {
      super();
      this.backend = "https://waterwheel-village.onrender.com";
      this.sessionId = localStorage.getItem("wwv-session") || crypto.randomUUID();
      localStorage.setItem("wwv-session", this.sessionId);
      
      this.learned = new Set();
      this.wordlist = [];
      this.activeCharacter = "mcarthur";
      this._milestone10 = false;
      this.isProcessing = false;

      this.attachShadow({ mode: "open" });
      this.renderUI();
    }

    renderUI() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: 'Inter', -apple-system, sans-serif; }
          .wrap { max-width: 950px; margin: 20px auto; border-radius: 24px; overflow: hidden; background: #fff; box-shadow: 0 20px 50px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
          .top { padding: 24px; background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color: #fff; font-weight: 800; font-size: 20px; text-align: center; }
          
          .char-pane { display: flex; gap: 10px; padding: 15px; overflow-x: auto; background: #f8fafc; border-bottom: 1px solid #e2e8f0; scrollbar-width: none; }
          .char-pane::-webkit-scrollbar { display: none; }
          .char { flex: 0 0 auto; padding: 10px 20px; border: 2px solid #e2e8f0; border-radius: 25px; cursor: pointer; background: #fff; font-size: 13px; font-weight: 700; transition: 0.2s; }
          .char.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; transform: translateY(-2px); box-shadow: 0 5px 15px rgba(14, 165, 233, 0.4); }

          .lesson-controls { padding: 15px; display: flex; gap: 10px; background: #fff; border-bottom: 1px solid #f1f5f9; justify-content: center; align-items: center; }
          select, input { padding: 10px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 13px; }

          .grid { display: flex; height: 550px; background: #fff; }
          .col-chat { flex: 2; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; }
          .col-words { flex: 1; background: #f8fafc; padding: 20px; overflow-y: auto; }

          .chat { flex: 1; overflow-y: auto; padding: 25px; display: flex; flex-direction: column; gap: 15px; background: #ffffff; }
          .bubble { max-width: 80%; padding: 14px 18px; border-radius: 20px; font-size: 15px; line-height: 1.6; position: relative; }
          .bot-msg { background: #f1f5f9; color: #334155; align-self: flex-start; border-bottom-left-radius: 4px; }
          .user-msg { background: #0ea5e9; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }

          .bar { padding: 20px; display: flex; gap: 12px; background: #fff; border-top: 1px solid #e2e8f0; }
          textarea { flex: 1; border: 1px solid #e2e8f0; border-radius: 15px; padding: 15px; resize: none; height: 50px; font-family: inherit; font-size: 14px; }
          .btn { background: #0ea5e9; color: #fff; border: none; padding: 0 25px; border-radius: 15px; font-weight: 700; cursor: pointer; transition: 0.2s; }
          .btn:disabled { background: #94a3b8; }
          
          .pill { display: inline-block; padding: 8px 15px; margin: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; font-size: 12px; font-weight: 600; color: #64748b; }
          .pill.learned { background: #dcfce7; color: #166534; border-color: #86efac; transform: scale(1.05); }
          #status { padding: 5px 20px; font-size: 12px; color: #64748b; }
        </style>

        <div class="wrap">
          <div class="top">🌊 Waterwheel Village Academy</div>
          <div class="char-pane" id="charRow">
            ${Object.keys(VOICE_BY_CHAR).map(c => `<div class="char ${c==='mcarthur'?'active':''}" data-char="${c}">${c.charAt(0).toUpperCase()+c.slice(1)}</div>`).join('')}
          </div>

          <div class="lesson-controls">
            <input type="text" id="userName" placeholder="Your Name" style="width:140px">
            <select id="monthSelect"><option value="month1">Month 1</option></select>
            <select id="chapterSelect"><option value="food_drink">Food & Drink</option></select>
            <button id="startBtn" class="btn">Start Lesson</button>
          </div>

          <div class="grid">
            <div class="col-chat">
              <div id="chat" class="chat"></div>
              <div id="status"></div>
              <div class="bar">
                <textarea id="input" placeholder="Speak or type to your tutor..."></textarea>
                <button id="sendBtn" class="btn">Send</button>
              </div>
            </div>
            <div class="col-words">
              <div style="font-weight:800; color:#475569; margin-bottom:15px; font-size:14px; text-transform:uppercase;">Vocabulary Lab</div>
              <div id="wordsContainer"></div>
            </div>
          </div>
        </div>
        <audio id="player" playsinline></audio>
      `;

      this.ui = {
        chat: this.shadowRoot.querySelector("#chat"),
        input: this.shadowRoot.querySelector("#input"),
        send: this.shadowRoot.querySelector("#sendBtn"),
        start: this.shadowRoot.querySelector("#startBtn"),
        words: this.shadowRoot.querySelector("#wordsContainer"),
        status: this.shadowRoot.querySelector("#status"),
        player: this.shadowRoot.querySelector("#player")
      };

      this.ui.send.onclick = () => this.handleChat();
      this.ui.start.onclick = () => this.startLesson();
      this.shadowRoot.querySelector("#charRow").onclick = (e) => this.switchChar(e);
    }

    switchChar(e) {
      const el = e.target.closest('.char');
      if (!el) return;
      this.shadowRoot.querySelectorAll('.char').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      this.activeCharacter = el.dataset.char;
    }

    async startLesson() {
      const name = this.shadowRoot.querySelector("#userName").value || "Student";
      this.ui.status.textContent = "Loading village lore...";
      try {
        const res = await fetch(`${this.backend}/lesson`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: this.sessionId,
            name: name,
            character: this.activeCharacter,
            month: "month1",
            chapter: "food_drink"
          })
        });
        const data = await res.json();
        this.ui.chat.innerHTML = "";
        if (data.welcomeText) this.addMsg("bot", data.welcomeText);
        if (data.lessonText) this.addMsg("bot", data.lessonText);
        if (data.words) {
          this.wordlist = data.words;
          this.renderVocab();
        }
        this.ui.status.textContent = "Lesson Active";
      } catch (e) {
        this.ui.status.textContent = "Connection Error";
      }
    }

    async handleChat() {
      const text = this.ui.input.value.trim();
      if (!text || this.isProcessing) return;
      
      this.isProcessing = true;
      this.addMsg("user", text);
      this.ui.input.value = "";
      this.ui.send.disabled = true;

      try {
        const res = await fetch(`${this.backend}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, sessionId: this.sessionId, character: this.activeCharacter })
        });
        const data = await res.json();
        if (data.reply) this.addMsg("bot", data.reply);
        if (data.learnedWords) this.mergeLearned(data.learnedWords);
        if (data.audioContent) this.playAudio(data.audioContent);
      } catch (e) {
        this.addMsg("bot", "The wind is too strong, I couldn't hear you. Try again.");
      } finally {
        this.isProcessing = false;
        this.ui.send.disabled = false;
      }
    }

    addMsg(role, text) {
      const m = ce("div", { className: `bubble ${role}-msg`, textContent: text });
      this.ui.chat.appendChild(m);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    renderVocab() {
      this.ui.words.innerHTML = "";
      this.wordlist.forEach(w => {
        const isLearned = this.learned.has(w.en.toLowerCase());
        const p = ce("div", { className: `pill ${isLearned?'learned':''}`, textContent: w.en });
        this.ui.words.appendChild(p);
      });
    }

    mergeLearned(list) {
      list.forEach(w => this.learned.add(w.toLowerCase().trim()));
      this.renderVocab();
      if (this.learned.size >= 10 && !this._milestone10) {
        this._milestone10 = true;
        if (window.confetti) window.confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }
    }

    playAudio(base64) {
      this.ui.player.src = `data:audio/mp3;base64,${base64}`;
      this.ui.player.play().catch(console.error);
    }
  }

  customElements.define("waterwheel-chat", WaterwheelChat);
})();