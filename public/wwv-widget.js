// Waterwheel Village Chat Widget
(() => {
    class WaterwheelChat extends HTMLElement {
      constructor() {
        super();
        this.backend = this.getAttribute("backend") || "https://waterwheel-village.onrender.com";
        this.voice = (this.getAttribute("voice") || "on") === "on";
        this.sessionId =
          localStorage.getItem("wwv-session") ||
          (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
        localStorage.setItem("wwv-session", this.sessionId);
  
        this._rec = null;
        this._recActive = false;
        this._primed = false;
        this._restartWanted = false;
        this._audioReady = true;
        this._lastVoiceId = null;
  
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `
          <style>
            :host { all: initial; font-family: Arial, sans-serif; color:#0f172a }
            .wrap { border:1px solid #ccc; border-radius:10px; overflow:hidden; background:#fff }
            .top { padding:10px; background:#0ea5e9; color:#fff; font-weight:700 }
            .pane { display:flex; gap:6px; padding:8px; background:#f8fafc; border-bottom:1px solid #ddd; flex-wrap:wrap; align-items:center }
            .pane input, .pane select { border:1px solid #ccc; border-radius:6px; padding:6px 8px; outline:none; min-width:120px }
            .btn { border:0; background:#0ea5e9; color:#fff; padding:7px 10px; border-radius:6px; cursor:pointer; font-weight:600 }
            .btn.secondary { background:#555 }
            .btn.ghost { background:#eee; color:#111 }
            .chat { height:360px; overflow:auto; padding:10px; background:#fff }
            .msg { margin:8px 0; display:flex; gap:8px }
            .msg.user { justify-content:flex-end }
            .bubble { max-width:75%; padding:8px 10px; border-radius:10px; line-height:1.4; white-space:pre-wrap; word-wrap:break-word }
            .bot .bubble { background:#f1f5f9; border:1px solid #ddd }
            .user .bubble { background:#dcfce7; border:1px solid #86efac }
            .typing { font-size:12px; color:#666; }
            .bar { display:flex; gap:6px; padding:8px; border-top:1px solid #ddd; background:#f8fafc; align-items:center }
            textarea { flex:1; resize:none; min-height:40px; max-height:120px; border:1px solid #ccc; border-radius:8px; padding:8px; outline:none }
            .mic { background:#eee; color:#111; padding:7px 10px; border-radius:6px; cursor:pointer }
            .mic.rec { background:#d33; color:#fff }
            .hint { font-size:12px; color:#555; margin-left:auto }
            .err { color:#b91c1c; font-size:12px }
            .interim { font-style:italic; color:#555; }
          </style>
  
          <div class="wrap">
            <div class="top">Waterwheel Village</div>
            <div class="pane">
              <input id="name" placeholder="Your name" />
              <select id="month">
                <option value="">Month...</option>
                <option value="month1">Month 1</option>
              </select>
              <select id="chapter">
                <option value="">Chapter...</option>
                <option value="greetings_introductions">Greetings & Introductions</option>
                <option value="numbers_days_questions">Numbers, Days & Questions</option>
                <option value="food_drink">Food & Drink</option>
                <option value="daily_phrases">Daily Phrases</option>
                <option value="farmer_chat">Farmer Chat</option>
              </select>
              <button id="start" class="btn secondary">Start Lesson</button>
              <button id="voiceToggle" class="btn ghost">Voice: ON</button>
              <span class="hint" id="status"></span>
            </div>
            <div class="chat" id="chat"></div>
            <div class="bar">
              <button id="mic" class="mic" aria-label="Mic">Mic</button>
              <textarea id="input" placeholder="Type or use mic..."></textarea>
              <button id="send" class="btn" aria-label="Send">Send</button>
            </div>
            <div class="pane">
              <span id="micInfo" class="hint"></span>
              <span id="micErr" class="err"></span>
            </div>
          </div>
          <audio id="player"></audio>
        `;
  
        this.ui = {
          name: this.shadowRoot.querySelector("#name"),
          month: this.shadowRoot.querySelector("#month"),
          chapter: this.shadowRoot.querySelector("#chapter"),
          start: this.shadowRoot.querySelector("#start"),
          voiceToggle: this.shadowRoot.querySelector("#voiceToggle"),
          status: this.shadowRoot.querySelector("#status"),
          chat: this.shadowRoot.querySelector("#chat"),
          input: this.shadowRoot.querySelector("#input"),
          send: this.shadowRoot.querySelector("#send"),
          mic: this.shadowRoot.querySelector("#mic"),
          micInfo: this.shadowRoot.querySelector("#micInfo"),
          micErr: this.shadowRoot.querySelector("#micErr"),
          player: this.shadowRoot.querySelector("#player"),
        };
      }
  
      connectedCallback() {
        const savedName = localStorage.getItem("wwv-name") || "friend";
        this.ui.name.value = savedName;
        this.ui.month.value = "month1";
        this.ui.chapter.value = "greetings_introductions";
  
        this.ui.name.addEventListener("change", () =>
          localStorage.setItem("wwv-name", this.ui.name.value.trim())
        );
        this.ui.start.addEventListener("click", () => this.startLesson());
        this.ui.voiceToggle.addEventListener("click", () => {
          this.voice = !this.voice;
          this.ui.voiceToggle.textContent = this.voice ? "Voice: ON" : "Voice: OFF";
        });
        this.ui.send.addEventListener("click", () => this.send());
        this.ui.input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.send();
          }
        });
  
        this.setupMic();
      }
  
      setupMic() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          this.ui.micInfo.textContent = "Mic not supported in this browser.";
          return;
        }
        const rec = new SR();
        rec.lang = "en-US";
        rec.continuous = true;
        rec.interimResults = true;
        this._rec = rec;
  
        this.ui.mic.addEventListener("click", async () => {
          if (this._recActive) {
            this._restartWanted = false;
            try { rec.stop(); } catch {}
            return;
          }
          try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            this.ui.micErr.textContent = "Mic permission denied.";
            return;
          }
          this._restartWanted = true;
          this._recActive = true;
          this.ui.mic.classList.add("rec");
          try { rec.start(); } catch {}
        });
  
        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) {
              const final = t.trim();
              if (final) this.sendText(final);
            } else {
              interim += t;
            }
          }
          if (interim) this.showInterim(interim);
          else this.showInterim("");
        };
  
        rec.onend = () => {
          this._recActive = false;
          this.ui.mic.classList.remove("rec");
          if (this._restartWanted) setTimeout(() => { try { rec.start(); this._recActive = true; this.ui.mic.classList.add("rec"); } catch {} }, 300);
        };
      }
  
      showInterim(text) {
        if (!this._interimNode) {
          this._interimNode = document.createElement("div");
          this._interimNode.className = "interim";
          this.ui.chat.appendChild(this._interimNode);
        }
        this._interimNode.textContent = text || "";
        if (!text) { this._interimNode.remove(); this._interimNode = null; }
      }
  
      addMsg(role, text) {
        const row = document.createElement("div");
        row.className = `msg ${role === "user" ? "user" : "bot"}`;
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = text;
        row.appendChild(bubble);
        this.ui.chat.appendChild(row);
        this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
      }
  
      async startLesson() {
        const m = this.ui.month.value, c = this.ui.chapter.value;
        if (!m || !c) { alert("Pick Month & Chapter first"); return; }
        const name = (this.ui.name.value || "friend").trim();
        localStorage.setItem("wwv-name", name);
        try {
          const r = await fetch(`${this.backend}/lesson/${m}/${c}?sessionId=${this.sessionId}&name=${encodeURIComponent(name)}`);
          const d = await r.json();
          if (d.welcomeText) { this.addMsg("bot", d.welcomeText); if (this.voice && d.voiceId) this.speak(d.welcomeText, d.voiceId); }
          if (d.lessonText) { this.addMsg("bot", d.lessonText); if (this.voice && d.voiceId) this.speak(d.lessonText, d.voiceId); }
          if (d.voiceId) this._lastVoiceId = d.voiceId;
        } catch {
          this.addMsg("bot", "Lesson could not start.");
        }
      }
  
      async send() {
        const text = this.ui.input.value.trim();
        if (!text) return;
        this.addMsg("user", text);
        this.ui.input.value = "";
        await this.sendText(text);
      }
  
      async sendText(text) {
        try {
          const r = await fetch(`${this.backend}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, sessionId: this.sessionId, isVoice: this.voice, name: this.ui.name.value })
          });
          const d = await r.json();
          const reply = d.text || "(no response)";
          this.addMsg("bot", reply);
          if (d.voiceId) this._lastVoiceId = d.voiceId;
          if (this.voice && d.voiceId) this.speak(reply, d.voiceId);
        } catch {
          this.addMsg("bot", "Error talking to server.");
        }
      }
  
      async speak(text, voiceId) {
        try {
          const r = await fetch(`${this.backend}/speakbase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voiceId })
          });
          if (!r.ok) return;
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          this.ui.player.src = url;
          await this.ui.player.play().catch(() => {});
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch {}
      }
    }
    customElements.define("waterwheel-chat", WaterwheelChat);
  })();
  