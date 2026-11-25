"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSession as FishAgentSession } from "@fishaudio/agent-client";
import { Ringtone, playBlip } from "./ringtone";
import type { ActiveCall, AppConfig, Bubble } from "./types";

export const AGENT_UPDATE_MARKER = "__NDAA_AGENT_UPDATE__";
const TOKEN_KEY = "nidaa_device_token";

function norm(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export type Phase = "loading" | "gate" | "ready";

export function useNidaa() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<{ id: string; title: string; summary: string; at: number } | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  const tokenRef = useRef<string | null>(null);
  const sessionRef = useRef<FishAgentSession | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const injectedUpdatesRef = useRef<string[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const busyRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  /* ---------------------------------------------------------- pairing ---- */

  const loadConfig = useCallback(async (token: string) => {
    try {
      const res = await fetch(`/api/app-config?token=${token}`, { cache: "no-store" });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        tokenRef.current = null;
        setPhase("gate");
        return null;
      }
      const cfg = (await res.json()) as AppConfig;
      setConfig(cfg);
      setPhase("ready");
      return cfg;
    } catch {
      setPhase("ready");
      return null;
    }
  }, []);

  const pair = useCallback(async (code: string) => {
    setPairing(true);
    setPairError(null);
    try {
      const res = await fetch("/api/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, label: navigator.userAgent.slice(0, 90) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "فشل الدخول");
      }
      const { device_token } = (await res.json()) as { device_token: string };
      localStorage.setItem(TOKEN_KEY, device_token);
      tokenRef.current = device_token;
      await loadConfig(device_token);
    } catch (err) {
      setPairError((err as Error).message);
    } finally {
      setPairing(false);
    }
  }, [loadConfig]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    tokenRef.current = null;
    setConfig(null);
    setPhase("gate");
  }, []);

  const refresh = useCallback(async () => {
    if (tokenRef.current) await loadConfig(tokenRef.current);
  }, [loadConfig]);

  /* ------------------------------------------------------ call control ---- */

  const upsertBubble = useCallback((key: string, role: Bubble["role"], text: string, final: boolean) => {
    setBubbles((prev) => {
      const idx = prev.findIndex((b) => b.key === key);
      if (idx === -1) return [...prev, { key, role, text, final, ts: Date.now() }];
      const next = [...prev];
      next[idx] = { ...next[idx], text, final };
      return next;
    });
  }, []);

  const isInjectedUpdate = useCallback((text: string) => {
    const t = norm(text);
    if (t.length < 6) return false;
    return injectedUpdatesRef.current.some((u) => u.includes(t) || t.includes(u));
  }, []);

  const finishCallUI = useCallback((reason?: string) => {
    ringtoneRef.current?.stop();
    activeIdRef.current = null;
    busyRef.current = false;
    setActive((prev) => (prev ? { ...prev, status: "ended", endReason: reason } : null));
    try { sessionRef.current?.end(); } catch { /* noop */ }
    sessionRef.current = null;
    void playBlip("hangup");
    if (tokenRef.current) void loadConfig(tokenRef.current);
  }, [loadConfig]);

  /* -------------------------------------------------------------- SSE ---- */

  const injectAgentUpdate = useCallback(async (text: string, seq: number) => {
    // purple bubble on screen
    setBubbles((prev) =>
      prev.some((b) => b.key === `upd-${seq}`)
        ? prev
        : [...prev, { key: `upd-${seq}`, role: "update", text, ts: Date.now() }],
    );
    injectedUpdatesRef.current.push(norm(text));
    // speak it inside the call right now
    const session = sessionRef.current;
    if (session) {
      try {
        await session.sendUserMessage(AGENT_UPDATE_MARKER, { audio: true });
      } catch { /* session may be closing */ }
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setPhase("gate");
      return;
    }
    tokenRef.current = token;
    loadConfig(token);
  }, [loadConfig]);

  useEffect(() => {
    const token = tokenRef.current;
    if (!token || phase !== "ready") return;

    const es = new EventSource(`/api/events?token=${token}`);
    esRef.current = es;

    es.addEventListener("call:incoming", async (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { call_id: string; text: string };
      if (activeIdRef.current || busyRef.current) return; // already in a call
      busyRef.current = true;
      try {
        const res = await fetch(`/api/calls/${data.call_id}?token=${token}`, { cache: "no-store" });
        const call = (await res.json()) as { id: string; title: string; summary: string; status: string };
        if (["ended", "missed", "declined", "failed"].includes(call.status)) {
          busyRef.current = false;
          return;
        }
        setIncoming({ id: call.id, title: call.title || "مكالمة من الإيجنت", summary: call.summary, at: Date.now() });
        if (!ringtoneRef.current) ringtoneRef.current = new Ringtone();
        ringtoneRef.current.start();
      } catch {
        busyRef.current = false;
      }
    });

    es.addEventListener("call:update", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { call_id: string; seq: number; text: string };
      if (data.call_id === activeIdRef.current) {
        injectAgentUpdate(data.text, data.seq);
      } else if (incoming && data.call_id === incoming.id) {
        // update arrived before answering — queue visually
        setBubbles((prev) =>
          prev.some((b) => b.key === `upd-${data.seq}`)
            ? prev
            : [...prev, { key: `upd-${data.seq}`, role: "update", text: data.text, ts: Date.now() }],
        );
      }
    });

    es.addEventListener("call:status", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { call_id: string; status: string };
      if (data.call_id === activeIdRef.current && ["ended", "missed", "declined", "failed"].includes(data.status)) {
        finishCallUI(`المكالمة انتهت (${data.status})`);
      } else if (incoming && data.call_id === incoming.id && ["missed", "declined", "ended", "failed"].includes(data.status)) {
        ringtoneRef.current?.stop();
        setIncoming(null);
        busyRef.current = false;
      }
    });

    es.addEventListener("call:event", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { call_id: string; text: string; kind: string };
      if (data.call_id === activeIdRef.current) {
        setBubbles((prev) => [...prev, { key: `sys-${Date.now()}-${prev.length}`, role: "system", text: data.text ?? "", ts: Date.now() }]);
      }
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [phase, injectAgentUpdate, incoming, finishCallUI]);

  /* ------------------------------------------------------ accept flow ---- */

  const accept = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !incoming || busyRef.current !== true || activeIdRef.current) return;
    const callId = incoming.id;
    ringtoneRef.current?.stop();
    setIncoming(null);
    setBubbles([]);
    injectedUpdatesRef.current = [];
    setActive({
      id: callId,
      title: incoming.title,
      summary: incoming.summary,
      startedAt: Date.now(),
      status: "connecting",
      mode: "listening",
      muted: false,
    });
    activeIdRef.current = callId;
    void playBlip("answer");

    try {
      const res = await fetch(`/api/calls/${callId}/answer`, {
        method: "POST",
        headers: { "x-device-token": token },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "فشل بدء الجلسة الصوتية");
      }
      const body = (await res.json()) as Record<string, unknown>;
      const { nidaa_call, ...sessionToken } = body;

      const { AgentSession } = await import("@fishaudio/agent-client");
      const session = await AgentSession.start({ sessionToken: sessionToken as never });

      session.on("userTranscript", ({ segmentId, text, final }) => {
        upsertBubble(`u-${segmentId}`, "user", text, final);
      });
      session.on("agentResponseDelta", ({ segmentId, text }) => {
        if (!isInjectedUpdate(text)) upsertBubble(`a-${segmentId}`, "agent", text, false);
      });
      session.on("agentResponse", ({ segmentId, text }) => {
        if (!isInjectedUpdate(text)) upsertBubble(`a-${segmentId}`, "agent", text, true);
      });
      session.on("modeChange", (mode) => {
        setActive((prev) => (prev ? { ...prev, mode } : prev));
      });
      session.on("disconnect", ({ reason }) => {
        if (activeIdRef.current === callId) finishCallUI(reason === "user_hangup" ? "قفلت المكالمة" : `انتهت: ${reason}`);
      });
      session.on("error", (err) => {
        showToast(`خطأ في الجلسة: ${err?.code ?? "unknown"}`);
      });

      sessionRef.current = session;
      setActive((prev) => (prev ? { ...prev, status: "connected" } : prev));

      // if the MCP agent already queued updates before answering, speak them now
      const info = await fetch(`/api/calls/${callId}?token=${token}`, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ pending_agent_updates?: number }>)
        .catch(() => null);
      if (info?.pending_agent_updates) {
        await session.sendUserMessage(AGENT_UPDATE_MARKER, { audio: true });
      }
    } catch (err) {
      setActive((prev) => (prev ? { ...prev, status: "error", endReason: (err as Error).message } : null));
      showToast((err as Error).message);
      busyRef.current = false;
      // The voice channel could not open — close the call server-side so the
      // MCP agent's wait_for_call_updates loop exits cleanly.
      activeIdRef.current = null;
      await fetch(`/api/calls/${callId}/end`, {
        method: "POST",
        headers: { "x-device-token": token },
      }).catch(() => {});
    }
  }, [incoming, upsertBubble, isInjectedUpdate, finishCallUI, showToast]);

  const decline = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !incoming) return;
    ringtoneRef.current?.stop();
    const id = incoming.id;
    setIncoming(null);
    busyRef.current = false;
    void playBlip("hangup");
    await fetch(`/api/calls/${id}/end`, { method: "POST", headers: { "x-device-token": token } }).catch(() => {});
  }, [incoming]);

  const hangup = useCallback(async () => {
    const token = tokenRef.current;
    const id = activeIdRef.current ?? active?.id;
    if (!token || !id) return;
    finishCallUI("قفلت المكالمة");
    await fetch(`/api/calls/${id}/end`, { method: "POST", headers: { "x-device-token": token } }).catch(() => {});
  }, [active, finishCallUI]);

  const toggleMute = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const next = !session.micMuted;
    await session.setMicMuted(next).catch(() => {});
    setActive((prev) => (prev ? { ...prev, muted: next } : prev));
  }, []);

  const closeEnded = useCallback(() => {
    setActive(null);
    setBubbles([]);
  }, []);

  /* ------------------------------------------------------------- push ---- */

  const enablePush = useCallback(async () => {
    const token = tokenRef.current;
    const cfg = config;
    if (!token || !cfg?.vapid_public_key) {
      showToast("مفتوح VAPID مش متظبط لسه — جرب تاني");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const key = cfg.vapid_public_key;
        const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      }
      const res = await fetch("/api/device", {
        method: "PUT",
        headers: { "x-device-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error("فشل تسجيل الإشعار");
      setPushEnabled(true);
      showToast("الإشعارات اتفعلت — هتسمع الجرس والتطبيق مقفول");
    } catch (err) {
      showToast(`تعذر تفعيل الإشعارات: ${(err as Error).message}`);
    }
  }, [config, showToast]);

  useEffect(() => {
    (async () => {
      try {
        if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") setPushEnabled(true);
      } catch { /* noop */ }
    })();
  }, [phase]);

  /* -------------------------------------------------- fish one-click ---- */

  const linkFish = useCallback(async (bindPhoneNumberId?: string) => {
    const token = tokenRef.current;
    if (!token) return false;
    try {
      const res = await fetch("/api/admin/fish-link", {
        method: "POST",
        headers: { "x-device-token": token, "Content-Type": "application/json" },
        body: JSON.stringify(bindPhoneNumberId ? { bind_phone_number_id: bindPhoneNumberId } : {}),
      });
      const body = (await res.json()) as { ok?: boolean; results?: Record<string, unknown> };
      if (!res.ok || !body.ok) throw new Error("فشل ربط إعدادات Fish");
      showToast("تم ربط إعدادات Fish Audio ونشرها");
      if (tokenRef.current) void loadConfig(tokenRef.current);
      return true;
    } catch (err) {
      showToast((err as Error).message);
      return false;
    }
  }, [showToast, loadConfig]);

  return {
    phase, config, pairing, pairError,
    pair, logout, refresh, loadConfig,
    incoming, active, bubbles, toast, showToast,
    accept, decline, hangup, toggleMute, closeEnded,
    pushEnabled, enablePush, linkFish,
  };
}
