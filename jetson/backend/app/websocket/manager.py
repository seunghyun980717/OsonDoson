from fastapi import WebSocket
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self.hearing: WebSocket | None = None
        self.signer: WebSocket | None = None

    async def connect(self, role: str, websocket: WebSocket) -> None:

        logger.info(
            "WebSocket connect requested: role=%s client=%s",
            role,
            websocket.client,
        )

        await websocket.accept()

        logger.info(
            "WebSocket connected: role=%s client=%s",
            role,
            websocket.client,
        )

        previous = self._get(role)
        if previous is not None:
            await self._safe_send(
                previous,
                {
                    "type": "error",
                    "message": f"{role} connection replaced by a new client",
                },
            )
            await self._safe_close(previous)

        self._set(role, websocket)

        # 연결 시 connected message 전송
        await websocket.send_json({"type": "connected", "role": role})

        peer_role = self._peer_role(role)
        peer = self._get(peer_role)
        if peer is not None:
            await websocket.send_json({"type": "peer_connected", "role": peer_role})
            await self._safe_send(peer, {"type": "peer_connected", "role": role})

    async def disconnect(self, role: str, websocket: WebSocket) -> None:
        if self._get(role) is websocket:
            self._set(role, None)
            peer_role = self._peer_role(role)
            peer = self._get(peer_role)
            if peer is not None:
                await self._safe_send(peer, {"type": "peer_disconnected", "role": role})

    async def send_to_peer(self, sender_role: str, message: dict) -> bool:
        peer_role = self._peer_role(sender_role)
        peer = self._get(peer_role)
        sender = self._get(sender_role)

        if peer is None:
            if sender is not None:
                await self._safe_send(
                    sender,
                    {
                        "type": "peer_unavailable",
                        "target": peer_role,
                        "message": f"{peer_role} client is not connected",
                    },
                )
            return False

        await self._safe_send(peer, message)
        return True

    async def send_processing(self, role: str, pipeline: str) -> None:
        websocket = self._get(role)
        if websocket is not None:
            await self._safe_send(
                websocket,
                {"type": "processing", "pipeline": pipeline},
            )

    async def send_error(self, role: str, message: str | dict) -> None:
        websocket = self._get(role)
        if websocket is not None:
            payload = {"type": "error", "message": message} if isinstance(message, str) else {"type": "error", **message}
            await self._safe_send(
                websocket,
                payload,
            )

    def _get(self, role: str) -> WebSocket | None:
        if role == "hearing":
            return self.hearing
        if role == "signer":
            return self.signer
        raise ValueError(f"unknown role: {role}")

    def _set(self, role: str, websocket: WebSocket | None) -> None:
        if role == "hearing":
            self.hearing = websocket
            return
        if role == "signer":
            self.signer = websocket
            return
        raise ValueError(f"unknown role: {role}")

    @staticmethod
    def _peer_role(role: str) -> str:
        return "signer" if role == "hearing" else "hearing"

    @staticmethod
    async def _safe_send(websocket: WebSocket, message: dict) -> None:
        try:
            await websocket.send_json(message)
        except RuntimeError:
            pass

    @staticmethod
    async def _safe_close(websocket: WebSocket) -> None:
        try:
            await websocket.close(code=1000)
        except RuntimeError:
            pass


manager = ConnectionManager()
