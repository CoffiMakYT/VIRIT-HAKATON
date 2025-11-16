# ==================== ПОЛНОЕ ЛОГИРОВАНИЕ ====================
import logging
import http.client as http_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

http_client.HTTPConnection.debuglevel = 0
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("aiogram").setLevel(logging.INFO)
logging.getLogger("aiohttp").setLevel(logging.WARNING)

logging.info("=== BOT START ===")
# =============================================================

import os
import json
import subprocess
import tempfile
import requests
import asyncio
import re
from datetime import datetime

from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, FSInputFile,
    ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton,
    CallbackQuery
)
from aiogram.filters import CommandStart
import edge_tts


# ====================== ОЧИСТКА ТЕКСТА ==========================

def clean_text(text: str) -> str:
    """
    Убираем разметку, HTML, лишние пробелы, чтобы не читались
    спецсимволы и списки при озвучке и отправке.
    """
    if not text:
        return ""

    # Удаляем HTML-подобные теги
    text = re.sub(r"<[^>]+>", " ", text)

    # Удаляем markdown-символы
    text = re.sub(r"[*_`~>#]", " ", text)

    # Убираем нумерованные списки "1. ", "2. " и т.п.
    text = re.sub(r"\b\d+\.\s*", "", text)

    # Сжимаем пробелы и переносы
    text = re.sub(r"\s+", " ", text).strip()

    return text


# ====================== НАСТРОЙКИ ===========================
TELEGRAM_TOKEN = "8396415265:AAGpTF-NypRlkymOkbgFNeSSQmQxmIlzuZ0"
BACKEND_URL = "http://109.187.182.251:8080"

WHISPER_BIN = "whisper/whisper-cli.exe"
WHISPER_MODEL = "whisper/models/ggml-medium.bin"
FFMPEG_PATH = "../ffmpeg/ffmpeg.exe"

bot = Bot(token=TELEGRAM_TOKEN)
dp = Dispatcher()

if not os.path.exists("users"):
    os.mkdir("users")

# Для автоочистки контекста раз в минуту (по пользователю)
LAST_ACTIVITY: dict[int, datetime] = {}


# ================= USER JSON =========================

def user_file(tg_id: int) -> str:
    return f"users/{tg_id}.json"


def load_user(tg_id: int):
    path = user_file(tg_id)
    return json.load(open(path, "r", encoding="utf-8")) if os.path.exists(path) else None


def save_user(tg_id: int, data: dict):
    json.dump(data, open(user_file(tg_id), "w", encoding="utf-8"), ensure_ascii=False, indent=4)


# ================= BACKEND АВТОРИЗАЦИЯ ============================

def backend_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def login_user(email: str, password: str):
    try:
        r = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"email": email, "password": password},
            timeout=10
        )
        if r.status_code == 200:
            data = r.json()
            token = data.get("token")
            logging.info(f"LOGIN OK for {email}")
            return token
        logging.warning(f"LOGIN FAILED [{r.status_code}]: {r.text}")
        return None
    except Exception as e:
        logging.error(f"LOGIN ERROR: {e}")
        return None


def register_user(email: str, password: str, username: str, birth_iso: str):
    try:
        r = requests.post(
            f"{BACKEND_URL}/api/auth/register",
            json={
                "username": username,
                "email": email,
                "password": password,
                "birthDate": birth_iso
            },
            timeout=10
        )
        if r.status_code == 200:
            data = r.json()
            token = data.get("token")
            logging.info(f"REGISTER OK for {email}")
            return token
        logging.warning(f"REGISTER FAILED [{r.status_code}]: {r.text}")
        return None
    except Exception as e:
        logging.error(f"REGISTER ERROR: {e}")
        return None


def _birth_to_iso(birth_str: str) -> str:
    try:
        d, m, y = birth_str.split(".")
        return f"{y}-{m}-{d}"
    except Exception:
        return "2000-01-01"


def complete_registration(tg: int, user: dict):
    """
    Полная регистрация: register + login.
    Даже если register скажет "уже существует", login всё равно пробуем.
    """
    email = user["email"]
    password = user["password"]
    username = user["name"]
    birth_iso = _birth_to_iso(user.get("birth", "01.01.2000"))

    # сначала пробуем зарегистрировать (если уже есть — норм)
    register_user(email, password, username, birth_iso)

    # потом логинимся
    token = login_user(email, password)

    if token:
        user["token"] = token
        user["state"] = "menu"
        save_user(tg, user)
        return token
    return None


