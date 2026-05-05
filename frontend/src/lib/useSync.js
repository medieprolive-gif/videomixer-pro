import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { wsUrl, getToken } from "./api";

/**
 * useSync(room) - WebSocket connection to playback state for a given room.
 */
export function useSync(room = "default") {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const lastErrorAt = useRef(0);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(wsUrl(room));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "state") {
            setState(msg.state);
          } else if (msg.type === "error") {
            // Throttle to avoid spam if many actions fail in a row
            const now = Date.now();
            if (now - lastErrorAt.current > 1500) {
              lastErrorAt.current = now;
              if (msg.error === "unauthorized") {
                toast.error("Ikke autorisert — logg inn på nytt");
              } else {
                toast.error(`Feil: ${msg.error || "ukjent"}`);
              }
            }
          }
        } catch (_) {
          /* noop */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch (_) {
          /* noop */
        }
      };
    } catch (_) {
      /* noop */
    }
  }, [room]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (_) {
          /* noop */
        }
      }
    };
  }, [connect]);

  const send = useCallback((payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const token = getToken();
    ws.send(JSON.stringify({ ...payload, token }));
  }, []);

  // Public, unauthenticated send (used by display to report video ended)
  const sendPublic = useCallback((payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  return { state, connected, send, sendPublic };
}
