#!/usr/bin/env python3
"""AiBox standalone voice assistant — wake word "Hey Amy".

Listens continuously on the SP92, wakes on "hey amy" (fuzzy), greets, captures a
question, and answers it via Ollama (CT200) through say.sh.

Three capabilities beyond plain chat:
  * Sight — the eyes daemon (eyes/eyes.py) owns the camera. Its cached room
    description is injected as ambient context every turn; visual questions get a
    live vision-model call; "look left" and friends drive the gimbal.
  * Web search — SearXNG on linuxg3, answered out loud, with the top links kept
    so a follow-up can act on them.
  * Desktop hand-off — "pull that up on my computer" queues the link for the
    agent running in Lacy's Windows session, which opens it in his browser.

Command precedence matters: desktop hand-off is checked before search, and
search before camera, because "look up the weather" is a search while a bare
"look up" is a tilt.
"""
import os, threading, collections, re, sys, wave, time, tempfile, subprocess, difflib
from datetime import datetime
from zoneinfo import ZoneInfo
import threading, collections
import numpy as np
import requests
from faster_whisper import WhisperModel

sys.path.insert(0, "/opt/voice")
import web

CARD = os.environ.get("AIBOX_CARD_DEV", "plughw:3,0")
SAY = "/opt/voice/say.sh"
OLLAMA = "http://192.168.166.182:11434/v1/chat/completions"
EYES = os.environ.get("AIBOX_EYES", "http://127.0.0.1:8823")
LLM = os.environ.get("AIBOX_LLM", "llama3:latest")       # fast, conversational
RMS_GATE = float(os.environ.get("AIBOX_RMS_GATE", "350"))  # silence threshold
WAKE_WINDOW = 3       # seconds per listen chunk
QUESTION_WINDOW = 6   # seconds to capture the question
END_PHRASES = ["stop", "thanks", "thank you", "that's all", "that is all",
               "no thanks", "never mind", "nevermind", "goodbye", "bye",
               "that's it", "that is it", "we're done", "i'm done", "done"]
SCENE_MAX_AGE = 600   # ignore ambient context older than this

# Fuzzy variants Whisper may produce for the wake word
WAKE = ["hey amy","hey aimee","hey amie","hey emmy","hey ami","hay amy","hey, amy",
        "hey andy","hey andi","hey andie","hey aigartha","hey agatha","hey agartha"]
# Trigger + name for fuzzy matching (Whisper garbles the name: amy->andy, aigartha->agatha).
WAKE_TRIGGERS = ("hey", "hay", "hi", "hello", "ok", "okay", "yo")
WAKE_NAMES = ("amy", "aimee", "amie", "emmy", "ami", "andy", "andi", "andie",
              "aigartha", "agatha", "agartha", "argatha")

SYSTEM = ("You are Aigartha, Lacy's local voice assistant running on the AiBox. "
          "Your manner is calm, composed, and professional: clear, precise, and efficient, "
          "with no filler, no hype, and no over-apologizing. You are confident and direct, "
          "but never cold — warm in substance, economical in words. If you do not know "
          "something, you say so plainly rather than guessing. Because your reply is spoken "
          "aloud, answer in 1 to 3 short sentences of plain conversational text, with no "
          "markdown, lists, or emoji.")

SEARCH_SYSTEM = (
    "You are Aigartha, answering out loud from web search results in a calm, "
    "professional, matter-of-fact manner. "
    "1 to 3 short spoken sentences, no markdown, no lists, never read out URLs. "
    "Then on a final line write 'SOURCE: <number>' naming the single numbered result you "
    "actually relied on. If the results do not really answer the question, reply with "
    "exactly: NOTHING FOUND")

# Questions that need to actually look, rather than reason from memory.
VISUAL_PATTERNS = [
    r"\bwhat (do|can) you see\b", r"\bcan you see\b", r"\bdo you see\b",
    r"\bwhat am i (holding|wearing|doing|pointing)", r"\bhow do i look\b",
    r"\bhow many (people|persons)\b", r"\bwhat colou?r\b",
    r"\bread (this|that|the sign|my screen)\b", r"\blook at (this|that)\b",
    r"\bdescribe (the |this )?(room|scene|view|what)", r"\bis (anyone|anybody|someone) (here|there|in)\b",
    r"\bwho( i|')s (here|there|in the room|with me)\b", r"\bam i alone\b",
    r"\bwhat('s| is) (this|that|in front of you|on (my|the) desk|behind me)\b",
]

