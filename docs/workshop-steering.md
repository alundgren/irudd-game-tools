# Steering a connected agent

A Claude Code or Codex session connects on its first workshop tool call and gets an inbox (see [Connect an agent](workshop-clients.md#connect-an-agent)). An agent paired by hand calls `workshop_status` from its session to connect, and a person binds its inbox. Then send a message from the desktop Steer panel. The same commands in the CLI are:

```sh
irudd route artist --inbox agent
irudd send artist "Widen the shoulders" --doc doc-character
```

The host requires the paired agent to be connected when you send a message or an artwork brief. The agent reads its inbox, acknowledges the request and links its edit or proposal. A proposal takes effect when you accept it.

For a Claude session already running with the workshop MCP channel, `irudd recipients` lists its live channel instance. Bind it with `irudd route artist --claude-channel <instance>` to receive notifications on that connection.
