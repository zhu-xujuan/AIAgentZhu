"""
AI client for LLM inference.
Supports multiple providers: Ollama, OpenAI, Anthropic, Azure.
Provides async HTTP client with health checks, text generation, and retry logic.
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from src.llm.config import AIProvider

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingResult:
    """Result from embedding generation."""
    embedding: list[float]
    model: str
    success: bool
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "embedding": self.embedding,
            "model": self.model,
            "success": self.success,
            "error": self.error,
        }


@dataclass
class GenerateResult:
    """Result from text generation."""
    text: str
    model: str
    total_duration_ms: float
    prompt_eval_count: int
    eval_count: int
    success: bool
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "model": self.model,
            "total_duration_ms": self.total_duration_ms,
            "prompt_eval_count": self.prompt_eval_count,
            "eval_count": self.eval_count,
            "success": self.success,
            "error": self.error,
        }


@dataclass
class HealthStatus:
    """Health check result."""
    available: bool
    models: list[str]
    provider: str = "ollama"
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "models": self.models,
            "provider": self.provider,
            "error": self.error,
        }


class AIClient:
    """
    Async HTTP client for AI APIs.
    Supports Ollama, OpenAI, Anthropic, and Azure OpenAI.

    Features:
    - Health check
    - Text generation
    - Embedding generation
    - JSON format support
    - Timeout and retry handling
    """

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "qwen2.5:7b",
        embedding_model: str = "nomic-embed-text",
        timeout: float = 60.0,
        max_retries: int = 2,
        provider: AIProvider = AIProvider.OLLAMA,
        api_key: Optional[str] = None,
        max_concurrent_embeddings: int = 4,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.embedding_model = embedding_model
        self.timeout = timeout
        self.max_retries = max_retries
        self.provider = provider
        self.api_key = api_key
        self.max_concurrent_embeddings = max_concurrent_embeddings
        self._client: Optional[httpx.AsyncClient] = None

    def _get_headers(self) -> dict[str, str]:
        """Get headers for API requests."""
        headers = {"Content-Type": "application/json"}

        if self.api_key:
            if self.provider == AIProvider.ANTHROPIC:
                headers["x-api-key"] = self.api_key
                headers["anthropic-version"] = "2023-06-01"
            else:
                headers["Authorization"] = f"Bearer {self.api_key}"

        return headers

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the async HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout, connect=10.0),
                headers=self._get_headers(),
            )
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def health_check(self) -> HealthStatus:
        """
        Check AI service availability.

        Returns:
            HealthStatus with availability and model list.
        """
        try:
            client = await self._get_client()

            if self.provider == AIProvider.OLLAMA:
                response = await client.get("/api/tags")
                response.raise_for_status()
                data = response.json()
                models = [m.get("name", "") for m in data.get("models", [])]

            elif self.provider in (AIProvider.OPENAI, AIProvider.AZURE):
                response = await client.get("/models")
                response.raise_for_status()
                data = response.json()
                models = [m.get("id", "") for m in data.get("data", [])]

            elif self.provider == AIProvider.ANTHROPIC:
                # Anthropic doesn't have a models endpoint, just return known models
                models = ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]

            else:
                models = []

            return HealthStatus(
                available=True,
                models=models,
                provider=self.provider.value,
                error=None,
            )

        except httpx.ConnectError as e:
            logger.warning(f"AI service connection failed: {e}")
            return HealthStatus(
                available=False,
                models=[],
                provider=self.provider.value,
                error=f"Connection failed: {e}",
            )
        except httpx.TimeoutException as e:
            logger.warning(f"AI service health check timeout: {e}")
            return HealthStatus(
                available=False,
                models=[],
                provider=self.provider.value,
                error=f"Timeout: {e}",
            )
        except Exception as e:
            logger.error(f"AI service health check error: {e}")
            return HealthStatus(
                available=False,
                models=[],
                provider=self.provider.value,
                error=str(e),
            )

    async def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        format_json: bool = False,
        temperature: float = 0.1,
        system: Optional[str] = None,
    ) -> GenerateResult:
        """
        Generate text using the configured AI provider.

        Args:
            prompt: The input prompt.
            model: Model to use (defaults to instance model).
            format_json: If True, request JSON format output.
            temperature: Sampling temperature (0.0-1.0).
            system: Optional system prompt.

        Returns:
            GenerateResult with generated text and metadata.
        """
        model = model or self.model
        last_error: Optional[str] = None

        for attempt in range(self.max_retries + 1):
            try:
                client = await self._get_client()

                if self.provider == AIProvider.OLLAMA:
                    result = await self._generate_ollama(
                        client, prompt, model, format_json, temperature, system
                    )
                elif self.provider in (AIProvider.OPENAI, AIProvider.AZURE):
                    result = await self._generate_openai(
                        client, prompt, model, format_json, temperature, system
                    )
                elif self.provider == AIProvider.ANTHROPIC:
                    result = await self._generate_anthropic(
                        client, prompt, model, format_json, temperature, system
                    )
                else:
                    raise ValueError(f"Unsupported provider: {self.provider}")

                return result

            except httpx.ConnectError as e:
                last_error = f"Connection failed: {e}"
                logger.warning(f"AI generate attempt {attempt + 1} failed: {last_error}")

            except httpx.TimeoutException as e:
                last_error = f"Timeout after {self.timeout}s"
                logger.warning(f"AI generate attempt {attempt + 1} timeout: {e}")

            except httpx.HTTPStatusError as e:
                last_error = f"HTTP error {e.response.status_code}: {e.response.text}"
                logger.error(f"AI generate HTTP error: {last_error}")
                break  # Don't retry on HTTP errors

            except Exception as e:
                last_error = str(e)
                logger.error(f"AI generate error: {e}")
                break

        # All retries failed
        return GenerateResult(
            text="",
            model=model,
            total_duration_ms=0,
            prompt_eval_count=0,
            eval_count=0,
            success=False,
            error=last_error,
        )

    async def _generate_ollama(
        self,
        client: httpx.AsyncClient,
        prompt: str,
        model: str,
        format_json: bool,
        temperature: float,
        system: Optional[str],
    ) -> GenerateResult:
        """Generate using Ollama API."""
        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": temperature},
        }

        if format_json:
            payload["format"] = "json"
        if system:
            payload["system"] = system

        response = await client.post("/api/generate", json=payload)
        response.raise_for_status()
        data = response.json()

        total_duration_ns = data.get("total_duration", 0)
        total_duration_ms = total_duration_ns / 1_000_000

        return GenerateResult(
            text=data.get("response", ""),
            model=data.get("model", model),
            total_duration_ms=round(total_duration_ms, 2),
            prompt_eval_count=data.get("prompt_eval_count", 0),
            eval_count=data.get("eval_count", 0),
            success=True,
            error=None,
        )

    async def _generate_openai(
        self,
        client: httpx.AsyncClient,
        prompt: str,
        model: str,
        format_json: bool,
        temperature: float,
        system: Optional[str],
    ) -> GenerateResult:
        """Generate using OpenAI-compatible API."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }

        if format_json:
            payload["response_format"] = {"type": "json_object"}

        response = await client.post("/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()

        choice = data.get("choices", [{}])[0]
        message = choice.get("message", {})
        usage = data.get("usage", {})

        return GenerateResult(
            text=message.get("content", ""),
            model=data.get("model", model),
            total_duration_ms=0,
            prompt_eval_count=usage.get("prompt_tokens", 0),
            eval_count=usage.get("completion_tokens", 0),
            success=True,
            error=None,
        )

    async def _generate_anthropic(
        self,
        client: httpx.AsyncClient,
        prompt: str,
        model: str,
        format_json: bool,
        temperature: float,
        system: Optional[str],
    ) -> GenerateResult:
        """Generate using Anthropic API."""
        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
        }

        if system:
            payload["system"] = system

        response = await client.post("/v1/messages", json=payload)
        response.raise_for_status()
        data = response.json()

        content = data.get("content", [{}])
        text = content[0].get("text", "") if content else ""
        usage = data.get("usage", {})

        return GenerateResult(
            text=text,
            model=data.get("model", model),
            total_duration_ms=0,
            prompt_eval_count=usage.get("input_tokens", 0),
            eval_count=usage.get("output_tokens", 0),
            success=True,
            error=None,
        )

    async def generate_json(
        self,
        prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.1,
        system: Optional[str] = None,
    ) -> tuple[Optional[dict], Optional[str]]:
        """
        Generate and parse JSON output.

        Args:
            prompt: The input prompt.
            model: Model to use.
            temperature: Sampling temperature.
            system: Optional system prompt.

        Returns:
            Tuple of (parsed_json, error_message).
        """
        result = await self.generate(
            prompt=prompt,
            model=model,
            format_json=True,
            temperature=temperature,
            system=system,
        )

        if not result.success:
            return None, result.error

        try:
            parsed = json.loads(result.text)
            return parsed, None
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse LLM JSON response: {e}")
            logger.debug(f"Raw response: {result.text[:500]}")
            return None, f"JSON parse error: {e}"

    async def embed(
        self,
        text: str,
        model: Optional[str] = None,
    ) -> EmbeddingResult:
        """
        Generate embedding vector for text.

        Args:
            text: The text to embed.
            model: Embedding model to use.

        Returns:
            EmbeddingResult with embedding vector.
        """
        model = model or self.embedding_model

        try:
            client = await self._get_client()

            if self.provider == AIProvider.OLLAMA:
                return await self._embed_ollama(client, text, model)
            elif self.provider in (AIProvider.OPENAI, AIProvider.AZURE):
                return await self._embed_openai(client, text, model)
            else:
                # Fallback to OpenAI-compatible API
                return await self._embed_openai(client, text, model)

        except httpx.ConnectError as e:
            logger.warning(f"Embedding connection failed: {e}")
            return EmbeddingResult(
                embedding=[],
                model=model,
                success=False,
                error=f"Connection failed: {e}",
            )
        except httpx.TimeoutException as e:
            logger.warning(f"Embedding timeout: {e}")
            return EmbeddingResult(
                embedding=[],
                model=model,
                success=False,
                error=f"Timeout: {e}",
            )
        except Exception as e:
            logger.error(f"Embedding error: {e}")
            return EmbeddingResult(
                embedding=[],
                model=model,
                success=False,
                error=str(e),
            )

    async def _embed_ollama(
        self,
        client: httpx.AsyncClient,
        text: str,
        model: str,
    ) -> EmbeddingResult:
        """Generate embedding using Ollama API."""
        payload = {"model": model, "prompt": text}
        response = await client.post("/api/embeddings", json=payload)
        response.raise_for_status()
        data = response.json()

        return EmbeddingResult(
            embedding=data.get("embedding", []),
            model=model,
            success=True,
            error=None,
        )

    async def _embed_openai(
        self,
        client: httpx.AsyncClient,
        text: str,
        model: str,
    ) -> EmbeddingResult:
        """Generate embedding using OpenAI-compatible API."""
        payload = {"model": model, "input": text}
        response = await client.post("/embeddings", json=payload)
        response.raise_for_status()
        data = response.json()

        embedding_data = data.get("data", [{}])
        embedding = embedding_data[0].get("embedding", []) if embedding_data else []

        return EmbeddingResult(
            embedding=embedding,
            model=model,
            success=True,
            error=None,
        )

    async def embed_batch(
        self,
        texts: list[str],
        model: Optional[str] = None,
    ) -> list[EmbeddingResult]:
        """
        Generate embeddings for multiple texts in parallel.

        Uses asyncio.gather() with semaphore to control concurrency.
        Individual failures don't block the entire batch.

        Args:
            texts: List of texts to embed.
            model: Embedding model to use.

        Returns:
            List of EmbeddingResult objects in the same order as input texts.
        """
        if not texts:
            return []

        semaphore = asyncio.Semaphore(self.max_concurrent_embeddings)
        model = model or self.embedding_model

        async def embed_with_limit(index: int, text: str) -> tuple[int, EmbeddingResult]:
            async with semaphore:
                result = await self.embed(text, model)
                return (index, result)

        tasks = [embed_with_limit(i, t) for i, t in enumerate(texts)]
        completed = await asyncio.gather(*tasks, return_exceptions=True)

        # Reconstruct results in original order
        results: list[EmbeddingResult] = [None] * len(texts)  # type: ignore
        for item in completed:
            if isinstance(item, Exception):
                logger.error(f"Embedding batch task failed: {item}")
                continue
            index, result = item
            results[index] = result

        # Fill any missing results with error responses
        for i, result in enumerate(results):
            if result is None:
                results[i] = EmbeddingResult(
                    embedding=[],
                    model=model,
                    success=False,
                    error="Task failed or was not completed",
                )

        return results

    def __repr__(self) -> str:
        return f"AIClient(provider={self.provider.value!r}, base_url={self.base_url!r}, model={self.model!r})"


# Alias for backwards compatibility
OllamaClient = AIClient
