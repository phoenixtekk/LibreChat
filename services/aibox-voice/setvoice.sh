#!/usr/bin/env bash
# Switch the AiBox voice: setvoice.sh <jarvis|ryan|amy|lacy>
CONF=/opt/voice/voice.conf
case "$1" in
  jarvis) v=en_GB-alan-medium ;;
  ryan)   v=en_US-ryan-medium ;;
  amy)    v=en_US-amy-medium ;;
  lacy)   v=lacy ;;
  *) echo "Usage: setvoice.sh <jarvis|ryan|amy|lacy>  (current: $(. $CONF 2>/dev/null; echo ${AIBOX_VOICE:-unset}))"; exit 1 ;;
esac
touch "$CONF"
# Rewrite only AIBOX_VOICE so other settings (e.g. AIBOX_LENGTH_SCALE) survive.
grep -v '^AIBOX_VOICE=' "$CONF" > "$CONF.tmp"
echo "AIBOX_VOICE=$v" >> "$CONF.tmp"
mv "$CONF.tmp" "$CONF"
echo "voice set to $1 ($v)"
