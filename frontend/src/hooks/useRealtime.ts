import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface RealtimeEvent {
  type: 'metrics' | 'market-data' | 'positions' | 'trades' | 'signals' | 'alerts' | 'settings_update' | 'connected';
  data: any;
  timestamp: string;
}

export function useRealtime(enabled: boolean = true) {
  const { token } = useAuth();
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    if (!enabled || !token) {
      return;
    }

    const connect = () => {
      // Close existing connection if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      try {
        // Create EventSource with authentication token
        const url = `/api/realtime/events?token=${encodeURIComponent(token)}`;
        const eventSource = new EventSource(url);

        eventSource.onopen = () => {
          setConnected(true);
          setError(null);
          reconnectAttempts.current = 0;
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setEvents((prev) => [...prev.slice(-99), data]); // Keep last 100 events
          } catch (err) {
            console.error('Failed to parse SSE event:', err);
          }
        };

                eventSource.onerror = (_err) => {
          setConnected(false);
          eventSource.close();

          // Attempt to reconnect with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
            setError(`Connection lost. Reconnecting in ${delay / 1000}s...`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, delay);
          } else {
            setError('Failed to connect. Please refresh the page.');
          }
        };

        eventSourceRef.current = eventSource;
      } catch (err: any) {
        setError(err.message || 'Failed to establish connection');
        setConnected(false);
      }
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, token]);

  // Helper function to get latest event of a specific type
  const getLatestEvent = (type: RealtimeEvent['type']) => {
    return events.filter((e) => e.type === type).slice(-1)[0];
  };

  return {
    events,
    connected,
    error,
    getLatestEvent,
  };
}

