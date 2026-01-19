# MCP Server Integration Guide

## Overview

The Virtual Agency now supports Model Context Protocol (MCP) servers, allowing agents to have enhanced capabilities like browser automation, long-term memory, web search, and database access.

## Frontend Implementation (Completed)

### Files Modified/Created:

1. **`packages/shared/src/types/mcpServers.ts`** (NEW)
   - Defines all available MCP servers
   - 10 verified servers with metadata (name, description, npm package, configuration requirements)

2. **`packages/shared/src/types/agent.ts`**
   - Added `mcpServers?: MCPServerId[]` field to Agent interface

3. **`apps/desktop/src/lib/api.ts`**
   - Updated `AgentOptions` interface to include `mcpServers?: string[]`
   - Updated `createAgent()` to pass MCP servers to backend

4. **`apps/desktop/src/components/Toolbar/CreateAgentDialog.tsx`**
   - Added MCP server selection UI
   - Users can select multiple servers when creating agents

### Available MCP Servers:

| ID | Name | Package | Category | Config Required |
|----|------|---------|----------|----------------|
| `playwright` | Playwright | `@playwright/mcp` | automation | No |
| `context7` | Context7 | `@upstash/context7-mcp` | search | No |
| `memory` | Memory (Knowledge Graph) | `@modelcontextprotocol/server-memory` | memory | No |
| `filesystem` | Filesystem | `@modelcontextprotocol/server-filesystem` | filesystem | No |
| `git` | Git | `@modelcontextprotocol/server-git` | filesystem | No |
| `fetch` | Fetch | `@modelcontextprotocol/server-fetch` | web | No |
| `sequential-thinking` | Sequential Thinking | `@modelcontextprotocol/server-sequentialthinking` | reasoning | No |
| `brave-search` | Brave Search | `@modelcontextprotocol/server-brave-search` | search | Yes (API key) |
| `sqlite` | SQLite | `@modelcontextprotocol/server-sqlite` | database | Yes (DB path) |
| `postgres` | PostgreSQL | `@modelcontextprotocol/server-postgres` | database | Yes (Connection string) |

## Backend Integration Required

### 1. API Endpoints

#### POST `/api/agents`

**Request Body (Updated):**
```json
{
  "id": "agent-abc123",
  "name": "My Agent",
  "working_dir": "/path/to/project",
  "model": "sonnet",
  "thinking_enabled": false,
  "mcp_servers": ["playwright", "memory", "git"]  // NEW FIELD
}
```

**What the Backend Should Do:**

1. **Accept the `mcp_servers` field** (array of server IDs)
2. **Validate server IDs** against the list of known servers
3. **Configure Claude Desktop** with the selected MCP servers
4. **Persist the MCP server configuration** with the agent

#### PATCH `/api/agents/:id`

Should also support updating `mcp_servers`:

```json
{
  "mcp_servers": ["playwright", "context7", "fetch"]
}
```

### 2. MCP Server Configuration

For each enabled MCP server, the backend needs to:

#### A. Install the NPM Package

```bash
# Example for Playwright
npx -y @playwright/mcp
```

#### B. Configure Claude Desktop's `config.json`

The Claude Desktop configuration file location varies by OS:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Example Configuration:**

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "git": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git"]
    }
  }
}
```

#### C. Handle Servers Requiring Configuration

Some servers need additional configuration:

**Brave Search (requires API key):**
```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**SQLite (requires database path):**
```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sqlite",
        "/path/to/database.db"
      ]
    }
  }
}
```

**PostgreSQL (requires connection string):**
```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://user:password@localhost:5432/mydb"
      ]
    }
  }
}
```

### 3. Agent-Specific MCP Configuration

**Option 1: Per-Agent Configuration Files**

Create separate config files for each agent:
- `~/.config/Claude/agents/agent-abc123.json`

This allows each agent to have its own set of MCP servers.

**Option 2: Dynamic Configuration on Agent Start**

When starting an agent:
1. Read the agent's `mcp_servers` from the database
2. Generate a temporary config file
3. Start Claude with `--config /path/to/agent-config.json`

