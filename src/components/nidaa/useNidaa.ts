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
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
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
  /** Last call_event seq delivered over SSE — the reconnect cursor. */
  const lastSeqRef = useRef(0);
  const incomingRef = useRef<{ id: string; title: string; summary: string; at: number } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  /* -------------------------------------------------------- sign-in ---- */

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

  /** Direct sign-in: email only, no password, no access code. */
  const login = useCallback(async (email: string) => {
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, label: navigator.userAgent.slice(0, 90) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "فشل تسجيل الدخول");
      }
      const { device_token } = (await res.json()) as { device_token: string };
      localStorage.setItem(TOKEN_KEY, device_token);
      tokenRef.current = device_token;
      await loadConfig(device_token);
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoginBusy(false);
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

  /**
   * Show the update as a purple bubble, then inject the marker turn so the
   * relay speaks it out loud right now. One retry on failure — a duplicate
   * injection is harmless now (the server stays silent if nothing is left
   * to claim), so erring on the side of retrying keeps the call live.
   */
  const injectAgentUpdate = useCallback(async (text: string, seq: number) => {
    // purple bubble on screen
    setBubbles((prev) =>
      prev.some((b) => b.key === `upd-${seq}`)
        ? prev
        : [...prev, { key: `upd-${seq}`, role: "update", text, ts: Date.now() }],
    );
    injectedUpdatesRef.current.push(norm(text));
    // speak it inside the call right now
    const send = () => {
      const session = sessionRef.current;
      if (!session) return;
      session.sendUserMessage(AGENT_UPDATE_MARKER, { audio: true });
    };
    try {
      send();
    } catch {
      await new Promise((r) => setTimeout(r, 700));
      try { send(); } catch { /* session closing — give up */ }
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

  useEffect(() => { incomingRef.current = incoming; }, [incoming]);

  useEffect(() => {
    const token = tokenRef.current;
    if (!token || phase !== "ready") return;

    let closed = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    /** Attach a handler that tracks the global seq cursor (dedupe + reconnect). */
    const on = (name: string, fn: (data: Record<string, unknown>) => void) => {
      es?.addEventListener(name, (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>;
          const seq = Number(data.seq ?? 0);
          if (seq > 0) {
            if (seq <= lastSeqRef.current) return; // replayed duplicate — skip
            lastSeqRef.current = seq;
          }
          fn(data);
        } catch { /* malformed frame */ }
      });
    };

    const connect = () => {
      if (closed) return;
      // Reconnect with the exact cursor — anything that landed while we were
      // reconnecting is still delivered, so agent replies never go unspoken.
      const since = lastSeqRef.current;
      es = new EventSource(`/api/events?token=${token}${since > 0 ? `&since=${since}` : ""}`);
      esRef.current = es;

      es.addEventListener("hello", () => { failures = 0; });

      on("call:incoming", async (data) => {
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

      on("call:update", (data) => {
        const text = String(data.text ?? "");
        const seq = Number(data.seq ?? 0);
        if (data.call_id === activeIdRef.current) {
          void injectAgentUpdate(text, seq);
        } else if (incomingRef.current && data.call_id === incomingRef.current.id) {
          // update arrived before answering — queue visually
          setBubbles((prev) =>
            prev.some((b) => b.key === `upd-${seq}`)
              ? prev
              : [...prev, { key: `upd-${seq}`, role: "update", text, ts: Date.now() }],
          );
        }
      });

      on("call:status", (data) => {
        const status = String(data.status ?? "");
        if (data.call_id === activeIdRef.current && ["ended", "missed", "declined", "failed"].includes(status)) {
          finishCallUI(`المكالمة انتهت (${status})`);
        } else if (incomingRef.current && data.call_id === incomingRef.current.id && ["missed", "declined", "ended", "failed"].includes(status)) {
          ringtoneRef.current?.stop();
          setIncoming(null);
          busyRef.current = false;
        }
      });

      on("call:event", (data) => {
        if (data.call_id === activeIdRef.current) {
          setBubbles((prev) => [...prev, { key: `sys-${Date.now()}-${prev.length}`, role: "system", text: String(data.text ?? ""), ts: Date.now() }]);
        }
      });

      // The server ends the stream every ~55s ("bye"). Reconnect at once
      // WITH the cursor — native EventSource auto-reconnect would reuse the
      // URL without it and silently skip whatever lands in the gap.
      const schedule = (ms: number) => {
        if (closed || reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, ms);
      };
      es.addEventListener("bye", () => {
        es?.close();
        esRef.current = null;
        schedule(250);
      });
      es.onerror = () => {
        es?.close();
        esRef.current = null;
        failures += 1;
        schedule(Math.min(8_000, 400 * 2 ** Math.min(failures, 5)));
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      esRef.current = null;
    };
  }, [phase, injectAgentUpdate, finishCallUI]);

  /**
   * Safety net while the voice session is live: if the SSE stream ever missed
   * an agent update (tab throttling, dropped reconnect), this 5s poll sees the
   * still-unclaimed reply and injects the marker so it gets spoken anyway.
   */
  useEffect(() => {
    const token = tokenRef.current;
    const id = active?.id;
    const status = active?.status;
    if (!token || !id || (status !== "connected" && status !== "connecting")) return;
    const tick = setInterval(async () => {
      try {
        const res = await fetch(`/api/calls/${id}?token=${token}`, { cache: "no-store" });
        if (!res.ok) return;
        const info = (await res.json()) as { status?: string; pending_agent_updates?: number };
        if (info.status && ["ended", "missed", "declined", "failed"].includes(info.status)) {
          finishCallUI(`المكالمة انتهت (${info.status})`);
          return;
        }
        if (info.pending_agent_updates) {
          try { sessionRef.current?.sendUserMessage(AGENT_UPDATE_MARKER, { audio: true }); } catch { /* noop */ }
        }
      } catch { /* next tick */ }
    }, 5_000);
    return () => clearInterval(tick);
  }, [active?.id, active?.status, finishCallUI]);

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
        const t = (text ?? "").trim();
        if (t) upsertBubble(`u-${segmentId}`, "user", t, final);
      });
      session.on("agentResponseDelta", ({ segmentId, text }) => {
        const t = (text ?? "").trim();
        if (!t) return; // silent turns (duplicate injections) — no empty bubble
        if (!isInjectedUpdate(t)) upsertBubble(`a-${segmentId}`, "agent", t, false);
      });
      session.on("agentResponse", ({ segmentId, text }) => {
        const t = (text ?? "").trim();
        if (!t) return; // silent turns (duplicate injections) — no empty bubble
        if (!isInjectedUpdate(t)) upsertBubble(`a-${segmentId}`, "agent", t, true);
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
        try { session.sendUserMessage(AGENT_UPDATE_MARKER, { audio: true }); } catch { /* noop */ }
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

  /* -------------------------------------------------- fish settings ---- */

  /** Save Fish credentials from the in-app settings form (stored in Turso). */
  const saveFishSettings = useCallback(async (vals: {
    fish_api_key?: string;
    fish_agent_id?: string;
    fish_phone_number_id?: string;
  }): Promise<boolean> => {
    const token = tokenRef.current;
    if (!token) return false;
    try {
      const res = await fetch("/api/admin/fish-settings", {
        method: "POST",
        headers: { "x-device-token": token, "Content-Type": "application/json" },
        body: JSON.stringify(vals),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; agent?: { name?: string } | null;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "فشل حفظ الإعدادات");
      if (body.agent?.name) showToast(`تم الحفظ ✓ — الإيجنت «${body.agent.name}» شغّال`);
      else showToast("اتحفظ — بس Fish مش ردّ بالاسم، اتأكد من الـ API Key والـ Agent ID");
      await loadConfig(token);
      return true;
    } catch (err) {
      showToast((err as Error).message);
      return false;
    }
  }, [showToast, loadConfig]);

  return {
    phase, config, loginBusy, loginError,
    login, logout, refresh, loadConfig,
    incoming, active, bubbles, toast, showToast,
    accept, decline, hangup, toggleMute, closeEnded,
    pushEnabled, enablePush, linkFish, saveFishSettings,
  };
}