# Phrases that introduce a web search; the query is whatever follows.
SEARCH_TRIGGERS = (
    r"search (?:the web |the internet |online )?(?:for )?|"
    r"look up |google |look online for |find me |find out (?:about )?|"
    r"what does the internet say about "
)

# "show me a search for X" — open the RESULTS PAGE, not one of the results.
# Requires an open/show verb before the word "search", so a plain
# "search for X" still gets a spoken answer instead of a browser window.
SHOW_SEARCH = re.compile(
    r"\b(?:show me|open|open up|pull up|bring up|do|run|give me|start)\b.{0,40}?\bsearch\b")

# Noise to drop before reading the query out of a spoken sentence.
DEVICE_PHRASE = re.compile(r"\s*\bon (?:my|the) (?:computer|screen|pc|desktop|monitor|laptop)\b")
ENGINE_PHRASE = re.compile(r"\busing (?:google|duck ?duck ?go|bing|searx\w*)\b.*$")

# Whatever follows "open"/"pull up". If it names a thing rather than pointing at
# an earlier result, it's a new subject and must trigger a fresh search —
# otherwise "pull up <new thing>" silently reopens the last link.
OPEN_SUBJECT = re.compile(r"\b(?:pull up|pull|open up|open|show me|bring up|bring)\s+(.+)$")
POINTS_BACK = re.compile(
    r"^(?:that\b|it\b|this\b|these\b|those\b|them\b|up\b|again\b|"
    r"the (?:first|second|third|fourth|fifth|last|one|link|page|site|website|result)\b|"
    r"(?:first|second|third|fourth|fifth|last)\b|number \w+)")

# Send the current link to the desktop.
OPEN_PATTERNS = [
    r"\bon (?:my|the) (?:computer|screen|pc|desktop|monitor|laptop)\b",
    # "pull up" is unambiguously a show-me-something command, so it stands alone;
    # "open"/"show me" must stay narrow or they swallow "open your eyes".
    r"\bpull (?:that|it|this|them|those) up\b", r"\bpull up\b",
    r"\bshow me (?:that|it|this|the (?:first|second|third|fourth|fifth))\b",
    r"\bopen (?:that|it|this|the (?:first|second|third|fourth|fifth|link|page|site))\b",
    r"\bbring (?:that|it) up\b",
]

# Ordered, not a dict: true ordinals must be tested before bare numbers, or
# "the second one" matches "one" and picks the wrong link.
ORDINALS = [
    ("first", 0), ("1st", 0), ("second", 1), ("2nd", 1), ("third", 2), ("3rd", 2),
    ("fourth", 3), ("4th", 3), ("fifth", 4), ("5th", 4), ("last", -1),
    ("one", 0), ("two", 1), ("three", 2), ("four", 3), ("five", 4),
]

DIRECTIONS = {"left": "left", "right": "right", "up": "up", "down": "down"}

last_results = []      # most recent search hits, so a follow-up can act on them
last_query = ""        # what produced them, for "show me the search results"
last_results_at = 0.0  # when — stale hits must never be opened silently
RESULTS_TTL = 900      # seconds a remembered result set stays openable

# A follow-up must be at least this loud to count as addressed to her; quieter ambient
# or cross-room speech ends the conversation instead of being answered, so she never
# "just starts talking" unless you called her name or clearly spoke up. Tunable via env.
FOLLOWUP_RMS_GATE = float(os.environ.get("AIBOX_FOLLOWUP_RMS_GATE", "650"))
OFFER_WINDOW = int(os.environ.get("AIBOX_OFFER_WINDOW", "4"))   # seconds to catch a yes/no

# After a spoken web-search answer, the source she used is offered for opening on the desktop.
offer_url = ""
offer_domain = ""

YES_WORDS = ("yes", "yeah", "yep", "yup", "sure", "please", "ok", "okay", "go ahead",
             "do it", "open it", "open that", "pull it up", "please do", "affirmative",
             "sounds good", "yes please")
NO_WORDS = ("no", "nope", "nah", "no thanks", "don't", "do not", "leave it", "that is okay",
            "that's okay", "that is fine", "that's fine", "cancel", "never mind", "nevermind")


