"use client";

import { useNidaa } from "@/components/nidaa/useNidaa";
import { Login } from "@/components/nidaa/Login";
import { Home } from "@/components/nidaa/Home";
import { IncomingCall, ActiveCallScreen } from "@/components/nidaa/CallScreen";
import { Toaster } from "@/components/ui/toaster";

export default function Page() {
  const nidaa = useNidaa();

  return (
    <main className="min-h-screen bg-[#0f0a1c]">
      {nidaa.phase === "gate" && (
        <Login busy={nidaa.loginBusy} error={nidaa.loginError} onLogin={nidaa.login} />
      )}

      {nidaa.phase === "ready" && nidaa.config && (
        <Home
          config={nidaa.config}
          pushEnabled={nidaa.pushEnabled}
          onEnablePush={nidaa.enablePush}
          onLinkFish={() => nidaa.linkFish()}
          onLogout={nidaa.logout}
          onRefresh={() => void nidaa.refresh()}
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

      <Toaster />
    </main>
  );
}
