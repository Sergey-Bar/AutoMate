"""FastAPI application entry point for the Webwright Bridge sidecar."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from webwright_bridge.browser import BrowserManager
from webwright_bridge.models import TaskRequest, TaskResponse, TaskStatus

app = FastAPI(title="Webwright Bridge", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory task store: task_id -> TaskResponse
_tasks: dict[str, TaskResponse] = {}


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


@app.post("/tasks", status_code=202)
async def create_task(body: TaskRequest) -> TaskResponse:
    """Accept a browser automation task and execute it asynchronously."""
    task_id = str(uuid.uuid4())
    task = TaskResponse(id=task_id, status=TaskStatus.pending, url=body.url)
    _tasks[task_id] = task

    # Run in background without blocking the response
    asyncio.create_task(_run_task(task_id, body))

    return task


@app.get("/tasks/{task_id}")
async def get_task(task_id: str) -> TaskResponse:
    """Return the current status and results of a task."""
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


async def _run_task(task_id: str, body: TaskRequest) -> None:
    """Execute the browser task and update the in-memory store."""
    task = _tasks[task_id]
    task.status = TaskStatus.running

    try:
        manager = BrowserManager()
        results = await manager.run_task(body.url, body.actions)
        task.results = results
        task.status = TaskStatus.completed
    except Exception as exc:
        task.status = TaskStatus.failed
        task.error = str(exc)