def is_affirmative(text):
    """Yes/no from a short spoken reply. A 'no' anywhere wins over a 'yes'."""
    if not text:
        return False
    t = re.sub(r"[^a-z ]", " ", text.lower())
    if any(re.search(rf"\b{re.escape(n)}\b", t) for n in NO_WORDS):
        return False
    return any(re.search(rf"\b{re.escape(y)}\b", t) for y in YES_WORDS)



def eyes_call(path, params=None, timeout=240):
    try:
        r = requests.get(f"{EYES}{path}", params=params or {}, timeout=timeout)
        return r.json()
    except Exception as e:
        print(f"[eyes] {path} failed: {e}", flush=True)
        return None


print("[aigartha] loading STT models...", flush=True)
wake_stt = WhisperModel("small.en", device="cpu", compute_type="int8")
qa_stt = WhisperModel("small.en", device="cpu", compute_type="int8")

# --- speaker verification: only wake / respond to Lacy's voice ------------------------
SPEAKER_THRESHOLD = float(os.environ.get("AIBOX_SPEAKER_THRESHOLD", "0.70"))
VOICEPRINT_PATH = os.environ.get("AIBOX_VOICEPRINT", "/opt/voice/lacy_voiceprint.npy")
try:
    from resemblyzer import VoiceEncoder, preprocess_wav
    _spk_encoder = VoiceEncoder()
    _lacy_voiceprint = np.load(VOICEPRINT_PATH) if os.path.exists(VOICEPRINT_PATH) else None
    if _lacy_voiceprint is None:
        print(f"[speaker] WARNING: no voiceprint at {VOICEPRINT_PATH} - speaker gate OFF", flush=True)
    else:
        print(f"[speaker] voiceprint loaded; threshold {SPEAKER_THRESHOLD}", flush=True)
except Exception as _spk_err:
    _spk_encoder = None
    _lacy_voiceprint = None
    print(f"[speaker] disabled (encoder load failed): {_spk_err}", flush=True)


def speaker_is_lacy(wav_path):
    """True if the clip's speaker matches Lacy's enrolled voiceprint. Fails OPEN if the
    encoder/voiceprint is unavailable or a rare processing error occurs (so the assistant
    still works); a computed low similarity is a hard reject."""
    if _spk_encoder is None or _lacy_voiceprint is None:
        return True
    try:
        emb = _spk_encoder.embed_utterance(preprocess_wav(wav_path))
    except Exception as e:
        print(f"[speaker] verify error (allowing): {e}", flush=True)
        return True
    sim = float(np.dot(emb, _lacy_voiceprint) /
                (np.linalg.norm(emb) * np.linalg.norm(_lacy_voiceprint) + 1e-9))
    ok = sim >= SPEAKER_THRESHOLD
    print(f"[speaker] sim={sim:.3f} thr={SPEAKER_THRESHOLD} -> {'Lacy' if ok else 'other'}", flush=True)
    return ok
print("[aigartha] listening for wake word 'Hey Aigartha'...", flush=True)


def record(seconds):
    f = tempfile.mktemp(suffix=".wav")
    subprocess.run(["arecord", "-D", CARD, "-f", "S16_LE", "-r", "16000", "-c", "1",
                    "-d", str(seconds), f], stderr=subprocess.DEVNULL)
    return f

# --- continuous rolling-buffer recorder (fills gaps between wake windows) ---
_RATE = 16000
_buf = collections.deque(maxlen=_RATE * 4)   # last ~4s of int16 samples
_buf_lock = threading.Lock()
_rec_stop = threading.Event()
_rec_proc = None


def _recorder_loop():
    global _rec_proc
    while not _rec_stop.is_set():
        _rec_proc = subprocess.Popen(
            ["arecord", "-D", CARD, "-f", "S16_LE", "-r", str(_RATE), "-c", "1", "-t", "raw"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            while not _rec_stop.is_set():
                data = _rec_proc.stdout.read(6400)   # ~0.2s
                if not data:
                    break
                with _buf_lock:
                    _buf.extend(np.frombuffer(data, dtype=np.int16))
        finally:
            try:
                _rec_proc.terminate()
            except Exception:
                pass
        if not _rec_stop.is_set():
            time.sleep(0.2)


def start_recorder():
    _rec_stop.clear()
    threading.Thread(target=_recorder_loop, daemon=True).start()


def pause_recorder():
    _rec_stop.set()
    try:
        if _rec_proc:
            _rec_proc.terminate()
    except Exception:
        pass
    time.sleep(0.3)   # let ALSA release the device


def resume_recorder():
    with _buf_lock:
        _buf.clear()
    start_recorder()


def snapshot(seconds):
    n = int(_RATE * seconds)
    with _buf_lock:
        samples = np.array(list(_buf)[-n:], dtype=np.int16)
    f = tempfile.mktemp(suffix=".wav")
    with wave.open(f, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(_RATE)
        w.writeframes(samples.tobytes())
    level = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2))) if samples.size else 0.0
    return f, level


