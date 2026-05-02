import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";
import type { CliRunEvent } from "./lib/types";

function cliRunWsBase() {
  if (API_BASE) {
    const url = new URL(API_BASE, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.origin;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export function buildCliRunWsUrl(runId: string, token: string, afterSeq: number) {
  const params = new URLSearchParams({
    token,
    after_seq: String(afterSeq)
  });
  return `${cliRunWsBase()}/ws/cli-runs/${encodeURIComponent(runId)}?${params.toString()}`;
}

export function useCliRunStream(runId: string, token: string) {
  const [events, setEvents] = useState<CliRunEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const activeRef = useRef(true);
  const lastSeqRef = useRef(0);
  const seenSeqsRef = useRef<Set<number>>(new Set());
  const reconnectTimerRef = useRef<number | undefined>();
  const generationRef = useRef(0);

  const connect = useCallback((generation: number) => {
    if (!runId || !token || !activeRef.current || generation !== generationRef.current) return;
    const ws = new WebSocket(buildCliRunWsUrl(runId, token, lastSeqRef.current));
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as CliRunEvent;
        if (seenSeqsRef.current.has(event.seq)) return;
        seenSeqsRef.current.add(event.seq);
        lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
        if (event.type === "done" || event.type === "error" || event.type === "canceled") {
          activeRef.current = false;
          ws.close();
        }
        setEvents((prev) => [...prev, event]);
      } catch { return; }
    };

    ws.onclose = () => {
      if (!activeRef.current || generation !== generationRef.current) return;
      const delay = Math.min(1000 * 2 ** retryRef.current, 16000);
      retryRef.current++;
      reconnectTimerRef.current = window.setTimeout(() => connect(generation), delay);
    };

    ws.onerror = () => ws.close();
  }, [runId, token]);

  useEffect(() => {
    activeRef.current = true;
    retryRef.current = 0;
    lastSeqRef.current = 0;
    seenSeqsRef.current = new Set();
    generationRef.current += 1;
    setEvents([]);
    const generation = generationRef.current;
    connect(generation);
    return () => {
      activeRef.current = false;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return events;
}
