/* 🌊 Waterwheel Village Academy - FULL MASTER VERSION 2026 */
window.__WWV_VERSION = "2026-01-31-FINAL-FIX";

// 1. Load confetti for celebrations
if (!document.getElementById('confetti-script')) {
  const sc = document.createElement('script');
  sc.id = 'confetti-script';
  sc.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js";
  document.head.appendChild(sc);
}

// 2. Global Voice Configuration
const VOICE_BY_CHAR = Object.freeze({
  mcarthur: "fEVT2ExfHe1MyjuiIiU9", kwame: "dhwafD61uVd8h85wAZSE",
  nadia: "a1KZUXKFVFDOb33I1uqr", sophia: "0q9TlrIoQJIdxZP9oZh7",
  liang: "gAMZphRyrWJnLMDnom6H", fatima: "JMbCR4ujfEfGaawA1YtC",
  ibrahim: "tlETan7Okc4pzjD0z62P", alex: "tIFPE2y0DAU6xfZn3Fka",
  anika: "GCPLhb1XrVwcoKUJYcvz", johannes: "JgHmW3ojZwT0NDP5D1JJ"
});

(() => {
  const DEFAULT_BACKEND = "https://waterwheel-village.onrender.com";
  const ce = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  class WaterwheelChat extends HTMLElement {
    constructor() {
      super(); // MUST BE FIRST
      
      // Initialize State
      this.backend = DEFAULT_BACKEND;
      this.sessionId = localStorage.getItem("wwv-session") || crypto.randomUUID();
      localStorage.setItem("wwv-session", this.sessionId);
      
      this.activeCharacter = "mcarthur";
      this.learned = new Set();
      this.wordlist = [];
      this.isProcessing = false;
      this._milestone10 = false;

      // Create Shadow DOM
      this.attachShadow({ mode: "open" });
      
      // Render HTML & CSS
      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; font-family: 'Inter', sans-serif; }
          .wrap { max-width: 900px; margin: 20px auto; border-radius: 24px; background: #fff; box-shadow: 0 20px 50px rgba(0,0,0,0.1); overflow: hidden; border: 1px solid #e2e8f0; }
          .top { padding: 24px; background: linear-gradient(135deg, #0ea5e9, #2563eb); color: #fff; font-weight: 800; text-align: center; font-size: 20px; }
          .char-pane { display: flex; gap: 8px; padding: 15px; overflow-x: auto; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
          .char { padding: 8px 16px; border: 2px solid #e2e8f0; border-radius: 20px; cursor: pointer; background: #fff; font-size: 13px; font-weight: 600; white-space: nowrap; }
          .char.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
          .grid { display: flex; height: 500px; }
          .col-chat { flex: 2; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; }
          .chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
          .bubble { max-width: 80%; padding: 12px 16px; border-radius: 18px; font-size: 14px; line-height: 1.5; }
          .bot-msg { background: #f1f5f9; align-self: flex-start; border-bottom-left-radius: 4px; }
          .user-msg { background: #0ea5e9; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
          .bar { padding: 20px; display: flex; gap: 10px; border-top: 1px solid #e2e8f0; }
          textarea { flex: 1; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px; resize: none; height: 44px; }
          .btn { background: #0ea5e9; color: #fff; border: none; padding: 0 20px; border-radius: 12px; font-weight: 700; cursor: pointer; }
          .col-words { flex: 1; background: #f8fafc; padding: 20px; }
          .pill { display: inline-block; padding: 6px 12px; margin: 3px; background: #fff; border: 1px solid #e2e8f0; border-radius: 15px; font-size: 12px; }
          .pill.learned { background: #dcfce7; color: #166534; border-color: #86efac; }
        </style>

        <div class="wrap">
          <div class="top">🌊 Waterwheel Village Academy</div>
          <div class="char-pane" id="charRow">
            ${Object.keys(VOICE_BY_CHAR).map(c => `<div class="char ${c==='mcarthur'?'active':''}" data-char="${c}">${c.charAt(0).toUpperCase()+c.slice(1)}</div>`).join('')}
          </div>
          <div class="grid">
            <div class="col-chat">
              <div id="chat" class="chat"></div>
              <div class="bar">
                <textarea id="input" placeholder="Message your tutor..."></textarea>
                <button id="send" class="btn">Send</button>
              </div>
            </div>
            <div class="col-words">
              <div style="font-weight:800; color:#64748b; margin-bottom:15px; font-size:12px; text-transform:uppercase;">Vocabulary</div>
              <div id="words"></div>
            </div>
          </div>
        </div>
        <audio id="player" playsinline></audio>
      `;

      // Define UI elements
      this.ui = {
        chat: this.shadowRoot.querySelector("#chat"),
        input: this.shadowRoot.querySelector("#input"),
        send: this.shadowRoot.querySelector("#send"),
        words: this.shadowRoot.querySelector("#words"),
        player: this.shadowRoot.querySelector("#player"),
        charRow: this.shadowRoot.querySelector("#charRow")
      };
    }

    connectedCallback() {
      // Line 147 Fix: Now safely inside a lifecycle method
      this.ui.send.addEventListener("click", () => this.handleSend());
      
      this.ui.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.handleSend();
        }
      });

      this.ui.charRow.addEventListener("click", (e) => {
        const btn = e.target.closest(".char");
        if (btn) {
          this.shadowRoot.querySelectorAll(".char").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          this.activeCharacter = btn.dataset.char;
          this.addMsg("bot", `Hello! I am ${this.activeCharacter.charAt(0).toUpperCase() + this.activeCharacter.slice(1)}. How can I help you today?`);
        }
      });
    }

    async handleSend() {
      const text = this.ui.input.value.trim();
      if (!text || this.isProcessing) return;

      this.isProcessing = true;
      this.addMsg("user", text);
      this.ui.input.value = "";

      try {
        const res = await fetch(`${this.backend}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            sessionId: this.sessionId,
            character: this.activeCharacter,
            name: "Robert"
          })
        });
        
        const data = await res.json();
        if (data.reply) this.addMsg("bot", data.reply);
        if (data.audioContent) this.playAudio(data.audioContent);
        if (data.learnedWords) this.updateVocab(data.learnedWords);

      } catch (err) {
        this.addMsg("bot", "I lost connection to the village. Try again?");
      } finally {
        this.isProcessing = false;
      }
    }

    addMsg(role, text) {
      const m = ce("div", { className: `bubble ${role}-msg`, textContent: text });
      this.ui.chat.appendChild(m);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    updateVocab(list) {
      list.forEach(w => this.learned.add(w.toLowerCase().trim()));
      this.ui.words.innerHTML = "";
      this.learned.forEach(word => {
        const p = ce("div", { className: "pill learned", textContent: word });
        this.ui.words.appendChild(p);
      });

      if (this.learned.size >= 10 && !this._milestone10) {
        this._milestone10 = true;
        if (window.confetti) window.confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }
    }

    playAudio(base64) {
      this.ui.player.src = `data:audio/mp3;base64,${base64}`;
      this.ui.player.play().catch(() => console.log("Autoplay blocked"));
    }
  }

  customElements.define("waterwheel-chat", WaterwheelChat);
})();