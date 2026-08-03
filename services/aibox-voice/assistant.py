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
import os, re, sys, wave, time, tempfile, subprocess
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
SCENE_MAX_AGE = 600   # ignore ambient context older than this

# Fuzzy variants Whisper may produce for the wake word
WAKE = ["hey amy","hey aimee","hey amie","hey emmy","hey ami","hay amy","hey, amy"]

SYSTEM = ("You are Aigartha, Lacy's local voice assistant on the AiBox. "
          "Answer briefly and conversationally — 1 to 3 sentences, plain spoken text, "
          "no markdown or lists, since your reply is read aloud.")

SEARCH_SYSTEM = ("You answer questions out loud using web search results. "
                 "1 to 3 short spoken sentences, no markdown, no lists, never read out URLs. "
                 "If the results conflict or don't cover it, say so briefly.")

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

# Send the current link to the desktop.
OPEN_PATTERNS = [
    r"\bon (?:my|the) (?:computer|screen|pc|desktop|monitor|laptop)\b",
    r"\bpull (?:that|it|this|them|those) up\b", r"\bpull up (?:that|it|the)\b",
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

last_results = []   # most recent search hits, so a follow-up can act on them


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
print("[aigartha] listening for wake word 'Hey Amy'...", flush=True)


def record(seconds):
    f = tempfile.mktemp(suffix=".wav")
    subprocess.run(["arecord", "-D", CARD, "-f", "S16_LE", "-r", "16000", "-c", "1",
                    "-d", str(seconds), f], stderr=subprocess.DEVNULL)
    return f


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


def handle_search(question):
    query = extract_query(question)
    if len(query) < 3:
        return None
    global last_results
    say("Let me look that up.")
    try:
        results = web.search(query)
    except Exception as e:
        print(f"[search] failed: {e}", flush=True)
        return "I couldn't reach the search service."
    if not results:
        last_results = []
        return f"I didn't find anything for {query}."
    last_results = results
    try:
        answer = llm(SEARCH_SYSTEM,
                     f"Question: {query}\n\nSearch results:\n{web.sources_block(results)}\n\n"
                     "Answer the question.")
    except Exception:
        answer = results[0]["title"]
    return f"{answer} That's from {results[0]['domain']}."


def handle_desktop_command(text):
    """Open a remembered link on the Windows desktop."""
    if not any(re.search(p, text) for p in OPEN_PATTERNS):
        return None
    chosen = pick_result(text)
    if not chosen:
        return "I don't have a link to open yet. Ask me to search for something first."
    if not web.open_on_desktop(chosen["url"]):
        return "I couldn't reach your computer to open that."
    return f"Opening {chosen['domain']} on your computer."


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


def respond(question):
    """Route one question. Order is deliberate — see the module docstring."""
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
    return any(p in text for p in WAKE)


if __name__ == "__main__":
    while True:
        w = record(WAKE_WINDOW)
        level = rms(w)
        if level < RMS_GATE:
            os.remove(w)
            continue
        text = transcribe(wake_stt, w)
        os.remove(w)
        if not text:
            continue
        print(f"[heard] ({int(level)}) {text}", flush=True)
        if not is_wake(text):
            continue
        print("[WAKE] detected", flush=True)
        say("How can I help you, Lacy?")
        q = record(QUESTION_WINDOW)
        question = transcribe(qa_stt, q)
        os.remove(q)
        print(f"[question] {question}", flush=True)
        if not question:
            say("Sorry, I didn't catch that.")
            continue

        try:
            answer = respond(question)
        except Exception as e:
            print(f"[error] {e}", flush=True)
            say("Sorry, something went wrong.")
            continue
        print(f"[answer] {answer}", flush=True)
        say(answer)
