#!/usr/bin/env bash
# Test NIDAA_ALLOWED_EMAILS whitelist + screenshot the login screen.
set -u
cd "$(dirname "$0")/.."
PORT=3112
rm -f test-wl.log
setsid nohup env NIDAA_ALLOWED_EMAILS="owner@nidaa.dev" bunx next dev -p $PORT > test-wl.log 2>&1 < /dev/null &
SRV=$!
cleanup() { pkill -P $SRV 2>/dev/null; kill $SRV 2>/dev/null; pkill -f "next dev -p $PORT" 2>/dev/null; }
trap cleanup EXIT

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "home_status=$code"

echo "=== allowed email ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" -H "Content-Type: application/json" \
  -d '{"email":"owner@nidaa.dev"}' -w "\n[http=%{http_code}]\n" | head -c 160; echo
echo "=== blocked email ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" -H "Content-Type: application/json" \
  -d '{"email":"stranger@gmail.com"}' -w "\n[http=%{http_code}]\n"

echo "=== screenshot login screen ==="
mkdir -p /tmp/render
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
sleep 3
agent-browser screenshot /tmp/render/login.jpg >/dev/null 2>&1 && echo "shot_saved" || echo "shot_failed"
agent-browser close >/dev/null 2>&1
echo "DONE"
