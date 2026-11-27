"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PhoneCall, Plug, Download, Zap, ShieldCheck, MessageSquare,
  Github, Youtube, Send, Globe, LogIn, Heart, Copy, Check,
  Star, Sparkles, Bot, Mic, FolderCode,
} from "lucide-react";
import {
  PROJECT_OWNER_AR, PROJECT_OWNER_EN,
  GITHUB_URL, YOUTUBE_URL, TELEGRAM_URL, PAYPAL_EMAIL, PAYPAL_DONATE_URL,
  ANDROID_APK_URL, ANDROID_SOURCE_URL, ANDROID_APP_VERSION,
} from "@/lib/project-info";

type Lang = "ar" | "en";
const LANG_KEY = "nidaa_lang";

const T = {
  ar: {
    appName: "نداء",
    tagline: "مكالمات صوتية حية بينك وبين إيجنتك — لما المهمة تخلص، موبايلك يرن.",
    sub: "إيجنتك (ChatGPT أو Claude أو Cursor أو أي أداة) بيخلّص مهمة مجدولة ويناده عليك بمكالمة صوتية حية: يقرا لك الملخص، ترد عليه، تطلب تنفيذ… ويسمعك ويرد عليك صوتيًا — من غير ما تفتح حسابك أصلًا.",
    freeBadge: "مجاني 100% ومفتوح المصدر",
    login: "تسجيل الدخول",
    noPass: "إيميل بس — من غير باسورد",
    githubCta: "كود المشروع على GitHub",
    featuresTitle: "ليه نداء؟",
    features: [
      { icon: PhoneCall, title: "مكالمات صوتية حية", text: "رن، رد، اتكلم — الإيجنت بيسمعك ويرد عليك صوتيًا في نفس اللحظة، زي مكالمة تليفون عادية بالظبط." },
      { icon: Plug, title: "MCP جاهز لأي إيجنت", text: "ChatGPT وClaude وCursor وn8n وأي أداة بتدعم MCP — كونفج جاهز جوه التطبيق تنسخه بضغطة." },
      { icon: Download, title: "بيتثبّت زي التطبيق", text: "PWA خفيف: ثبّته على الشاشة الرئيسية ووصلتك إشعارات المكالمات (Push) حتى والتطبيق مقفول." },
      { icon: Zap, title: "تنفيذ جوه المكالمة", text: "اطلب حاجة وأنت بتتكلم — «رد على إيميل المدير» — والإيجنت ينفذها ويرد عليك صوتيًا في نفس اللحظة." },
      { icon: ShieldCheck, title: "دخول بإيميل بس", text: "من غير باسورد ولا كود ولا بطاقة — إيميلك وبتدخل فورًا، والجهاز يفضل مسجّل." },
      { icon: MessageSquare, title: "عربي أولًا", text: "واجهة عربية RTL كاملة + إنجليزي، وصوت عربي طبيعي على Fish Audio — بيشتغل على الموبايل والكمبيوتر." },
    ],
    howTitle: "بيشتغل إزاي؟",
    how: [
      "الإيجنت يخلّص المهمة المجدولة",
      "بينادي نداء عبر MCP",
      "موبايلك يرن — رد",
      "تتكلم ويسمعك وينفّذ",
    ],
    ossTitle: "مفتوح المصدر ومجاني للأبد",
    ossText: "الكود كله متاح على GitHub — مجاني بالكامل، من غير خطط ولا اشتراكات. أضف ⭐ Star لو المشروع نفعك وشاركه مع أصحابك.",
    ossBtn: "Star على GitHub",
    supportTitle: "ادعم المشروع بأي مبلغ",
    supportText: "لو نداء نفعك، تقدر تدعمه بأي مبلغ من عندك — مفيش حد أدنى أبدًا. التبرع عبر PayPal:",
    donateBtn: "تبرع بأي مبلغ عبر PayPal",
    orEmail: "أو ابعت أي مبلغ مباشرة على PayPal:",
    copied: "اتنسخ ✓",
    copy: "نسخ",
    followTitle: "تابع المشروع",
    ytName: "قناة NextGen AI على يوتيوب",
    ytDesc: "شروحات وإصدارات وأخبار المشروع أول بأول.",
    tgName: "قناة NextGen AI على تليجرام",
    tgDesc: "تحديثات سريعة ومحتوى تقني يومي.",
    madeBy: "صاحب المشروع",
    freeLine: "نداء — مجاني ومفتوح المصدر",
    rights: "جميع الحقوق محفوظة",
    appTitle: "تطبيق أندرويد رسمي",
    appSub: "نداء بقى تطبيق أندرويد حقيقي — حمّله وثبّته على موبايلك بضغطة، أو خد كود المصدر وابنيه بنفسك.",
    apkName: "تطبيق أندرويد — APK",
    apkDesc: `تحميل مباشر · إصدار ${ANDROID_APP_VERSION}`,
    apkHint: "ثبّته على هاتفك من غير متجر",
    srcName: "كود التطبيق مفتوح المصدر",
    srcDesc: "حمّل مشروع الأندرويد كامل · ZIP",
    srcHint: "ابنِ التطبيق بنفسك",
  },
  en: {
    appName: "Nidaa",
    tagline: "Live voice calls between you and your AI agent — when the task is done, your phone rings.",
    sub: "Your agent (ChatGPT, Claude, Cursor or any tool) finishes a scheduled task and calls you: it reads the summary out loud, you talk back, ask for actions… it hears you and replies live — without ever opening your account.",
    freeBadge: "100% free & open source",
    login: "Sign in",
    noPass: "Email only — no password",
    githubCta: "Source on GitHub",
    featuresTitle: "Why Nidaa?",
    features: [
      { icon: PhoneCall, title: "Live voice calls", text: "Ring, answer, talk — the agent hears you and replies out loud in real time, exactly like a normal phone call." },
      { icon: Plug, title: "MCP-ready for any agent", text: "ChatGPT, Claude, Cursor, n8n — any MCP-capable tool. A ready-made config to copy with one tap." },
      { icon: Download, title: "Installs like an app", text: "Lightweight PWA: install it on your home screen and get call push notifications even when it's closed." },
      { icon: Zap, title: "Act inside the call", text: "Ask while talking — «reply to my manager's email» — the agent executes it and answers you live, instantly." },
      { icon: ShieldCheck, title: "Email-only sign in", text: "No password, no code, no card — just your email and you're in; the device stays signed in." },
      { icon: MessageSquare, title: "Arabic first", text: "Full RTL Arabic UI plus English, with a natural Arabic voice on Fish Audio — works on mobile and desktop." },
    ],
    howTitle: "How it works",
    how: [
      "The agent finishes the scheduled task",
      "It notifies Nidaa over MCP",
      "Your phone rings — answer",
      "You talk, it hears, it acts",
    ],
    ossTitle: "Open source, free forever",
    ossText: "All the code is on GitHub — completely free, no plans, no subscriptions. Leave a ⭐ star if it helps you and share it with your friends.",
    ossBtn: "Star on GitHub",
    supportTitle: "Support the project — any amount",
    supportText: "If Nidaa helps you, support it with any amount you like — there's no minimum, ever. Donations via PayPal:",
    donateBtn: "Donate any amount via PayPal",
    orEmail: "Or send any amount directly to PayPal:",
    copied: "Copied ✓",
    copy: "Copy",
    followTitle: "Follow the project",
    ytName: "NextGen AI on YouTube",
    ytDesc: "Tutorials, releases and project news, first-hand.",
    tgName: "NextGen AI on Telegram",
    tgDesc: "Quick updates and daily tech content.",
    madeBy: "Project by",
    freeLine: "Nidaa — free & open source",
    rights: "All rights reserved",
    appTitle: "Official Android app",
    appSub: "Nidaa is now a real Android app — download it and install it on your phone in one tap, or grab the source code and build it yourself.",
    apkName: "Android app — APK",
    apkDesc: `Direct download · v${ANDROID_APP_VERSION}`,
    apkHint: "Installs on your phone, no store needed",
    srcName: "App source code (open source)",
    srcDesc: "Full Android project · ZIP",
    srcHint: "Build the app yourself",
  },
} as const;

