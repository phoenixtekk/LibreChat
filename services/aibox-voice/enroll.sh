#!/bin/bash
# Re-enroll Lacy's voiceprint from the speakerphone mic, then restart the assistant.
SECS="${1:-20}"
echo "Pausing Aigartha to free the microphone..."
systemctl stop aigartha.service
sleep 1
/opt/voice/venv/bin/python /opt/voice/enroll_mic.py "$SECS" 2>&1 | grep -viE "Loaded the voice encoder|pkg_resources is deprecated|import pkg_resources"
echo ""
echo "Restarting Aigartha..."
systemctl start aigartha.service
sleep 3
echo "Done. Say 'Hey Aigartha' to test."
echo "To watch the match scores live:  tail -f /opt/voice/assistant.log | grep speaker"
