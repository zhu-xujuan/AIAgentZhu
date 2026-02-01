"""
LLM integration module.
Provides async client and prompt templates for agent enhancement.
Supports multiple providers: Ollama, OpenAI, Anthropic, Azure.
"""

from .ai_client import AIClient, OllamaClient, EmbeddingResult, GenerateResult, HealthStatus
from .config import LLMConfig, get_llm_config

__all__ = [
    "AIClient",
    "OllamaClient",  # Alias for backwards compatibility
    "EmbeddingResult",
    "GenerateResult",
    "HealthStatus",
    "LLMConfig",
    "get_llm_config",
]