def rms(path):
    try:
        with wave.open(path) as w:
            d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
        return float(np.sqrt(np.mean(d ** 2))) if d.size else 0.0
    except Exception:
        return 0.0


def transcribe(model, path):
    segs, _ = model.transcribe(path)
    return " ".join(s.text for s in segs).strip().lower()


def say(text):
    subprocess.run([SAY, text])


MON_DEV = os.environ.get("AIBOX_MON_DEV", "plughw:2,0")   # OBSBOT mic: hears "stop" while the SP92 talks
STOP_WORDS = ("stop", "be quiet", "quiet", "cancel", "enough", "never mind", "nevermind", "shut up")


def _synth(text):
    """Run say.sh in synth-only mode; return the padded wav path (caller owns playback)."""
    env = dict(os.environ, AIBOX_SYNTH_ONLY="1")
    p = subprocess.run([SAY, text], capture_output=True, text=True, env=env)
    out = (p.stdout or "").strip().splitlines()
    path = out[-1].strip() if out else ""
    return path if path and os.path.exists(path) else ""


def _is_bargein(heard, answer):
    """True only for a human stop word that is NOT part of Amy's own (echoed) answer.
    The monitor mic has no echo cancellation, so it transcribes Amy's own voice to her
    answer text; a stop word present in the answer is therefore echo, not a barge-in."""
    if not heard:
        return False
    h = heard.lower()
    a = answer.lower()
    return any(sw in h and sw not in a for sw in STOP_WORDS)


def say_interruptible(text):
    """Speak on the SP92; abort playback only if a human stop word is heard on the monitor mic.
    A missing/failed monitor mic (or normal end) must let the full answer play out -- polling
    stops but playback is waited on with no timeout. (The old 1s finalizer truncated every
    answer to ~2 words whenever the monitor device was unavailable.)"""
    wav = _synth(text)
    if not wav:
        say(text)
        return False
    player = subprocess.Popen(["aplay", "-q", "-D", CARD, wav], stderr=subprocess.DEVNULL)
    interrupted = False
    while player.poll() is None:
        mon = tempfile.mktemp(suffix=".wav")
        rc = subprocess.run(["arecord", "-D", MON_DEV, "-f", "S16_LE", "-r", "16000",
                             "-c", "1", "-d", "1", mon], stderr=subprocess.DEVNULL).returncode
        if rc != 0 or not os.path.exists(mon):
            try:
                os.remove(mon)
            except Exception:
                pass
            break                          # no monitor mic -> stop polling, let playback finish
        if player.poll() is not None:
            os.remove(mon)
            break
        heard = transcribe(wake_stt, mon)
        os.remove(mon)
        if _is_bargein(heard, text):
            print(f"[interrupt] '{heard}'", flush=True)
            player.terminate()
            interrupted = True
            break
    if interrupted:
        try:
            player.wait(timeout=1)
        except Exception:
            player.kill()
    else:
        player.wait()                      # full answer plays out; never truncate
    try:
        os.remove(wav)
    except Exception:
        pass
    return interrupted


def llm(system, user, timeout=120):
    r = requests.post(OLLAMA, json={
        "model": LLM,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "stream": False,
    }, timeout=timeout)
    return r.json()["choices"][0]["message"]["content"].strip()


def ambient_context():
    """What the camera is already looking at — cached, so it costs nothing."""
    scene = eyes_call("/scene", timeout=5)
    if not scene or not scene.get("description"):
        return ""
    age = scene.get("age_s")
    if age is not None and age > SCENE_MAX_AGE:
        return ""
    return (" Through your camera you can currently see: " + scene["description"] +
            " Only mention this if it is relevant to what was asked.")


def ask(question):
    return llm(SYSTEM + ambient_context(), question)


def condense(text):
    """Turn a multi-position scan into something short enough to speak."""
    try:
        return llm("You summarize camera observations for speech.",
                   "These are notes from a camera panning across a room, left to right. "
                   "Summarize the room in 2 to 3 short spoken sentences, no lists or markdown:\n\n" + text)
    except Exception:
        return text


