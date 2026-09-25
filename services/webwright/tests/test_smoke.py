"""Smoke tests for the Webwright Bridge sidecar."""

from fastapi.testclient import TestClient

import webwright_bridge
from webwright_bridge.main import app

client = TestClient(app)


def test_package_importable() -> None:
    """Package can be imported and has a version."""
    assert webwright_bridge.__version__ == "0.1.0"


def test_health_returns_200() -> None:
    """GET /health returns HTTP 200 with status ok."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
