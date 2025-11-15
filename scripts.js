/* scripts.merged.js — единый скрипт для index.html и chat.html
   Приведено к единому стилю + интеграция с cookie-токеном и внешним списком чатов (chat-list.js)
   Классы сообщений соответствуют styles.css: .message / .message-bubble
*/
(() => {
  'use strict';

  // ---------- Helpers ----------
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on  = (el, ev, fn) => el && el.addEventListener(ev, fn);

  const isChatPage = !!document.querySelector('.chat-page');
  if (isChatPage) document.body.classList.add('chat-mode');

  // ---------- Slides (главная) ----------
  let currentSlide = 0;
  let isAnimating = false;
  let slides = null;
  let stars  = null;

  function activateSlide(n) {
    if (!slides || !slides.length) return;
    if (isAnimating || n < 0 || n >= slides.length) return;
    isAnimating = true;

    slides.forEach((s, i) => {
      s.classList.remove('active', 'prev');
      if (i === n) s.classList.add('active');
      if (i === currentSlide) s.classList.add('prev');
    });

    if (stars) {
      if (n > currentSlide) {
        stars.classList.remove('up');
        stars.classList.add('down');
      } else {
        stars.classList.remove('down');
        stars.classList.add('up');
      }
    }

    currentSlide = n;
    setTimeout(() => (isAnimating = false), 900);
  }

function initSlides() {
  slides = qsa('.slide');
  stars  = qs('#fewStars');
  if (!slides.length) return;

  const isMobile = window.innerWidth < 900;

  if (isMobile) {
    // 🔥 Мобильный режим — отключаем фуллскрин механику полностью
    slides.forEach(s => {
      s.classList.add('active');
      s.classList.remove('prev');
      s.style.opacity = '1';
      s.style.transform = 'none';
      s.style.position = 'relative';
      s.style.height = 'auto';
    });

    // Убираем реакции на wheel, PageUp/PageDown и Arrow-навигацию
    window.onwheel = null;
    window.onkeydown = null;

    return; // ВЫХОД — не запускаем систему переключений
  }

  // 🔥 Десктопный режим — включаем полноценные слайды
  activateSlide(0);

  on(window, 'wheel', (e) => {
    if (e.deltaY > 0) activateSlide(currentSlide + 1);
    else activateSlide(currentSlide - 1);
  });

  on(window, 'keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'PageDown') activateSlide(currentSlide + 1);
    if (e.key === 'ArrowUp'   || e.key === 'PageUp')   activateSlide(currentSlide - 1);
  });
}

  // ---------- Модалки & Авторизация ----------
  const loginModal    = qs('#loginModal');
  const registerModal = qs('#registerModal');
  const profileModal  = qs('#profileModal');

  function openLoginModal()    { if (loginModal)    loginModal.style.display = 'block'; }
  function closeLoginModal()   { if (loginModal)    loginModal.style.display = 'none';  }
  function openRegisterModal() { closeLoginModal(); if (registerModal) registerModal.style.display = 'block'; }
  function closeRegisterModal(){ if (registerModal) registerModal.style.display = 'none'; }
  function openProfileModal()  { if (profileModal)  profileModal.style.display = 'block'; }
  function closeProfileModal() { if (profileModal)  profileModal.style.display = 'none';  }

  // ---------- Token (cookie + localStorage для совместимости) ----------
  const TOKEN_KEY = 'isonnik_token';

  function setCookieToken(token, days = 30) {
    try {
      document.cookie = 'isonnik_token=' + encodeURIComponent(token)
        + '; path=/; max-age=' + (days * 86400) + '; samesite=lax';
    } catch (e) {}
  }
  function getCookieToken() {
    try {
      const m = document.cookie.match(/(?:^|;\\s*)isonnik_token=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function clearCookieToken() {
    try {
      document.cookie = 'isonnik_token=; path=/; max-age=0; samesite=lax';
    } catch (e) {}
  }

  function saveToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch(e) {}
    setCookieToken(token);
  }
  function getToken() {
    return getCookieToken() || ( () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } } )();
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch(e) {}
    clearCookieToken();
  }

  async function loginUser() {
    const email = (qs('#login_email') || {}).value?.trim?.() || '';
    const password = (qs('#login_password') || {}).value || '';
    const err = qs('#login_error');
    if (!email || !password) { if (err) err.textContent = 'Заполните email и пароль.'; return; }

    try {
      const res = await fetch('http://109.187.201.245:8080/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) { if (err) err.textContent = 'Неверные данные.'; return; }

      const data = await res.json();
      if (data.token) saveToken(data.token);

      if (err) err.textContent = '';
      closeLoginModal();

      if (!isChatPage) window.location.href = 'chat.html';
      else renderAuthUI();
    } catch (e) {
      if (err) err.textContent = 'Ошибка соединения.';
    }
  }

  async function registerUser() {
    const name      = (qs('#reg_name') || {}).value?.trim?.() || '';
    const birthDate = (qs('#reg_birth') || {}).value || '';
    const email     = (qs('#reg_email') || {}).value?.trim?.() || '';
    const password  = (qs('#reg_password') || {}).value || '';
    const err = qs('#register_error');

    if (!name || !birthDate || !email || !password) { if (err) err.textContent = 'Заполните все поля.'; return; }
    if (password.length < 6) { if (err) err.textContent = 'Пароль минимум 6 символов.'; return; }

    try {
      const res = await fetch('http://109.187.201.245:8080/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, email, password, birthDate })
      });

      if (!res.ok) { if (err) err.textContent = 'Ошибка регистрации.'; return; }

      if (err) err.textContent = 'Успешно. Войдите.';
      setTimeout(() => { closeRegisterModal(); openLoginModal(); }, 700);
    } catch (e) {
      if (err) err.textContent = 'Ошибка соединения.';
    }
  }

  async function fetchProfile() {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch('http://109.187.201.245:8080/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) return;
      const data = await res.json();
      const name  = qs('#profile_name');
      const birth = qs('#profile_birth');
      const email = qs('#profile_email');
      if (name)  name.value  = data.username  || '';
      if (birth) birth.value = data.birthDate || '';
      if (email) email.value = data.email     || '';
    } catch (e) {}
  }

  function renderAuthUI() {
    const openLoginBtn = qs('#openLoginBtn');
    const logoutBtn    = qs('#logoutBtn');
    const token = getToken();

    if (token) {
      if (openLoginBtn) {
        openLoginBtn.textContent = 'В чат';
        openLoginBtn.onclick = () => (window.location.href = 'chat.html');
      }
      if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    } else {
      if (openLoginBtn) {
        openLoginBtn.textContent = 'Войти';
        openLoginBtn.onclick = openLoginModal;
      }
      if (logoutBtn) logoutBtn.style.display = 'none';
    }
  }

  // ---------- Чат: рендер сообщений + отправка ----------
  function appendMessage({ text, author }) {
    const chatBox = qs('#chatBox');
    if (!chatBox) return;

    const wrap = document.createElement('div');
    wrap.className = 'message' + (author === 'user' ? ' user' : '');

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;

    wrap.appendChild(bubble);
    chatBox.appendChild(wrap);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function updateActivePreview(text) {
    const active = qs('.chat-item.active');
    if (!active) return;
    const preview = active.querySelector('.chat-item-preview');
    if (preview) preview.textContent = (text || '').slice(0, 140);
    const timeEl = active.querySelector('.chat-item-time');
    if (timeEl) timeEl.textContent = 'сейчас';
  }

  async function sendChatMessage() {
    const input = qs('#chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    appendMessage({ text, author: 'user' });
    updateActivePreview(text);
    input.value = '';

    const token = getToken();
    try {
      const res = await fetch('http://109.187.201.245:8080/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': 'Bearer ' + token } : {})
        },
        body: JSON.stringify({ message: text })
      });

      if (!res.ok) {
        appendMessage({ text: 'Не удалось получить ответ.', author: 'bot' });
        return;
      }

      const data = await res.json();
      const answer = data.answer || '...';
      appendMessage({ text: answer, author: 'bot' });
      updateActivePreview(answer);
    } catch (e) {
      appendMessage({ text: 'Ошибка соединения.', author: 'bot' });
    }
  }

  // Привязка UX элементов чата (без генерации списка — он в chat-list.js)
  function selectChat(item) {
    if (!item) return;
    qsa('.chat-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const title = item.dataset.title || 'Чат';
    const subtitle = item.dataset.subtitle || '';
    const chatTitleEl = qs('#chatTitle');
    const chatSubtitleEl = qs('#chatSubtitle');
    const placeholderEl = qs('#chatPlaceholder');
    const chatBox = qs('#chatBox');

    if (chatTitleEl) chatTitleEl.textContent = title;
    if (chatSubtitleEl) chatSubtitleEl.textContent = subtitle;
    if (placeholderEl) placeholderEl.style.display = 'none';
    if (chatBox) chatBox.innerHTML = '';
  }

  function bindChatList() {
    // Клик по элементу чата
    qsa('.chat-item').forEach(item => {
      if (item.dataset.bound === '1') return;
      on(item, 'click', () => selectChat(item));
      item.dataset.bound = '1';
    });

    // Скрыть плейсхолдер если есть активный чат
    const firstActive = qs('.chat-item.active');
    const placeholderEl = qs('#chatPlaceholder');
    if (firstActive && placeholderEl) placeholderEl.style.display = 'none';

    // Создать новый чат (в оперативной DOM-структуре)
    const newChatBtn = qs('#newChatBtn');
    on(newChatBtn, 'click', () => {
      const list = qs('#chatList');
      if (!list) return;
      const idx = list.querySelectorAll('.chat-item').length + 1;
      const el = document.createElement('div');
      el.className = 'chat-item';
      el.dataset.title = `Новый сон ${idx}`;
      el.dataset.subtitle = 'Новый диалог';
      el.innerHTML = `
        <div class="chat-avatar">С</div>
        <div class="chat-item-main">
          <div class="chat-item-row">
            <div class="chat-item-title">Новый сон ${idx}</div>
            <div class="chat-item-time">сейчас</div>
          </div>
          <div class="chat-item-row">
            <div class="chat-item-preview">Пока нет сообщений</div>
          </div>
        </div>`;
      list.prepend(el);
      selectChat(el);
      bindChatList(); // привязать обработчик клика к новому элементу
    });

    // Удалить текущий чат
    const deleteBtn = qs('#deleteChatBtn');
    on(deleteBtn, 'click', () => {
      const active = qs('.chat-item.active');
      if (!active) return;
      const list = qs('#chatList');
      const next = active.nextElementSibling || active.previousElementSibling;
      active.remove();
      if (next) selectChat(next);
      else {
        const chatTitleEl = qs('#chatTitle');
        const chatSubtitleEl = qs('#chatSubtitle');
        const chatBox = qs('#chatBox');
        const placeholderEl = qs('#chatPlaceholder');
        if (chatTitleEl) chatTitleEl.textContent = 'Чат';
        if (chatSubtitleEl) chatSubtitleEl.textContent = '';
        if (chatBox) chatBox.innerHTML = '';
        if (placeholderEl) placeholderEl.style.display = '';
      }
    });

    // Поиск по чатам
    const search = qs('#chatSearch');
    on(search, 'input', () => {
      const q = (search.value || '').toLowerCase();
      qsa('.chat-item').forEach(item => {
        const title = item.querySelector('.chat-item-title')?.textContent || '';
        const preview = item.querySelector('.chat-item-preview')?.textContent || '';
        item.style.display = (title + ' ' + preview).toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  function bindChatInput() {
    const sendBtn = qs('#sendMessageBtn');
    on(sendBtn, 'click', sendChatMessage);

    const input = qs('#chatInput');
    on(input, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  function bindModalsAndAuth() {
    // Открытие/закрытие
    on(qs('#openLoginBtn'), 'click', openLoginModal);
    const openProfileBtn = qs('#openProfile');
    if (openProfileBtn) {
      on(openProfileBtn, 'click', () => {
        const token = getToken();
        if (!token) openLoginModal();
        else fetchProfile().finally(openProfileModal);
      });
    }
    on(qs('#loginModalClose'), 'click', closeLoginModal);
    on(qs('#registerModalClose'), 'click', closeRegisterModal);
    on(qs('#profileClose'), 'click', closeProfileModal);

    // Клик вне модалок
    on(window, 'click', (e) => {
      if (e.target === loginModal)    closeLoginModal();
      if (e.target === registerModal) closeRegisterModal();
      if (e.target === profileModal)  closeProfileModal();
    });

    // Переключения логин/регистрация
    on(qs('#openRegisterFromLogin'), 'click', openRegisterModal);
    const openLoginFromRegister = qs('#openLoginFromRegister');
    if (openLoginFromRegister) {
      on(openLoginFromRegister, 'click', () => {
        closeRegisterModal();
        openLoginModal();
      });
    }

    // Сабмиты
    on(qs('#loginSubmitBtn'), 'click', loginUser);
    on(qs('#registerSubmitBtn'), 'click', registerUser);

    // Профиль (сохранить закрывает модалку)
    on(qs('#profileSaveBtn'), 'click', () => { closeProfileModal(); });

    // Кнопка "Попробовать" на главной
    const tryBtn = qs('#heroTryBtn2');
    on(tryBtn, 'click', () => {
      const token = getToken();
      if (token) window.location.href = 'chat.html';
      else openLoginModal();
    });
  }

  function bindLogoutIfAny() {
    const logout = qs('#logoutBtn');
    on(logout, 'click', () => {
      clearToken();
      window.location.href = 'index.html';
    });
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    bindModalsAndAuth();
    renderAuthUI();

    if (isChatPage) {
      // Gate: без токена — на главную с автооткрытием логина
      if (!getToken()) {
        window.location.href = 'index.html#login';
        return;
      }
      bindChatList();
      bindChatInput();
      bindLogoutIfAny();

      // если chat-list.js перерисовал список — перевяжем клики
      window.addEventListener('chats:ready', () => bindChatList());
    } else {
      initSlides();

      // Автооткрытие модалки входа при #login
      if (location.hash === '#login') {
        openLoginModal();
        try { history.replaceState(null, '', location.pathname + location.search); } catch {}
      }
    }
  });

  function initMobileSlider() {
    slides = qsa('.slide');
    stars  = qs('#fewStars');
    if (!slides.length) return;
    const isMobile = window.innerWidth < 900;
    if (!isMobile) return;
    activateSlide(0);
    slides.forEach((s, i) => {
      s.style.position = 'absolute';
      s.style.inset = '0';
      s.style.height = '100vh';
    });
    let touchStartY = 0;
    let touchEndY = 0;
    window.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches.length) return;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      if (!e.changedTouches || !e.changedTouches.length) return;
      touchEndY = e.changedTouches[0].clientY;
      const diff = touchStartY - touchEndY;
      if (Math.abs(diff) < 40) return;
      if (diff > 0) activateSlide(currentSlide + 1);
      else activateSlide(currentSlide - 1);
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!isChatPage) initMobileSlider();
  });
})();




/* ===========================
   ASR (Распознавание речи)
   =========================== */

let recognizing = false;
let recognition;

if ('webkitSpeechRecognition' in window) {
  recognition = new webkitSpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => { recognizing = true; updateMicButton(); };
  recognition.onend = () => { recognizing = false; updateMicButton(); };
  recognition.onerror = () => { recognizing = false; updateMicButton(); };

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const input = document.getElementById('chatInput');
    input.value = text;
  };
}

function toggleASR() {
  if (!recognition) return alert('Ваш браузер не поддерживает голосовой ввод.');

  if (!recognizing) recognition.start();
  else recognition.stop();
}

function updateMicButton() {
  const btn = document.getElementById('micBtn');
  if (!btn) return;
  btn.textContent = recognizing ? '🎙️' : '🎤';
}

/* ===========================
   TTS (Озвучка текста бота)
   =========================== */

function speakText(text) {
  if (!window.speechSynthesis) {
    alert('Ваш браузер не поддерживает озвучивание.');
    return;
  }

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ru-RU';
  utter.rate = 1;
  utter.pitch = 1;

  speechSynthesis.speak(utter);
}

function attachTTSButtons() {
  const botMessages = document.querySelectorAll('.message:not(.user)');

  botMessages.forEach((msg) => {
    if (msg.dataset.ttsAttached) return;

    const btn = document.createElement('button');
    btn.className = 'tts-btn';
    btn.textContent = '🔊';
    btn.onclick = () => {
      const text = msg.querySelector('.message-bubble').textContent;
      speakText(text);
    };

    msg.appendChild(btn);
    msg.dataset.ttsAttached = '1';
  });
}

const observer = new MutationObserver(() => attachTTSButtons());
observer.observe(document.getElementById('chatBox'), { childList: true });

