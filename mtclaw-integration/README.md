# MTClaw integration

Project-owned MTClaw configuration, function schemas, wrapper scripts, and trace extensions belong here.

The official upstream source is stored separately in `../MTClaw`. The different directory name is intentional because Windows paths are case-insensitive.

## Verified development configuration

- Function Router: `http://127.0.0.1:18790`
- Routing base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Routing model: `doubao-seed-2-0-mini-260428`
- Upstream base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Upstream model endpoint: `ep-20260711144344-4zm7g`
- Tool execution: internal Function Router execution with `delegate_tools_to_openclaw=false`
- Secret source: `ARK_API_KEY` environment variable

Copy `config.example.json` to `config.local.json` for local development. The local file is ignored by Git. Never put the real API key in either file.

The smoke function and wrapper prove the complete routing path. They are not production legal capabilities and will be replaced by the legal Subagent tool set.

## Verified development configuration

- Function Router: `http://127.0.0.1:18790`
- Routing base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Routing model: `doubao-seed-2-0-mini-260428`
- Upstream base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Upstream model endpoint: `ep-20260711144344-4zm7g`
- Tool execution: internal Function Router execution with `delegate_tools_to_openclaw=false`
- Secret source: `ARK_API_KEY` environment variable

Copy `config.example.json` to `config.local.json` for local development. The local file is ignored by Git. Never put the real API key in either file.

The smoke function and wrapper prove the complete routing path. They are not production legal capabilities and will be replaced by the legal Subagent tool set.
