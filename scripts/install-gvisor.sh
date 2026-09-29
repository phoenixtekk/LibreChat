#!/bin/bash
# Install gVisor (runsc) on the g3 host so the Hermes agent runtime can spawn
# per-task containers under a kernel-level sandbox. Approved by Lacy 2026-06-16
# (option "Yes, with socket proxy") — the docker daemon restart bounces every
# container on g3 (analytikul stack + vllm + comfyui + postiz + open-webui +
# paperclip + wikijs). Each comes back in ~30-90 sec.
set -euo pipefail
ts=$(date +%Y%m%d-%H%M%S)
echo "[1/6] installing runsc binary"
(
  set -e
  ARCH=$(uname -m)
  URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"
  cd /tmp
  curl -fsLO "${URL}/runsc"
  curl -fsLO "${URL}/runsc.sha512"
  curl -fsLO "${URL}/containerd-shim-runsc-v1"
  curl -fsLO "${URL}/containerd-shim-runsc-v1.sha512"
  sha512sum -c runsc.sha512
  sha512sum -c containerd-shim-runsc-v1.sha512
  sudo chmod a+rx runsc containerd-shim-runsc-v1
  sudo mv runsc containerd-shim-runsc-v1 /usr/local/bin/
  /usr/local/bin/runsc --version | head -1
)
echo "[2/6] runsc installed"

# Backup daemon.json
sudo mkdir -p /etc/docker
if [ -f /etc/docker/daemon.json ]; then
  sudo cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.${ts}"
  echo "[3/6] daemon.json backed up"
else
  echo "[3/6] no existing daemon.json"
fi

# Merge or create daemon.json adding the runsc runtime. Uses jq if installed,
# falls back to python.
if command -v jq >/dev/null; then
  EXISTING="{}"
  [ -f /etc/docker/daemon.json ] && EXISTING="$(cat /etc/docker/daemon.json)"
  MERGED=$(echo "$EXISTING" | jq '. + {runtimes: ((.runtimes // {}) + {runsc: {path: "/usr/local/bin/runsc"}})}')
  echo "$MERGED" | sudo tee /etc/docker/daemon.json > /dev/null
else
  sudo python3 - <<PY
import json, os
p = "/etc/docker/daemon.json"
d = {}
if os.path.exists(p):
    with open(p) as f:
        try: d = json.load(f)
        except Exception: d = {}
d.setdefault("runtimes", {})["runsc"] = {"path": "/usr/local/bin/runsc"}
with open(p, "w") as f:
    json.dump(d, f, indent=2)
PY
fi
echo "[4/6] daemon.json updated with runsc runtime"

echo "[5/6] restarting docker daemon (bounces all containers on host)"
sudo systemctl restart docker
sleep 6
echo "[5/6] docker daemon back up"

echo "[6/6] verifying runsc works"
docker run --rm --runtime=runsc alpine:3 echo "gVisor OK $(uname -r)"
echo "DONE"
