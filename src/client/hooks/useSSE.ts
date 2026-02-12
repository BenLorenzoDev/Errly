// ============================================================================
// Errly — SSE (Server-Sent Events) Hook
// Connects to /api/errors/stream with EventSource.
// Parses SSEEvent JSON, handles auth-expired, bulk-cleared, reconnection.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import type { SSEEvent } from '@shared/types';

interface UseSSEOptions {
  enabled: boolean;
  onEvent: (event: SSEEvent) => void;
  onAuthExpired: () => void;
  onReconnect: () => void;
}

interface UseSSEReturn {
  isConnected: boolean;
  reconnectCount: number;
  lastEvent: SSEEvent | null;
}

export function useSSE({
  enabled,
  onEvent,
  onAuthExpired,
  onReconnect,
}: UseSSEOptions): UseSSEReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectCountRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);

  // Stable callback refs to avoid re-creating EventSource on callback changes
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onAuthExpiredRef = useRef(onAuthExpired);
  onAuthExpiredRef.current = onAuthExpired;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const es = new EventSource('/api/errors/stream', {
      withCredentials: true,
    });

    es.onopen = () => {
      setIsConnected(true);
      // If this is a reconnection (not first connect), trigger re-fetch
      if (hasConnectedOnceRef.current) {
        reconnectCountRef.current += 1;
        setReconnectCount(reconnectCountRef.current);
        if (reconnectCountRef.current >= 5) {
          console.warn(
            `[Errly SSE] ${reconnectCountRef.current} reconnections — possible instability`,
          );
        }
        onReconnectRef.current();
      }
      hasConnectedOnceRef.current = true;
    };

    es.onmessage = (messageEvent: MessageEvent) => {
      try {
        const sseEvent: SSEEvent = JSON.parse(messageEvent.data);
        setLastEvent(sseEvent);

        if (sseEvent.type === 'auth-expired') {
          es.close();
          eventSourceRef.current = null;
          setIsConnected(false);
          onAuthExpiredRef.current();
          return;
        }

        onEventRef.current(sseEvent);
      } catch (err) {
        console.error('[Errly SSE] Failed to parse event:', err);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects; we handle reconnection in onopen
    };

    eventSourceRef.current = es;
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
    };
  }, [enabled, connect]);

  return { isConnected, reconnectCount, lastEvent };
}
