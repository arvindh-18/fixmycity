import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { tokenStore } from "@/services/api";
import { useAuth } from "./AuthContext";
import type { Message } from "@/types";

/**
 * One WebSocket per signed-in tab. Server events:
 *   notification   → toast + refresh the bell
 *   message        → refresh conversations; listeners (open chat) get the message instantly
 *   read           → refresh read receipts
 *   issue_updated  → refetch that issue wherever it's on screen
 * Reconnects with backoff if the connection drops.
 */
type Listener = (m: Message) => void;
interface RT { connected: boolean; onMessage: (fn: Listener) => () => void }
const Ctx = createContext<RT>({ connected: false, onMessage: () => () => {} });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let ping: number | undefined;

    const connect = () => {
      const token = tokenStore.get();
      if (!token) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        ping = window.setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000);
      };
      ws.onmessage = (ev) => {
        let data: any;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (data.type === "notification") {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          if (data.notification.kind !== "message") {
            toast(data.notification.title, {
              description: data.notification.body ?? undefined,
              action: data.notification.link ? { label: "Open", onClick: () => navigate(data.notification.link) } : undefined,
            });
          }
        } else if (data.type === "message") {
          listeners.current.forEach((fn) => fn(data.message));
          qc.invalidateQueries({ queryKey: ["conversations"] });
        } else if (data.type === "read") {
          qc.invalidateQueries({ queryKey: ["conversation", data.conversation_id] });
        } else if (data.type === "issue_updated") {
          qc.invalidateQueries({ queryKey: ["issue", data.tracking_id] });
          qc.invalidateQueries({ queryKey: ["timeline", data.tracking_id] });
          qc.invalidateQueries({ queryKey: ["admin-issue", data.tracking_id] });
          qc.invalidateQueries({ queryKey: ["task", data.issue_id] });
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["my-issues"] });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        window.clearInterval(ping);
        if (!stopped) setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => { stopped = true; window.clearInterval(ping); ws?.close(); };
  }, [user, qc, navigate]);

  const onMessage = (fn: Listener) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; };
  return <Ctx.Provider value={{ connected, onMessage }}>{children}</Ctx.Provider>;
}

export const useRealtime = () => useContext(Ctx);
