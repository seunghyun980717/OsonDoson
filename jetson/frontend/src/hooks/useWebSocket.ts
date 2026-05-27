import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConnectedMessage, PeerConnectedMessage, PeerDisconnectedMessage } from '@/types/ws';

export type WebSocketPath = '/ws/hearing' | '/ws/signer';

export type ReadyState = 'connecting' | 'open' | 'closing' | 'closed';

type MinimalIncomingMessage = { type: string };
type MinimalOutgoingMessage = { type: string };

type UseWebSocketOptions<TIn extends MinimalIncomingMessage> = {
  path: WebSocketPath;
  onMessage?: (msg: TIn) => void;
};

type UseWebSocketResult<TOut extends MinimalOutgoingMessage> = {
  readyState: ReadyState;
  peerConnected: boolean;
  send: (msg: TOut) => void;
};

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const toReadyState = (raw: number): ReadyState => {
  switch (raw) {
    case WebSocket.CONNECTING:
      return 'connecting';
    case WebSocket.OPEN:
      return 'open';
    case WebSocket.CLOSING:
      return 'closing';
    default:
      return 'closed';
  }
};

const isLifecycleMessage = (msg: {
  type: string;
}): msg is ConnectedMessage | PeerConnectedMessage | PeerDisconnectedMessage =>
  msg.type === 'connected' || msg.type === 'peer_connected' || msg.type === 'peer_disconnected';

export const useWebSocket = <
  TIn extends MinimalIncomingMessage,
  TOut extends MinimalOutgoingMessage,
>({
  path,
  onMessage,
}: UseWebSocketOptions<TIn>): UseWebSocketResult<TOut> => {
  const [readyState, setReadyState] = useState<ReadyState>('connecting');
  const [peerConnected, setPeerConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isUnmountedRef = useRef(false);

  // 최신 onMessage를 ref로 보관 — onMessage 참조가 바뀔 때마다 재연결되지 않도록
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    isUnmountedRef.current = false;

    const connect = () => {
      const base = import.meta.env.VITE_WS_BASE;
      if (!base) {
        console.error('[useWebSocket] VITE_WS_BASE 환경변수가 설정되어 있지 않음');
        return;
      }

      const url = `${base}${path}`;
      const ws = new WebSocket(url);
      socketRef.current = ws;
      setReadyState(toReadyState(ws.readyState));

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setReadyState('open');
      };

      ws.onclose = () => {
        socketRef.current = null;
        setReadyState('closed');
        setPeerConnected(false);

        if (isUnmountedRef.current) return;

        // 지수 백오프 재연결: 1s → 2s → 4s → ... → 30s 캡
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
        reconnectAttemptRef.current = attempt + 1;
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // onclose가 뒤따라 호출되어 재연결 처리됨 — 여기서 별도 처리 불필요
      };

      ws.onmessage = (event) => {
        let parsed: TIn;
        try {
          parsed = JSON.parse(event.data) as TIn;
        } catch {
          console.error('[useWebSocket] JSON parse 실패:', event.data);
          return;
        }

        if (isLifecycleMessage(parsed)) {
          if (parsed.type === 'peer_connected') {
            setPeerConnected(true);
          } else if (parsed.type === 'peer_disconnected') {
            setPeerConnected(false);
          }
          // 'connected'는 자체 소비만 (현재 노출 필요 없음)
          // peer_connected/peer_disconnected는 application 레이어 처리도 허용하기 위해 onMessage로 함께 전달
          if (parsed.type === 'connected') return;
        }

        onMessageRef.current?.(parsed);
      };
    };

    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        // 핸들러를 먼저 떼야 close()가 onclose의 재연결 로직을 트리거하지 않음
        socketRef.current.onopen = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.onmessage = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [path]);

  const send = useCallback((msg: TOut) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[useWebSocket] WebSocket이 OPEN 상태가 아니라 송신 무시:', msg.type);
      return;
    }
    ws.send(JSON.stringify(msg));
  }, []);

  return { readyState, peerConnected, send };
};
