# نداء (Nidaa) — مكالمات صوتية حية بينك وبين إيجنتك 📞

> **الفكرة في سطر:** إيجنتك (ChatGPT / Claude / Cursor / أي أداة) يخلّص مهمة مجدولة → بينده على MCP Server بتاع نداء → في نفس اللحظة **موبايلك يرن** بمكالمة صوتية حية (تطبيق ويب بيتثبّت زي التطبيقات العادية) → الإيجنت يقرا لك الملخص بصوت → تتكلم ويسمعك → ينفّذ طلباتك **جوه نفس المكالمة** ويرد عليك صوتيًا — كل حاجة من غير ما تفتح حسابك أصلًا.

---

## إزاي بيشتغل؟

```
┌────────────┐   ①notify_task_complete     ┌─────────────────┐
│ ChatGPT /  │ ───────────────────────────▶ │   نداء MCP      │
│ Claude /   │                              │  (Vercel)       │
│ أي إيجنت   │ ◀─────────────────────────── │  + Turso DB     │
└────────────┘   ③send_call_update (صوت)    └────────┬────────┘
      ▲                                             │ ②يرن الجرس
      │  ④wait_for_call_updates (سماع كلامك)         ▼
      │                                       ┌──────────────┐
      └────────────────────────────────────── │  موبايلك     │
                                              │  (PWA نداء)  │
                                              └──────┬───────┘
                                                     │ صوت ↔ Fish Audio
                                                     ▼ (Voice Agent "hussain")
```

1. **`notify_task_complete(summary)`** — الإيجنت بيناديها لما المهمة تخلص. موبايلك يرن (جرس + اهتزاز + إشعار Push لو التطبيق مقفول).
2. ترد على المكالمة → إيجنت Fish Audio الصوتي (**hussain** — صوت **فريدة** العربي، محرك **Live 3**) بيفتح الكلام بقراءة الملخص.
3. إنت تتكلم → كلامك يتحول لنص ويوصل للإيجنت عبر **`wait_for_call_updates`** (بلفّة/loop).
4. لو طلبت حاجة («رد على إيميل المدير») → الإيجنت ينفّذها فورًا وبعتها بـ **`send_call_update`** → **تتقال بصوت عالي في نفس اللحظة جوه المكالمة** + تظهر كفقاعة **بنفسجية «تحديث مباشر من الإيجنت»** على الشاشة.
5. الدورة تكرر لحد ما **إنت** تقفل المكالمة — ساعتها بس الإيجنت يعرف إن الجلسة انتهت (`ended=true`) ويخرج من الحلقة. **مفيش حد يقفل المكالمة غيرك.**

**الأدوات (MCP Tools):**

| الأداة | الوظيفة |
|---|---|
| `notify_task_complete` | تفتح مكالمة وترنّ الجرس، بترجّع `call_id` |
| `wait_for_call_updates` | Long-poll — بترجّع كل كلامك الجديد أثناء المكالمة + الحالة |
| `send_call_update` | بتبعت رسالة تتقال صوتيًا فورًا جوه المكالمة (الفقاعة البنفسجية) |
| `get_call_status` | حالة مكالمة / آخر المكالمات |

---

## المكونات

| الجزء | التقنية |
|---|---|
| MCP Server (Streamable HTTP, stateless) | `/api/mcp` — JSON-RPC 2.0، مفتاح `Authorization: Bearer` أو `?key=` |
| REST API لأي أداة تانية | `/api/calls`, `/api/calls/{id}/updates` |
| جسر الصوت (Custom LLM) | `/api/llm/v1/chat/completions` — OpenAI-compatible، Fish Audio بينده عليه كل لفة |
| تطبيق الموبايل | Next.js 16 PWA — شاشة مكالمة، جرس WebAudio، فقاعات مباشرة، RTL عربي |
| الصوت | Fish Audio **Voice Agents** (agent `hussain`، صوت فريدة `ar-eg`، engine `live3` + Drama 3 للعربي، ASR `transcribe-stream-1`) |
| قاعدة البيانات | **Turso** (libsql) |
| الإشعارات | Web Push (VAPID) + قناة SSE |
| الرقم الهاتفي | Twilio `+13202335431` — اتصل عليه تتكلم مع نفس الإيجنت (fallback model) |

---

## النشر على Vercel (خطوة بخطوة)

### 1) ارفع المشروع على GitHub

```bash
git clone https://github.com/nidaa-ai/mcp
```

### 2) Deploy على Vercel

