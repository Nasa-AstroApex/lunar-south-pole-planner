/*
 * AstroApex — Debug & Telemetry Console.
 *
 * A lightweight, dependency-free logging console that captures boot, API, simulation
 * and runtime events with a millisecond timestamp and a level tag. It renders into a
 * slide-in drawer controlled by the HUD "Debug Logs (n)" button and the "D" key.
 *
 * Levels: INFO, WARN, ERR, API, SIM, BOOT, RUNTIME.
 */

const LEVEL_ORDER = ["INFO", "WARN", "ERR", "API", "SIM", "BOOT", "RUNTIME"];

function pad(n, w) {
  return String(n).padStart(w, "0");
}

function timestamp() {
  const d = new Date();
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
}

const Debug = {
  logs: [],
  maxLogs: 800,
  el: null,
  logEl: null,
  countEl: null,
  toggleBtn: null,
  visible: false,

  init({ panelId, logId, countId, toggleId, copyId, downloadId, clearId, closeId }) {
    this.el = document.getElementById(panelId);
    this.logEl = document.getElementById(logId);
    this.countEl = document.getElementById(countId);
    this.toggleBtn = document.getElementById(toggleId);

    this._bind(toggleId, () => this.toggle());
    this._bind(closeId, () => this.hide());
    this._bind(copyId, () => this.copy());
    this._bind(downloadId, () => this.download());
    this._bind(clearId, () => this.clear());

    document.addEventListener("keydown", (e) => {
      if (e.key === "d" || e.key === "D") {
        const t = e.target;
        const isTyping = t && (
          ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName) ||
          t.isContentEditable === true
        );
        if (isTyping) return;
        e.preventDefault();
        this.toggle();
      }
    });

    window.addEventListener("error", (e) => {
      this.runtime(`window.onerror: ${e.message} @ ${e.filename}:${e.lineno}`);
    });
    window.addEventListener("unhandledrejection", (e) => {
      const reason = (e && e.reason) ? (e.reason.message || String(e.reason)) : "unknown";
      this.runtime(`unhandledrejection: ${reason}`);
    });
  },

  _bind(id, fn) {
    const node = document.getElementById(id);
    if (node) node.addEventListener("click", fn);
  },

  push(level, msg) {
    if (!LEVEL_ORDER.includes(level)) level = "INFO";
    const entry = { t: timestamp(), level, msg };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);
    this._renderOne(entry);
    this._renderCount();
  },

  _renderOne(entry) {
    if (!this.logEl) return;
    const div = document.createElement("div");
    div.className = `log-line lvl-${entry.level.toLowerCase()}`;
    div.innerHTML = `<span class="log-t">${entry.t}</span><span class="log-lvl">${entry.level}</span><span class="log-msg"></span>`;
    div.querySelector(".log-msg").textContent = entry.msg;
    this.logEl.appendChild(div);
    const atBottom = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 40;
    if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
  },

  _renderAll() {
    if (!this.logEl) return;
    this.logEl.innerHTML = "";
    this.logs.forEach((e) => this._renderOne(e));
    this._renderCount();
  },

  _renderCount() {
    if (this.countEl) this.countEl.textContent = String(this.logs.length);
    if (this.toggleBtn) this.toggleBtn.textContent = `Debug Logs (${this.logs.length})`;
  },

  toggle() {
    this.visible ? this.hide() : this.show();
  },

  show() {
    this.visible = true;
    if (this.el) this.el.hidden = false;
    if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight;
  },

  hide() {
    this.visible = false;
    if (this.el) this.el.hidden = true;
  },

  info(msg) { this.push("INFO", msg); },
  warn(msg) { this.push("WARN", msg); },
  error(msg) { this.push("ERR", msg); },
  api(msg) { this.push("API", msg); },
  sim(msg) { this.push("SIM", msg); },
  boot(msg) { this.push("BOOT", msg); },
  runtime(msg) { this.push("RUNTIME", msg); },

  _text() {
    return this.logs.map((e) => `[${e.t}] [${e.level}] ${e.msg}`).join("\n");
  },

  copy() {
    const text = this._text();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => this.info("Logs copied to clipboard."));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) { /* ignore */ }
      document.body.removeChild(ta);
      this.info("Logs copied to clipboard (fallback).");
    }
  },

  download() {
    const blob = new Blob([this._text() + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `astroapex-debug-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.info("Debug log downloaded.");
  },

  clear() {
    this.logs = [];
    if (this.logEl) this.logEl.innerHTML = "";
    this._renderCount();
  },
};

export default Debug;
