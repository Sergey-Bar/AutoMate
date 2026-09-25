# AI Provider Support Matrix

This document outlines the current status and configuration for AI providers across the Automate ecosystem.

## Support Matrix

| Provider | Automate Status | Dashboard Status | Environment Variables |
| :--- | :--- | :--- | :--- |
| **Ollama** | Supported (Tier 1) | Supported | `OLLAMA_HOST` (optional) |
| **OpenAI** | Supported (Tier 1) | Supported | `OPENAI_API_KEY` |
| **Anthropic** | Supported (Tier 1) | Supported | `ANTHROPIC_API_KEY` |
| **Groq** | Supported (Tier 2) | Not Available | `GROQ_API_KEY` |
| **Mistral** | Supported (Tier 2) | Not Available | `MISTRAL_API_KEY` |
| **OpenRouter** | Supported (Tier 2) | Not Available | `OPENROUTER_API_KEY` |
| **Cohere** | Supported (Tier 2) | Not Available | `COHERE_API_KEY` |
| **Google** | Planned (Tier 3) | Not Available | `GOOGLE_GENERATIVE_AI_API_KEY` |
| **Azure OpenAI** | Planned (Tier 3) | Not Available | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` |
| **Bedrock** | Planned (Tier 3) | Not Available | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |

## Legend

- **Supported**: Full native integration or confirmed compatibility.
- **Planned**: Stubs exist in the codebase but require additional dependencies or configuration.
- **Not Available**: No current implementation in this repository.
- **Tier 1**: Native SDK implementation with high priority updates.
- **Tier 2**: Integration via OpenAI-compatible endpoints or dedicated provider SDKs.
- **Tier 3**: NotConfigured stubs requiring specific package installations.

## Known Limitations

### Automate
- Tier 2 providers rely on OpenAI-compatible API structures; certain provider-specific features might not be fully exposed.
- Tier 3 providers require manual installation of corresponding @ai-sdk packages (e.g., @ai-sdk/google, @ai-sdk/azure, @ai-sdk/amazon-bedrock).

### Automate
- Currently focused on local-first (Ollama) and primary cloud providers (OpenAI, Anthropic).
- No current plans to support Tier 2 or Tier 3 providers from Automate.

## Fallback Behavior

If a configured provider fails to initialize or returns an authentication error, the systems generally follow these rules:
1. Validate presence of required environment variables.
2. Log the specific provider error to the server console.
3. Return a structured 400 or 500 error to the client depending on the failure stage.
4. No automatic cross-provider fallback is implemented to prevent unexpected billing or data leakage across environments.

## Quick-Start Setup

Add the following to your `.env` file based on your chosen provider.

### Ollama (Default)
No API key required. Ensure Ollama is running locally.
```bash
# Optional: defaults to http://localhost:11434
OLLAMA_HOST=http://localhost:11434
```

### OpenAI
```bash
OPENAI_API_KEY=sk-proj-your-key-here
```

### Anthropic
```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Groq (Automate Only)
```bash
GROQ_API_KEY=gsk_your-key-here
```
