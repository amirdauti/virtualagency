import type { Agent } from "./agent";

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface Workspace {
  id: string;
  name: string;
  agents: Agent[];
  camera: CameraState;
  createdAt: string;
  updatedAt: string;
}
