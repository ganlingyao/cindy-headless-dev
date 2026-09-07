# Cindy Headless Local Gateway Config

Copy `config.example.json` to one of these ignored local paths:

- `<repository>/apps/cindy-headless/config.local.json`
- `<repository>/.cindy-headless.json`
- `%APPDATA%/cindy-headless/config.json`
- `~/.config/cindy-headless/config.json`

Or set `CINDY_HEADLESS_CONFIG_FILE` to an explicit path.

The file contains the shared gateway URL and API key used by all three backends:

```json
{
  "gateway": {
    "baseUrl": "https://llm-proxy.example.com",
    "apiKey": "replace-with-your-local-key",
    "codexBasePath": "/v1"
  }
}
```

The real file is ignored by Git. Do not commit it, put the key in a profile,
or include it in a Harbor bundle. The same gateway credential is mapped to
Claude and Pi's Anthropic-compatible transports and Codex's OpenAI Responses provider.
Environment variables override file values:
`CINDY_HEADLESS_BASE_URL` and `CINDY_HEADLESS_API_KEY`.
