# Steering a connected agent

Pair the agent in the workshop and connect its MCP server with the issued credential. Call `workshop_status` from the agent session to establish the project connection. In the desktop Agents panel, bind its inbox and send a message. The same commands in the CLI are:

```sh
irudd route artist --inbox agent
irudd send artist "Widen the shoulders" --doc doc-character
```

The host requires the paired agent to be connected when you send a message or an artwork brief. The agent reads its inbox, acknowledges the request and links its edit or proposal. A proposal takes effect when you accept it.

For a Claude session already running with the workshop MCP channel, `irudd recipients` lists its live channel instance. Bind it with `irudd route artist --claude-channel <instance>` to receive notifications on that connection.
