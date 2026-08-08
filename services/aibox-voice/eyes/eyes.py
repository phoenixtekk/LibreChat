#!/usr/bin/env python3
"""Amy's eyes — always-on vision daemon for the AiBox.

Owns the OBSBOT Tiny: keeps a live capture running, watches for motion, and
keeps a current description of the room so the voice assistant always knows what
it is looking at without paying for a model call mid-conversation. Also drives
the gimbal, so Amy can look around the room on request.

Frames live in tmpfs and are overwritten in place — nothing is recorded to disk,
and every model call goes to the local Ollama box. Pausing stops the capture
process outright, so the camera's own light goes out.
"""
import base64
import io
import json
import os
import shutil
import signal
import subprocess
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import requests
from PIL import Image

import ptz

DEVICE = os.environ.get("EYES_DEVICE", "/dev/video0")
RUN_DIR = Path(os.environ.get("EYES_RUN_DIR", "/run/amy-eyes"))
FRAME = RUN_DIR / "frame.jpg"
SCENE_FILE = RUN_DIR / "scene.json"

OLLAMA = os.environ.get("EYES_OLLAMA", "http://192.168.166.182:11434")
VLM = os.environ.get("EYES_VLM", "qwen2.5vl:7b")

CAPTURE_SIZE = os.environ.get("EYES_CAPTURE_SIZE", "1280x720")
CAPTURE_FPS = os.environ.get("EYES_CAPTURE_FPS", "2")
VLM_WIDTH = int(os.environ.get("EYES_VLM_WIDTH", "768"))

MOTION_THRESHOLD = float(os.environ.get("EYES_MOTION_THRESHOLD", "6.0"))
QUIET_SECONDS = float(os.environ.get("EYES_QUIET_SECONDS", "2.5"))
IDLE_REFRESH = float(os.environ.get("EYES_IDLE_REFRESH", "300"))
MIN_DESCRIBE_GAP = float(os.environ.get("EYES_MIN_DESCRIBE_GAP", "20"))
PORT = int(os.environ.get("EYES_PORT", "8823"))

SCENE_PROMPT = (
    "Briefly describe what you see in one or two sentences: any people present and "
    "what they are doing, plus notable objects. Be factual and concise."
)
GLANCE_PROMPT = (
    "In one short sentence, say what is in view here. Be factual and concise."
)

state_lock = threading.Lock()
camera_lock = threading.RLock()
camera_busy = threading.Event()

state = {
    "scene": "",
    "scene_at": 0.0,
    "motion": False,
    "last_motion_at": 0.0,
    "paused": False,
    "capture_ok": False,
    "describes": 0,
    "errors": 0,
}


def log(message):
    print(f"[eyes] {message}", flush=True)


class Capture:
    """Keeps a persistent ffmpeg stream writing the newest frame to tmpfs."""

    def __init__(self):
        self.process = None

    def start(self):
        if self.process and self.process.poll() is None:
            return
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        self.process = subprocess.Popen(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
                "-f", "v4l2", "-input_format", "mjpeg",
                "-video_size", CAPTURE_SIZE, "-framerate", "30",
                "-i", DEVICE,
                "-vf", f"fps={CAPTURE_FPS}", "-q:v", "4",
                "-f", "image2", "-atomic_writing", "1", "-update", "1",
                "-y", str(FRAME),
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        log(f"capture started (pid {self.process.pid})")

    def stop(self):
        if not self.process or self.process.poll() is not None:
            return
        self.process.send_signal(signal.SIGINT)
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
        log("capture stopped")

    def alive(self):
        return bool(self.process) and self.process.poll() is None


capture = Capture()


def read_frame(retries=6):
    """Read the newest frame, tolerating a write landing mid-read."""
    for attempt in range(retries):
        try:
            data = FRAME.read_bytes()
            image = Image.open(io.BytesIO(data))
            image.load()
            return data, image
        except (OSError, ValueError):
            time.sleep(0.15 * (attempt + 1))
    return None, None


def frame_age():
    try:
        return time.time() - FRAME.stat().st_mtime
    except OSError:
        return float("inf")


def thumbnail(image, width):
    if image.width <= width:
        return image
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.LANCZOS)