def is_visual(text):
    return any(re.search(p, text) for p in VISUAL_PATTERNS)


def extract_query(text):
    match = re.search(SEARCH_TRIGGERS, text)
    if not match:
        return ""
    return text[match.end():].strip(" ?.,").strip()


def pick_result(text):
    """Which remembered link the user meant."""
    if not last_results:
        return None
    for word, index in ORDINALS:
        if re.search(rf"\b{word}\b", text):
            try:
                return last_results[index]
            except IndexError:
                return None
    return last_results[0]


def remember(query, results):
    global last_results, last_query, last_results_at
    last_results, last_query, last_results_at = results, query, time.time()


def results_are_fresh():
    return bool(last_results) and (time.time() - last_results_at) <= RESULTS_TTL


def run_search(query):
    """Search and remember the hits. Returns [] on failure or no results."""
    try:
        results = web.search(query)
    except Exception as e:
        print(f"[search] failed: {e}", flush=True)
        return []
    remember(query, results)
    return results


def parse_answer(raw, results):
    """Split the spoken answer from the source the model says it used.

    Returns (answer, source). answer is None when the model found nothing —
    better to admit that than to narrate whatever the snippets happened to say.
    """
    if "NOTHING FOUND" in raw.upper():
        return None, None
    source = None
    cite = re.search(r"SOURCE:\s*(\d+)", raw, re.I)
    if cite:
        index = int(cite.group(1)) - 1
        if 0 <= index < len(results):
            source = results[index]
        raw = raw[:cite.start()]
    return raw.strip(), source


def handle_search(question):
    query = extract_query(question)
    if len(query) < 3:
        return None
    say("Let me look that up.")
    results = run_search(query)
    if not results:
        return f"I didn't find anything for {query}."
    try:
        raw = llm(SEARCH_SYSTEM,
                  f"Question: {query}\n\nSearch results:\n{web.sources_block(results)}\n\n"
                  "Answer the question.")
    except Exception:
        return f"{results[0]['title']}. That's from {results[0]['domain']}."
    answer, source = parse_answer(raw, results)
    if not answer:
        return f"I couldn't find anything solid about {query}."
    global offer_url, offer_domain
    target = source or (results[0] if results else None)
    if target:
        offer_url, offer_domain = target["url"], target["domain"]
    return f"{answer} That's from {source['domain']}." if source else answer


def clean_spoken(text):
    return ENGINE_PHRASE.sub("", DEVICE_PHRASE.sub(" ", text)).strip()


def search_page_query(text):
    """The thing to search for in 'show me a search for X'."""
    match = re.search(r"\bfor\s+(.+)$", clean_spoken(text))
    if match:
        query = match.group(1).strip(" ?.,")
        if len(query) >= 3:
            return query
    return last_query


def new_subject(text):
    """A fresh thing to look up in "pull up X", or "" if X points at an old result."""
    explicit = extract_query(text)
    if len(explicit) >= 3:
        return explicit
    match = OPEN_SUBJECT.search(text)
    if not match:
        return ""
    subject = match.group(1).strip(" ?.,")
    if POINTS_BACK.match(subject) or len(subject) < 3:
        return ""
    return subject


def preferred_engine(text):
    if re.search(r"\bgoogle\b", text):
        return "google"
    if re.search(r"\bduck ?duck ?go\b", text):
        return "duckduckgo"
    return None


def open_url(url, spoken):
    return spoken if web.open_on_desktop(url) else "I couldn't reach your computer to open that."


def handle_desktop_command(text):
    """Put something on the Windows desktop: a results page, or one result."""
    if SHOW_SEARCH.search(text):
        query = search_page_query(text)
        if not query:
            return "What would you like me to search for?"
        return open_url(web.serp_url(query, preferred_engine(text)),
                        f"Opening a search for {query} on your computer.")

    if not any(re.search(p, text) for p in OPEN_PATTERNS):
        return None

    # An open command carrying its own subject means search THAT — never reopen
    # whatever happened to be found last time.
    fresh = new_subject(clean_spoken(text))
    if fresh:
        results = run_search(fresh)
        if not results:
            return f"I didn't find anything for {fresh}."
        return open_url(results[0]["url"], f"Opening {results[0]['domain']} on your computer.")

    if not results_are_fresh():
        return "I don't have a recent search to open. Ask me to search for something first."

    chosen = pick_result(text)
    if not chosen:
        return "I don't have that one. Ask me to search for something first."
    return open_url(chosen["url"], f"Opening {chosen['domain']} on your computer.")


