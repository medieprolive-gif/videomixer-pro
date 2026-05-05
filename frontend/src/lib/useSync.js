import { useEffect, useRef, useState, useCallback } from "react";
import { wsUrl, getToken } from "./api";

/**
 * useSync - WebSocket connection to playback state.
 * @param {boolean} canControl - if true, send authenticated commands
 */
export function useSync() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "state") setState(msg.state);
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
  }, []);

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

  return { state, connected, send };
}
