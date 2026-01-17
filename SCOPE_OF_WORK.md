# Virtual Agency - Scope of Work

## Project Overview
A Tauri desktop application for managing multiple Claude CLI agents in a 3D workspace environment. Users can spawn, monitor, and interact with Claude agents visualized as avatars in a Three.js canvas.

---

## Current Progress

### Completed

#### Infrastructure
- [x] pnpm monorepo workspace setup
- [x] Turborepo build configuration
- [x] Root Cargo.toml for Rust workspace
- [x] ESLint/Prettier configuration
- [x] Git ignore rules
- [x] Dev/build scripts

#### Tauri Backend (Rust)
- [x] Basic project scaffold (`src-tauri/`)
- [x] App state management (`state/app_state.rs`)
- [x] Agent manager for tracking processes (`agents/manager.rs`)
- [x] Agent process wrapper with stdin/stdout (`agents/process.rs`)
- [x] Tauri commands: `create_agent`, `kill_agent`, `send_message`, `list_agents`
- [x] Shell plugin integration
- [x] Output streaming via Tauri events (`agents/output.rs`)
- [x] Threaded stdout/stderr readers with event emission

#### React Frontend
- [x] Vite + React + TypeScript setup
- [x] Three.js canvas with React Three Fiber
- [x] Basic 3D scene with grid floor
- [x] Orbit controls for camera
- [x] Zustand store for agent state
- [x] Basic toolbar component
- [x] Agent panel (details sidebar)
- [x] Global CSS with dark theme
- [x] Tauri invoke wrappers (`lib/tauri.ts`)
- [x] Terminal panel with live output (`TerminalPanel.tsx`)
- [x] Chat panel for sending messages (`ChatPanel.tsx`)
- [x] Agent output hooks (`useAgentOutput.ts`, `useTauriEvents.ts`)

#### Shared Package
- [x] Agent type definitions
- [x] Message type definitions
- [x] Workspace type definitions
- [x] UUID generation utility

---

## Pending Work

### High Priority

#### 3D Visualization
- [x] **AgentAvatar.tsx** - 3D humanoid model component (geometric capsule + sphere)
- [ ] **AvatarLoader.tsx** - GLTF model loading system
- [x] **SelectionOutline.tsx** - Highlight effect for selected agents (ring + glow)
- [x] Agent positioning system on the grid
- [x] Click-to-select agents in 3D space
- [ ] Download/create 3D avatar models (`.glb` files)
  - `agent_idle.glb`
  - `agent_thinking.glb`
  - `agent_working.glb`

#### Agent Animations
- [x] Idle animation loop
- [x] Thinking animation (when Claude is processing)
- [x] Working animation (when executing tools)
- [x] Error animation (distressed shaking)
- [ ] Transition animations between states

#### Real-time Output Streaming
- [x] **output.rs** - Stream stdout/stderr from Claude CLI to frontend
- [x] **useAgentOutput.ts** - Subscribe to CLI output streams
- [x] **useTauriEvents.ts** - IPC event listeners for agent events
- [x] **TerminalPanel.tsx** - Live CLI output display
- [x] Tauri event emission for process output

#### Chat Interface
- [x] **ChatPanel.tsx** - Send messages to selected agent
- [ ] Message history per agent (visual history in panel)
- [x] Input field with send functionality
- [x] Display agent responses in real-time

### Medium Priority

#### Workspace Management
- [x] **WorkspacePanel.tsx** - List all agents sidebar
- [x] **workspace.rs** - Save/load workspace layouts
- [x] **workspaceStore.ts** - Canvas layout state persistence
- [ ] Export/import workspace configurations
- [x] Auto-save workspace state

#### Settings & Configuration
- [x] **settings.rs** - App configuration commands
- [x] **settingsStore.ts** - User preferences
- [x] Settings modal/panel
- [x] Claude CLI path configuration
- [ ] Theme customization (dark mode only for now)

#### UI Components
- [x] **Modal.tsx** - Reusable modal component
- [ ] **Tooltip.tsx** - Hover tooltips
- [ ] **LayoutControls.tsx** - Grid/layout toggle buttons
- [x] Agent creation dialog (name, working directory)
- [ ] Confirmation dialogs for destructive actions

### Low Priority

#### CLI Utilities
- [x] **cli.rs** - Claude CLI detection & validation
- [x] Auto-detect Claude CLI installation
- [x] CLI setup modal on app start
- [ ] Version compatibility checks

#### Polish & UX
- [x] Loading states and spinners
- [ ] Error handling UI
- [ ] Keyboard shortcuts
- [ ] Drag-and-drop agent repositioning
- [ ] Agent grouping/organization

#### CI/CD
- [ ] **ci.yml** - Lint, test, build checks
- [ ] **release.yml** - Build & publish binaries
- [ ] Automated releases for macOS/Windows/Linux

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Desktop App                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │   React Frontend    │    │      Rust Backend           │ │
│  │                     │    │                             │ │
│  │  ┌───────────────┐  │    │  ┌───────────────────────┐  │ │
│  │  │ Three.js      │  │◄──►│  │ Agent Manager         │  │ │
│  │  │ Canvas        │  │IPC │  │                       │  │ │
│  │  │ (3D Avatars)  │  │    │  │ ┌─────────────────┐   │  │ │
│  │  └───────────────┘  │    │  │ │ Claude Process 1│   │  │ │
│  │                     │    │  │ └─────────────────┘   │  │ │
│  │  ┌───────────────┐  │    │  │ ┌─────────────────┐   │  │ │
│  │  │ Panels        │  │    │  │ │ Claude Process 2│   │  │ │
│  │  │ - Agent Info  │  │    │  │ └─────────────────┘   │  │ │
│  │  │ - Terminal    │  │    │  │ ┌─────────────────┐   │  │ │
│  │  │ - Chat        │  │    │  │ │ Claude Process N│   │  │ │
│  │  └───────────────┘  │    │  │ └─────────────────┘   │  │ │
│  │                     │    │  └───────────────────────┘  │ │
│  │  ┌───────────────┐  │    │                             │ │
│  │  │ Zustand       │  │    │  ┌───────────────────────┐  │ │
│  │  │ State Stores  │  │    │  │ Workspace Persistence │  │ │
│  │  └───────────────┘  │    │  └───────────────────────┘  │ │
│  └─────────────────────┘    └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Next Steps (Recommended Order)

1. ~~**Get basic app running** - Verify Tauri dev server launches successfully~~ DONE
2. ~~**Implement output streaming** - Critical for seeing Claude responses~~ DONE
3. ~~**Add chat panel** - Enable sending messages to agents~~ DONE
4. ~~**Create 3D avatars** - Geometric representations~~ DONE
5. ~~**Wire up agent selection** - Click avatars to select, show details in panel~~ DONE
6. ~~**CLI setup modal** - Check for Claude CLI on startup~~ DONE
7. ~~**Agent creation dialog** - Let users specify name and working directory~~ DONE
8. ~~**WorkspacePanel** - List all agents in sidebar~~ DONE
9. ~~**Workspace persistence** - Save/load agent configurations~~ DONE
10. ~~**Agent animations** - Idle, thinking, working states~~ DONE
11. ~~**Settings panel** - Configure CLI path, themes~~ DONE

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri 2.x |
| Frontend | React 18, TypeScript, Vite |
| 3D Graphics | Three.js, React Three Fiber, Drei |
| State Management | Zustand |
| Backend | Rust |
| Build System | Turborepo, pnpm |
| CLI Target | Claude Code CLI |

---

*Last updated: January 2025*
