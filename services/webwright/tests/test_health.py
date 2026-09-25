"""Health endpoint smoke test for the Webwright Bridge sidecar."""

from fastapi.testclient import TestClient

from webwright_bridge.main import app

client = TestClient(app)


def test_health_returns_200() -> None:
    """GET /health returns HTTP 200."""
    response = client.get("/health")
    assert response.status_code == 200


def test_health_returns_status_ok() -> None:
    """GET /health returns JSON body {"status": "ok"}."""
    response = client.get("/health")
    assert response.json() == {"status": "ok"}
