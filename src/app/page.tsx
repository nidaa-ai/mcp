"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useNidaa } from "@/components/nidaa/useNidaa";
import { Login } from "@/components/nidaa/Login";
import { Home } from "@/components/nidaa/Home";
import { Landing } from "@/components/nidaa/Landing";
import { IncomingCall, ActiveCallScreen } from "@/components/nidaa/CallScreen";

export default function Page() {
  const nidaa = useNidaa();
  const [view, setView] = useState<"landing" | "login">("landing");

  return (
    <main className="min-h-screen bg-[#0f0a1c]">
      {nidaa.phase === "loading" && (
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" aria-hidden />
            <p className="text-xs text-violet-200/60">جاري تحميل نداء…</p>
          </div>
        </div>
      )}

      {nidaa.phase === "gate" && view === "landing" && (
        <Landing onLogin={() => setView("login")} />
      )}

      {nidaa.phase === "gate" && view === "login" && (
        <Login
          busy={nidaa.loginBusy}
          error={nidaa.loginError}
          onLogin={nidaa.login}
          onBack={() => setView("landing")}
        />
      )}

      {nidaa.phase === "ready" && nidaa.config && (
        <Home
          config={nidaa.config}
          pushEnabled={nidaa.pushEnabled}
          onEnablePush={nidaa.enablePush}
          onLinkFish={() => nidaa.linkFish()}
          onLogout={() => {
            setView("landing");
            nidaa.logout();
          }}
          onRefresh={() => void nidaa.refresh()}
          onSaveFishSettings={nidaa.saveFishSettings}
        />
      )}

      {nidaa.incoming && !nidaa.active && (
        <IncomingCall
          title={nidaa.incoming.title}
          summary={nidaa.incoming.summary}
          onAccept={nidaa.accept}
          onDecline={nidaa.decline}
        />
      )}

      {nidaa.active && (
        <ActiveCallScreen
          call={nidaa.active}
          bubbles={nidaa.bubbles}
          onHangup={nidaa.hangup}
          onToggleMute={nidaa.toggleMute}
          onClose={nidaa.closeEnded}
        />
      )}

      {nidaa.toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] bg-black/80 border border-violet-400/30 text-white text-xs px-4 py-2.5 rounded-full shadow-xl" role="status">
          {nidaa.toast}
        </div>
      )}
    </main>
  );
}
