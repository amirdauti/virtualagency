import type { AgentRuntime } from "@virtual-agency/shared";

// A workspace using only one server should create new agents on that server.
// Mixed/empty workspaces keep the configured preference; explicit selections
// in an open dialog are never changed when background agent updates arrive.
export function initialAgentRuntime(
  preferred: AgentRuntime,
  agents: Array<{ runtime?: AgentRuntime }>,
  nativeDesktop: boolean,
): AgentRuntime {
  if (nativeDesktop) return "local";
  const runtimes = new Set(agents.map(agent => agent.runtime || "local"));
  return runtimes.size === 1 ? [...runtimes][0] : preferred;
}
