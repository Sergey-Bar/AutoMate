"""Pydantic models for the Webwright Bridge task API."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    navigate = "navigate"
    click = "click"
    fill = "fill"
    screenshot = "screenshot"
    wait = "wait"


class Action(BaseModel):
    type: ActionType
    selector: str | None = None
    value: str | None = None


class TaskRequest(BaseModel):
    url: str
    actions: list[Action] = Field(default_factory=list)


class TaskStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ActionResult(BaseModel):
    type: ActionType
    success: bool
    data: Any = None
    error: str | None = None


class TaskResponse(BaseModel):
    id: str
    status: TaskStatus
    url: str
    results: list[ActionResult] = Field(default_factory=list)
    error: str | None = None
