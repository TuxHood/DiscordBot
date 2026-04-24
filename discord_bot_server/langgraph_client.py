import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urljoin

import aiohttp


log = logging.getLogger(__name__)


@dataclass
class LangGraphTestResult:
    ok: bool
    url: str
    reply_text: str = ""
    status: Optional[int] = None
    raw_body: str = ""
    response_json: Any = None
    error: Optional[str] = None


def _get_timeout_seconds() -> float:
    raw_timeout = os.getenv("LANGGRAPH_TIMEOUT_SECONDS", "20").strip()
    try:
        timeout_seconds = float(raw_timeout)
    except ValueError:
        timeout_seconds = 20.0

    return max(timeout_seconds, 1.0)


def get_langgraph_test_url() -> str:
    base_url = os.getenv("LANGGRAPH_BASE_URL", "http://127.0.0.1:8000").strip()
    endpoint = os.getenv("LANGGRAPH_TEST_ENDPOINT", "/invoke").strip()

    if endpoint.startswith(("http://", "https://")):
        return endpoint

    return urljoin(base_url.rstrip("/") + "/", endpoint.lstrip("/"))


def _extract_text_from_payload(value: Any) -> str:
    if value is None:
        return ""

    if isinstance(value, str):
        return value.strip()

    if isinstance(value, list):
        for item in value:
            text = _extract_text_from_payload(item)
            if text:
                return text
        return ""

    if isinstance(value, dict):
        direct = value.get("final_response")
        text = _extract_text_from_payload(direct)
        if text:
            return text

        output = value.get("output")
        text = _extract_text_from_payload(output)
        if text:
            return text

        for key in ("message", "text", "content", "response"):
            text = _extract_text_from_payload(value.get(key))
            if text:
                return text

        return ""

    return str(value).strip()


def parse_langgraph_response(raw_body: str, response_json: Any = None) -> str:
    if response_json is not None:
        text = _extract_text_from_payload(response_json)
        if text:
            return text

    stripped_body = raw_body.strip()
    if not stripped_body:
        return ""

    try:
        parsed_json = json.loads(stripped_body)
    except json.JSONDecodeError:
        return stripped_body

    text = _extract_text_from_payload(parsed_json)
    if text:
        return text

    return stripped_body


async def send_test_payload_to_langgraph(
    session: aiohttp.ClientSession,
    payload: dict,
    logger: Optional[logging.Logger] = None,
) -> LangGraphTestResult:
    active_logger = logger or log
    url = get_langgraph_test_url()
    timeout_seconds = _get_timeout_seconds()
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    headers = {"content-type": "application/json"}

    api_key = os.getenv("LANGGRAPH_API_KEY", "").strip()
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    active_logger.info("Posting LangGraph test payload to %s", url)

    try:
        async with session.post(url, json=payload, headers=headers, timeout=timeout) as response:
            raw_body = await response.text()
            response_json = None

            if raw_body.strip():
                try:
                    response_json = json.loads(raw_body)
                except json.JSONDecodeError:
                    response_json = None

            reply_text = parse_langgraph_response(raw_body, response_json)

            if response.status < 200 or response.status >= 300:
                error_text = raw_body.strip() or "<empty body>"
                if len(error_text) > 500:
                    error_text = error_text[:500] + "..."
                active_logger.error("LangGraph returned HTTP %s: %s", response.status, error_text)
                return LangGraphTestResult(
                    ok=False,
                    url=url,
                    status=response.status,
                    raw_body=raw_body,
                    response_json=response_json,
                    reply_text=reply_text,
                    error=f"HTTP {response.status}",
                )

            active_logger.info("LangGraph response received with HTTP %s", response.status)
            active_logger.info("LangGraph parsed reply: %s", reply_text or "<empty>")

            return LangGraphTestResult(
                ok=True,
                url=url,
                status=response.status,
                raw_body=raw_body,
                response_json=response_json,
                reply_text=reply_text,
            )

    except asyncio.TimeoutError:
        active_logger.exception("LangGraph request timed out after %s seconds", timeout_seconds)
        return LangGraphTestResult(ok=False, url=url, error="request timed out")
    except aiohttp.ClientError as exc:
        active_logger.exception("LangGraph request failed: %s", exc)
        return LangGraphTestResult(ok=False, url=url, error=str(exc))
    except Exception as exc:
        active_logger.exception("Unexpected LangGraph bridge failure: %s", exc)
        return LangGraphTestResult(ok=False, url=url, error=str(exc))