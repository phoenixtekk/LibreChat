#!/usr/bin/env bash
# Speak text on the SP92. Reads voice + speed from voice.conf.
CONF="/opt/voice/voice.conf"; [ -f "$CONF" ] && . "$CONF"
VOICE="${AIBOX_VOICE:-en_GB-alan-medium}"; CARD="${AIBOX_CARD:-3}"
# Piper's length-scale is INVERSE to speed: lower = faster. 1.0 is the model default.
SCALE="${AIBOX_LENGTH_SCALE:-0.82}"
text="$*"; [ -z "$text" ] && text="$(cat)"
tmp="$(mktemp --suffix=.wav)"
if [ "$VOICE" = "lacy" ] || [ "$VOICE" = "xtts" ]; then
  COQUI_TOS_AGREED=1 /opt/voice/venv/bin/python /opt/voice/xtts_say.py "$text" "$tmp" >/dev/null 2>&1
else
  printf "%s" "$text" | /opt/voice/venv/bin/piper -m "$VOICE" --length-scale "$SCALE" --data-dir /opt/voice/models -f "$tmp" 2>/dev/null
fi
aplay -D "plughw:${CARD},0" "$tmp" 2>/dev/null
rm -f "$tmp"
