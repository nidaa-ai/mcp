"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  PhoneCall, BellRing, Download, Plug, Copy, Check,
  MessageSquare, Bot, Clock, Signal, LogOut, Phone,
  Fish, Save, Loader2,
} from "lucide-react";
import type { AppConfig } from "./types";
import { GITHUB_URL } from "@/lib/project-info";

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-violet-200/80">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-violet-200 hover:text-white hover:bg-violet-500/20"
          onClick={async () => {
            await navigator.clipboard.writeText(text).catch(() => {});
            setCopied(true);
            toast({ title: "تم النسخ ✓", duration: 1500 });
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          <span className="text-xs">{copied ? "اتنسخ" : "نسخ"}</span>
        </Button>
      </div>
      <pre dir="ltr" className="max-h-40 overflow-auto rounded-lg bg-black/40 border border-violet-400/10 p-3 text-[11px] leading-relaxed text-violet-100 whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

function statusBadge(s: string) {
  switch (s) {
    case "active": return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/15">نشطة</Badge>;
    case "ringing": return <Badge className="bg-amber-500/15 text-amber-300 border-amber-400/30 hover:bg-amber-500/15">بيرن</Badge>;
    case "ended": return <Badge variant="outline" className="text-violet-200/70 border-violet-400/20">خلصت</Badge>;
    case "missed": return <Badge className="bg-rose-500/15 text-rose-300 border-rose-400/30 hover:bg-rose-500/15">فاتتك</Badge>;
    case "declined": return <Badge variant="outline" className="text-violet-200/70 border-violet-400/20">رفضتها</Badge>;
    default: return <Badge variant="outline" className="text-violet-200/70 border-violet-400/20">{s}</Badge>;
  }
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "الآن";
  if (s < 3600) return `منذ ${Math.floor(s / 60)} دقيقة`;
  if (s < 86400) return `منذ ${Math.floor(s / 3600)} ساعة`;
  return new Date(ts).toLocaleDateString("ar-EG");
}

/** In-app Fish Audio credentials form — saved to THIS account only (multi-tenant). */
function FishSettingsCard({
  config,
  saving,
  onSave,
}: {
  config: AppConfig;
  saving: boolean;
  onSave: (vals: { fish_api_key?: string; fish_agent_id?: string; fish_phone_number_id?: string }) => Promise<boolean>;
}) {
  const fc = config.fish_config;
  const [apiKey, setApiKey] = useState("");
  const [agentId, setAgentId] = useState(fc.agent_id || "");
  const [phoneId, setPhoneId] = useState(fc.phone_number_id || "");

  const chips: Array<[string, boolean]> = [
    ["API Key", !!fc.api_key_set],
    ["Agent", !!fc.agent_id],
    ["رقم التليفون", !!fc.phone_number_id],
  ];

  return (
    <Card className="bg-white/[0.03] border-violet-400/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-violet-100 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Fish className="h-4 w-4 text-violet-300" aria-hidden />
            إعدادات Fish Audio
          </span>
          <span className="flex gap-1">
            {chips.map(([label, ok]) => (
              <Badge
                key={label}
                className={ok
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/15"
                  : "bg-amber-500/15 text-amber-300 border-amber-400/30 hover:bg-amber-500/15"}
              >
                {label} {ok ? "✓" : "ناقص"}
              </Badge>
            ))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-2 space-y-3">
        <p className="text-[11px] text-violet-200/60 leading-relaxed">
          القيم دي بتتحفظ لحسابك إنت بس — كل مستخدم بيجيب مفتاح Fish بتاعه لوحده، وكل واحد مكالماته ومفتاح ربط الإيجنت بتاعه. مفيش حاجة بتتحط على Vercel. سيب حاجة فاضية لو مش عايز تغيّرها.
        </p>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await onSave({
              fish_api_key: apiKey.trim() || undefined,
              fish_agent_id: agentId.trim() || undefined,
              fish_phone_number_id: phoneId.trim() || undefined,
            });
            if (ok) setApiKey("");
          }}
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-violet-200/80" htmlFor="fish-api-key">API Key</label>
            <Input
              id="fish-api-key"
              dir="ltr"
              type="password"
              autoComplete="off"
              placeholder={fc.api_key_masked ?? "sk-fish-…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-10 bg-white/5 border-violet-400/20 text-sm focus:border-violet-400/60"
            />
            {fc.api_key_masked && (
              <p className="text-[10px] text-violet-200/50">المحفوظ حاليًا: <span dir="ltr">{fc.api_key_masked}</span> — سيبه فاضي عشان يفضل</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-violet-200/80" htmlFor="fish-agent-id">Agent ID</label>
            <Input
              id="fish-agent-id"
              dir="ltr"
              autoComplete="off"
              placeholder="حط الـ Agent ID بتاعك من fish.audio (hex)"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="h-10 bg-white/5 border-violet-400/20 text-sm focus:border-violet-400/60"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-violet-200/80" htmlFor="fish-phone-id">Phone Number ID (اختياري)</label>
            <Input
              id="fish-phone-id"
              dir="ltr"
              autoComplete="off"
              placeholder="حط الـ Phone Number ID بتاعك من Twilio (hex)"
              value={phoneId}
              onChange={(e) => setPhoneId(e.target.value)}
              className="h-10 bg-white/5 border-violet-400/20 text-sm focus:border-violet-400/60"
            />
          </div>
          <Button type="submit" disabled={saving} className="w-full h-10 bg-violet-600 hover:bg-violet-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {saving ? "جاري الحفظ…" : "حفظ الإعدادات"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function Home({
  config,
  pushEnabled,
  onEnablePush,
  onLinkFish,
  onLogout,
  onRefresh,
  onSaveFishSettings,
}: {
  config: AppConfig;
  pushEnabled: boolean;
  onEnablePush: () => void;
  onLinkFish: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onSaveFishSettings: (vals: { fish_api_key?: string; fish_agent_id?: string; fish_phone_number_id?: string }) => Promise<boolean>;
}) {
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [fishLinking, setFishLinking] = useState(false);
  const [fishSaving, setFishSaving] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as unknown as { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const cfg = config.configs;
  const mcpWithKey = `${config.origin}/api/mcp?key=${config.agent_api_key}`;

  return (
    <div className="min-h-screen bg-[#0f0a1c] text-white">
      <div className="mx-auto max-w-lg px-4 pt-8 pb-16 space-y-5">
        {/* header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-b from-violet-500 to-purple-800 flex items-center justify-center shadow-lg shadow-violet-900/40">
              <PhoneCall className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">نداء</h1>
              <p className="text-xs text-violet-200/60">
                {config.fish_agent?.name ? `الوكيل الصوتي: ${config.fish_agent.name}` : "جسر الإيجنت الصوتي"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="text-violet-200/70 hover:bg-violet-500/20" onClick={onRefresh} aria-label="تحديث">
              <Signal className="h-5 w-5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" className="text-violet-200/70 hover:bg-violet-500/20" onClick={onLogout} aria-label="تسجيل خروج">
              <LogOut className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </header>

        {/* status card */}
        <Card className="bg-white/[0.03] border-violet-400/10">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                <span className="text-violet-100/90">الجهاز متصل ومستني مكالمات</span>
              </div>
              {config.user_email && (
                <span dir="ltr" className="text-[11px] text-violet-200/60 truncate max-w-[180px]">{config.user_email}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-black/30 border border-violet-400/10 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <BellRing className="h-4 w-4 text-violet-300" aria-hidden />
                  <Switch checked={pushEnabled} onCheckedChange={onEnablePush} aria-label="تفعيل الإشعارات" />
                </div>
                <p className="text-xs text-violet-200/70 leading-snug">إشعارات المكالمات (جرس والتطبيق مقفول)</p>
              </div>
              <button
                className="rounded-xl bg-black/30 border border-violet-400/10 p-3 space-y-2 text-start hover:border-violet-400/40 transition-colors"
                onClick={async () => {
                  if (installPrompt) await installPrompt.prompt();
                  else window.alert("على آيفون: افتح قائمة المشاركة في Safari واختار «إضافة إلى الشاشة الرئيسية».");
                }}
              >
                <div className="flex items-center justify-between">
                  <Download className="h-4 w-4 text-violet-300" aria-hidden />
                  <span className="text-[10px] text-violet-300/70">PWA</span>
                </div>
                <p className="text-xs text-violet-200/70 leading-snug">ثبّت التطبيق على الشاشة الرئيسية</p>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* recent calls */}
        <Card className="bg-white/[0.03] border-violet-400/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-violet-100 flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-300" aria-hidden />
              آخر المكالمات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-72 overflow-y-auto">
              {(config.recent_calls ?? []).length === 0 ? (
                <p className="p-5 text-xs text-violet-200/50 text-center leading-relaxed">
                  لسه مفيش مكالمات. شغّل مهمة مجدولة عند إيجنتك وهيصلك الجرس هنا.
                </p>
              ) : (
                <ul className="divide-y divide-violet-400/10">
                  {(config.recent_calls ?? []).map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="h-9 w-9 rounded-full bg-violet-500/10 border border-violet-400/20 flex items-center justify-center shrink-0">
                        <Phone className={`h-4 w-4 ${c.status === "missed" ? "text-rose-300" : "text-violet-300"}`} aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.title || "مكالمة من الإيجنت"}</p>
                        <p className="text-[11px] text-violet-200/50 truncate">{c.summary}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {statusBadge(c.status)}
                        <span className="text-[10px] text-violet-200/40">{timeAgo(c.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* fish audio credentials (stored in the DB) */}
        <FishSettingsCard
          key={`${config.fish_config?.api_key_set}|${config.fish_config?.agent_id}|${config.fish_config?.phone_number_id}`}
          config={config}
          saving={fishSaving}
          onSave={async (vals) => {
            setFishSaving(true);
            const ok = await onSaveFishSettings(vals);
            setFishSaving(false);
            return ok;
          }}
        />

        {/* connect agents */}
        <Card className="bg-white/[0.03] border-violet-400/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-violet-100 flex items-center gap-2">
              <Plug className="h-4 w-4 text-violet-300" aria-hidden />
              اربط إيجنتك — كونفج جاهز
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <Tabs defaultValue="chatgpt" dir="rtl">
              <TabsList className="grid w-full grid-cols-5 bg-black/30 h-9">
                <TabsTrigger value="chatgpt" className="text-[10px] px-0 whitespace-nowrap text-violet-200/70 data-[state=active]:text-white data-[state=active]:bg-violet-500/25 dark:data-[state=active]:bg-violet-500/25">ChatGPT</TabsTrigger>
                <TabsTrigger value="claude" className="text-[10px] px-0 whitespace-nowrap text-violet-200/70 data-[state=active]:text-white data-[state=active]:bg-violet-500/25 dark:data-[state=active]:bg-violet-500/25">Claude</TabsTrigger>
                <TabsTrigger value="cursor" className="text-[10px] px-0 whitespace-nowrap text-violet-200/70 data-[state=active]:text-white data-[state=active]:bg-violet-500/25 dark:data-[state=active]:bg-violet-500/25">Cursor</TabsTrigger>
                <TabsTrigger value="json" className="text-[10px] px-0 whitespace-nowrap text-violet-200/70 data-[state=active]:text-white data-[state=active]:bg-violet-500/25 dark:data-[state=active]:bg-violet-500/25">MCP</TabsTrigger>
                <TabsTrigger value="rest" className="text-[10px] px-0 whitespace-nowrap text-violet-200/70 data-[state=active]:text-white data-[state=active]:bg-violet-500/25 dark:data-[state=active]:bg-violet-500/25">REST</TabsTrigger>
              </TabsList>

              <TabsContent value="chatgpt" className="space-y-3 mt-3">
                <div className="flex items-start gap-2 rounded-lg bg-violet-500/10 border border-violet-400/20 p-3">
                  <MessageSquare className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" aria-hidden />
                  <p className="text-[11px] text-violet-100/80 leading-relaxed">
                    في ChatGPT: الإعدادات ← Apps &amp; Connectors ← Create. نوع MCP، والصق الرابط ده. بعدها اعمل مهمة مجدولة (Scheduled task) واقولها تستخدم أداة نداء لما تخلص.
                  </p>
                </div>
                <CopyBox label="ChatGPT Connector URL (فيه المفتاح جوه الرابط)" text={mcpWithKey} />
              </TabsContent>

              <TabsContent value="claude" className="space-y-3 mt-3">
                <p className="text-[11px] text-violet-100/70 leading-relaxed">
                  حط ده في <code dir="ltr">claude_desktop_config.json</code> (Settings ← Developer ← Edit Config):
                </p>
                <CopyBox label="Claude Desktop" text={JSON.stringify(cfg.claude.json, null, 2)} />
              </TabsContent>

              <TabsContent value="cursor" className="space-y-3 mt-3">
                <p className="text-[11px] text-violet-100/70 leading-relaxed">
                  حط ده في <code dir="ltr">~/.cursor/mcp.json</code>:
                </p>
                <CopyBox label="Cursor" text={JSON.stringify(cfg.cursor.json, null, 2)} />
              </TabsContent>

              <TabsContent value="json" className="space-y-3 mt-3">
                <CopyBox label="MCP endpoint + headers" text={JSON.stringify(cfg.mcp_json.json, null, 2)} />
              </TabsContent>

              <TabsContent value="rest" className="space-y-3 mt-3">
                <p className="text-[11px] text-violet-100/70 leading-relaxed">لأي أداة تانية (n8n / Make / cron / كود):</p>
                <CopyBox label="ابدأ مكالمة" text={cfg.rest.notify} />
                <CopyBox label="استمع للتحديثات (long-poll)" text={cfg.rest.poll} />
                <CopyBox label="ابعت تحديث يُقال صوتيًا" text={cfg.rest.send} />
              </TabsContent>
            </Tabs>

            <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-black/30 border border-violet-400/10 p-3">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="h-4 w-4 text-violet-300 shrink-0" aria-hidden />
                <p className="text-[11px] text-violet-200/70 leading-snug">ربط Fish Audio (Custom LLM + Webhook + الرقم) بنفس الزر</p>
              </div>
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-500 h-8 shrink-0"
                disabled={fishLinking || !config.fish_config?.api_key_set || !config.fish_config?.agent_id}
                title={!config.fish_config?.api_key_set || !config.fish_config?.agent_id ? "احفظ إعدادات Fish الأول" : "اربط كل حاجة"}
                onClick={async () => {
                  setFishLinking(true);
                  await onLinkFish();
                  setFishLinking(false);
                }}
              >
                {fishLinking ? "جاري الربط…" : "اربط"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <footer className="pt-2 text-center">
          <p className="text-[10px] text-violet-200/40 leading-relaxed">
            نداء — MCP Server + Voice Agents على Fish Audio · MCP: <span dir="ltr">{config.origin}/api/mcp</span>
          </p>
          <p className="text-[10px] text-violet-200/40 leading-relaxed mt-1">
            {"مجاني ومفتوح المصدر · صاحب المشروع: حسين شعبان · GitHub: "}
            <a dir="ltr" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-violet-200/70">{GITHUB_URL.replace("https://", "")}</a>
          </p>
        </footer>
      </div>
    </div>
  );
}
