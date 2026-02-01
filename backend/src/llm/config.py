"""
LLM configuration management.
Loads settings from environment variables with sensible defaults.
Supports multiple AI providers: Ollama, OpenAI, Anthropic, Azure.
"""

import os
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


class AIProvider(Enum):
    """Supported AI providers."""
    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    AZURE = "azure"


@dataclass
class AgentLLMConfig:
    """Per-agent LLM configuration."""
    enabled: bool = True
    model: Optional[str] = None  # None means use default model
    temperature: float = 0.1


@dataclass
class LLMConfig:
    """
    LLM configuration loaded from environment variables.

    Environment Variables:
        AI_PROVIDER: Provider type (ollama, openai, anthropic, azure)
        AI_BASE_URL: API base URL
        AI_API_KEY: API key (required for OpenAI, Anthropic, Azure)
        AI_MODEL: Default model name
        AI_EMBEDDING_MODEL: Model for embeddings
        AI_TIMEOUT: Request timeout in seconds (default: 60)
        AI_ENABLED: Global LLM enable flag (default: true)
        AI_MAX_CONCURRENT_EMBEDDINGS: Max parallel embedding requests (default: 4)
        AI_MAX_CONCURRENT_DOCUMENTS: Max parallel document processing (default: 3)

        Legacy support (fallback if AI_* not set):
        OLLAMA_BASE_URL, OLLAMA_MODEL, etc.

        Agent-specific enable flags (all default to true):
        LLM_FACT_EXTRACTOR_ENABLED
        LLM_SQL_QUERY_ENABLED
        LLM_ANSWER_FORMATTER_ENABLED
        LLM_DOCUMENT_CLASSIFIER_ENABLED
        LLM_QUALITY_GUARDIAN_ENABLED
    """

    # Provider settings
    provider: AIProvider = AIProvider.OLLAMA
    base_url: str = "http://localhost:11434"
    api_key: Optional[str] = None
    model: str = "qwen2.5:7b"
    embedding_model: str = "nomic-embed-text"
    timeout: float = 60.0
    max_retries: int = 2

    # Parallel processing settings
    max_concurrent_embeddings: int = 4
    max_concurrent_documents: int = 3

    # Global enable flag
    enabled: bool = True

    # Agent-specific settings
    fact_extractor: AgentLLMConfig = field(default_factory=AgentLLMConfig)
    sql_query: AgentLLMConfig = field(default_factory=AgentLLMConfig)
    answer_formatter: AgentLLMConfig = field(default_factory=AgentLLMConfig)
    document_classifier: AgentLLMConfig = field(default_factory=AgentLLMConfig)
    quality_guardian: AgentLLMConfig = field(default_factory=AgentLLMConfig)

    @property
    def is_openai_compatible(self) -> bool:
        """Check if provider uses OpenAI-compatible API."""
        return self.provider in (AIProvider.OPENAI, AIProvider.AZURE)

    def is_agent_enabled(self, agent_name: str) -> bool:
        """
        Check if LLM is enabled for a specific agent.

        Args:
            agent_name: One of "fact_extractor", "sql_query", "answer_formatter",
                       "document_classifier", "quality_guardian"

        Returns:
            True if LLM is enabled globally AND for the specific agent.
        """
        if not self.enabled:
            return False

        agent_config = getattr(self, agent_name, None)
        if agent_config is None:
            return False

        return agent_config.enabled

    def get_agent_model(self, agent_name: str) -> str:
        """
        Get the model to use for a specific agent.

        Args:
            agent_name: Agent name.

        Returns:
            Model name (agent-specific or default).
        """
        agent_config = getattr(self, agent_name, None)
        if agent_config and agent_config.model:
            return agent_config.model
        return self.model

    def get_agent_temperature(self, agent_name: str) -> float:
        """
        Get the temperature to use for a specific agent.

        Args:
            agent_name: Agent name.

        Returns:
            Temperature value.
        """
        agent_config = getattr(self, agent_name, None)
        if agent_config:
            return agent_config.temperature
        return 0.1


def _parse_bool(value: str, default: bool = True) -> bool:
    """Parse boolean from environment variable string."""
    if not value:
        return default
    return value.lower() in ("true", "1", "yes", "on")


def _parse_float(value: str, default: float) -> float:
    """Parse float from environment variable string."""
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _parse_int(value: str, default: int) -> int:
    """Parse int from environment variable string."""
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _parse_provider(value: str) -> AIProvider:
    """Parse AI provider from environment variable string."""
    if not value:
        return AIProvider.OLLAMA
    try:
        return AIProvider(value.lower())
    except ValueError:
        return AIProvider.OLLAMA


