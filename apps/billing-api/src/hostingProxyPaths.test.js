import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedHostingProxyPath } from "./hostingProxyPaths.js";

test("hosted DeepSeek setup and agent creation can reach their runtime endpoints", () => {
  for (const path of ["/api/providers/deepseek", "/api/providers/deepseek/test", "/api/agents", "/api/agents/example/messages"]) {
    assert.equal(isAllowedHostingProxyPath(path), true, path);
  }
});

test("adding DeepSeek does not expose other providers, internal controls, or prefix lookalikes", () => {
  for (const path of ["/api/providers", "/api/providers/other", "/api/providers/deepseek/keys", "/api/providers/deepseek-other", "/api/agent-tools/example/create-agent", "/api/agents-other", "/api/hosting/internal/rollout-update"]) {
    assert.equal(isAllowedHostingProxyPath(path), false, path);
  }
});
