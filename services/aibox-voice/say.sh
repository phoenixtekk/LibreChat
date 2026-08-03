#!/usr/bin/env bash
# Speak text on the SP92. Reads voice + speed from voice.conf.
CONF="/opt/voice/voice.conf"; [ -f "$CONF" ] && . "$CONF"
VOICE="${AIBOX_VOICE:-en_GB-alan-medium}"; CARD="${AIBOX_CARD:-3}"
# Piper's length-scale is INVERSE to speed: lower = faster. 1.0 is the model default.
SCALE="${AIBOX_LENGTH_SCALE:-0.82}"
# The SP92 takes a moment to wake when playback starts and eats the beginning
# of the audio, so pad silence onto the front (and a little onto the tail).
LEAD_MS="${AIBOX_LEAD_MS:-400}"
TAIL_S="${AIBOX_TAIL_S:-0.25}"

text="$*"; [ -z "$text" ] && text="$(cat)"
tmp="$(mktemp --suffix=.wav)"
if [ "$VOICE" = "lacy" ] || [ "$VOICE" = "xtts" ]; then
  COQUI_TOS_AGREED=1 /opt/voice/venv/bin/python /opt/voice/xtts_say.py "$text" "$tmp" >/dev/null 2>&1
else
  printf "%s" "$text" | /opt/voice/venv/bin/piper -m "$VOICE" --length-scale "$SCALE" --data-dir /opt/voice/models -f "$tmp" 2>/dev/null
fi

if [ "${LEAD_MS:-0}" -gt 0 ] 2>/dev/null; then
  padded="$(mktemp --suffix=.wav)"
  if ffmpeg -hide_banner -loglevel error -i "$tmp" \
       -af "adelay=${LEAD_MS}:all=1,apad=pad_dur=${TAIL_S}" -y "$padded" 2>/dev/null; then
    mv -f "$padded" "$tmp"
  else
    rm -f "$padded"
  fi
fi

aplay -D "plughw:${CARD},0" "$tmp" 2>/dev/null
rm -f "$tmp"
