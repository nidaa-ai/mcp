"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, PhoneCall, Mail } from "lucide-react";

export function Login({
  busy,
  error,
  onLogin,
}: {
  busy: boolean;
  error: string | null;
  onLogin: (email: string) => void;
}) {
  const [email, setEmail] = useState("");

  return (
    <div className="min-h-screen bg-[#0f0a1c] text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-4">
          <div className="mx-auto h-20 w-20 rounded-3xl bg-gradient-to-b from-violet-500 to-purple-800 flex items-center justify-center shadow-lg shadow-violet-900/50">
            <PhoneCall className="h-9 w-9 text-white" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">نداء</h1>
            <p className="text-sm text-violet-200/70 leading-relaxed">
              مكالمات صوتية حية بينك وبين إيجنتك — لما المهمة تخلص، موبايلك يرن.
            </p>
          </div>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) onLogin(email.trim());
          }}
        >
          <div className="relative">
            <Mail className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-violet-300/60" aria-hidden />
            <Input
              dir="ltr"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 bg-white/5 border-violet-400/20 text-center text-base placeholder:text-violet-200/40 focus:border-violet-400/60"
            />
          </div>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <Button
            type="submit"
            disabled={busy || !email.trim()}
            className="w-full h-12 text-base bg-violet-600 hover:bg-violet-500"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : "تسجيل الدخول"}
          </Button>
          <p className="text-xs text-violet-200/50 leading-relaxed">
            من غير باسورد ولا كود — أول مرة بيتعمل حسابك فورًا، وبعدها الجهاز يفضل مسجّل دخول.
          </p>
        </form>
      </div>
    </div>
  );
}
