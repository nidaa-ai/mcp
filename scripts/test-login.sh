#!/usr/bin/env bash
# One-shot login-flow test: boots `next dev`, exercises the email sign-in API,
# then shuts down. Usage: bash scripts/test-login.sh
set -u
cd "$(dirname "$0")/.."
PORT=3111
rm -rf .next-test
rm -f test-login.log
setsid nohup bunx next dev -p $PORT > test-login.log 2>&1 < /dev/null &
SRV=$!
cleanup() { pkill -P $SRV 2>/dev/null; kill $SRV 2>/dev/null; pkill -f "next dev -p $PORT" 2>/dev/null; }
trap cleanup EXIT

# wait for readiness (max ~60s)
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "home_status=$code"
if [ "$code" != "200" ]; then echo "SERVER FAILED TO BOOT"; tail -c 1500 test-login.log; exit 1; fi

echo "=== 1) valid email login ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" \
  -H "Content-Type: application/json" \
  -d '{"email":"hussain@nidaa.dev","label":"test-device"}' -w "\n[http=%{http_code}]\n"

echo "=== 2) invalid email ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email"}' -w "\n[http=%{http_code}]\n"

echo "=== 3) missing email ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" \
  -H "Content-Type: application/json" -d '{"label":"x"}' -w "\n[http=%{http_code}]\n"

echo "=== 4) second login same email (upsert) ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" \
  -H "Content-Type: application/json" \
  -d '{"email":"HUSSAIN@nidaa.dev","label":"second-device"}' -w "\n[http=%{http_code}]\n"

echo "=== 5) app-config with token ==="
TOKEN=$(curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" \
  -H "Content-Type: application/json" -d '{"email":"hussain@nidaa.dev"}' \
  | sed -n 's/.*"device_token":"\([a-f0-9]*\)".*/\1/p')
echo "token_len=${#TOKEN}"
curl -s --max-time 20 "http://localhost:$PORT/api/app-config?token=$TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('user_email=', d.get('user_email')); print('access_code_default' in d and 'STILL HAS access_code_default!' or 'no access_code_default (good)'); print('has_configs=', 'configs' in d)"

echo "=== 6) app-config with bad token ==="
curl -s --max-time 20 "http://localhost:$PORT/api/app-config?token=$(printf 'a%.0s' $(seq 1 48))" -w "\n[http=%{http_code}]\n" | head -c 200
echo
echo "DONE"
