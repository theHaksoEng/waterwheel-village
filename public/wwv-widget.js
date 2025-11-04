// Waterwheel Village — Chat Widget (stable working version before Month 2 edits)
(() => {
    const DEFAULT_BACKEND = "https://waterwheel-village.onrender.com";
    const MCARTHUR_VOICE = "fEVT2ExfHe1MyjuiIiU9";
  
    const qs = (root, sel) => root.querySelector(sel);
    const ce = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  
    class WaterwheelChat extends HTMLElement {
      constructor() {
        super();
        this.backend = this.getAttribute("backend") || DEFAULT_BACKEND;
        this.voice = (this.getAttribute("voice") || "on") === "on";
        this.sessionId =
          localStorage.getItem("wwv-session") ||
          (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
        localStorage.setItem("wwv-session", this.sessionId);
  
        this.wordlist = [];
        this.wordsetEn = new Set();
        this.learned = new Set();
        this.lastVoiceId = null;
        this.audioReady = true;
        this.ttsQueue = [];
        this.ttsPlaying = false;
  
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `
          <style>
            :host { all: initial; font-family: system-ui, sans-serif; }
            .wrap { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff; }
            .top { background: #0ea5e9; color: white; font-weight: bold; padding: 10px; }
            .pane { display: flex; gap: 8px; padding: 8px; background: #f1f5f9; border-bottom: 1px solid #e5e7eb; }
            select, input { padding: 6px 8px; border-radius: 6px; border: 1px solid #cbd5e1; }
            .btn { background: #0ea5e9; color: white; border: none; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
            .chat { height: 400px; overflow-y: auto; padding: 10px; }
            .msg { margin: 8px 0; display: flex; }
            .msg.bot { justify-content: flex-start; }
            .msg.user { justify-content: flex-end; }
            .bubble { padding: 8px 10px; border-radius: 10px; max-width: 70%; }
            .bot .bubble { background: #f1f5f9; }
            .user .bubble { background: #dcfce7; }
            textarea { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #cbd5e1; resize: none; }
            .bar { display: flex; gap: 8px; padding: 8px; background: #f8fafc; border-top: 1px solid #e5e7eb; }
            .words { border-top: 1px solid #e5e7eb; padding: 8px; background: #fff; display: flex; flex-wrap: wrap; gap: 6px; }
            .pill { border: 1px solid #e2e8f0; padding: 6px 10px; border-radius: 9999px; background: #f8fafc; cursor: pointer; }
            .pill.learned { background: #dcfce7; border-color: #86efac; color: #065f46; }
          </style>
  
          <div class="wrap">
            <div class="top">Waterwheel Village</div>
  
            <div class="pane">
              <input id="name" placeholder="Your name" />
              <select id="month">
                <option value="">Month...</option>
                <option value="month1" selected>Month 1 – Everyday Survival</option>
              </select>
              <select id="chapter">
                <option value="">Chapter...</option>
                <option value="greetings_introductions">Greetings & Introductions</option>
                <option value="numbers_days_questions">Numbers, Days & Questions</option>
                <option value="food_drink">Food & Drink</option>
                <option value="daily_phrases">Daily Phrases</option>
              </select>
              <button id="start" class="btn">Start</button>
            </div>
  
            <div id="chat" class="chat"></div>
  
            <div class="bar">
              <textarea id="input" placeholder="Type here..."></textarea>
              <button id="send" class="btn">Send</button>
            </div>
  
            <div class="words" id="words"></div>
          </div>
  
          <audio id="player" playsinline></audio>
        `;
  
        this.ui = {
          name: qs(this.shadowRoot, "#name"),
          month: qs(this.shadowRoot, "#month"),
          chapter: qs(this.shadowRoot, "#chapter"),
          start: qs(this.shadowRoot, "#start"),
          chat: qs(this.shadowRoot, "#chat"),
          input: qs(this.shadowRoot, "#input"),
          send: qs(this.shadowRoot, "#send"),
          words: qs(this.shadowRoot, "#words"),
          player: qs(this.shadowRoot, "#player")
        };
      }
  
      connectedCallback() {
        this.ui.start.addEventListener("click", () => this.startLesson());
        this.ui.send.addEventListener("click", () => this.send());
      }
  
      addMsg(role, text) {
        const row = ce("div", { className: "msg " + role });
        const bubble = ce("div", { className: "bubble", textContent: text });
        row.appendChild(bubble);
        this.ui.chat.appendChild(row);
        this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      }
  
      async startLesson() {
        const m = this.ui.month.value;
        const c = this.ui.chapter.value;
        const name = this.ui.name.value || "friend";
        if (!m || !c) {
          alert("Pick month and chapter first");
          return;
        }
  
        // clear chat + wordlist
        this.ui.chat.innerHTML = "";
        this.ui.words.innerHTML = "";
        this.wordlist = [];
        this.wordsetEn.clear();
        this.learned.clear();
  
        try {
          const wlRes = await fetch(`${this.backend}/wordlist/${m}/${c}`);
          const wl = await wlRes.json();
          if (Array.isArray(wl)) {
            this.wordlist = wl;
            this.wordsetEn = new Set(wl.map(w => w.en.toLowerCase()));
            this.renderWordlist();
          }
        } catch {
          this.addMsg("bot", "(Wordlist not found)");
        }
  
        try {
          const r = await fetch(`${this.backend}/lesson/${m}/${c}?sessionId=${this.sessionId}&name=${encodeURIComponent(name)}`);
          const d = await r.json();
          if (d.welcomeText) this.addMsg("bot", d.welcomeText);
          if (d.lessonText) this.addMsg("bot", d.lessonText);
        } catch {
          this.addMsg("bot", "Sorry, I could not start the lesson.");
        }
      }
  
      renderWordlist() {
        this.ui.words.innerHTML = "";
        this.wordlist.forEach(({ en }) => {
          const pill = ce("div", { className: "pill", textContent: en });
          pill.addEventListener("click", () => {
            this.ui.input.value += (this.ui.input.value ? " " : "") + en;
            this.ui.input.focus();
          });
          this.ui.words.appendChild(pill);
        });
      }
  
      async send() {
        const text = this.ui.input.value.trim();
        if (!text) return;
        this.addMsg("user", text);
        this.ui.input.value = "";
        try {
          const r = await fetch(`${this.backend}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              sessionId: this.sessionId,
              isVoice: false,
              name: this.ui.name.value || "friend"
            })
          });
          const d = await r.json();
          const reply = d.text || "(no response)";
          this.addMsg("bot", reply);
        } catch {
          this.addMsg("bot", "Sorry, something went wrong.");
        }
      }
    }
  
    customElements.define("waterwheel-chat", WaterwheelChat);
  
    document.addEventListener("DOMContentLoaded", () => {
      const root = document.getElementById("wwv-root");
      if (root && !root.querySelector("waterwheel-chat")) {
        const el = document.createElement("waterwheel-chat");
        el.setAttribute("backend", DEFAULT_BACKEND);
        el.setAttribute("voice", "on");
        root.appendChild(el);
      }
    });
  })();
  
  
  