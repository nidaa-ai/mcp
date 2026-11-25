#!/usr/bin/env bash
# Live test of the in-app Fish settings flow:
#   login → app-config (env fallback) → save dummies (DB wins) →
#   bad input rejected → browser snapshot of the settings card → cleanup.
set -u
cd "$(dirname "$0")/.."
PORT=3121
rm -f test-fish.log
setsid nohup bunx next dev -p $PORT > test-fish.log 2>&1 < /dev/null &
SRV=$!
cleanup() { pkill -P $SRV 2>/dev/null; kill $SRV 2>/dev/null; pkill -f "next dev -p $PORT" 2>/dev/null; }
trap cleanup EXIT

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "home_status=$code"

TOKEN=$(curl -s --max-time 20 -X POST "http://localhost:$PORT/api/device" -H "Content-Type: application/json" \
  -d '{"email":"fish-test@nidaa.dev"}' | sed -n 's/.*"device_token":"\([a-f0-9]*\)".*/\1/p')
echo "token_len=${#TOKEN}"

echo "=== 1) app-config BEFORE save (env fallback from local .env) ==="
curl -s --max-time 30 "http://localhost:$PORT/api/app-config?token=$TOKEN" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('fish_config =', json.dumps(d.get('fish_config'), ensure_ascii=False))
print('fish_agent  =', json.dumps(d.get('fish_agent'), ensure_ascii=False))
"

echo "=== 2) save dummy values (DB wins over env) ==="
curl -s --max-time 30 -X POST "http://localhost:$PORT/api/admin/fish-settings" \
  -H "x-device-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"fish_api_key":"sk-fish-dummy-key-0123456789","fish_agent_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fish_phone_number_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}' \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('ok =', d.get('ok'))
print('fish_config =', json.dumps(d.get('fish_config'), ensure_ascii=False))
print('agent =', d.get('agent'))
"

echo "=== 3) app-config AFTER save (dummy agent wins, real key masked) ==="
curl -s --max-time 30 "http://localhost:$PORT/api/app-config?token=$TOKEN" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('fish_config =', json.dumps(d.get('fish_config'), ensure_ascii=False))
"

echo "=== 4) bad agent id rejected ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/admin/fish-settings" \
  -H "x-device-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"fish_agent_id":"not-hex!!"}' -w "\n[http=%{http_code}]\n"

echo "=== 5) unauthorized rejected ==="
curl -s --max-time 20 -X POST "http://localhost:$PORT/api/admin/fish-settings" \
  -H "Content-Type: application/json" -d '{"fish_api_key":"x"}' -w "\n[http=%{http_code}]\n" | head -c 200; echo

echo "=== 6) fish-link blocked until real settings (dummy key -> Fish API fails) ==="
curl -s --max-time 40 -X POST "http://localhost:$PORT/api/admin/fish-link" \
  -H "x-device-token: $TOKEN" -H "Content-Type: application/json" -d '{}' -w "\n[http=%{http_code}]\n" | head -c 300; echo

echo "=== 7) browser: settings card renders ==="
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
sleep 3
agent-browser snapshot > /tmp/refs.txt 2>&1
EMAIL_REF=$(python3 -c "
import re; t=open('/tmp/refs.txt',encoding='utf-8').read()
m=re.search(r'textbox \"[^\"]+\" \[ref=(e\d+)\]',t); print(m.group(1) if m else '')")
agent-browser type "$EMAIL_REF" "fish-test@nidaa.dev" >/dev/null 2>&1
BTN_REF=$(python3 -c "
import re; t=open('/tmp/refs.txt',encoding='utf-8').read()
m=re.search(r'button \"تسجيل الدخول\"[^[]*\[.*?ref=(e\d+)\]',t); print(m.group(1) if m else '')")
agent-browser click "$BTN_REF" >/dev/null 2>&1
sleep 6
agent-browser snapshot 2>&1 | rg -i "Fish|API Key|Agent|تليفون|حفظ|إعدادات" | head -20
agent-browser close >/dev/null 2>&1
echo "DONE"
