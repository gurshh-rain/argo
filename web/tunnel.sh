#!/bin/sh
# Starts the web app behind one public HTTPS address so a phone can reach it (and use its microphone).
# Uses cloudflared if installed, otherwise Tailscale Funnel. Pass a URL to use your own tunnel:
#   ./tunnel.sh https://my-tunnel.example.com      (must forward to http://localhost:4318)
set -e
cd "$(dirname "$0")"
URL="$1"
cleanup() { [ -n "$TPID" ] && kill "$TPID" 2>/dev/null; }
trap cleanup EXIT INT TERM

if [ -z "$URL" ] && command -v cloudflared >/dev/null; then
  LOG=$(mktemp)
  cloudflared tunnel --url http://localhost:4318 >"$LOG" 2>&1 &
  TPID=$!
  for _ in $(seq 1 40); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1)
    [ -n "$URL" ] && break
    sleep 0.5
  done
elif [ -z "$URL" ] && command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then
  tailscale funnel --bg 4318 >/dev/null
  URL="https://$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
fi
if [ -z "$URL" ]; then
  echo "No tunnel available. Install cloudflared (brew install cloudflared), start Tailscale, or pass a URL." >&2
  exit 1
fi

TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.argo/config.json')))['token'])" 2>/dev/null || true)
[ -n "$TOKEN" ] && curl -s -o /dev/null -X PUT "http://127.0.0.1:4317/api/settings" -H "Authorization: Bearer $TOKEN" -d "{\"publicUrl\":\"$URL\"}" || true

echo
echo "  Phone address:  $URL"
echo "  Pairing code:   Argo Mac app -> Phone"
echo
wasp start --client-port 4318 --server-port 4319 --client-url "$URL" --server-url "$URL/_server"