def ensure_token(tg: int, user: dict):
    """
    Гарантирует, что у юзера есть токен.
    Логика:
      - если токен есть → вернуть
      - если есть email/пароль → login
      - если login не удался → register + login
      - если всё равно не получилось → None
    """
    if user.get("token"):
        return user["token"]

    email = user.get("email")
    password = user.get("password")
    if not email or not password:
        logging.warning(f"NO EMAIL/PASSWORD FOR USER {tg}")
        return None

    # пробуем просто залогиниться
    token = login_user(email, password)
    if not token:
        # если не вышло — пытаемся зарегистрировать и снова залогиниться
        username = user.get("name", f"user_{tg}")
        birth_iso = _birth_to_iso(user.get("birth", "01.01.2000"))
        register_user(email, password, username, birth_iso)
        token = login_user(email, password)

    if token:
        user["token"] = token
        save_user(tg, user)
        return token

    logging.error(f"UNABLE TO OBTAIN TOKEN FOR USER {tg}")
    return None


# ================= ЛИМИТЫ И ПОДПИСКА (ЧЕРЕЗ БЭКЕНД) ======================

def get_limits(token: str) -> dict:
    """
    GET /api/chat/limits

    Ожидаем:
    {
      "hasActiveSubscription": false,
      "requestCount": 2,
      "requestLimit": 5,
      "remainingRequests": 3,
      "canSendMessage": true
    }
    или ту же структуру, но вложенную в "limits".
    """
    if not token:
        return {}

    try:
        r = requests.get(
            f"{BACKEND_URL}/api/chat/limits",
            headers=backend_headers(token),
            timeout=10
        )
        data = r.json()
        logging.info(f"[BACKEND LIMITS]: {data}")
        if isinstance(data, dict) and "limits" in data and isinstance(data["limits"], dict):
            return data["limits"]
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logging.error(f"LIMITS REQUEST ERROR: {e}")
        return {}


def get_subscription_status(token: str) -> dict:
    """
    GET /api/payment/subscription/status

    Пример:
    {
      "subscriptionStatus": "...",
      "userId": ...,
      "email": "...",
      "hasActiveSubscription": true/false
    }
    """
    if not token:
        return {}
    try:
        r = requests.get(
            f"{BACKEND_URL}/api/payment/subscription/status",
            headers=backend_headers(token),
            timeout=10
        )
        data = r.json()
        logging.info(f"[BACKEND SUBSCRIPTION STATUS]: {data}")
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logging.error(f"SUBSCRIPTION STATUS ERROR: {e}")
        return {}


def clear_context(token: str, keep_welcome: bool = True):
    """
    POST /api/chat/clear-context
    { "keepWelcome": true/false }
    """
    if not token:
        return

    try:
        r = requests.post(
            f"{BACKEND_URL}/api/chat/clear-context",
            headers=backend_headers(token),
            json={"keepWelcome": keep_welcome},
            timeout=10
        )
        logging.info(f"[CLEAR CONTEXT]: {r.status_code} {r.text}")
    except Exception as e:
        logging.error(f"CLEAR CONTEXT ERROR: {e}")


def maybe_clear_context(tg_id: int, token: str):
    """
    Автоочистка контекста, если прошло > 60 секунд
    с последнего обращения этого пользователя.
    """
    if not token:
        return

    now = datetime.utcnow()
    last = LAST_ACTIVITY.get(tg_id)

    # если уже было обращение и прошла >1 минута — чистим контекст
    if last and (now - last).total_seconds() > 60:
        clear_context(token, keep_welcome=True)

    # обновляем время последней активности
    LAST_ACTIVITY[tg_id] = now


# ================= CHAT ======================

def send_chat_message(token: str, msg: str) -> dict:
    if not token:
        logging.error("send_chat_message called with EMPTY token")
        return {}

    try:
        r = requests.post(
            f"{BACKEND_URL}/api/chat/message",
            headers=backend_headers(token),
            json={"message": msg},
            timeout=30
        )
        data = r.json()
        logging.info(f"[BACKEND CHAT JSON]: {data}")
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logging.error(f"CHAT REQUEST ERROR: {e}")
        return {}


