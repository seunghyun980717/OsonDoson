from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging

from app.websocket.handlers import handle_hearing_message, handle_signer_message
from app.websocket.manager import manager

# 이 파일 전용 라우터 객체
router = APIRouter()

# 이 모듈 이름으로 로그 찍는 객체
logger = logging.getLogger(__name__)

"""
- /hearing websocket endpoint 정의
- main.py 에서 /ws prefix 붙여서 실제 최종 주소는 /ws/hearing
- 청인 클라이언트가 들어오는 입구
"""
@router.websocket("/hearing")
async def hearing_socket(websocket: WebSocket) -> None:

    # 새 청인 클라이언트 연결 처리.
    await manager.connect("hearing", websocket)
    try:
        # 연결이 살아있는 동안 계속 메시지를 받겠다는 의미.
        while True:
            try:
                # 청인이 보낸 message 를 json 으로 읽음.
                data = await websocket.receive_json()
            except ValueError:
                # JSON 파싱 실패시 에러 메시지를 보내고 다음 메시지를 기다림.
                await manager.send_error("hearing", "invalid JSON payload")
                continue

            try:
                # 파싱된 json 을 실제 비즈니스 로직 handler 에게 넘김
                # fast api 접근하게 하기 위해 websocket.app 객체 넘겨 보냄
                await handle_hearing_message(websocket.app, data)
            except Exception:
                logger.exception("Unhandled hearing websocket error")
                await manager.send_error("hearing", "unexpected hearing websocket error")
    except WebSocketDisconnect:
        # client 가 연결 끊으면 여기로 옴.
        # manager 가 hearing 연결을 정리하고 반대편 signer 가 살아 있으면 peer_disconnected 를 보내줌
        await manager.disconnect("hearing", websocket)


"""수어 사용자 client 입구"""
@router.websocket("/signer")
async def signer_socket(websocket: WebSocket) -> None:
    await manager.connect("signer", websocket)
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                await manager.send_error("signer", "invalid JSON payload")
                continue

            try:
                await handle_signer_message(websocket.app, data)
            except Exception:
                logger.exception("Unhandled signer websocket error")
                await manager.send_error("signer", "unexpected signer websocket error")
    except WebSocketDisconnect:
        await manager.disconnect("signer", websocket)