def handle_camera_command(text):
    """Movement and privacy commands. Returns what to say, or None if not a camera command."""
    if re.search(r"\b(close|shut) your eyes\b|\bstop watching\b|\bcamera off\b", text):
        return "Okay, closing my eyes." if eyes_call("/pause", timeout=15) else "I couldn't turn the camera off."

    if re.search(r"\bopen your eyes\b|\bstart watching\b|\bcamera (back )?on\b", text):
        return "Okay, eyes open." if eyes_call("/resume", timeout=20) else "I couldn't turn the camera back on."

    remember = re.search(
        r"\bremember (?:this spot|this place|this|here|that)(?:\s+as)?\s+(?:the |a |my )?([a-z ]{2,30})", text)
    if remember:
        name = remember.group(1).strip()
        result = eyes_call("/remember", {"name": name}, timeout=20)
        return f"Got it, I'll remember that as {name}." if result and result.get("saved") else "I couldn't save that spot."

    if re.search(r"\blook around\b|\bscan the room\b|\bcheck the room\b|\bwhat('s| is) around\b", text):
        say("Let me take a look around.")
        result = eyes_call("/scan", timeout=300)
        if not result or not result.get("summary"):
            return "I couldn't look around just now."
        return condense(result["summary"])

    if re.search(r"\b(look|turn|point)\b", text):
        if re.search(r"\b(center|centre|straight ahead|forward|recenter|reset)\b", text):
            result = eyes_call("/look", {"dir": "center"})
            return f"Back to center. {result.get('view','')}".strip() if result else "I couldn't move the camera."

        for word, direction in DIRECTIONS.items():
            if re.search(rf"\b{word}\b", text):
                degrees = re.search(r"\b(\d{1,3})\s*degrees?\b", text)
                params = {"dir": direction}
                if degrees:
                    params["deg"] = degrees.group(1)
                result = eyes_call("/look", params)
                if not result or result.get("error"):
                    return "I couldn't move the camera."
                return result.get("view") or f"Looking {direction}."

        spot = re.search(r"\blook at (?:the |my )?([a-z ]{2,30})", text)
        if spot:
            name = spot.group(1).strip()
            result = eyes_call("/look", {"to": name})
            if result and result.get("view"):
                return result["view"]
            if result and result.get("error"):
                return result["error"]
            return "I couldn't look over there."

    return None


AIBOX_TZ = ZoneInfo(os.environ.get("AIBOX_TZ", "America/Phoenix"))
TZ_SPOKEN = os.environ.get("AIBOX_TZ_SPOKEN", "Mountain Standard Time")
TIME_QUERY = re.compile(
    r"\bwhat(?:\'?s| is)?\b[^?]*\b(time|date|day)\b"
    r"|\b(current|the)\s+(time|date)\b"
    r"|\btime\s+is\s+it\b"
    r"|\bwhat\s+day\b"
    r"|\btoday\'?s?\s+date\b",
    re.I,
)


def _ordinal(n):
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def handle_time(text):
    """Answer time/date questions from the real clock. Returns spoken text, or None."""
    if not TIME_QUERY.search(text):
        return None
    now = datetime.now(AIBOX_TZ)
    low = text.lower()
    wants_date = any(w in low for w in ("date", "day", "today"))
    wants_time = "time" in low or "o'clock" in low or "clock" in low
    clock = now.strftime("%I:%M %p").lstrip("0")
    long_date = f"{now.strftime('%A, %B')} {_ordinal(now.day)}, {now.year}"
    if wants_date and not wants_time:
        return f"Today is {long_date}."
    if wants_date and wants_time:
        return f"It's {clock} {TZ_SPOKEN}, on {long_date}."
    return f"It's {clock} {TZ_SPOKEN}."


def respond(question):
    """Route one question. Order is deliberate — see the module docstring."""
    global offer_url, offer_domain
    offer_url, offer_domain = "", ""
    spoken = handle_time(question)
    if spoken:
        return spoken
    spoken = handle_desktop_command(question)
    if spoken:
        return spoken

    spoken = handle_search(question)
    if spoken:
        return spoken

    spoken = handle_camera_command(question)
    if spoken:
        return spoken

    if is_visual(question):
        result = eyes_call("/ask", {"q": question})
        if result and result.get("answer"):
            return result["answer"]
        if result and result.get("error"):
            return result["error"]
        return "I couldn't get a look just now."

    return ask(question)


