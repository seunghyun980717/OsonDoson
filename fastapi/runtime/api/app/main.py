"""Compatibility shim for older imports of ``runtime.api.app.main``."""

from app.main import app

__all__ = ["app"]
