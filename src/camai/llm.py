"""Claude access behind one small interface.

Two backends, chosen with CAMAI_CLAUDE_BACKEND:

* ``subscription`` (default): shells out to the local ``claude -p`` CLI, which uses the
  developer's claude.ai login. For local testing only; never for customers.
* ``api``: the official Anthropic SDK with ANTHROPIC_API_KEY. Use this in production.

Both return the same ``LLMResult`` so nothing downstream knows which one ran.
``est_api_cost_usd`` is always computed from list prices and the tokens our own
prompt used, so test runs on a subscription still show what production would cost.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

# List prices, USD per million tokens (input, output). Haiku 5.5's price applies to
# prompts up to 100K tokens; we stay far below that.
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}

HAIKU = "claude-haiku-5-5"
SONNET = "claude-sonnet-5-5"


@dataclass
class Image:
    """A JPEG to send to the model."""

    data: bytes
    label: str = ""

    @classmethod
    def from_path(cls, path: Path, label: str = "") -> Image:
        return cls(Path(path).read_bytes(), label)

    def block(self) -> dict[str, Any]:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64.standard_b64encode(self.data).decode("ascii"),
            },
        }


@dataclass
class LLMResult:
    data: dict[str, Any]
    model: str
    input_tokens: int
    output_tokens: int
    backend: str
    latency_ms: int = 0
    cached: bool = False
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def est_api_cost_usd(self) -> float:
        pin, pout = PRICES.get(self.model, PRICES[SONNET])
        return (self.input_tokens * pin + self.output_tokens * pout) / 1_000_000


class LLMError(RuntimeError):
    pass


class Backend(Protocol):
    name: str

    def complete_json(
        self,
        *,
        model: str,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        effort: str,
        max_tokens: int,
    ) -> LLMResult: ...


def build_content(images: list[Image], text: str) -> list[dict[str, Any]]:
    """Images in order, each preceded by its label, then the instruction text."""
    content: list[dict[str, Any]] = []
    for img in images:
        if img.label:
            content.append({"type": "text", "text": img.label})
        content.append(img.block())
    content.append({"type": "text", "text": text})
    return content


class SubscriptionBackend:
    """Calls Claude through the local Claude Code CLI (claude.ai login)."""

    name = "subscription"

    def __init__(self, cli: str = "claude", timeout_s: int = 180):
        self.cli = cli
        self.timeout_s = timeout_s

    def complete_json(self, *, model, system, content, schema, effort, max_tokens):
        msg = {"type": "user", "message": {"role": "user", "content": content}}
        cmd = [
            self.cli,
            "-p",
            "--model",
            model,
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--json-schema",
            json.dumps(schema),
            "--system-prompt",
            system,
            "--tools",
            "",
            "--setting-sources",
            "",
            "--no-session-persistence",
        ]
        try:
            proc = subprocess.run(
                cmd,
                input=json.dumps(msg) + "\n",
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
                check=False,
            )
        except FileNotFoundError as e:
            raise LLMError(
                "The `claude` CLI was not found. Install Claude Code and sign in, "
                "or set CAMAI_CLAUDE_BACKEND=api with ANTHROPIC_API_KEY."
            ) from e
        result = None
        for line in proc.stdout.splitlines():
            if '"type":"result"' in line.replace(" ", ""):
                result = json.loads(line)
        if result is None:
            raise LLMError(f"claude CLI gave no result (exit {proc.returncode}): {proc.stderr[-500:]}")
        if result.get("is_error") or result.get("structured_output") is None:
            raise LLMError(f"claude CLI error: {str(result.get('result'))[:500]}")
        usage = (result.get("modelUsage") or {}).get(model) or {}
        input_tokens = (
            usage.get("inputTokens", 0)
            + usage.get("cacheCreationInputTokens", 0)
            + usage.get("cacheReadInputTokens", 0)
        )
        return LLMResult(
            data=result["structured_output"],
            model=model,
            input_tokens=input_tokens,
            output_tokens=usage.get("outputTokens", 0),
            backend=self.name,
            latency_ms=int(result.get("duration_ms") or 0),
            raw={"session_cost_usd": result.get("total_cost_usd")},
        )


class ApiBackend:
    """Calls Claude through the Anthropic SDK (ANTHROPIC_API_KEY). Production path."""

    name = "api"

    def __init__(self, client: Any = None):
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        self.client = client

    def complete_json(self, *, model, system, content, schema, effort, max_tokens):
        kwargs: dict[str, Any] = dict(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        )
        if model == SONNET:
            # Server-side fallback if a safety classifier declines the request.
            resp = self.client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
            )
        else:
            resp = self.client.messages.create(**kwargs)
        if resp.stop_reason == "refusal":
            raise LLMError(f"Model declined the request: {getattr(resp, 'stop_details', None)}")
        if resp.stop_reason == "max_tokens":
            raise LLMError("Model hit max_tokens before finishing the JSON")
        text = next(b.text for b in resp.content if b.type == "text")
        u = resp.usage
        input_tokens = (
            (u.input_tokens or 0)
            + (getattr(u, "cache_creation_input_tokens", 0) or 0)
            + (getattr(u, "cache_read_input_tokens", 0) or 0)
        )
        return LLMResult(
            data=json.loads(text),
            model=model,
            input_tokens=input_tokens,
            output_tokens=u.output_tokens or 0,
            backend=self.name,
        )


class Claude:
    """Cached front door. Identical requests are answered from disk, so eval reruns are free."""

    def __init__(self, backend: Backend, cache_dir: Path | None):
        self.backend = backend
        self.cache_dir = cache_dir
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def complete_json(
        self,
        *,
        model: str,
        system: str,
        images: list[Image],
        text: str,
        schema: dict[str, Any],
        effort: str = "low",
        max_tokens: int = 4000,
    ) -> LLMResult:
        content = build_content(images, text)
        key = hashlib.sha256(
            json.dumps([model, system, content, schema, effort], sort_keys=True).encode()
        ).hexdigest()[:32]
        path = self.cache_dir / f"{key}.json" if self.cache_dir else None
        if path and path.exists():
            d = json.loads(path.read_text())
            return LLMResult(**{**d, "cached": True})
        res = self.backend.complete_json(
            model=model, system=system, content=content, schema=schema, effort=effort, max_tokens=max_tokens
        )
        if path:
            d = {k: v for k, v in res.__dict__.items() if k != "cached"}
            path.write_text(json.dumps(d))
        return res


def default_claude(cache_dir: Path | None) -> Claude:
    which = os.environ.get("CAMAI_CLAUDE_BACKEND", "subscription").lower()
    if which == "api":
        backend: Backend = ApiBackend()
    elif which == "subscription":
        backend = SubscriptionBackend(cli=os.environ.get("CAMAI_CLAUDE_CLI", "claude"))
    else:
        raise LLMError(f"Unknown CAMAI_CLAUDE_BACKEND={which!r} (use 'subscription' or 'api')")
    return Claude(backend, cache_dir)
