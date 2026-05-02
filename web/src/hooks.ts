import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useAsyncData<T>(token: string, path: string, fallback: T, interval = 0) {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setData(await api<T>(path, token));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [path, token]);

  useEffect(() => {
    refresh();
    if (!interval) return;
    const timer = window.setInterval(refresh, interval);
    return () => window.clearInterval(timer);
  }, [refresh, interval]);

  return { data, setData, error, refresh };
}
