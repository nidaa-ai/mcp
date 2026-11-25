"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActiveCall, Bubble } from "./types";
import {
  PhoneCall, PhoneOff, PhoneIncoming, Mic, MicOff, Loader2,
  Sparkles, Bot, User, Volume2,
} from "lucide-react";

function fmt(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function AgentOrb({ mode }: { mode: ActiveCall["mode"] }) {
  const label = mode === "listening" ? "بيسمعك" : mode === "thinking" ? "بيفكر…" : "بيتكلم";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <div className={`absolute inset-0 rounded-full ${mode === "speaking" ? "animate-pulse bg-violet-500/20" : "bg-violet-500/10"}`} />
        <div className="absolute inset-2 rounded-full bg-gradient-to-b from-violet-500 to-purple-800 flex items-center justify-center shadow-xl shadow-violet-900/50">
          <Bot className="h-10 w-10 text-white" aria-hidden />
        </div>
        {mode === "thinking" && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-1 bg-black/60 rounded-full px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-300 animate-bounce [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-violet-300 animate-bounce [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-violet-300 animate-bounce [animation-delay:300ms]" />
          </div>
        )}
      </div>
      <p className="text-xs text-violet-200/80">{label}</p>
    </div>
  );
}

function BubbleItem({ b }: { b: Bubble }) {
  if (b.role === "update") {
    return (
      <div className="flex justify-start" dir="rtl">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-purple-600/90 border border-purple-300/30 px-4 py-3 shadow-lg shadow-purple-900/40">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-3.5 w-3.5 text-purple-100" aria-hidden />
            <span className="text-[10px] font-semibold text-purple-100">تحديث مباشر من الإيجنت</span>
          </div>
          <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{b.text}</p>
        </div>
      </div>
    );
  }
  if (b.role === "system") {
    return (
      <div className="flex justify-center" dir="rtl">
        <span className="text-[10px] text-violet-200/50 bg-white/5 rounded-full px-3 py-1">{b.text}</span>
      </div>
    );
  }
  const isUser = b.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`} dir="rtl">
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 leading-relaxed ${
          isUser
            ? "rounded-br-sm bg-white/10 border border-white/10 text-white"
            : "rounded-bl-sm bg-violet-600/25 border border-violet-400/25 text-violet-50"
        } ${b.final === false ? "opacity-80" : ""}`}
      >
        {isUser && <User className="inline h-3 w-3 ms-1 text-violet-200/50" aria-hidden />}
        {!isUser && <Volume2 className="inline h-3 w-3 me-1 text-violet-300/60" aria-hidden />}
        <p className={`text-sm whitespace-pre-wrap inline ${isUser ? "text-end" : ""}`}>{b.text}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ incoming ---- */

export function IncomingCall({
  title,
  summary,
  onAccept,
  onDecline,
}: {
  title: string;
  summary: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-[#241243] to-[#0c0616] text-white flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 pt-14">
        <div className="relative">
          <div className="absolute -inset-6 rounded-full bg-violet-500/20 animate-ping" />
          <div className="h-28 w-28 rounded-full bg-gradient-to-b from-violet-500 to-purple-800 flex items-center justify-center shadow-2xl shadow-violet-900/60">
            <PhoneCall className="h-12 w-12 text-white" aria-hidden />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-violet-200/70">مكالمة صوتية واردة من الإيجنت…</p>
          <p className="text-xs text-violet-200/50 max-w-xs mx-auto line-clamp-3 leading-relaxed">{summary}</p>
        </div>
      </div>
      <div className="flex-1 flex items-end justify-center pb-16">
        <div className="flex items-center gap-16">
          <div className="flex flex-col items-center gap-2">
            <Button
              size="icon"
              aria-label="رفض المكالمة"
              onClick={onDecline}
              className="h-16 w-16 rounded-full bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-900/50"
            >
              <PhoneOff className="h-7 w-7" aria-hidden />
            </Button>
            <span className="text-xs text-violet-200/60">ارفض</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button
              size="icon"
              aria-label="رد على المكالمة"
              onClick={onAccept}
              className="h-16 w-16 rounded-full bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/50 animate-bounce"
            >
              <PhoneIncoming className="h-7 w-7" aria-hidden />
            </Button>
            <span className="text-xs text-violet-200/60">رد</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- active ---- */

export function ActiveCallScreen({
  call,
  bubbles,
  onHangup,
  onToggleMute,
  onClose,
}: {
  call: ActiveCall;
  bubbles: Bubble[];
  onHangup: () => void;
  onToggleMute: () => void;
  onClose: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - call.startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [call.startedAt]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles]);

  if (call.status === "ended" || call.status === "error") {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-[#241243] to-[#0c0616] text-white flex flex-col items-center justify-center gap-6 px-8">
        <div className="h-20 w-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <PhoneOff className="h-9 w-9 text-violet-200/70" aria-hidden />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold">{call.status === "error" ? "المكالمة وقفت" : "انتهت المكالمة"}</h2>
          <p className="text-sm text-violet-200/60 leading-relaxed">{call.endReason ?? ""}</p>
          {bubbles.length > 0 && (
            <p className="text-xs text-violet-200/40">{bubbles.filter((b) => b.role !== "system").length} رسالة في المكالمة</p>
          )}
        </div>
        <Button onClick={onClose} className="bg-violet-600 hover:bg-violet-500 h-11 px-8">
          رجوع
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-[#241243] to-[#0c0616] text-white flex flex-col">
      {/* header */}
      <div className="pt-10 pb-2 px-6 flex flex-col items-center gap-3 shrink-0">
        <AgentOrb mode={call.mode} />
        <div className="text-center">
          <h2 className="text-lg font-bold">{call.title}</h2>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            {call.status === "connecting" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-violet-300" aria-hidden />
                <span className="text-xs text-violet-200/70">جاري فتح القناة الصوتية…</span>
              </>
            ) : (
              <span dir="ltr" className="text-xs tabular-nums text-violet-200/70">{fmt(seconds)}</span>
            )}
          </div>
        </div>
      </div>

      {/* transcript feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0" dir="rtl">
        {call.summary && bubbles.length === 0 && (
          <p className="text-center text-[11px] text-violet-200/40 leading-relaxed max-w-xs mx-auto">
            الإيجنت هيتكلم أول ما يتصل… الملخص هيُقال صوتيًا.
          </p>
        )}
        {bubbles.map((b) => (
          <BubbleItem key={b.key} b={b} />
        ))}
      </div>

      {/* controls */}
      <div className="shrink-0 pb-10 pt-4 px-8 bg-black/20 border-t border-white/5" style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-center gap-12">
          <div className="flex flex-col items-center gap-2">
            <Button
              size="icon"
              aria-label={call.muted ? "إلغاء كتم الصوت" : "كتم الصوت"}
              onClick={onToggleMute}
              className={`h-14 w-14 rounded-full ${call.muted ? "bg-amber-600 hover:bg-amber-500" : "bg-white/10 hover:bg-white/20 border border-white/15"}`}
            >
              {call.muted ? <MicOff className="h-6 w-6" aria-hidden /> : <Mic className="h-6 w-6" aria-hidden />}
            </Button>
            <span className="text-[10px] text-violet-200/60">{call.muted ? "مكتوم" : "المايك مفتوح"}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button
              size="icon"
              aria-label="قفل المكالمة"
              onClick={onHangup}
              className="h-16 w-16 rounded-full bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-900/50"
            >
              <PhoneOff className="h-7 w-7" aria-hidden />
            </Button>
            <span className="text-[10px] text-violet-200/60">اقفل (إنت بس اللي تقدر)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
