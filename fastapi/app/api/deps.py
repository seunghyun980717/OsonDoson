from __future__ import annotations

from fastapi import Request

from app.container import RuntimeContainer


def get_container(request: Request) -> RuntimeContainer:
    return request.app.state.container

