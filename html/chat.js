(() => {
  "use strict";

  /* =====================================================
      HELPERS
  ===================================================== */
  const qs = (s, r = document) => r.querySelector(s);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  const API = "http://109.187.182.251:8080";
  const TOKEN_KEY = "isonnik_token";
  const CHAT_KEY = "isonnik_single_chat";
  const QUOTA_KEY = "isonnik_quota_state";

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);

  /* =====================================================
      QUOTA LOCAL
  ===================================================== */

  function getQuotaState() {
    try {
      return (
        JSON.parse(localStorage.getItem(QUOTA_KEY)) || {
          freeLeft: 5,
          totalSent: 0,
          hasSubscription: false
        }
      );
    } catch {
      return { freeLeft: 5, totalSent: 0, hasSubscription: false };
    }
  }

  function saveQuotaState(q) {
    localStorage.setItem(QUOTA_KEY, JSON.stringify(q));
  }

  function updateQuotaIndicator() {
    const el = qs("#quotaIndicator");
    if (!el) return;

    const q = getQuotaState();
    el.textContent = q.hasSubscription ? `${q.totalSent} / ∞` : `${q.freeLeft} / 5`;
  }

  /* =====================================================
      SUBSCRIPTION
  ===================================================== */

  async function fetchQuotaFromBackend() {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API}/api/payment/subscription/status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) return;

      const data = await res.json();
      const q = getQuotaState();

      if (typeof data.hasActiveSubscription === "boolean") {
        q.hasSubscription = data.hasActiveSubscription;
        if (q.hasSubscription) q.freeLeft = 0;
      }

      saveQuotaState(q);
      updateQuotaIndicator();
    } catch {}
  }

  /* =====================================================
      CHAT STORAGE
  ===================================================== */

  let chat = null;

  function saveChat() {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
  }

  function createDefaultChat() {
    chat = {
      messages: [
        { author: "bot", text: "Привет! Я ИИ-сонник. Расскажи, что тебе приснилось 🌙" }
      ]
    };
    saveChat();
    renderChat();
  }

  function loadChat() {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return createDefaultChat();

    try {
      chat = JSON.parse(raw);
      if (!chat.messages) throw 0;
    } catch {
      return createDefaultChat();
    }

    renderChat();
  }

  /* =====================================================
      LOAD HISTORY FROM BACKEND
  ===================================================== */

  async function loadHistoryFromBackend() {
    const token = getToken();
    if (!token) return false;

    try {
      const res = await fetch(`${API}/api/chat/history`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (!Array.isArray(data)) return false;

      if (!data.length) return createDefaultChat(), true;

      chat = {
        messages: data.map(m => ({
          author: m.isUserMessage || m.userMessage ? "user" : "bot",
          text: normalizeAiText(m.message || "")
        }))
      };

      saveChat();
      renderChat();
      return true;

    } catch {
      return false;
    }
  }

  /* =====================================================
      NORMALIZE TEXT
  ===================================================== */

  function normalizeAiText(t) {
    if (!t) return "";
    return t
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/[*_`~/\\]/g, "")
      .trim();
  }

  function cleanForTTS(t) {
    return t.replace(/[*_`~/\\]/g, "").trim();
  }

  /* =====================================================
      TTS (исправлено)
  ===================================================== */

  function speak(text) {
    if (!window.speechSynthesis) return;

    // ОБЯЗАТЕЛЬНО — иначе кнопка не работает
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(cleanForTTS(text));
    utter.lang = "ru-RU";

    window.speechSynthesis.speak(utter);
  }

  function pauseTTS() {
    if (speechSynthesis.speaking) {
      speechSynthesis.pause();
    }
  }

  /* =====================================================
      CLEAR CONTEXT
  ===================================================== */

  async function clearContext() {
    const token = getToken();
    if (!token) return alert("Вы не авторизованы.");

    try {
      await fetch(`${API}/api/chat/clear-context`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ keepWelcome: true })
      });

      createDefaultChat();
      alert("Чат очищен!");
    } catch {
      alert("Ошибка сети");
    }
  }

  /* =====================================================
      RENDER CHAT
  ===================================================== */

  function appendMessageToDOM(msg) {
    const box = qs("#chatBox");

    const wrap = document.createElement("div");
    wrap.className = "message" + (msg.author === "user" ? " user" : "");

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = msg.text;
    wrap.appendChild(bubble);

    if (msg.author === "bot") {
      const row = document.createElement("div");
      row.className = "tts-controls";

      const b1 = document.createElement("button");
      b1.className = "tts-btn";
      b1.textContent = "▶️";
      b1.onclick = () => speak(msg.text);

      const b2 = document.createElement("button");
      b2.className = "tts-btn";
      b2.textContent = "⏸";
      b2.onclick = pauseTTS;

      row.appendChild(b1);
      row.appendChild(b2);

      wrap.appendChild(row);
    }

    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function renderChat() {
    const box = qs("#chatBox");
    box.innerHTML = "";
    chat.messages.forEach(m => appendMessageToDOM(m));
  }

  /* =====================================================
      SEND MESSAGE
  ===================================================== */

  async function sendChatMessage() {
    const input = qs("#chatInput");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";

    chat.messages.push({ author: "user", text });
    saveChat();
    appendMessageToDOM({ author: "user", text });

    const token = getToken();

    try {
      const res = await fetch(`${API}/api/chat/message`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: text })
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.needSubscription) {
          const q = getQuotaState();
          q.freeLeft = 0;
          saveQuotaState(q);
          updateQuotaIndicator();
          qs("#paymentModal").style.display = "flex";
          return;
        }
        return alert(data.error || "Ошибка");
      }

      const reply = normalizeAiText(data.aiResponse?.message || "…");
      chat.messages.push({ author: "bot", text: reply });
      saveChat();
      appendMessageToDOM({ author: "bot", text: reply });

      const q = getQuotaState();
      if (q.hasSubscription) q.totalSent++;
      else if (q.freeLeft > 0) q.freeLeft--;
      saveQuotaState(q);
      updateQuotaIndicator();

    } catch {
      alert("Ошибка сети");
    }
  }

  /* =====================================================
      PAYMENTS
  ===================================================== */

  async function handlePayClick() {
    const token = getToken();
    if (!token) return alert("Нет токена");

    const res = await fetch(`${API}/api/payment/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: 100,
        description: "Monthly subscription"
      })
    });

    if (!res.ok) return alert("Ошибка платежа");

    const data = await res.json();

    await fetch(`${API}/api/payment/mock/success/${data.mockPaymentId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });

    fetchQuotaFromBackend();
    qs("#paymentModal").style.display = "none";
    alert("Подписка активирована!");
  }

  /* =====================================================
      LOGOUT
  ===================================================== */

  async function logout() {
    const token = getToken();

    if (token) {
      await fetch(`${API}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }

    clearToken();
    localStorage.removeItem(CHAT_KEY);
    localStorage.removeItem(QUOTA_KEY);
    location.href = "index.html";
  }

  /* =====================================================
      ASR (VOICE INPUT)
  ===================================================== */

  let recognition = null;
  let isRecording = false;

  function initASR() {
    const btn = qs("#voiceBtn");
    if (!btn) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.style.opacity = "0.4";
      btn.style.cursor = "not-allowed";
      return;
    }

    recognition = new SR();
    recognition.lang = "ru-RU";
    recognition.interimResults = true;
    recognition.continuous = false;

    btn.onclick = () => {
      if (!isRecording) recognition.start();
      else recognition.stop();
    };

    recognition.onstart = () => {
      isRecording = true;
      btn.classList.add("recording");
    };

    recognition.onend = () => {
      isRecording = false;
      btn.classList.remove("recording");
    };

    recognition.onerror = () => {
      isRecording = false;
      btn.classList.remove("recording");
    };

    recognition.onresult = e => {
      qs("#chatInput").value = e.results[0][0].transcript;
    };
  }

  /* =====================================================
      INIT
  ===================================================== */

  document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) return (location.href = "index.html");

    const ok = await loadHistoryFromBackend();
    if (!ok) loadChat();

    fetchQuotaFromBackend();
    updateQuotaIndicator();

    on(qs("#sendMessageBtn"), "click", sendChatMessage);
    on(qs("#chatInput"), "keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    on(qs("#logoutBtn"), "click", logout);
    on(qs("#payButton"), "click", handlePayClick);
    on(qs("#trashBtn"), "click", clearContext);

    initASR();
  });

})();
