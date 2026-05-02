import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";
import type { CliRunEvent } from "./lib/types";

export function useCliRunStream(runId: string, token: string) {
  const [events, setEvents] = useState<CliRunEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const activeRef = useRef(true);

  const connect = useCallback(() => {
    if (!runId || !token || !activeRef.current) return;
    const wsBase = API_BASE.replace(/^http/, "ws") || `ws://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/cli-runs/${runId}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as CliRunEvent;
        setEvents((prev) => [...prev, event]);
        if (event.type === "done" || event.type === "error" || event.type === "canceled") {
          ws.close();
        }
      } catch { return; }
    };

    ws.onclose = () => {
      if (!activeRef.current) return;
      const delay = Math.min(1000 * 2 ** retryRef.current, 16000);
      retryRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, [runId, token]);

  useEffect(() => {
    activeRef.current = true;
    retryRef.current = 0;
    setEvents([]);
    connect();
    return () => {
      activeRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  return events;
}
