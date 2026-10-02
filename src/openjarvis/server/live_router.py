"""Jarvis Live — low-latency full-duplex voice sessions backed by GPT-Live."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jarvis/live", tags=["jarvis-live"])


class LiveSessionRequest(BaseModel):
    sdp: str


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

    # Bring the automatic local fact memory into the Live backend too. This is
    # deliberately best-effort: voice must still start if memory is unavailable.
    try:
        memory_service = getattr(request.app.state, "memory_service", None)
        if memory_service is not None:
            facts = memory_service.list_facts()
            lines: list[str] = []
            for fact in facts[:40]:
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

    # Keep the prompt bounded; persistent/retrieval memory can be added through
    # delegated tools later without bloating every Live session.
    return "\n\n".join(parts)[:12000]


def _live_instructions() -> str:
    return (
        "Você é Jarvis, um assistente pessoal de voz em português do Brasil. "
        "Converse de forma natural, rápida, calma e elegante. Seja conciso em voz; "
        "não leia markdown, listas artificiais ou símbolos. Use 'senhor' apenas "
        "ocasionalmente. Aceite interrupções sem reclamar. Quando a pergunta "
        "exigir fatos atuais, pesquisa, análise mais profunda, memória de negócios "
        "ou uso de ferramentas, delegue ao backend em vez de inventar. "
        "Nunca afirme que executou uma ação sem confirmação do backend."
    )


def _backend_instructions(context: str) -> str:
    base = (
        "Você é o cérebro analítico do Jarvis. Responda em português do Brasil. "
        "Use web_search para fatos atuais. Seja preciso e não invente dados. "
        "Para respostas destinadas à fala, seja direto e natural. "
        "Use o contexto privado abaixo quando for relevante aos projetos do usuário; "
        "não o mencione gratuitamente e não suponha informações ausentes."
    )
    if not context:
        return base
    return f"{base}\n\n# Contexto privado local do usuário\n\n{context}"


@router.get("/status")
async def live_status() -> dict[str, Any]:
    from openjarvis.server.cloud_router import _load_keys

    available = bool(_load_keys().get("OPENAI_API_KEY"))
    return {
        "available": available,
        "voice_model": "gpt-live-1",
        "backend_model": "gpt-5.6-terra",
    }


@router.post("/session")
async def create_live_session(body: LiveSessionRequest, request: Request):
    if not body.sdp.strip():
        raise HTTPException(status_code=400, detail="An SDP offer is required")

    # Browser/Tauri origins already pass through the app CORS policy. Keep this
    # endpoint local-oriented and never expose the project API key to the client.
    from openjarvis.server.cloud_router import _load_keys

    api_key = _load_keys().get("OPENAI_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not configured. Add it in Settings > API Keys.",
        )

    context = _persona_context(request)
    payload = {
        "session": {
            "model": "gpt-live-1",
            "instructions": _live_instructions(),
            "delegation": {
                "type": "responses",
                "responses": {
                    "model": "gpt-5.6-terra",
                    "instructions": _backend_instructions(context),
                    "tools": [{"type": "web_search"}],
                    "tool_choice": "auto",
                },
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
