"""Fixed-question checks on still frames ("Is the gate open?"), with swappable checkers.

``HaikuChecker`` works today. ``JevChecker`` is a placeholder for TypeSafe's Jev,
whose image input is experimental (header ``TypeSafe-Danger-Zone-Images: true``).
It switches on when JEV_API_KEY is set, so the side-by-side test needs no code change
beyond filling in the request shape from TypeSafe's docs.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from camai.llm import HAIKU, Claude, Image


@dataclass
class CheckResult:
    checker: str
    answer: str  # one of the options, or "cant_tell"
    confidence: float  # 0..1; Haiku's is self-reported and uncalibrated
    latency_ms: int
    est_cost_usd: float
    raw: dict[str, Any] = field(default_factory=dict)


class Checker(Protocol):
    name: str

    def check(self, question: str, options: list[str], images: list[Image]) -> CheckResult: ...


CONF = {"low": 0.55, "medium": 0.75, "high": 0.9}


class HaikuChecker:
    name = "haiku-5.5"

    def __init__(self, claude: Claude):
        self.claude = claude

    def check(self, question, options, images):
        schema = {
            "type": "object",
            "properties": {
                "answer": {"type": "string", "enum": [*options, "cant_tell"]},
                "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                "why": {"type": "string"},
            },
            "required": ["answer", "confidence", "why"],
            "additionalProperties": False,
        }
        t0 = time.monotonic()
        res = self.claude.complete_json(
            model=HAIKU,
            system="You answer one question about a security camera image. Answer cant_tell when the image does not show it clearly. Keep 'why' under 15 words.",
            images=images,
            text=question,
            schema=schema,
            effort="low",
            max_tokens=1000,
        )
        return CheckResult(
            self.name,
            res.data["answer"],
            CONF[res.data["confidence"]],
            res.latency_ms or int((time.monotonic() - t0) * 1000),
            res.est_api_cost_usd,
            res.data,
        )


class JevNotConfigured(RuntimeError):
    pass


class JevChecker:
    """TypeSafe Jev. Returns a choice plus a confidence score; never writes text."""

    name = "jev-1.14"

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.environ.get("JEV_API_KEY")
        self.base_url = base_url or os.environ.get("JEV_BASE_URL")
        if not self.api_key:
            raise JevNotConfigured("Set JEV_API_KEY (and JEV_BASE_URL) to include Jev in the comparison.")

    def check(self, question, options, images):  # pragma: no cover - needs a Jev key
        # Fill in from TypeSafe's API docs once access is granted. Required pieces:
        #  - header "TypeSafe-Danger-Zone-Images: true" for image input (experimental)
        #  - one choice question with `options` (+ "cant_tell"), images as PNG/JPEG, 280-1568px per side
        #  - map Jev's confidence score straight into CheckResult.confidence
        raise NotImplementedError("Jev request shape not wired yet; see docs/jev.md")


def available_checkers(claude: Claude) -> list[Checker]:
    checkers: list[Checker] = [HaikuChecker(claude)]
    try:
        checkers.append(JevChecker())
    except JevNotConfigured:
        pass
    return checkers