افتح [vercel.com/new](https://vercel.com/new) → **Import** الريبو → قبل أول Deploy ظبّط الـ Environment Variables:

| المتغير | القيمة | ملاحظات |
|---|---|---|
| `FISH_API_KEY` | `sk-fish-...` | من [fish.audio](https://fish.audio) → API keys |
| `FISH_AGENT_ID` | `d0df6840a7454f92aa818ff8575eeff4` | الـ agent **hussain** (جاهز عندك) |
| `FISH_PHONE_NUMBER_ID` | `ab10a45646d84f1f8d31aacf359de261` | رقم Twilio `+13202335431` |
| `TURSO_DATABASE_URL` | `libsql://nidaa-mcp-nidaa.aws-us-east-1.turso.io` | |
| `TURSO_AUTH_TOKEN` | `eyJ...` | |
| `APP_ACCESS_CODE` | كود سرّي تختاره | كود دخول التطبيق — **غيّره عن الافتراضي** |

> `AGENT_API_KEY` اختياري: لو مش محدد، التطبيق يولّد مفتاح تلقائيًا ويعرضه جوّه صفحة «اربط إيجنتك» بعد الدخول.

اضغط **Deploy**. (الـ `maxDuration` لكل route متظبط في `vercel.json` — الخطة المجانية كفاية.)

### 3) اربط Fish Audio (زر واحد)

افتح التطبيق على الموبايل → ادخل كود الدخول → في آخر الصفحة زر **«اربط»** — ده بيعمل الآتي تلقائيًا:

- Custom LLM → `https://تطبيقك/api/llm/v1` (جسر الصوت)
- Webhook → `https://تطبيقك/api/fish/webhook` (call.ended / call.analyzed بتتسجّل تلقائي)
- System prompt عربي + fallback لـ `gpt-6.1-sol-fast` (للمكالمات الهاتفية الواردة)
- تعطيل speculative responses + نشر (Publish) النسخة الجديدة
- ربط رقم Twilio `+13202335431` بنفس الإيجنت

أو من الترمنال:

```bash
node scripts/setup-fish.mjs https://تطبيقك.vercel.app
```

### 4) اربط إيجنتك (كونفج جاهز)

كل الكونفجات موجودة جاهزة للنسخ **جوّه التطبيق نفسه** (تاب «اربط إيجنتك»):

<details>
<summary><b>ChatGPT</b> (Apps & Connectors)</summary>

الإعدادات ← Apps & Connectors ← Create ← MCP ← الصق:

```
https://تطبيقك.vercel.app/api/mcp?key=المفتاح
```

بعدها اعمل **Scheduled Task**، مثلاً:

> «كل يوم الساعة 9 صباحًا: راجع إيميلاتي الجديدة، ولما تخلص نادِ أداة notify_task_complete بالملخص، وبعدين ادخل في حلقة wait_for_call_updates على نفس المكالمة ورد على طلباتي بـ send_call_update لحد ما أقفل.»

</details>

<details>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nidaa": {
      "type": "http",
      "url": "https://تطبيقك.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer المفتاح" }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nidaa": {
      "url": "https://تطبيقك.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer المفتاح" }
    }
  }
}
```

</details>

<details>
<summary><b>REST</b> (n8n / Make / cron / أي كود)</summary>

```bash
# ابدأ مكالمة
curl -X POST https://تطبيقك.vercel.app/api/calls \
  -H "Authorization: Bearer المفتاح" -H "Content-Type: application/json" \
  -d '{"summary":"المهمة خلصت!","title":"المهمة"}'

# استمع للتحديثات (long-poll 25 ثانية)
curl "https://تطبيقك.vercel.app/api/calls/CALL_ID/updates?since=0&wait=25" \
  -H "Authorization: Bearer المفتاح"

# ابعت تحديث يُقال صوتيًا
curl -X POST https://تطبيقك.vercel.app/api/calls/CALL_ID/updates \
  -H "Authorization: Bearer المفتاح" -H "Content-Type: application/json" \
  -d '{"message":"ردّيت على إيميل المدير ✅"}'
```

</details>

### 5) ثبّت التطبيق على موبايلك

- **أندرويد (Chrome):** افتح الرابط → قائمة ⋮ → «إضافة إلى الشاشة الرئيسية».
- **آيفون (Safari):** زر المشاركة → «إضافة إلى الشاشة الرئيسية».
- فعّل **الإشعارات** من صفحة التطبيق (زر التبديل) — كده الجرس يوصل والتطبيق مقفول (آيفون 16.4+).

### 6) اختبر كل حاجة

```bash
node scripts/smoke-test.mjs https://تطبيقك.vercel.app
```

أو يدويًا: من ChatGPT اطلب «نادِ notify_task_complete بملخص تجريبي» — موبايلك المفروض يرن فورًا.

---

## تشغيل محلي

```bash
bun install
cp .env.example .env   # وظّف المفاتيح
bun run dev            # http://localhost:3000
```

## هيكل المشروع

```
src/app/api/mcp/                     → MCP Server (Streamable HTTP)
src/app/api/llm/v1/chat/completions/ → جسر الصوت (Custom LLM لـ Fish)
src/app/api/calls/…                  → REST + answer + end (الرد/القفل)
src/app/api/events/                  → قناة SSE للتطبيق
src/app/api/fish/webhook/            → webhooks المكالمات المنتهية
src/app/api/admin/fish-link/         → زر الربط الشامل
src/app/api/device/                  → اقتران الموبايل + Web Push
src/components/nidaa/                → الواجهة (شاشة المكالمة، الجرس، الفقاعات)
public/sw.js + manifest              → PWA + الإشعارات
scripts/setup-fish.mjs               → ربط Fish من الترمنال
scripts/smoke-test.mjs               → اختبار بعد النشر
```

## ملاحظات تقنية

- **العقل داخل المكالمة هو إيجنتك نفسه** (ChatGPT/Claude عبر MCP) — التطبيق مجرد جسر: صوتك يتحول لنص (ASR بتاع Fish) ويرجع لك كرد منطوق (TTS). لو الرد اتأخر أكتر من ~8 ثواني، الإيجنت الصوتي يقول «ثانية واحدة…» والرد يُقال فور وصوله.
- **لو مفيش إيجنت متواصل** بالمكالمة (مثلاً مكالمة هاتفية على رقم Twilio)، الـ fallback model بتاع Fish بيرد بنفسه — الشخصية العربي متظبطة في الـ system prompt.
- **الخصوصية:** كل المفاتيح على السيرفر — الموبايل بياخد session token مؤقت لكل مكالمة بس. متحطش أي مفتاح في الريبو (ملف `.env` مستثنى من Git).

---

صُنع بـ ❤️ — Fish Audio Voice Agents + MCP + Turso + Next.js 16.