def encode_for_vlm(image):
    buffer = io.BytesIO()
    thumbnail(image.convert("RGB"), VLM_WIDTH).save(buffer, "JPEG", quality=82)
    return base64.b64encode(buffer.getvalue()).decode()


def vlm(prompt, image, timeout=180):
    response = requests.post(
        f"{OLLAMA}/api/generate",
        json={
            "model": VLM,
            "prompt": prompt,
            "images": [encode_for_vlm(image)],
            "stream": False,
        },
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()["response"].strip()


def describe_now(prompt=SCENE_PROMPT):
    _, image = read_frame()
    if image is None:
        raise RuntimeError("no frame available")
    return vlm(prompt, image)


def refresh_scene(reason):
    try:
        description = describe_now()
    except Exception as error:  # noqa: BLE001 - daemon must survive any model failure
        with state_lock:
            state["errors"] += 1
        log(f"describe failed ({reason}): {error}")
        return None

    with state_lock:
        state["scene"] = description
        state["scene_at"] = time.time()
        state["describes"] += 1
    try:
        SCENE_FILE.write_text(json.dumps({
            "description": description,
            "at": time.time(),
            "reason": reason,
        }))
    except OSError:
        pass
    log(f"scene ({reason}): {description}")
    return description


def grayscale_signature(image):
    return np.asarray(thumbnail(image.convert("L"), 160), dtype=np.float32)


def watch_loop():
    """Motion-driven awareness: describe when the room changes and then settles."""
    previous = None
    pending_describe = False
    last_describe = 0.0

    while True:
        time.sleep(0.5)

        with state_lock:
            paused = state["paused"]
        if paused:
            previous = None
            continue

        if not capture.alive():
            with state_lock:
                state["capture_ok"] = False
            log("capture died — restarting")
            with camera_lock:
                capture.start()
            time.sleep(3)
            continue

        if camera_busy.is_set() or frame_age() > 10:
            previous = None
            continue

        _, image = read_frame(retries=2)
        if image is None:
            continue

        with state_lock:
            state["capture_ok"] = True

        signature = grayscale_signature(image)
        if previous is not None and previous.shape == signature.shape:
            delta = float(np.mean(np.abs(signature - previous)))
            moving = delta > MOTION_THRESHOLD
            now = time.time()
            with state_lock:
                state["motion"] = moving
                if moving:
                    state["last_motion_at"] = now
                last_motion = state["last_motion_at"]
                scene_at = state["scene_at"]

            if moving:
                pending_describe = True
            elif (
                pending_describe
                and now - last_motion >= QUIET_SECONDS
                and now - last_describe >= MIN_DESCRIBE_GAP
            ):
                pending_describe = False
                last_describe = now
                refresh_scene("motion settled")
            elif now - scene_at >= IDLE_REFRESH and now - last_describe >= MIN_DESCRIBE_GAP:
                last_describe = now
                refresh_scene("idle refresh")

        previous = signature


@contextmanager
def camera_session():
    """Claim the camera so the motion watcher ignores our own movement."""
    with camera_lock:
        camera_busy.set()
        try:
            yield
        finally:
            camera_busy.clear()


def wait_for_fresh_frame(timeout=4.0):
    """After a move, wait for the stream to deliver a frame from the new view."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if frame_age() < 0.8:
            return True
        time.sleep(0.15)
    return False


def look(direction=None, preset=None, degrees=None):
    """Point the camera and report what came into view."""
    with camera_session():
        if preset:
            moved = ptz.go_to_preset(preset)
            if moved is None:
                return {"error": f"I don't know a spot called {preset}."}
        elif direction == "center":
            moved = ptz.recenter()
        elif direction in ("left", "right"):
            step = degrees if degrees is not None else 35.0
            moved = ptz.nudge(pan_delta=-step if direction == "left" else step)
        elif direction in ("up", "down"):
            step = degrees if degrees is not None else 20.0
            moved = ptz.nudge(tilt_delta=step if direction == "up" else -step)
        else:
            return {"error": f"I don't know how to look {direction}."}

        wait_for_fresh_frame()
        try:
            view = describe_now(GLANCE_PROMPT)
        except Exception as error:  # noqa: BLE001
            return {"position": moved, "error": str(error)}

    with state_lock:
        state["scene"] = view
        state["scene_at"] = time.time()
    return {"position": moved, "view": view}


def scan(path=None):
    """Sweep the room and report what is at each position."""
    stops = path or ptz.SCAN_PATH
    presets = ptz.load_presets()
    results = []

    with camera_session():
        origin = ptz.position()
        for name in stops:
            target = presets.get(name)
            if not target:
                continue
            ptz.move_to(target[0], target[1])
            wait_for_fresh_frame()
            try:
                view = describe_now(GLANCE_PROMPT)
            except Exception as error:  # noqa: BLE001
                view = f"(couldn't see: {error})"
            results.append({"position": name, "view": view})
            log(f"scan {name}: {view}")
        ptz.move_to(origin["pan"], origin["tilt"], settle=False)

    summary = " ".join(f"{r['position'].capitalize()}: {r['view']}" for r in results)
    with state_lock:
        state["scene"] = summary
        state["scene_at"] = time.time()
    return {"stops": results, "summary": summary}


def ask(question):
    """Answer a question about what the camera can see right now."""
    with camera_session():
        _, image = read_frame()
        if image is None:
            return {"error": "I can't see anything right now."}
        answer = vlm(
            f"{question}\n\nAnswer in one or two short spoken sentences, no markdown.",
            image,
        )
    return {"answer": answer}


def pause():
    with state_lock:
        state["paused"] = True
        state["scene"] = ""
        state["motion"] = False
    with camera_lock:
        capture.stop()
    try:
        FRAME.unlink()
    except OSError:
        pass
    log("paused — camera released")
    return True


def resume():
    with state_lock:
        state["paused"] = False
    with camera_lock:
        capture.start()
    log("resumed")
    return True


def snapshot():
    with state_lock:
        current = dict(state)
    current["scene_age_s"] = (
        round(time.time() - current["scene_at"], 1) if current["scene_at"] else None
    )
    current["frame_age_s"] = round(frame_age(), 1)
    current["capture_alive"] = capture.alive()
    try:
        current["position"] = ptz.position()
    except Exception:  # noqa: BLE001
        current["position"] = None
    current["presets"] = sorted(ptz.load_presets())
    return current


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, payload, status=200, content_type="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        route = url.path.rstrip("/") or "/"

        with state_lock:
            paused = state["paused"]
        if paused and route not in ("/status", "/resume"):
            return self._send({"error": "Eyes are closed."}, 409)

        try:
            if route == "/status":
                return self._send(snapshot())
            if route == "/scene":
                current = snapshot()
                return self._send({
                    "description": current["scene"],
                    "age_s": current["scene_age_s"],
                    "motion": current["motion"],
                    "position": current["position"],
                })
            if route == "/frame":
                data, _ = read_frame()
                if data is None:
                    return self._send({"error": "no frame"}, 503)
                return self._send(data, content_type="image/jpeg")
            if route == "/describe":
                return self._send({"description": refresh_scene("requested")})
            if route == "/ask":
                question = query.get("q", "").strip()
                if not question:
                    return self._send({"error": "missing q"}, 400)
                return self._send(ask(question))
            if route == "/look":
                return self._send(look(
                    direction=query.get("dir"),
                    preset=query.get("to"),
                    degrees=float(query["deg"]) if query.get("deg") else None,
                ))
            if route == "/scan":
                return self._send(scan())
            if route == "/remember":
                name = query.get("name", "").strip()
                if not name:
                    return self._send({"error": "missing name"}, 400)
                return self._send({"saved": name, "position": ptz.save_preset(name)})
            if route == "/pause":
                return self._send({"paused": pause()})
            if route == "/resume":
                return self._send({"resumed": resume()})
        except Exception as error:  # noqa: BLE001 - never take the daemon down
            log(f"request {route} failed: {error}")
            return self._send({"error": str(error)}, 500)

        return self._send({"error": "not found"}, 404)


def main():
    if not shutil.which("ffmpeg") or not shutil.which("v4l2-ctl"):
        raise SystemExit("ffmpeg and v4l2-ctl are required")

    RUN_DIR.mkdir(parents=True, exist_ok=True)
    capture.start()
    time.sleep(3)
    ptz.recenter()
    refresh_scene("startup")

    threading.Thread(target=watch_loop, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"listening on 127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    finally:
        capture.stop()


if __name__ == "__main__":
    main()
