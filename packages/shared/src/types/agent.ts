export type AgentStatus = "idle" | "thinking" | "working" | "error";

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  position: Position;
  workingDirectory: string;
  createdAt: string;
  lastActivity?: string;
}
