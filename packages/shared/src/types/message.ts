export type MessageType = "user" | "agent" | "system" | "error";

export interface Message {
  id: string;
  agentId: string;
  type: MessageType;
  content: string;
  timestamp: string;
}

export interface AgentOutput {
  agentId: string;
  stream: "stdout" | "stderr";
  data: string;
  timestamp: string;
}
