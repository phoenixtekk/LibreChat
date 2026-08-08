#!/usr/bin/env bash
# Tune how Amy talks:  setspeed.sh <length-scale> [sentence-silence] [noise-w]
#   length-scale     lower = faster   (1.0 = model default, current 0.72)
#   sentence-silence seconds of pause after each sentence (piper default 0.20)
#   noise-w          phoneme-width variability; lower = tighter (default 0.8)
# e.g. setspeed.sh 0.72 0.10     ~10% faster than 0.79 with half the sentence gap
CONF=/opt/voice/voice.conf
cur(){ . $CONF 2>/dev/null; echo "${!1:-$2}"; }

case "$1" in
  ''|*[!0-9.]*)
    echo "Usage: setspeed.sh <length-scale> [sentence-silence] [noise-w]"
    echo "  current: length=$(cur AIBOX_LENGTH_SCALE 0.72) silence=$(cur AIBOX_SENTENCE_SILENCE 0.10) noise-w=$(cur AIBOX_NOISE_W 0.8)"
    echo "  lower length-scale = faster; lower sentence-silence = shorter pauses"
    exit 1 ;;
esac

set_key(){ # key value
  touch "$CONF"
  grep -v "^$1=" "$CONF" > "$CONF.tmp"
  echo "$1=$2" >> "$CONF.tmp"
  mv "$CONF.tmp" "$CONF"
}

set_key AIBOX_LENGTH_SCALE "$1"
[ -n "$2" ] && set_key AIBOX_SENTENCE_SILENCE "$2"
[ -n "$3" ] && set_key AIBOX_NOISE_W "$3"

echo "speech: length=$(cur AIBOX_LENGTH_SCALE 0.72) silence=$(cur AIBOX_SENTENCE_SILENCE 0.10) noise-w=$(cur AIBOX_NOISE_W 0.8)"
