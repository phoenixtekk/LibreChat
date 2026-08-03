#!/usr/bin/env bash
# Set how fast Amy talks: setspeed.sh <length-scale>  (lower = faster; 1.0 = model default)
# e.g. setspeed.sh 0.82   ~10% faster than 0.9
CONF=/opt/voice/voice.conf
current="$(. $CONF 2>/dev/null; echo ${AIBOX_LENGTH_SCALE:-0.82})"
case "$1" in
  ''|*[!0-9.]*) echo "Usage: setspeed.sh <length-scale>  (current: $current; lower = faster)"; exit 1 ;;
esac
touch "$CONF"
grep -v '^AIBOX_LENGTH_SCALE=' "$CONF" > "$CONF.tmp"
echo "AIBOX_LENGTH_SCALE=$1" >> "$CONF.tmp"
mv "$CONF.tmp" "$CONF"
echo "speech length-scale set to $1 (was $current; lower = faster)"