def is_wake(text):
    """Wake if the text contains a trigger word ('hey', ...) immediately followed by a
    name close to 'amy'/'aigartha'. Whisper garbles the name (amy->andy, aigartha->agatha),
    so an exact list is too brittle; fuzzy-match the following one or two tokens."""
    low = text.lower()
    if any(p in low for p in WAKE):
        return True
    words = re.sub(r"[^a-z ]", " ", low).split()
    for i, w in enumerate(words):
        if w not in WAKE_TRIGGERS:
            continue
        for cand in (words[i + 1] if i + 1 < len(words) else "",
                     "".join(words[i + 1:i + 3])):
            if not cand:
                continue
            if any(difflib.SequenceMatcher(None, cand, n).ratio() >= 0.72 for n in WAKE_NAMES):
                return True
    return False


if __name__ == "__main__":
    start_recorder()
    time.sleep(1.0)   # prime the buffer
    while True:
        time.sleep(0.7)                    # slide the window ~0.7s
        w, level = snapshot(2.5)           # overlapping 2.5s window -> no gaps
        if level < RMS_GATE:
            os.remove(w)
            continue
        text = transcribe(wake_stt, w)
        if not text:
            os.remove(w)
            continue
        print(f"[heard] ({int(level)}) {text}", flush=True)
        if not is_wake(text):
            os.remove(w)
            continue
        if not speaker_is_lacy(w):
            print("[WAKE] wake word heard but not Lacy's voice - ignored", flush=True)
            os.remove(w)
            continue
        os.remove(w)
        print("[WAKE] detected", flush=True)
        pause_recorder()                   # free the SP92 for greeting + conversation
        say("I'm here, Lacy. What do you need?")
        # --- conversation loop ---
        # The first turn is hers (you just called her). After that a follow-up must be
        # spoken up / close (rms >= FOLLOWUP_RMS_GATE) to count as addressed; quieter
        # ambient or cross-room speech ends the conversation and she waits for the wake
        # word again -- so she never answers talk that wasn't directed at her.
        engaged = False
        while True:
            q = record(QUESTION_WINDOW)
            level = rms(q)
            question = transcribe(qa_stt, q)
            clean = question.strip().lower() if question else ""
            if len(clean) < 2:
                os.remove(q)
                if not engaged:
                    say("I didn't catch that. Say it again?")
                    engaged = True
                    continue
                break                      # silence -> conversation is over
            # Only Lacy's voice sustains the conversation; anyone else (a meeting, a
            # passerby) ends it and she waits for the wake word again.
            if engaged and not speaker_is_lacy(q):
                os.remove(q)
                print(f"[followup] ignored - not Lacy's voice: {clean!r}", flush=True)
                break
            os.remove(q)
            if engaged and level < FOLLOWUP_RMS_GATE:
                print(f"[followup] ignored ambient ({int(level)}<{int(FOLLOWUP_RMS_GATE)}): {clean!r}",
                      flush=True)
                break                      # not addressed to her -> require the wake word again
            if any(clean == ph or clean.startswith(ph + " ") for ph in END_PHRASES):
                say("Understood. I'll be here if you need me.")
                break
            print(f"[question] ({int(level)}) {question}", flush=True)
            try:
                answer = respond(question)
            except Exception as e:
                print(f"[error] {e}", flush=True)
                say("Sorry, something went wrong.")
                break
            print(f"[answer] {answer}", flush=True)
            if say_interruptible(answer):
                print("[interrupt] stopped by user", flush=True)
                engaged = True
                continue                   # you cut her off -> skip the offer, keep listening
            engaged = True
            # --- offer to open the search source on the desktop (web-search answers only) ---
            if offer_url:
                url, dom = offer_url, offer_domain
                say(f"Want me to open {dom} in your browser?")
                r = record(OFFER_WINDOW)
                reply = transcribe(qa_stt, r)
                os.remove(r)
                print(f"[offer] {dom} -> {reply!r}", flush=True)
                if is_affirmative(reply):
                    ok = web.open_on_desktop(url)
                    say("Opening it now." if ok else
                        "I couldn't reach your computer. Make sure the desktop helper is running.")
        resume_recorder()