/** أيقونة Google Play — مثلث الألوان الأربعة / Google Play style triangle mark */
function GooglePlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <defs>
        <clipPath id="gp-clip" clipPathUnits="userSpaceOnUse">
          <path d="M5.41 3.75 L19.59 11.25 Q21 12 19.59 12.75 L5.41 20.25 Q4 21 4 19.4 L4 4.6 Q4 3 5.41 3.75 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#gp-clip)">
        <polygon points="4,3 12.8,7.7 9,12" fill="#00A0FF" />
        <polygon points="12.8,7.7 21,12 12.8,16.3 9,12" fill="#00C853" />
        <polygon points="4,21 12.8,16.3 9,12" fill="#FFC400" />
        <polygon points="4,3 9,12 4,21" fill="#FF3D00" />
      </g>
    </svg>
  );
}

function SocialLink({
  href, label, icon: Icon, hover,
}: {
  href: string; label: string; icon: React.ComponentType<{ className?: string }>; hover: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={`h-11 w-11 rounded-xl bg-white/[0.04] border border-violet-400/15 flex items-center justify-center text-violet-200/80 transition-colors hover:text-white hover:border-violet-400/40 ${hover}`}
    >
      <Icon className="h-5 w-5" />
    </a>
  );
}

export function Landing({ onLogin }: { onLogin: () => void }) {
  const [lang, setLang] = useState<Lang>("ar");
  const [emailCopied, setEmailCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "ar") setLang(saved);
  }, []);

  const t = T[lang];
  const rtl = lang === "ar";
  const year = new Date().getFullYear();

  return (
    <div dir={rtl ? "rtl" : "ltr"} lang={lang} className="relative min-h-screen bg-[#0f0a1c] text-white overflow-x-hidden">
      {/* decorative glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -end-32 h-80 w-80 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute top-1/3 -start-40 h-96 w-96 rounded-full bg-purple-700/10 blur-3xl" />
        <div className="absolute bottom-0 start-1/3 h-72 w-72 rounded-full bg-fuchsia-700/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 pb-16">
        {/* nav */}
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-b from-violet-500 to-purple-800 flex items-center justify-center shadow-lg shadow-violet-900/40">
              <PhoneCall className="h-4.5 w-4.5" aria-hidden />
            </div>
            <span className="text-lg font-bold">{t.appName}</span>
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
              <Sparkles className="h-3 w-3" aria-hidden /> {t.freeBadge}
            </span>
          </div>

          {/* language toggle */}
          <div dir="ltr" className="flex items-center gap-1 rounded-full bg-white/[0.04] border border-violet-400/15 p-1">
            <Globe className="mx-1.5 h-3.5 w-3.5 text-violet-300/70" aria-hidden />
            <button
              type="button"
              onClick={() => { setLang("ar"); localStorage.setItem(LANG_KEY, "ar"); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${lang === "ar" ? "bg-violet-600 text-white" : "text-violet-200/70 hover:text-white"}`}
            >
              عربي
            </button>
            <button
              type="button"
              onClick={() => { setLang("en"); localStorage.setItem(LANG_KEY, "en"); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${lang === "en" ? "bg-violet-600 text-white" : "text-violet-200/70 hover:text-white"}`}
            >
              EN
            </button>
          </div>
        </header>

        {/* hero */}
        <section className="pt-10 sm:pt-16 text-center space-y-6">
          <div className="relative mx-auto h-24 w-24">
            <div className="absolute -inset-4 rounded-full bg-violet-500/20 blur-2xl animate-pulse" aria-hidden />
            <div className="relative h-24 w-24 rounded-[2rem] bg-gradient-to-b from-violet-500 to-purple-800 flex items-center justify-center shadow-2xl shadow-violet-900/50">
              <PhoneCall className="h-11 w-11 text-white" aria-hidden />
            </div>
          </div>

          <div className="space-y-4 max-w-2xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-bold leading-tight">
              {t.appName}
              <span className="block mt-2 text-lg sm:text-xl font-semibold text-violet-200/90 leading-relaxed">
                {t.tagline}
              </span>
            </h1>
            <p className="text-sm sm:text-base text-violet-200/70 leading-relaxed">
              {t.sub}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={onLogin}
              className="h-12 px-8 text-base bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-900/40"
            >
              <LogIn className="h-5 w-5" aria-hidden />
              {t.login}
            </Button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md px-6 text-sm font-medium border border-violet-400/25 bg-white/[0.04] text-violet-100 hover:bg-white/[0.08] transition-colors"
            >
              <Github className="h-5 w-5" aria-hidden />
              {t.githubCta}
            </a>
          </div>
          <p className="text-xs text-violet-200/50">{t.noPass}</p>
        </section>

        {/* Android app downloads */}
        <section className="pt-14 space-y-6">
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-bold">{t.appTitle}</h2>
            <p className="text-sm text-violet-200/70 leading-relaxed max-w-xl mx-auto">{t.appSub}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <a
              href={ANDROID_APK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl bg-white/[0.03] border border-violet-400/10 p-5 flex items-center gap-4 hover:border-violet-400/30 transition-colors"
            >
              <div className="h-12 w-12 rounded-xl bg-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <GooglePlayIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t.apkName}</p>
                <p className="text-xs text-violet-200/60 leading-relaxed">{t.apkDesc}</p>
                <p className="text-xs text-violet-200/40 leading-relaxed">{t.apkHint}</p>
              </div>
            </a>
            <a
              href={ANDROID_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl bg-white/[0.03] border border-violet-400/10 p-5 flex items-center gap-4 hover:border-emerald-400/30 transition-colors"
            >
              <div className="h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center shrink-0 group-hover:scale-105 group-hover:bg-emerald-500/25 transition-all">
                <FolderCode className="h-6 w-6 text-emerald-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t.srcName}</p>
                <p className="text-xs text-violet-200/60 leading-relaxed">{t.srcDesc}</p>
                <p className="text-xs text-violet-200/40 leading-relaxed">{t.srcHint}</p>
              </div>
            </a>
          </div>
        </section>

        {/* features */}
        <section className="pt-16 space-y-6">
          <h2 className="text-2xl font-bold text-center">{t.featuresTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl bg-white/[0.03] border border-violet-400/10 p-5 space-y-3 hover:border-violet-400/30 transition-colors"
              >
                <div className="h-10 w-10 rounded-xl bg-violet-500/10 border border-violet-400/20 flex items-center justify-center">
                  <f.icon className="h-5 w-5 text-violet-300" aria-hidden />
                </div>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="text-sm text-violet-200/70 leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section className="pt-14 space-y-6">
          <h2 className="text-2xl font-bold text-center">{t.howTitle}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {t.how.map((step, i) => (
              <div key={step} className="relative rounded-2xl bg-black/30 border border-violet-400/10 p-4">
                <span className="absolute top-3 end-4 text-3xl font-black text-violet-500/25 select-none" aria-hidden>
                  {i + 1}
                </span>
                <div className="flex items-center gap-2">
                  {i === 0 && <Bot className="h-4 w-4 text-violet-300" aria-hidden />}
                  {i === 3 && <Mic className="h-4 w-4 text-violet-300" aria-hidden />}
                  <p className="text-sm font-medium leading-snug pe-6">{step}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* open source */}
        <section className="pt-14">
          <div className="rounded-3xl bg-gradient-to-b from-violet-600/15 to-transparent border border-violet-400/20 p-8 sm:p-10 text-center space-y-5">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-white/[0.05] border border-violet-400/25 flex items-center justify-center">
              <Github className="h-7 w-7 text-violet-200" aria-hidden />
            </div>
            <h2 className="text-2xl font-bold">{t.ossTitle}</h2>
            <p className="text-sm text-violet-200/70 leading-relaxed max-w-xl mx-auto">{t.ossText}</p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-violet-600 hover:bg-violet-500 px-6 text-sm font-medium transition-colors"
            >
              <Star className="h-4 w-4" aria-hidden />
              {t.ossBtn}
            </a>
          </div>
        </section>

        {/* support (PayPal) */}
        <section className="pt-10">
          <div className="rounded-3xl bg-white/[0.03] border border-violet-400/10 p-8 sm:p-10 text-center space-y-5">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-400/25 flex items-center justify-center">
              <Heart className="h-7 w-7 text-rose-300" aria-hidden />
            </div>
            <h2 className="text-2xl font-bold">{t.supportTitle}</h2>
            <p className="text-sm text-violet-200/70 leading-relaxed max-w-xl mx-auto">{t.supportText}</p>
            <a
              href={PAYPAL_DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-rose-600 hover:bg-rose-500 px-6 text-sm font-medium transition-colors"
            >
              <Heart className="h-4 w-4" aria-hidden />
              {t.donateBtn}
            </a>
            <div className="max-w-md mx-auto space-y-2">
              <p className="text-xs text-violet-200/60">{t.orEmail}</p>
              <div className="flex items-center justify-center gap-2">
                <code dir="ltr" className="rounded-lg bg-black/40 border border-violet-400/10 px-3 py-2 text-xs text-violet-100 break-all">
                  {PAYPAL_EMAIL}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-violet-200 hover:text-white hover:bg-violet-500/20"
                  onClick={async () => {
                    await navigator.clipboard.writeText(PAYPAL_EMAIL).catch(() => {});
                    setEmailCopied(true);
                    setTimeout(() => setEmailCopied(false), 1600);
                  }}
                >
                  {emailCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  <span className="text-xs">{emailCopied ? t.copied : t.copy}</span>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* follow: YouTube + Telegram */}
        <section className="pt-10 space-y-6">
          <h2 className="text-2xl font-bold text-center">{t.followTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <a
              href={YOUTUBE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl bg-white/[0.03] border border-violet-400/10 p-5 flex items-center gap-4 hover:border-violet-400/30 transition-colors"
            >
              <div className="h-12 w-12 rounded-xl bg-red-600/15 border border-red-400/25 flex items-center justify-center shrink-0 group-hover:bg-red-600/25 transition-colors">
                <Youtube className="h-6 w-6 text-red-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{t.ytName}</p>
                <p className="text-xs text-violet-200/60 leading-relaxed">{t.ytDesc}</p>
              </div>
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl bg-white/[0.03] border border-violet-400/10 p-5 flex items-center gap-4 hover:border-violet-400/30 transition-colors"
            >
              <div className="h-12 w-12 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center shrink-0 group-hover:bg-sky-500/25 transition-colors">
                <Send className="h-6 w-6 text-sky-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{t.tgName}</p>
                <p className="text-xs text-violet-200/60 leading-relaxed">{t.tgDesc}</p>
              </div>
            </a>
          </div>
        </section>

        {/* footer */}
        <footer className="pt-14 mt-4 border-t border-violet-400/10 space-y-5 text-center">
          <div className="space-y-1">
            <p className="text-xs text-violet-200/50">{t.madeBy}</p>
            <p className="text-lg font-bold">
              {rtl ? PROJECT_OWNER_AR : `${PROJECT_OWNER_AR} · ${PROJECT_OWNER_EN}`}
            </p>
          </div>
          <div dir="ltr" className="flex items-center justify-center gap-3">
            <SocialLink href={GITHUB_URL} label="GitHub" icon={Github} hover="hover:bg-white/10" />
            <SocialLink href={YOUTUBE_URL} label="YouTube" icon={Youtube} hover="hover:bg-red-600/20" />
            <SocialLink href={TELEGRAM_URL} label="Telegram" icon={Send} hover="hover:bg-sky-500/20" />
          </div>
          <p className="text-[11px] text-violet-200/40">
            {t.freeLine} · © {year} {rtl ? PROJECT_OWNER_AR : PROJECT_OWNER_EN} — {t.rights}
          </p>
        </footer>
      </div>
    </div>
  );
}
