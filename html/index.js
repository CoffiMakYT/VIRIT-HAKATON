(() => {
  "use strict";

  /* ==========================================================
         HELPERS
  ========================================================== */
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const on  = (el, ev, fn) => el && el.addEventListener(ev, fn);

  const API = "http://109.187.182.251:8080";
  const TOKEN_KEY = "isonnik_token";

  /* ==========================================================
        TOKEN — ТЕПЕРЬ ТОЛЬКО LOCALSTORAGE
  ========================================================== */

  function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  /* ==========================================================
       FORM MESSAGES (успех / ошибка)
  ========================================================== */

  function setFormMessage(target, text, type = "info") {
    const el = typeof target === "string" ? qs(target) : target;
    if (!el) return;

    el.textContent = text || "";
    el.className = "form-message";

    if (type === "error") el.classList.add("is-error");
    else if (type === "success") el.classList.add("is-success");
    else if (type === "info" && text) el.classList.add("is-info");
  }

  /* ==========================================================
        LOGIN
  ========================================================== */

  async function loginUser() {
    const email = qs("#login_email")?.value.trim();
    const password = qs("#login_password")?.value;
    const msg = qs("#login_message");

    if (!email || !password) {
      setFormMessage(msg, "Заполните email и пароль.", "error");
      return;
    }

    setFormMessage(msg, "Проверяем данные…", "info");

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        setFormMessage(msg, "Неверный email или пароль.", "error");
        return;
      }

      const data = await res.json();

      if (!data.token) {
        setFormMessage(msg, "Ошибка сервера: токен не получен.", "error");
        return;
      }

      saveToken(data.token);

      setFormMessage(msg, "Успешный вход!", "success");

      setTimeout(() => {
        closeLoginModal();
        location.href = "chat.html";
      }, 500);

    } catch (e) {
      console.error(e);
      setFormMessage(msg, "Ошибка соединения. Попробуйте позже.", "error");
    }
  }

  /* ==========================================================
        REGISTER
  ========================================================== */

  async function registerUser() {
    const name      = qs("#reg_name")?.value.trim();
    const birthDate = qs("#reg_birth")?.value.trim();
    const email     = qs("#reg_email")?.value.trim();
    const password  = qs("#reg_password")?.value;
    const msg       = qs("#register_message");

    if (!name || !birthDate || !email || !password) {
      setFormMessage(msg, "Заполните все поля.", "error");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setFormMessage(msg, "Дата должна быть YYYY-MM-DD.", "error");
      return;
    }

    if (password.length < 6) {
      setFormMessage(msg, "Пароль должен быть не короче 6 символов.", "error");
      return;
    }

    setFormMessage(msg, "Создаём аккаунт…", "info");

    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          username: name,
          email,
          password,
          birthDate
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormMessage(msg, data.error || "Ошибка регистрации.", "error");
        return;
      }

      setFormMessage(msg, "Аккаунт создан. Теперь войдите.", "success");

      setTimeout(() => {
        closeRegisterModal();
        openLoginModal();
      }, 800);

    } catch (e) {
      console.error(e);
      setFormMessage(msg, "Ошибка соединения. Попробуйте позже.", "error");
    }
  }

  /* ==========================================================
        RENDER AUTH BUTTON
  ========================================================== */

  function renderAuthUI() {
    const btn = qs("#openLoginBtn");
    const token = getToken();

    if (!btn) return;

    if (token) {
      btn.textContent = "В чат";
      btn.onclick = () => location.href = "chat.html";
    } else {
      btn.textContent = "Войти";
      btn.onclick = openLoginModal;
    }
  }

  /* ==========================================================
        MODALS
  ========================================================== */

  const loginModal    = qs("#loginModal");
  const registerModal = qs("#registerModal");

  const openLoginModal = () => {
    loginModal.style.display = "block";
    setFormMessage("#login_message", "");
  };

  const closeLoginModal = () => {
    loginModal.style.display = "none";
  };

  const openRegisterModal = () => {
    closeLoginModal();
    registerModal.style.display = "block";
    setFormMessage("#register_message", "");
  };

  const closeRegisterModal = () => {
    registerModal.style.display = "none";
  };

  function bindModals() {
    on(qs("#openLoginBtn"), "click", openLoginModal);
    on(qs("#loginModalClose"), "click", closeLoginModal);
    on(qs("#registerModalClose"), "click", closeRegisterModal);

    on(qs("#openRegisterFromLogin"), "click", openRegisterModal);

    on(qs("#openLoginFromRegister"), "click", () => {
      closeRegisterModal();
      openLoginModal();
    });

    on(qs("#loginSubmitBtn"), "click", e => {
      e.preventDefault();
      loginUser();
    });

    on(qs("#registerSubmitBtn"), "click", e => {
      e.preventDefault();
      registerUser();
    });

    on(qs("#heroTryBtn2"), "click", () => {
      getToken() ? location.href = "chat.html" : openLoginModal();
    });

    // закрытие по клику на фон
    window.addEventListener("click", e => {
      if (e.target === loginModal) closeLoginModal();
      if (e.target === registerModal) closeRegisterModal();
    });
  }

  /* ==========================================================
        FULLPAGE SLIDER (как в твоём коде)
  ========================================================== */

  function initFullpageSlider() {
    const slides = qsa(".slide");
    if (!slides.length) return;

    let index = 0;
    let lock = false;
    const delay = 900;

    function showSlide(i) {
      slides.forEach(s => s.classList.remove("active", "prev"));

      if (i < 0) i = slides.length - 1;
      if (i >= slides.length) i = 0;

      index = i;
      slides[index].classList.add("active");
    }

    function nextSlide() {
      if (!lock) {
        lock = true;
        showSlide(index + 1);
        setTimeout(() => lock = false, delay);
      }
    }

    function prevSlide() {
      if (!lock) {
        lock = true;
        showSlide(index - 1);
        setTimeout(() => lock = false, delay);
      }
    }

    // колесо мыши
    window.addEventListener("wheel", e => {
      e.deltaY > 0 ? nextSlide() : prevSlide();
    }, { passive: true });

    // touch свайпы
    let startY = 0;

    window.addEventListener("touchstart", e => {
      startY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener("touchend", e => {
      const diff = startY - e.changedTouches[0].clientY;
      if (Math.abs(diff) > 40) diff > 0 ? nextSlide() : prevSlide();
    }, { passive: true });

    showSlide(index);
  }

  /* ==========================================================
        INIT
  ========================================================== */

  document.addEventListener("DOMContentLoaded", () => {
    bindModals();
    renderAuthUI();
    initFullpageSlider();

    if (location.hash === "#login") {
      openLoginModal();
      history.replaceState(null, "", location.pathname);
    }
  });

})();