def extract_ai_answer(resp: dict) -> str:
    """
    Аккуратно достаём текст ответа ИИ из структуры ответа.
    Никаких локальных подписок не учитываем — только то, что реально вернул бэкенд.
    """
    if not isinstance(resp, dict):
        return "Сервис сейчас недоступен. Попробуй чуть позже 🙏"

    # Успешный ответ
    if "aiResponse" in resp and isinstance(resp["aiResponse"], dict):
        msg = resp["aiResponse"].get("message")
        if msg:
            return msg

    # Иногда текст может лежать прямо в "message"
    if isinstance(resp.get("message"), str):
        return resp["message"]

    # Если бэкенд вернул ошибку
    if isinstance(resp.get("error"), str):
        return f"Сервис прислал ошибку: {resp['error']}"

    return "Сервис сейчас недоступен. Попробуй ещё раз чуть позже 🙏"


# ==================== ASR ============================

def whisper_asr(ogg_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
        f.write(ogg_bytes)
        ogg = f.name

    wav = ogg.replace(".ogg", ".wav")
    subprocess.run([FFMPEG_PATH, "-y", "-i", ogg, "-ac", "1", "-ar", "16000", wav])

    out = wav + ".txt"
    subprocess.run([WHISPER_BIN, "-m", WHISPER_MODEL, "-f", wav, "--language", "ru", "--output-txt"])

    return open(out, "r", encoding="utf-8").read().strip() if os.path.exists(out) else ""


# ==================== ТТС ============================

async def tts_generate(text: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        path = f.name
    await edge_tts.Communicate(text, "ru-RU-SvetlanaNeural").save(path)
    return path


# ==================== КНОПКИ ==========================

def menu_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🗣 Голосовой режим")],
            [KeyboardButton(text="✍️ Текстовый режим")],
            [KeyboardButton(text="Мой профиль")]
        ],
        resize_keyboard=True
    )


def buy_subscription_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Подключить подписку 🔥", callback_data="buy_sub")]
        ]
    )


def profile_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✏ Изменить имя", callback_data="edit_name")],
            [InlineKeyboardButton(text="📅 Изменить дату рождения", callback_data="edit_birth")],
            [InlineKeyboardButton(text="↩ Отмена изменений", callback_data="cancel_changes")]
        ]
    )


# ================= ПОДПИСКА (CALLBACK) ==========================

@dp.callback_query(F.data == "buy_sub")
async def buy_subscription(callback: CallbackQuery):
    tg = callback.from_user.id
    user = load_user(tg)

    if not user:
        await callback.message.answer("Сначала введи /start, чтобы зарегистрироваться.")
        return

    token = ensure_token(tg, user)
    if not token:
        await callback.message.answer("Не удалось авторизоваться на сервисе. Попробуй позже.")
        return

    await callback.message.answer("Создаю платёж… 🔄")

    # 1) создаём платёж
    try:
        r = requests.post(
            f"{BACKEND_URL}/api/payment/create",
            headers=backend_headers(token),
            json={"amount": 100, "description": "Подписка"},
            timeout=10
        )
    except Exception as e:
        logging.error(f"PAYMENT CREATE ERROR: {e}")
        await callback.message.answer("Ошибка при создании платежа 😢 Попробуй чуть позже.")
        return

    if r.status_code != 200:
        logging.warning(f"PAYMENT CREATE FAILED [{r.status_code}]: {r.text}")
        await callback.message.answer("Ошибка при создании платежа 😢 Попробуй чуть позже.")
        return

    data = r.json()
    mock_id = data.get("mockPaymentId") or data.get("id")

    if not mock_id:
        await callback.message.answer("Не удалось получить ID платежа. Попробуй позже.")
        return

    # 2) эмулируем успешную оплату
    try:
        r2 = requests.post(
            f"{BACKEND_URL}/api/payment/mock/success/{mock_id}",
            headers=backend_headers(token),
            timeout=10
        )
        logging.info(f"[PAYMENT MOCK SUCCESS]: {r2.status_code} {r2.text}")
    except Exception as e:
        logging.error(f"PAYMENT MOCK SUCCESS ERROR: {e}")
        await callback.message.answer(
            "Оплата не была подтверждена на сервере. Попробуй ещё раз чуть позже."
        )
        return

    # 3) проверяем статус подписки
    sub = get_subscription_status(token)
    has_sub = bool(sub.get("hasActiveSubscription"))

    if has_sub:
        await callback.message.answer("🎉 Подписка успешно активирована! Теперь лимитов нет.")
    else:
        await callback.message.answer(
            "Платёж создан, но сервер пока не подтвердил подписку.\n"
            "Попробуй отправить сон — если лимит всё ещё действует, напиши админам."
        )


# ==================== ПРОФИЛЬ =========================

