/* Waterwheel Village Academy - Full Feature Version */
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

  class WaterwheelChat extends HTMLElement {
    constructor() {
      super();
      this.backend = this.getAttribute("backend") || "https://waterwheel-village.onrender.com";
      this.sessionId = localStorage.getItem("wwv-session") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      localStorage.setItem("wwv-session", this.sessionId);
      
      this.learned = new Set();
      this.activeCharacter = "mcarthur";
      this._milestone10 = false;

      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; font-family: 'Segoe UI', system-ui, sans-serif; }
          .wrap { max-width: 800px; margin: 20px auto; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; background: #fff; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
          .top { padding: 15px; background: #0ea5e9; color: #fff; text-align: center; font-weight: bold; font-size: 1.2rem; }
          .char-row { display: flex; gap: 8px; padding: 12px; overflow-x: auto; background: #f8fafc; border-bottom: 1px solid #e2e8f0; scrollbar-width: none; }
          .char-row::-webkit-scrollbar { display: none; }
          .char { padding: 6px 14px; border: 1px solid #cbd5e1; border-radius: 20px; cursor: pointer; background: #fff; white-space: nowrap; font-size: 13px; font-weight: 600; transition: 0.2s; }
          .char.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; box-shadow: 0 4px 8px rgba(14, 165, 233, 0.3); }
          .grid { display: flex; height: 500px; }
          .chat-col { flex: 2; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; }
          .chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; background: #ffffff; }
          .words-col { flex: 1; background: #f1f5f9; padding: 15px; overflow-y: auto; }
          .bubble { max-width: 85%; padding: 10px 15px; border-radius: 15px; font-size: 14px; line-height: 1.4; }
          .bot-msg { background: #f1f5f9; color: #334155; align-self: flex-start; border-bottom-left-radius: 2px; }
          .user-msg { background: #0ea5e9; color: #white; align-self: flex-end; border-bottom-right-radius: 2px; color: white; }
          .bar { display: flex; padding: 15px; gap: 10px; border-top: 1px solid #e2e8f0; background: #fff; }
          textarea { flex: 1; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; resize: none; height: 40px; font-family: inherit; }
          .btn { background: #0ea5e9; color: white; border: none; padding: 0 20px; border-radius: 10px; cursor: pointer; font-weight: bold; }
          .pill { display: inline-block; padding: 5px 10px; margin: 3px; background: #fff; border: 1px solid #e2e8f0; border-radius: 15px; font-size: 12px; font-weight: 500; }
          .pill.learned { background: #dcfce7; color: #166534; border-color: #86efac; }
        </style>
        <div class="wrap">
          <div class="top">🌊 Waterwheel Village Academy</div>
          <div class="char-row" id="charRow">
            ${["mcarthur", "fatima", "nadia", "kwame", "liang", "sophia", "ibrahim", "alex", "anika", "johannes"]
              .map(c => `<div class="char ${c==='mcarthur'?'active':''}" data-char="${c}">${c.charAt(0).toUpperCase()+c.slice(1)}</div>`).join('')}
          </div>
          <div class="grid">
            <div class="chat-col">
              <div id="chat" class="chat"></div>
              <div class="bar">
                <textarea id="input" placeholder="Type a message..."></textarea>
                <button id="send" class="btn">Send</button>
              </div>
            </div>
            <div class="col-words" style="min-width: 200px;">
              <div style="font-weight:800; font-size:12px; color:#64748b; margin-bottom:10px; text-transform:uppercase;">Learned Words</div>
              <div id="words"></div>
            </div>
          </div>
        </div>
        <audio id="player" playsinline></audio>
      `;

      this.ui = {
        chat: this.shadowRoot.querySelector("#chat"),
        input: this.shadowRoot.querySelector("#input"),
        send: this.shadowRoot.querySelector("#send"),
        words: this.shadowRoot.querySelector("#words"),
        charRow: this.shadowRoot.querySelector("#charRow")
      };

      this.ui.send.onclick = () => this.handleSend();
      this.ui.charRow.onclick = (e) => {
        const target = e.target.closest('.char');
        if (target) {
          this.shadowRoot.querySelectorAll('.char').forEach(el => el.classList.remove('active'));
          target.classList.add('active');
          this.activeCharacter = target.dataset.char;
        }
      };
      
      // Allow Enter to send
      this.ui.input.onkeydown = (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleSend(); } };
    }

    addMsg(role, text) {
      const className = role === 'user' ? 'user-msg' : 'bot-msg';
      const b = ce("div", { className: `bubble ${className}`, textContent: text });
      this.ui.chat.appendChild(b);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    async handleSend() {
      const text = this.ui.input.value.trim();
      if (!text) return;
      
      this.addMsg("user", text);
      this.ui.input.value = "";

      try {
        const response = await fetch(`${this.backend}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            sessionId: this.sessionId,
            character: this.activeCharacter,
            name: "Robert"
          })
        });
        
        const data = await response.json();
        if (data.reply) this.addMsg("bot", data.reply);
        if (data.learnedWords) this.updateVocab(data.learnedWords);
      } catch (err) {
        console.error("Chat Error:", err);
        this.addMsg("bot", "I'm having trouble connecting to the village. Please try again.");
      }
    }

    updateVocab(list) {
      list.forEach(w => this.learned.add(w.toLowerCase().trim()));
      this.ui.words.innerHTML = "";
      this.learned.forEach(word => {
        const pill = ce("div", { className: "pill learned", textContent: word });
        this.ui.words.appendChild(pill);
      });

      if (this.learned.size >= 10 && !this._milestone10) {
        this._milestone10 = true;
        this.addMsg("bot", "🎊 Fantastic, Robert! You have learned 10 words!");
        if (window.confetti) window.confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }
    }
  }

  customElements.define("waterwheel-chat", WaterwheelChat);
})();