# AI Provider Support Matrix

The launch target uses a dynamic Kilo gateway catalog with optional Ollama support. Static provider lists and unsupported provider SDKs are not launch capabilities.

| Provider     | Status                                    | Configuration                      |
| ------------ | ----------------------------------------- | ---------------------------------- |
| Kilo gateway | Adapter implemented, not production-wired | `KILO_GATEWAY_URL`, `KILO_API_KEY` |
| Ollama       | Optional adapter, not production-wired    | `OLLAMA_BASE_URL`                  |

Kilo model discovery is loaded from `/models`; it is not a hard-coded source list. Streaming preserves usage, cancellation, tool-call fragments, and terminal finish reasons. Ollama uses `/api/tags` and NDJSON chat responses.

Provider credentials are vault references or environment bootstrap inputs. They are never returned through product APIs or written to model profiles.