### 4. Database Schema

Update your agent storage to include MCP servers:

```sql
-- Example SQL schema
ALTER TABLE agents ADD COLUMN mcp_servers TEXT; -- JSON array of server IDs

-- Example stored data
UPDATE agents SET mcp_servers = '["playwright", "memory", "git"]' WHERE id = 'agent-abc123';
```

### 5. Environment Variables for API Keys

For servers requiring API keys (Brave Search), you should:

1. **Store API keys securely** (environment variables or secrets manager)
2. **Inject them into MCP server configuration** when starting agents
3. **Never expose API keys** in frontend responses

**Recommended approach:**

```typescript
// Backend code (example)
function getMCPServerConfig(serverId: string, agentConfig: any) {
  const baseConfig = {
    command: "npx",
    args: ["-y", getServerPackage(serverId)]
  };

  if (serverId === "brave-search") {
    baseConfig.env = {
      BRAVE_API_KEY: process.env.BRAVE_API_KEY || agentConfig.braveApiKey
    };
  }

  return baseConfig;
}
```

## Testing

### Manual Testing Steps:

1. **Create an agent** with MCP servers selected:
   - Open Create Agent dialog
   - Select working directory
   - Check "Playwright", "Memory", and "Git" servers
   - Click "Create Agent"

2. **Verify backend receives the data:**
   ```
   POST /api/agents
   {
     "mcp_servers": ["playwright", "memory", "git"]
   }
   ```

3. **Check Claude configuration:**
   - Verify `claude_desktop_config.json` contains the servers
   - Verify `npx @playwright/mcp` can be executed

4. **Test agent capabilities:**
   - Send message: "Open https://example.com in a browser"
   - Agent should use Playwright to open the URL
   - Send message: "Remember that my favorite color is blue"
   - Agent should use Memory server to store this

### Automated Tests:

```typescript
// Example backend test
describe('POST /api/agents', () => {
  it('should accept mcp_servers array', async () => {
    const response = await request(app)
      .post('/api/agents')
      .send({
        id: 'test-agent',
        working_dir: '/tmp/test',
        mcp_servers: ['playwright', 'memory']
      });

    expect(response.status).toBe(200);

    // Verify config was created
    const config = await readClaudeConfig('test-agent');
    expect(config.mcpServers).toHaveProperty('playwright');
    expect(config.mcpServers).toHaveProperty('memory');
  });
});
```

## Security Considerations

1. **Validate server IDs** - Only allow known/approved servers
2. **Sandbox MCP servers** - Run them with limited permissions
3. **API key management** - Store securely, never expose to frontend
4. **Database access** - Limit SQLite/Postgres to specific databases
5. **Filesystem access** - Restrict to agent's working directory

## Troubleshooting

### Common Issues:

**Issue: MCP server fails to start**
- **Check**: NPM package is installed (`npx @playwright/mcp --version`)
- **Check**: Required dependencies are available (Node.js 18+)
- **Check**: Correct configuration in `claude_desktop_config.json`

**Issue: API key not working (Brave Search)**
- **Check**: Environment variable is set
- **Check**: API key is valid and has quota remaining
- **Check**: API key is properly passed to MCP server config

**Issue: Database connection fails (SQLite/Postgres)**
- **Check**: Database path/connection string is correct
- **Check**: Agent has permissions to access the database
- **Check**: Database server is running (for Postgres)

## Resources

- [Official MCP Documentation](https://modelcontextprotocol.io/)
- [MCP Registry](https://registry.modelcontextprotocol.io/)
- [MCP Server Reference Implementations](https://github.com/modelcontextprotocol/servers)
- [Playwright MCP Documentation](https://github.com/microsoft/playwright-mcp)
- [Memory Server Documentation](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)

## Next Steps

1. ✅ Frontend implementation (COMPLETED)
2. ⏳ Backend API updates (IN PROGRESS)
3. ⏳ MCP server configuration system
4. ⏳ Database schema updates
5. ⏳ Testing and validation
6. ⏳ Documentation for users

---

**Questions or Issues?**

Contact the Virtual Agency development team for assistance with MCP server integration.
