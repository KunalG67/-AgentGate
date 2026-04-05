import { useEffect, useRef, useState } from "react";

const useWebSocket = (url) => {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const shouldReconnect = useRef(true);
  const retryCount = useRef(0);

  useEffect(() => {
    shouldReconnect.current = true;

    const connect = () => {
      // Guard: if already connected, don't create duplicate connection
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        return;
      }

      // Clear any pending reconnect to avoid duplicates
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      ws.current = new WebSocket(url);

      ws.current.onopen = () => {
        setConnected(true);
        retryCount.current = 0;
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMessages((prev) => [...prev, data].slice(-50));
        } catch {
          // ignore malformed messages
        }
      };

      ws.current.onerror = () => {};

      ws.current.onclose = () => {
        setConnected(false);

        // Auto-reconnect so UI doesn't get stuck OFFLINE
        if (shouldReconnect.current) {
          const delay = Math.min(750 * Math.pow(2, retryCount.current), 30000);
          retryCount.current += 1;
          if (retryCount.current <= 10) reconnectTimer.current = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      // Properly close WebSocket and null handlers
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.onerror = null;
        ws.current.onmessage = null;
        try {
          ws.current.close();
        } catch {
          // ignore
        }
        ws.current = null;
      }
    };
  }, [url]);

  const manualReconnect = () => {
    retryCount.current = 0;
    shouldReconnect.current = true;
    // Close existing connection if any
    if (ws.current) {
      ws.current.onclose = null;
      try {
        ws.current.close();
      } catch {
        // ignore
      }
      ws.current = null;
    }
    // Clear any pending reconnect timer
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    // Create new connection immediately
    ws.current = new WebSocket(url);
    ws.current.onopen = () => {
      setConnected(true);
      retryCount.current = 0;
    };
    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setMessages((prev) => [...prev, data].slice(-50));
      } catch {
        // ignore malformed messages
      }
    };
    ws.current.onerror = () => {};
    ws.current.onclose = () => {
      setConnected(false);
      if (shouldReconnect.current) {
        const delay = Math.min(750 * Math.pow(2, retryCount.current), 30000);
        retryCount.current += 1;
        if (retryCount.current <= 10) reconnectTimer.current = setTimeout(manualReconnect, delay);
      }
    };
  };

  return { messages, setMessages, connected, manualReconnect };
};

export default useWebSocket;