@dp.message(F.text == "Мой профиль")
async def profile(message: Message):
    tg = message.from_user.id
    user = load_user(tg)

    if not user:
        await message.answer("Для начала введи /start, чтобы зарегистрироваться.")
        return

    token = ensure_token(tg, user)

    limits = get_limits(token) if token else {}
    sub_status = get_subscription_status(token) if token else {}

    # Определяем подписку
    has_sub = bool(
        (isinstance(limits, dict) and limits.get("hasActiveSubscription")) or
        (isinstance(sub_status, dict) and sub_status.get("hasActiveSubscription"))
    )

    sub_text = "Оформлена 🎉" if has_sub else "Нет ❌"

    await message.answer(
        "👤 Профиль\n\n"
        f"Имя: {user.get('name', 'не указано')}\n"
        f"Дата рождения: {user.get('birth', 'не указана')}\n"
        f"Email: {user.get('email', 'не указан')}\n"
        f"Подписка: {sub_text}",
        reply_markup=profile_keyboard()
    )


@dp.callback_query(F.data == "edit_name")
async def edit_name(callback: CallbackQuery):
    tg = callback.from_user.id
    user = load_user(tg)
    if not user:
        await callback.message.answer("Сначала введи /start.")
        return

    # сохраняем старое имя для отката
    user["backup_name"] = user.get("name")
    user["state"] = "edit_name"
    save_user(tg, user)
    await callback.message.answer("Введите новое имя:")


@dp.callback_query(F.data == "edit_birth")
async def edit_birth(callback: CallbackQuery):
    tg = callback.from_user.id
    user = load_user(tg)
    if not user:
        await callback.message.answer("Сначала введи /start.")
        return

    # сохраняем старую дату для отката
    user["backup_birth"] = user.get("birth")
    user["state"] = "edit_birth"
    save_user(tg, user)
    await callback.message.answer("Введите новую дату рождения (ДД.MM.ГГГГ):")


@dp.callback_query(F.data == "cancel_changes")
async def cancel_changes(callback: CallbackQuery):
    tg = callback.from_user.id
    user = load_user(tg)

    if not user:
        await callback.message.answer("Сначала введи /start.")
        return

    changed = False

    if "backup_name" in user:
        user["name"] = user["backup_name"]
        del user["backup_name"]
        changed = True

    if "backup_birth" in user:
        user["birth"] = user["backup_birth"]
        del user["backup_birth"]
        changed = True

    user["state"] = "menu"
    save_user(tg, user)

    if changed:
        await callback.message.answer("Изменения отменены, данные восстановлены.")
    else:
        await callback.message.answer("Нет сохранённых изменений для отмены.")


# ==================== СТАРТ ==========================

@dp.message(CommandStart())
async def start(message: Message):
    tg = message.from_user.id
    user = load_user(tg)

    # Новый пользователь
    if not user:
        user = {
            "state": "ask_name",
            "mode": "text"
        }
        save_user(tg, user)

        await message.answer(
            "Привет! Я сонный помощник.\n"
            "Сначала давай познакомимся 🙂"
        )
        await message.answer("Как тебя зовут?")
        return

    # Старый пользователь
    token = ensure_token(tg, user)
    limits = get_limits(token) if token else {}

    has_sub = bool(isinstance(limits, dict) and limits.get("hasActiveSubscription"))
    remaining = limits.get("remainingRequests") if isinstance(limits, dict) else None
    can_send = limits.get("canSendMessage") if isinstance(limits, dict) else True

    if has_sub:
        await message.answer("С возвращением! У тебя активна подписка, можешь использовать бота без ограничений 🎉")
    else:
        # нет подписки
        if remaining is not None and remaining <= 0 or not can_send:
            await message.answer(
                "Твои бесплатные сообщения закончились.\n"
                "Чтобы продолжить пользоваться ботом — оформи подписку.",
                reply_markup=buy_subscription_keyboard()
            )
        else:
            await message.answer("С возвращением! Можешь описать свой сон, и я помогу с интерпретацией ✨")

    await message.answer("Выбери режим работы:", reply_markup=menu_keyboard())


# ==================== ТЕКСТ ==========================

