# LocalLlamaModelOptions

`LocalLlamaModelOptions.js` identifies loopback OpenAI-compatible AI endpoints
and reads their advertised model IDs through llama.cpp router discovery.

`usesLocalLlamaCppEndpoint(aiConfig)` accepts configurations with a nonblank
local startup script, as well as `localhost`, IPv4 loopback, IPv6 loopback, and
`0.0.0.0` endpoints, only when the backend is `openai_compatible`.
`listAdvertisedLocalLlamaModels()` reuses
`LlamaCppRouterClient.listModels()`, forwards configured headers, applies a
short bounded request timeout, and returns unique, nonblank `data[].id` values.

The System Configuration page uses this list instead of `model_swap_options`
for local llama.cpp. A discovery failure is rendered as an unavailable-model
state with the error text; it does not substitute stale configured choices.
