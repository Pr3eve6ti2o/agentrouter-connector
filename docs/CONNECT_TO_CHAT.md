# Connect to ChatGPT / MCP client

## Custom connector built here

Remote endpoint after deployment:

`https://YOUR_HOST/mcp`

Authentication (private/generic MCP clients):

`Authorization: Bearer <MCP_AUTH_TOKEN>`

For public ChatGPT custom MCP connections, use OAuth 2.1 or OpenAI Secure MCP Tunnel; see the note below.

## ChatGPT

OpenAI's current custom-MCP flow is: Settings → Security and login → Developer mode → Plugins/Apps → add the HTTPS `/mcp` URL, then open a new chat and select the connection. Authenticated public MCP servers are expected to implement OAuth 2.1.

After connection, invoke in this order:

1. `agentrouter_health`
2. `agentrouter_list_models`
3. `agentrouter_chat`
4. `agentrouter_batch_chat` when independent tasks can run concurrently

## Existing AgentRouter hosted MCP

Current AgentRouter documentation also publishes a hosted MCP endpoint at:

`https://mcp.agentrouter.to`

That is AgentRouter's own remote MCP service, not this custom connector.


## Important authentication note

For a public ChatGPT custom MCP app, OpenAI's current guidance expects OAuth 2.1 for authenticated MCP servers. This repository's static bearer-token mode is intended for controlled/private deployments and generic MCP clients; for ChatGPT, prefer an OpenAI Secure MCP Tunnel or add a standards-compliant OAuth 2.1 authorization server in front of the MCP endpoint.
