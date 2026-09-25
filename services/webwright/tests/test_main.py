"""Tests for the Webwright Bridge API endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from webwright_bridge.main import _tasks, app
from webwright_bridge.models import ActionResult, ActionType, TaskStatus

client = TestClient(app)


def setup_function() -> None:
    """Clear task store before each test."""
    _tasks.clear()


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


def test_health_returns_200() -> None:
    response = client.get("/health")
    assert response.status_code == 200


def test_health_returns_status_ok() -> None:
    response = client.get("/health")
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# POST /tasks
# ---------------------------------------------------------------------------


def test_create_task_returns_202() -> None:
    with patch("webwright_bridge.main._run_task", new_callable=AsyncMock):
        response = client.post("/tasks", json={"url": "https://example.com", "actions": []})
    assert response.status_code == 202


def test_create_task_returns_task_id() -> None:
    with patch("webwright_bridge.main._run_task", new_callable=AsyncMock):
        response = client.post("/tasks", json={"url": "https://example.com", "actions": []})
    data = response.json()
    assert "id" in data
    assert len(data["id"]) > 0


def test_create_task_initial_status_is_pending() -> None:
    with patch("webwright_bridge.main._run_task", new_callable=AsyncMock):
        response = client.post("/tasks", json={"url": "https://example.com", "actions": []})
    assert response.json()["status"] == "pending"


def test_create_task_stores_url() -> None:
    with patch("webwright_bridge.main._run_task", new_callable=AsyncMock):
        response = client.post(
            "/tasks",
            json={"url": "https://example.com/page", "actions": []},
        )
    assert response.json()["url"] == "https://example.com/page"


def test_create_task_with_actions() -> None:
    payload = {
        "url": "https://example.com",
        "actions": [
            {"type": "click", "selector": "#btn"},
            {"type": "fill", "selector": "#input", "value": "hello"},
            {"type": "screenshot"},
        ],
    }
    with patch("webwright_bridge.main._run_task", new_callable=AsyncMock):
        response = client.post("/tasks", json=payload)
    assert response.status_code == 202


def test_create_task_invalid_body_returns_422() -> None:
    response = client.post("/tasks", json={"not_url": "oops"})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /tasks/{task_id}
# ---------------------------------------------------------------------------


def test_get_task_returns_404_for_unknown_id() -> None:
    response = client.get("/tasks/nonexistent-id")
    assert response.status_code == 404


def test_get_task_returns_task_after_creation() -> None:
    with patch("webwright_bridge.main._run_task", new_callable=AsyncMock):
        create_resp = client.post(
            "/tasks", json={"url": "https://example.com", "actions": []}
        )
    task_id = create_resp.json()["id"]

    get_resp = client.get(f"/tasks/{task_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == task_id


def test_get_task_reflects_completed_status() -> None:
    """Manually set a task to completed and verify GET returns it."""
    from webwright_bridge.models import TaskResponse

    task = TaskResponse(
        id="test-123",
        status=TaskStatus.completed,
        url="https://example.com",
        results=[ActionResult(type=ActionType.navigate, success=True)],
    )
    _tasks["test-123"] = task

    response = client.get("/tasks/test-123")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "completed"
    assert len(data["results"]) == 1


def test_get_task_reflects_failed_status() -> None:
    from webwright_bridge.models import TaskResponse

    task = TaskResponse(
        id="fail-456",
        status=TaskStatus.failed,
        url="https://example.com",
        error="browser crashed",
    )
    _tasks["fail-456"] = task

    response = client.get("/tasks/fail-456")
    data = response.json()
    assert data["status"] == "failed"
    assert data["error"] == "browser crashed"
