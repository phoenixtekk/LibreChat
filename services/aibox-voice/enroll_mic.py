#!/usr/bin/env python3
"""Enroll Lacy's voiceprint from the actual speakerphone mic (matches live audio far
better than the clean studio sample). Records a clip, builds the voiceprint, and reports
self-consistency + separation from known non-Lacy samples."""
import os
import sys
import subprocess
import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav

CARD = os.environ.get("AIBOX_CARD_DEV", "plughw:3,0")
SECS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
OUT = "/opt/voice/lacy_voiceprint.npy"
CLIP = "/opt/voice/enroll_capture.wav"

print("\n" + "=" * 60, flush=True)
print(f">>> SPEAK NOW for {SECS} seconds <<<", flush=True)
print(">>> Say 'Hey Aigartha' a few times, then just talk normally", flush=True)
print(">>> (read this sentence aloud, describe your day, anything).", flush=True)
print("=" * 60 + "\n", flush=True)

subprocess.run(
    ["arecord", "-D", CARD, "-f", "S16_LE", "-r", "16000", "-c", "1", "-d", str(SECS), CLIP],
    check=False,
)

enc = VoiceEncoder()
vp = enc.embed_utterance(preprocess_wav(CLIP))
np.save(OUT, vp)


def sim(path):
    e = enc.embed_utterance(preprocess_wav(path))
    return float(np.dot(e, vp) / (np.linalg.norm(e) * np.linalg.norm(vp) + 1e-9))


print("\nsaved voiceprint ->", OUT, flush=True)
print(f"  self (your capture)      : {sim(CLIP):.3f}   (this is ~1.0 by definition)", flush=True)
for f in ["/opt/voice/samples/lacy.wav", "/opt/voice/test.wav", "/opt/voice/samp.wav"]:
    if os.path.exists(f):
        tag = "your old studio sample" if "lacy" in f else "a different voice"
        print(f"  {os.path.basename(f):16} ({tag:22}): {sim(f):.3f}", flush=True)
