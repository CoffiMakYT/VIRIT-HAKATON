(() => {
  'use strict';

  /* ==========================================================
       HELPERS
  ========================================================== */
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const on  = (el, ev, fn) => el && el.addEventListener(ev, fn);

  /* ==========================================================
       SLIDER (DESKTOP + MOBILE)
  ========================================================== */

  let slides = [];
  let currentSlide = 0;
  let animating = false;
  let stars = null;

  function renderSlides() {
    slides.forEach((s, i) => {
      s.classList.remove("active", "prev");
      if (i === currentSlide) s.classList.add("active");
      if (i === currentSlide - 1) s.classList.add("prev");
    });

    if (stars) {
      stars.classList.add("down");
    }
  }

  function changeSlide(n) {
    if (animating) return;
    if (n < 0 || n >= slides.length) return;

    animating = true;
    currentSlide = n;

    renderSlides();

    setTimeout(() => {
      animating = false;
    }, 650);
  }

  function initFullpageSlider() {
    slides = qsa(".slide");
    stars  = qs("#fewStars");

    if (!slides.length) return;

    const mobile = window.innerWidth < 900;

    /* ==========================
         DESKTOP
    ========================== */
    if (!mobile) {
      renderSlides();

      let cooldown = false;

      on(window, "wheel", (e) => {
        if (cooldown) return;
        cooldown = true;

        if (e.deltaY > 0) changeSlide(currentSlide + 1);
        else changeSlide(currentSlide - 1);

        setTimeout(() => cooldown = false, 700);
      });

      on(window, "keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "PageDown")
          changeSlide(currentSlide + 1);

        if (e.key === "ArrowUp"   || e.key === "PageUp")
          changeSlide(currentSlide - 1);
      });

      return;
    }

    /* ==========================
         MOBILE — FIXED SWIPES
    ========================== */
    renderSlides();

    let startY = 0;
    let touching = false;

    on(document, "touchstart", (e) => {
      touching = true;
      startY = e.touches[0].clientY;
    });

    on(document, "touchend", (e) => {
      if (!touching) return;

      const endY = e.changedTouches[0].clientY;
      const delta = endY - startY;

      if (Math.abs(delta) > 60) {
        if (delta > 0) changeSlide(currentSlide - 1);
        else changeSlide(currentSlide + 1);
      }

      touching = false;
    });
  }

  /* ==========================================================
       AUTH
  ========================================================== */

  const TOKEN_KEY = "isonnik_token";

  function setCookieToken(token, days = 30) {
    document.cookie = `isonnik_token=${encodeURIComponent(token)}; path=/; max-age=${days*86400}; samesite=lax`;
  }

  function getCookieToken() {
    const m = document.cookie.match(/isonnik_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getToken() {
    return getCookieToken() || localStorage.getItem(TOKEN_KEY);
  }

  function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
    setCookieToken(token);
  }

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

  const openLoginModal    = () => loginModal.style.display = "block";
  const closeLoginModal   = () => loginModal.style.display = "none";
  const openRegisterModal = () => { closeLoginModal(); registerModal.style.display = "block"; };
  const closeRegisterModal= () => registerModal.style.display = "none";

  async function loginUser() {
    const email = qs("#login_email").value.trim();
    const password = qs("#login_password").value;
    const err = qs("#login_error");

    if (!email || !password) {
      err.textContent = "Заполните email и пароль.";
      return;
    }

    const res = await fetch("http://109.187.201.245:8080/api/auth/login", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      err.textContent = "Неверные данные.";
      return;
    }

    const data = await res.json();
    if (data.token) saveToken(data.token);

    closeLoginModal();
    location.href = "chat.html";
  }

  async function registerUser() {
    const name = qs("#reg_name").value;
    const birthDate = qs("#reg_birth").value;
    const email = qs("#reg_email").value;
    const password = qs("#reg_password").value;
    const err = qs("#register_error");

    if (!name || !birthDate || !email || !password) {
      err.textContent = "Заполните все поля.";
      return;
    }

    const res = await fetch("http://109.187.201.245:8080/api/auth/register", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ username:name, email, password, birthDate })
    });

    if (!res.ok) {
      err.textContent = "Ошибка регистрации.";
      return;
    }

    err.textContent = "Успешно! Войдите.";
    setTimeout(() => { closeRegisterModal(); openLoginModal(); }, 700);
  }

  function bindModals() {
    on(qs("#openLoginBtn"), "click", openLoginModal);
    on(qs("#loginModalClose"), "click", closeLoginModal);
    on(qs("#registerModalClose"), "click", closeRegisterModal);
    on(qs("#openRegisterFromLogin"), "click", openRegisterModal);

    on(qs("#openLoginFromRegister"), "click", () => {
      closeRegisterModal();
      openLoginModal();
    });

    on(qs("#loginSubmitBtn"), "click", loginUser);
    on(qs("#registerSubmitBtn"), "click", registerUser);

  const tryBtn = qs("#heroTryBtn2");
  on(tryBtn, "click", () => {
    const t = getToken();
    if (t) location.href = "chat.html";
    else openLoginModal();
  });
  }

  /* ==========================================================
       INIT
  ========================================================== */

  document.addEventListener("DOMContentLoaded", () => {
    bindModals();
    renderAuthUI();
    initFullpageSlider();

    // if #login in URL
    if (location.hash === "#login") {
      openLoginModal();
      history.replaceState(null, "", location.pathname);
    }
  });

})();