@dp.message(F.text)
async def text_handler(message: Message):
    tg = message.from_user.id
    user = load_user(tg)

    # Если вообще нет юзера — отправляем на /start
    if not user:
        user = {
            "state": "ask_name",
            "mode": "text"
        }
        save_user(tg, user)
        await message.answer("Привет! Давай сначала познакомимся. Как тебя зовут?")
        return

    txt = message.text

    # ---------- Регистрация ----------
    if user.get("state") == "ask_name":
        user["name"] = txt.strip()
        user["state"] = "ask_birth"
        save_user(tg, user)
        await message.answer("Введите дату рождения (ДД.ММ.ГГГГ):")
        return

    if user.get("state") == "ask_birth":
        user["birth"] = txt.strip()
        user["state"] = "ask_email"
        save_user(tg, user)
        await message.answer("Введите email:")
        return

    if user.get("state") == "ask_email":
        user["email"] = txt.strip()
        user["state"] = "ask_password"
        save_user(tg, user)
        await message.answer("Введите пароль:")
        return

    if user.get("state") == "ask_password":
        user["password"] = txt
        user["state"] = "register_backend"
        save_user(tg, user)

        await message.answer("Регистрирую…")

        token = complete_registration(tg, user)
        if token:
            await message.answer("Регистрация завершена 🎉", reply_markup=menu_keyboard())
        else:
            await message.answer("Ошибка регистрации ❌. Попробуйте другой email.")
        return

    # ---------- Изменение профиля ----------
    if user.get("state") == "edit_name":
        user["name"] = txt.strip()
        user["state"] = "menu"
        save_user(tg, user)
        await message.answer("Имя обновлено ✔")
        return

    if user.get("state") == "edit_birth":
        user["birth"] = txt.strip()
        user["state"] = "menu"
        save_user(tg, user)
        await message.answer("Дата рождения обновлена ✔")
        return

    # ---------- Режимы ----------
    if txt == "🗣 Голосовой режим":
        user["mode"] = "voice"
        save_user(tg, user)
        await message.answer("Голосовой режим включён 🎤")
        return

    if txt == "✍️ Текстовый режим":
        user["mode"] = "text"
        save_user(tg, user)
        await message.answer("Текстовый режим включён ✍️")
        return

    # Если пользователь сейчас в голосовом режиме и пишет текст — подсказка
    if user.get("mode") == "voice":
        await message.answer("Сейчас включён голосовой режим. Отправь голосовое сообщение 🎤")
        return

    # ---------- ИИ ----------
    token = ensure_token(tg, user)
    if not token:
        await message.answer(
            "Не удалось авторизоваться на сервисе. Попробуй позже или перезапусти /start."
        )
        return

    # Автоочистка контекста, если прошло >1 минуты
    maybe_clear_context(tg, token)

    resp = send_chat_message(token, txt)

    # Если бэкенд сказал, что нужна подписка
    if resp.get("needSubscription"):
        await message.answer(
            "Лимит запросов исчерпан. Чтобы продолжить, оформи подписку.",
            reply_markup=buy_subscription_keyboard()
        )
        return

    raw_answer = extract_ai_answer(resp)
    answer = clean_text(raw_answer)

    await message.answer(answer)


# ==================== ГОЛОС ==========================

@dp.message(F.voice)
async def voice_handler(message: Message):
    tg = message.from_user.id
    user = load_user(tg)

    if not user:
        await message.answer("Сначала введи /start, чтобы зарегистрироваться.")
        return

    if user.get("mode") != "voice":
        await message.answer("Сейчас включён текстовый режим. Переключись в голосовой, чтобы отправлять голосовые 🎤")
        return

    token = ensure_token(tg, user)
    if not token:
        await message.answer(
            "Не удалось авторизоваться на сервисе. Попробуй позже или перезапусти /start."
        )
        return

    stub = await message.answer("Распознаю голос…")

    file = await bot.get_file(message.voice.file_id)
    stream = await bot.download_file(file.file_path)
    text = whisper_asr(stream.read())

    if not text:
        await stub.delete()
        await message.answer("Не удалось распознать голос 😢")
        return

    # Автоочистка контекста, если прошло >1 минуты
    maybe_clear_context(tg, token)

    resp = send_chat_message(token, text)

    if resp.get("needSubscription"):
        await stub.delete()
        await message.answer(
            "Лимит запросов исчерпан. Чтобы продолжить, оформи подписку.",
            reply_markup=buy_subscription_keyboard()
        )
        return

    raw_answer = extract_ai_answer(resp)
    answer = clean_text(raw_answer)

    audio = await tts_generate(answer)

    await stub.delete()
    await message.answer_voice(FSInputFile(audio))


# ===================== MAIN =========================

async def main():
    logging.info("Бот запущен")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
