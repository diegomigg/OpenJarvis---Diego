"""Jarvis Live — low-latency full-duplex voice sessions backed by GPT-Live."""

from __future__ import annotations

import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jarvis/live", tags=["jarvis-live"])

VOICE_MODEL = "gpt-live-1"
LIVE_PRICE_PER_MINUTE_USD = 0.05

_BACKEND_PROFILES: dict[str, dict[str, Any]] = {
    "economy": {
        "model": "gpt-5.6-luna",
        "reasoning": {"effort": "low"},
        "max_output_tokens": 700,
    },
    "analysis": {
        "model": "gpt-5.6-terra",
        "reasoning": {"effort": "medium"},
        "max_output_tokens": 2200,
    },
}


class LiveSessionRequest(BaseModel):
    sdp: str
    backend_mode: Literal["economy", "analysis"] = "economy"


def _persona_context(request: Request) -> str:
    """Build private user/business context from local OpenJarvis memory only."""
    parts: list[str] = []

    try:
        config = getattr(request.app.state, "config", None)
        if config is None:
            from openjarvis.core.config import load_config

            config = load_config()

        from openjarvis.prompt.builder import SystemPromptBuilder

        builder = SystemPromptBuilder(
            agent_template="",
            memory_files_config=getattr(config, "memory_files", None),
            system_prompt_config=getattr(config, "system_prompt", None),
        )
        persona = builder.persona_sections().strip()
        if persona:
            parts.append(persona)
    except Exception:
        logger.debug("Jarvis Live persona loading failed", exc_info=True)

    try:
        memory_service = getattr(request.app.state, "memory_service", None)
        if memory_service is not None:
            facts = memory_service.list_facts()
            lines: list[str] = []
            for fact in facts[:24]:
                if isinstance(fact, str):
                    value = fact
                else:
                    value = (
                        getattr(fact, "content", None)
                        or getattr(fact, "text", None)
                        or str(fact)
                    )
                value = str(value).strip()
                if value:
                    lines.append(f"- {value}")
            if lines:
                parts.append("## Local remembered facts\n\n" + "\n".join(lines))
    except Exception:
        logger.debug("Jarvis Live fact loading failed", exc_info=True)

    # Do not ship an ever-growing biography on every session. Project-specific
    # memory will be retrieved selectively in the next workspace layer.
    return "\n\n".join(parts)[:7000]


def _live_instructions() -> str:
    return (
        "Você é Jarvis, um assistente pessoal de voz em português do Brasil. "
        "Converse de forma natural, rápida, calma e elegante. Respostas faladas "
        "devem ser curtas por padrão; aprofunde somente quando o usuário pedir. "
        "Não leia markdown, símbolos ou cabeçalhos artificiais. Aceite interrupções "
        "naturalmente. Use o backend apenas quando a pergunta exigir fatos atuais, "
        "pesquisa, memória, ferramentas ou análise. Para conversa casual e comandos "
        "simples, responda diretamente sem delegar. Nunca invente dados atuais nem "
        "afirme que uma ação foi executada sem confirmação."
    )


def _backend_instructions(context: str) -> str:
    base = (
        "Você é o cérebro analítico do Jarvis. Responda em português do Brasil. "
        "Seja econômico em tokens: entregue primeiro a conclusão e use detalhes "
        "apenas quando ajudarem a decisão. Use web_search para fatos atuais. "
        "Não invente dados. Para fala, prefira linguagem natural e curta. "
        "Use o contexto privado somente quando for relevante ao pedido atual."
    )
    if not context:
        return base
    return f"{base}\n\n# Contexto privado local\n\n{context}"


def _responses_profile(mode: str, context: str) -> dict[str, Any]:
    profile = _BACKEND_PROFILES.get(mode, _BACKEND_PROFILES["economy"])
    return {
        "model": profile["model"],
        "instructions": _backend_instructions(context),
        "tools": [{"type": "web_search"}],
        "tool_choice": "auto",
        "reasoning": profile["reasoning"],
        "max_output_tokens": profile["max_output_tokens"],
    }


@router.get("/status")
async def live_status() -> dict[str, Any]:
    from openjarvis.server.cloud_router import _load_keys

    available = bool(_load_keys().get("OPENAI_API_KEY"))
    return {
        "available": available,
        "voice_model": VOICE_MODEL,
        "live_price_per_minute_usd": LIVE_PRICE_PER_MINUTE_USD,
        "default_backend_mode": "economy",
        "backend_models": {
            key: value["model"] for key, value in _BACKEND_PROFILES.items()
        },
    }


@router.post("/session")
async def create_live_session(body: LiveSessionRequest, request: Request):
    if not body.sdp.strip():
        raise HTTPException(status_code=400, detail="An SDP offer is required")

    from openjarvis.server.cloud_router import _load_keys

    api_key = _load_keys().get("OPENAI_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not configured.",
        )

    context = _persona_context(request)
    payload = {
        "session": {
            "model": VOICE_MODEL,
            "instructions": _live_instructions(),
            "delegation": {
                "type": "responses",
                "responses": _responses_profile(body.backend_mode, context),
            },
        },
        "transport": {
            "type": "webrtc",
            "sdp": body.sdp,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/live/sessions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("Jarvis Live connection failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach OpenAI Live") from exc

    if not response.is_success:
        detail = response.text[:1200]
        logger.warning("Jarvis Live session rejected (%s): %s", response.status_code, detail)
        raise HTTPException(
            status_code=response.status_code,
            detail=f"OpenAI Live session failed: {detail}",
        )

    return response.json()


__all__ = ["router"]
