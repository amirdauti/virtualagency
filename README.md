# Virtual Agency

A Tauri desktop application for managing multiple Claude CLI agents in an interactive 3D workspace. Visualize, monitor, and interact with AI agents represented as customizable 3D avatars in a virtual office environment.

## Features

- **3D Virtual Office** - Immersive workspace with desks, lounge areas, and a Miami skyline backdrop rendered with Three.js
- **Multi-Agent Management** - Spawn, monitor, and interact with multiple Claude CLI agents simultaneously
- **Procedural Avatars** - Unique gacha/chibi-style 3D avatars generated deterministically from agent names with 16+ hair colors and 8+ outfit configurations
- **Real-Time Output** - Live streaming of agent terminal output and chat messages
- **Interactive Chat** - Send messages to agents with clipboard image support
- **Agent Animations** - Dynamic animations for idle, thinking, working, error, and walking states
- **Pathfinding Movement** - Intelligent avatar navigation around office obstacles
- **Workspace Persistence** - Save and restore your workspace layout
- **Web Server** - Optional Axum-based server for browser access via WebSocket

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri 2.x |
| Frontend | React 18, TypeScript, Vite |
| 3D Graphics | Three.js, React Three Fiber, Drei |
| State Management | Zustand |
| Backend (Desktop) | Rust |
| Backend (Server) | Axum, Tokio |
| Build System | Turborepo, pnpm |

## Project Structure

```
virtual-agency/
├── apps/
│   ├── desktop/           # Main Tauri desktop application
│   │   ├── src/           # React + TypeScript frontend
│   │   └── src-tauri/     # Rust backend
│   └── server/            # Web server for browser access
├── packages/
│   └── shared/            # Shared TypeScript types & utilities
├── Cargo.toml             # Rust workspace configuration
├── package.json           # pnpm workspace root
├── pnpm-workspace.yaml    # Monorepo workspace config
└── turbo.json             # Turborepo build orchestration
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v9.15.0 or higher)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Claude CLI](https://github.com/anthropics/claude-code) installed and configured

## Getting Started

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/virtual-agency.git
   cd virtual-agency
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build shared packages:
   ```bash
   pnpm build
   ```

### Development

Run the desktop application in development mode:

```bash
pnpm dev
```

Or run with Tauri development tools:

```bash
pnpm tauri dev
```

### Production Build

Build the desktop application for production:

```bash
pnpm tauri build
```

## Usage

1. **Launch the application** - Start Virtual Agency and configure the Claude CLI path in settings if not auto-detected
2. **Create an agent** - Click the "+" button to spawn a new agent with a name and working directory
3. **Interact** - Select an agent by clicking its avatar to view terminal output and send messages
4. **Monitor** - Watch agents work in real-time with visual status indicators (thinking, working, idle, error)

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development servers |
| `pnpm build` | Build all packages |
| `pnpm lint` | Run linting across all packages |
| `pnpm clean` | Clean build artifacts |
| `pnpm tauri dev` | Launch Tauri development environment |
| `pnpm tauri build` | Build production desktop binary |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgements

- [Tauri](https://tauri.app/) - Desktop application framework
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) - React renderer for Three.js
- [Claude](https://www.anthropic.com/claude) - AI assistant by Anthropic
