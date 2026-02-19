import { useEffect, useRef } from "react";
import type { Agent, AgentAutomation } from "@virtual-agency/shared";
import { sendMessage } from "../lib/api";
import { useAgentStore } from "../stores/agentStore";
import { useChatStore } from "../stores/chatStore";

const TICK_MS = 5_000;
const BUSY_RETRY_MS = 60_000;

function isAgentBusy(agent: Agent): boolean {
  return agent.status === "thinking" || agent.status === "working";
}

function toIso(timeMs: number): string {
  return new Date(timeMs).toISOString();
}

function buildAutomationMessage(automation: AgentAutomation): string {
  return [
    "[SCHEDULED_TASK]",
    `automation_id: ${automation.id}`,
    `scheduled_at: ${new Date().toISOString()}`,
    `task_description: ${automation.taskDescription}`,
    "",
    "This prompt was triggered by an automation schedule. Complete the task now and report findings clearly.",
    "",
    automation.prompt,
  ].join("\n");
}

function updateAutomation(
  agentId: string,
  automationId: string,
  updater: (automation: AgentAutomation) => AgentAutomation,
) {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return;

  const current = Array.isArray(agent.automations) ? agent.automations : [];
  const next = current.map((automation) =>
    automation.id === automationId ? updater(automation) : automation,
  );
  state.updateAgent(agentId, { automations: next });
}

export function useAgentAutomations() {
  const runningRef = useRef<Set<string>>(new Set());
  // Keep hook reactive to agent list changes.
  useAgentStore((state) => state.agents);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const agents = useAgentStore.getState().agents;

      for (const agent of agents) {
        const automations = Array.isArray(agent.automations) ? agent.automations : [];
        for (const automation of automations) {
          if (!automation.enabled) continue;

          const nextRun = new Date(automation.nextRunAt).getTime();
          if (!Number.isFinite(nextRun) || nextRun > now) continue;

          const key = `${agent.id}:${automation.id}`;
          if (runningRef.current.has(key)) continue;

          if (isAgentBusy(agent)) {
            updateAutomation(agent.id, automation.id, (current) => ({
              ...current,
              nextRunAt: toIso(now + BUSY_RETRY_MS),
            }));
            continue;
          }

          runningRef.current.add(key);
          void (async () => {
            try {
              const message = buildAutomationMessage(automation);

              useChatStore.getState().addUserMessage(
                agent.id,
                `[Automation] ${automation.taskDescription}`,
              );
              useAgentStore.getState().updateAgent(agent.id, { status: "thinking" });

              await sendMessage(agent.id, message);

              updateAutomation(agent.id, automation.id, (current) => ({
                ...current,
                lastRunAt: toIso(Date.now()),
                nextRunAt: toIso(Date.now() + current.intervalMinutes * 60_000),
              }));
            } catch (err) {
              console.error("[automation] Failed to run automation:", err);
              useAgentStore.getState().updateAgent(agent.id, { status: "error" });
              updateAutomation(agent.id, automation.id, (current) => ({
                ...current,
                nextRunAt: toIso(Date.now() + BUSY_RETRY_MS),
              }));
            } finally {
              runningRef.current.delete(key);
            }
          })();
        }
      }
    };

    const timer = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(timer);
  }, []);
}