def get_llm_config() -> LLMConfig:
    """
    Load LLM configuration from environment variables.
    Supports both new AI_* variables and legacy OLLAMA_* variables.

    Returns:
        LLMConfig instance with settings from environment.
    """
    # Provider (new AI_* takes precedence over legacy OLLAMA_*)
    provider = _parse_provider(os.getenv("AI_PROVIDER", ""))

    # Base URL (AI_BASE_URL > OLLAMA_BASE_URL > default)
    base_url = os.getenv("AI_BASE_URL") or os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434"

    # API Key
    api_key = os.getenv("AI_API_KEY") or None

    # Model (AI_MODEL > OLLAMA_MODEL > default)
    model = os.getenv("AI_MODEL") or os.getenv("OLLAMA_MODEL") or "qwen2.5:7b"

    # Embedding model
    embedding_model = os.getenv("AI_EMBEDDING_MODEL") or "nomic-embed-text"

    # Timeout (AI_TIMEOUT > OLLAMA_TIMEOUT > default)
    timeout = _parse_float(
        os.getenv("AI_TIMEOUT") or os.getenv("OLLAMA_TIMEOUT", ""),
        60.0
    )

    # Max retries (AI_MAX_RETRIES > OLLAMA_MAX_RETRIES > default)
    max_retries = _parse_int(
        os.getenv("AI_MAX_RETRIES") or os.getenv("OLLAMA_MAX_RETRIES", ""),
        2
    )

    # Enabled (AI_ENABLED > OLLAMA_ENABLED > default)
    enabled = _parse_bool(
        os.getenv("AI_ENABLED") or os.getenv("OLLAMA_ENABLED", ""),
        True
    )

    # Parallel processing settings
    max_concurrent_embeddings = _parse_int(
        os.getenv("AI_MAX_CONCURRENT_EMBEDDINGS", ""),
        4
    )
    max_concurrent_documents = _parse_int(
        os.getenv("AI_MAX_CONCURRENT_DOCUMENTS", ""),
        3
    )

    return LLMConfig(
        # Provider settings
        provider=provider,
        base_url=base_url,
        api_key=api_key,
        model=model,
        embedding_model=embedding_model,
        timeout=timeout,
        max_retries=max_retries,

        # Parallel processing settings
        max_concurrent_embeddings=max_concurrent_embeddings,
        max_concurrent_documents=max_concurrent_documents,

        # Global enable flag
        enabled=enabled,

        # Agent-specific settings
        fact_extractor=AgentLLMConfig(
            enabled=_parse_bool(os.getenv("LLM_FACT_EXTRACTOR_ENABLED", ""), True),
            model=os.getenv("LLM_FACT_EXTRACTOR_MODEL") or None,
            temperature=_parse_float(os.getenv("LLM_FACT_EXTRACTOR_TEMPERATURE", ""), 0.1),
        ),
        sql_query=AgentLLMConfig(
            enabled=_parse_bool(os.getenv("LLM_SQL_QUERY_ENABLED", ""), True),
            model=os.getenv("LLM_SQL_QUERY_MODEL") or None,
            temperature=_parse_float(os.getenv("LLM_SQL_QUERY_TEMPERATURE", ""), 0.1),
        ),
        answer_formatter=AgentLLMConfig(
            enabled=_parse_bool(os.getenv("LLM_ANSWER_FORMATTER_ENABLED", ""), True),
            model=os.getenv("LLM_ANSWER_FORMATTER_MODEL") or None,
            temperature=_parse_float(os.getenv("LLM_ANSWER_FORMATTER_TEMPERATURE", ""), 0.3),
        ),
        document_classifier=AgentLLMConfig(
            enabled=_parse_bool(os.getenv("LLM_DOCUMENT_CLASSIFIER_ENABLED", ""), True),
            model=os.getenv("LLM_DOCUMENT_CLASSIFIER_MODEL") or None,
            temperature=_parse_float(os.getenv("LLM_DOCUMENT_CLASSIFIER_TEMPERATURE", ""), 0.1),
        ),
        quality_guardian=AgentLLMConfig(
            enabled=_parse_bool(os.getenv("LLM_QUALITY_GUARDIAN_ENABLED", ""), True),
            model=os.getenv("LLM_QUALITY_GUARDIAN_MODEL") or None,
            temperature=_parse_float(os.getenv("LLM_QUALITY_GUARDIAN_TEMPERATURE", ""), 0.1),
        ),
    )


# Singleton instance for convenience
_config_instance: Optional[LLMConfig] = None


def get_config() -> LLMConfig:
    """Get the singleton LLM config instance."""
    global _config_instance
    if _config_instance is None:
        _config_instance = get_llm_config()
    return _config_instance


def reset_config():
    """Reset the singleton config (useful for testing)."""
    global _config_instance
    _config_instance = None
