(() => {
  "use strict";

  // ============================================================
  // HELPERS
  // ============================================================
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const on = (el, ev, fn) => el?.addEventListener(ev, fn);

  const API = "http://109.187.201.245:8080";
  const STORAGE_KEY = "isonnik_chats";

  let store = { chats: [] };
  let activeChatId = null;

  // ============================================================
  // PAYMENT MODAL
  // ============================================================
  function openPaymentModal() {
    qs("#paymentModal").style.display = "flex";
  }

  function closePaymentModal() {
    qs("#paymentModal").style.display = "none";
  }

  async function createPayment() {
    const res = await fetch(`${API}/api/payment/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Ошибка: платеж не создан");
    }
  }

  // ============================================================
  // LOAD STORE
  // ============================================================
  function loadStore() {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      store = { chats: [] };
      saveStore();
    } else {
      try {
        store = JSON.parse(raw);
        if (!store.chats) store.chats = [];
      } catch {
        store = { chats: [] };
        saveStore();
      }
    }

    renderChatList();

    if (store.chats.length === 0) {
      qs("#chatHeader").style.display = "none";
      qs("#chatPlaceholder").style.display = "flex";
      qs("#chatBox").innerHTML = "";
    }
  }

  function saveStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  // ============================================================
  // CHECK LIMITS
  // ============================================================
  async function checkLimits() {
    try {
      const res = await fetch(`${API}/api/chat/limits`);

      if (res.status === 403) return true;

      const data = await res.json();

      if (!data.subscribed && data.remaining <= 0) {
        openPaymentModal();
        return false;
      }

      return true;
    } catch (e) {
      console.warn("Ошибка проверки лимитов:", e);
      return true;
    }
  }

  // ============================================================
  // CHAT LIST RENDER
  // ============================================================
  function renderChatList() {
    const list = qs("#chatList");
    list.innerHTML = "";

    if (store.chats.length === 0) {
      qs("#emptyChatNote").style.display = "flex";
      return;
    }

    qs("#emptyChatNote").style.display = "none";

    store.chats
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .forEach((chat) => {
        const el = document.createElement("div");
        el.className = "chat-item";
        el.dataset.id = chat.id;

        const last = chat.messages.at(-1);
        const time = formatTime(chat.updatedAt);

        el.innerHTML = `
          <div class="chat-item-main">
            <div class="chat-item-row">
              <div class="chat-item-time">Сон от ${time}</div>
            </div>
            <div class="chat-item-row">
              <div class="chat-item-preview">${last ? last.text : "Пока нет сообщений"}</div>
            </div>
          </div>
        `;

        on(el, "click", () => openChat(chat.id, el));
        list.appendChild(el);
      });
  }

  function formatTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  // ============================================================
  // OPEN CHAT
  // ============================================================
  function openChat(id, el) {
    activeChatId = id;

    qsa(".chat-item").forEach((i) => i.classList.remove("active"));
    el.classList.add("active");

    const chat = store.chats.find((c) => c.id === id);

    qs("#chatPlaceholder").style.display = "none";
    qs("#chatHeader").style.display = "flex";

    qs("#chatTitle").textContent = chat.title;
    qs("#chatSubtitle").textContent = "Диалог";

    const box = qs("#chatBox");
    box.innerHTML = "";

    chat.messages.forEach((m) => appendMessage(m));
  }

  // ============================================================
  // APPEND MESSAGE
  // ============================================================
  function appendMessage({ author, text }) {
    const box = qs("#chatBox");

    const wrap = document.createElement("div");
    wrap.className = "message" + (author === "user" ? " user" : "");
    wrap.innerHTML = `<div class="message-bubble">${text}</div>`;

    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  // ============================================================
  // CREATE CHAT — без API /title
  // ============================================================
  function createChat() {
    const id = Date.now();

    const now = new Date();
    const time = now.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    });

    const chat = {
      id,
      title: `Сон от ${time}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: []
    };

    store.chats.push(chat);
    saveStore();
    renderChatList();

    const el = qs(`.chat-item[data-id="${id}"]`);
    if (el) openChat(id, el);
  }

  // ============================================================
  // DELETE CHAT
  // ============================================================
  function deleteChat() {
    if (!activeChatId) return;

    store.chats = store.chats.filter((c) => c.id !== activeChatId);
    activeChatId = null;

    saveStore();
    renderChatList();

    qs("#chatBox").innerHTML = "";
    qs("#chatPlaceholder").style.display = "flex";

    if (store.chats.length === 0) {
      qs("#chatHeader").style.display = "none";
    }
  }

  // ============================================================
  // SEND MESSAGE — generateTitle удалён
  // ============================================================
  async function sendChatMessage() {
    if (!activeChatId) return alert("Выберите чат");

    const allowed = await checkLimits();
    if (!allowed) return;

    const input = qs("#chatInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    const chat = store.chats.find((c) => c.id === activeChatId);

    chat.messages.push({ author: "user", text });
    chat.updatedAt = new Date().toISOString();
    appendMessage({ author: "user", text });
    saveStore();

    const res = await fetch(`${API}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    if (res.status === 401) return alert("Вы не авторизованы");
    if (res.status === 402) return openPaymentModal();
    if (!res.ok) return alert("Ошибка сервера");

    const data = await res.json();
    const botText = data.answer || "…";

    chat.messages.push({ author: "bot", text: botText });
    chat.updatedAt = new Date().toISOString();

    appendMessage({ author: "bot", text: botText });

    saveStore();
    updateChatPreview(activeChatId, botText);
  }

  function updateChatPreview(id, text) {
    const it = qs(`.chat-item[data-id="${id}"]`);
    if (!it) return;

    it.querySelector(".chat-item-preview").textContent = text;
    it.querySelector(".chat-item-time").textContent = "сейчас";
  }

  // ============================================================
  // SEARCH
  // ============================================================
  function bindSearch() {
    on(qs("#chatSearch"), "input", (e) => {
      const q = e.target.value.toLowerCase();
      qsa(".chat-item").forEach((i) => {
        const t = i.textContent.toLowerCase();
        i.style.display = t.includes(q) ? "" : "none";
      });
    });
  }

  // ============================================================
  // INIT
  // ============================================================
  document.addEventListener("DOMContentLoaded", async () => {
    loadStore();
    bindSearch();

    on(qs("#newChatBtn"), "click", createChat);
    on(qs("#deleteChatBtn"), "click", deleteChat);
    on(qs("#sendMessageBtn"), "click", sendChatMessage);

    on(qs("#chatInput"), "keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    on(qs("#payClose"), "click", closePaymentModal);
    on(qs("#payButton"), "click", createPayment);

    on(qs("#logoutBtn"), "click", () => {
      localStorage.removeItem("isonnik_token");
      document.cookie = "isonnik_token=; max-age=0; path=/";
      location.href = "index.html";
    });
  });

})();
