#!/usr/bin/env bash
# One-shot bridge loop test: boots `next dev`, runs the never-end-the-call
# contract test, then shuts down. Usage: bash scripts/test-bridge-loop.sh
set -u
cd "$(dirname "$0")/.."
PORT=3112
rm -rf .next-test
rm -f test-bridge.log
setsid nohup bunx next dev -p $PORT > test-bridge.log 2>&1 < /dev/null &
SRV=$!
cleanup() { pkill -P $SRV 2>/dev/null; kill $SRV 2>/dev/null; pkill -f "next dev -p $PORT" 2>/dev/null; }
trap cleanup EXIT

# wait for readiness (max ~90s)
code=000
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then echo "SERVER FAILED TO BOOT"; tail -c 1500 test-bridge.log; exit 1; fi

node scripts/test-bridge-loop.mjs "http://localhost:$PORT"
EXIT=$?
echo "test_exit=$EXIT"
exit $EXIT
