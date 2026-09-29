#!/usr/bin/env python3
"""PTZ control for the OBSBOT Tiny gimbal over UVC.

The kernel exposes pan/tilt in arcseconds and zoom as 0-100; this module speaks
degrees and named presets. Callers must serialize movement — the eyes daemon
owns the device and holds the lock for the whole move-and-settle cycle.
"""
import json
import subprocess
from pathlib import Path
from time import sleep

DEVICE = "/dev/video0"
ARCSEC = 3600.0

PAN_LIMIT = 130.0
TILT_LIMIT = 90.0
ZOOM_LIMIT = 100

SLEW_DEG_PER_S = 40.0
SETTLE_FLOOR = 0.7
SETTLE_CEILING = 5.0

PRESETS_FILE = Path("/opt/voice/eyes/presets.json")

BUILTIN_PRESETS = {
    "center": (0.0, 0.0),
    "left": (-55.0, 0.0),
    "right": (55.0, 0.0),
    "far left": (-115.0, 0.0),
    "far right": (115.0, 0.0),
    "up": (0.0, 25.0),
    "down": (0.0, -25.0),
}

SCAN_PATH = ["far left", "left", "center", "right", "far right"]


def clamp(value, limit):
    return max(-limit, min(limit, value))


def _ctl(args):
    return subprocess.run(
        ["v4l2-ctl", "-d", DEVICE, *args],
        capture_output=True, text=True, timeout=10,
    )


def _get(names):
    out = _ctl(["--get-ctrl", ",".join(names)]).stdout
    values = {}
    for line in out.splitlines():
        if ":" in line:
            key, _, raw = line.partition(":")
            try:
                values[key.strip()] = int(raw.strip())
            except ValueError:
                continue
    return values


def position():
    """Current gimbal position as degrees plus zoom level."""
    raw = _get(["pan_absolute", "tilt_absolute", "zoom_absolute"])
    return {
        "pan": round(raw.get("pan_absolute", 0) / ARCSEC, 1),
        "tilt": round(raw.get("tilt_absolute", 0) / ARCSEC, 1),
        "zoom": raw.get("zoom_absolute", 0),
    }


def settle_time(pan_delta, tilt_delta):
    travel = max(abs(pan_delta), abs(tilt_delta))
    return min(SETTLE_CEILING, SETTLE_FLOOR + travel / SLEW_DEG_PER_S)


def move_to(pan=None, tilt=None, settle=True):
    """Move to an absolute position in degrees, waiting for the gimbal to stop."""
    current = position()
    target_pan = current["pan"] if pan is None else clamp(pan, PAN_LIMIT)
    target_tilt = current["tilt"] if tilt is None else clamp(tilt, TILT_LIMIT)

    _ctl(["--set-ctrl", f"pan_absolute={int(target_pan * ARCSEC)}"])
    _ctl(["--set-ctrl", f"tilt_absolute={int(target_tilt * ARCSEC)}"])

    if settle:
        sleep(settle_time(target_pan - current["pan"], target_tilt - current["tilt"]))
    return {"pan": target_pan, "tilt": target_tilt}


def nudge(pan_delta=0.0, tilt_delta=0.0):
    current = position()
    return move_to(current["pan"] + pan_delta, current["tilt"] + tilt_delta)


def zoom(level):
    level = max(0, min(ZOOM_LIMIT, int(level)))
    _ctl(["--set-ctrl", f"zoom_absolute={level}"])
    sleep(0.4)
    return level


def load_presets():
    presets = dict(BUILTIN_PRESETS)
    if PRESETS_FILE.exists():
        try:
            saved = json.loads(PRESETS_FILE.read_text())
            presets.update({k: tuple(v) for k, v in saved.items()})
        except (ValueError, TypeError):
            pass
    return presets


def save_preset(name):
    """Remember the current position under a spoken name (e.g. "the door")."""
    name = name.strip().lower()
    current = position()
    saved = {}
    if PRESETS_FILE.exists():
        try:
            saved = json.loads(PRESETS_FILE.read_text())
        except ValueError:
            saved = {}
    saved[name] = [current["pan"], current["tilt"]]
    PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PRESETS_FILE.write_text(json.dumps(saved, indent=2))
    return current


def go_to_preset(name):
    preset = load_presets().get(name.strip().lower())
    if not preset:
        return None
    return move_to(preset[0], preset[1])


def recenter():
    return move_to(0.0, 0.0)
