/**
 * MCP (Model Context Protocol) Server Definitions
 *
 * Verified MCP servers from official sources and community repositories.
 * Sources:
 * - https://github.com/modelcontextprotocol/servers
 * - https://registry.modelcontextprotocol.io/
 */

export type MCPServerId =
  | "playwright"
  | "context7"
  | "memory"
  | "filesystem"
  | "git"
  | "fetch"
  | "sequential-thinking"
  | "brave-search"
  | "sqlite"
  | "postgres"
  | "tailwindcss"
  | "shadcn";

export interface MCPServerDefinition {
  id: MCPServerId;
  name: string;
  description: string;
  npmPackage: string;
  category: "automation" | "memory" | "filesystem" | "search" | "database" | "reasoning" | "web" | "design";
  requiresConfig?: boolean; // Whether this server needs additional configuration (API keys, etc.)
  configHint?: string; // Hint about what configuration is needed
}

/**
 * Predefined list of verified MCP servers
 * All servers have been verified to exist and are actively maintained
 */
export const MCP_SERVERS: MCPServerDefinition[] = [
  {
    id: "playwright",
    name: "Playwright",
    description: "Browser automation for testing and web scraping. Interact with web pages programmatically.",
    npmPackage: "@playwright/mcp",
    category: "automation",
    requiresConfig: false,
  },
  {
    id: "context7",
    name: "Context7",
    description: "Up-to-date code documentation and API references for popular libraries and frameworks.",
    npmPackage: "@upstash/context7-mcp",
    category: "search",
    requiresConfig: false,
  },
  {
    id: "memory",
    name: "Memory (Knowledge Graph)",
    description: "Long-term persistent memory using a knowledge graph. Remembers facts across conversations.",
    npmPackage: "@modelcontextprotocol/server-memory",
    category: "memory",
    requiresConfig: false,
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Secure file operations with controlled access. Read, write, and manipulate files safely.",
    npmPackage: "@modelcontextprotocol/server-filesystem",
    category: "filesystem",
    requiresConfig: false,
  },
  {
    id: "git",
    name: "Git",
    description: "Git repository operations. Inspect branches, commits, diffs, and manipulate repos.",
    npmPackage: "@modelcontextprotocol/server-git",
    category: "filesystem",
    requiresConfig: false,
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch web content and convert it for LLM consumption. Scrape websites and APIs.",
    npmPackage: "@modelcontextprotocol/server-fetch",
    category: "web",
    requiresConfig: false,
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Enhanced reasoning through explicit thought sequences. Better problem-solving capabilities.",
    npmPackage: "@modelcontextprotocol/server-sequentialthinking",
    category: "reasoning",
    requiresConfig: false,
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web search using Brave Search API. Search the web, images, news, and more.",
    npmPackage: "@modelcontextprotocol/server-brave-search",
    category: "search",
    requiresConfig: true,
    configHint: "Requires BRAVE_API_KEY environment variable",
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query and manipulate SQLite databases. Execute SQL and browse database schemas.",
    npmPackage: "@modelcontextprotocol/server-sqlite",
    category: "database",
    requiresConfig: true,
    configHint: "Requires database file path configuration",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Connect to PostgreSQL databases. Run queries and manage database operations.",
    npmPackage: "@modelcontextprotocol/server-postgres",
    category: "database",
    requiresConfig: true,
    configHint: "Requires database connection string",
  },
  {
    id: "tailwindcss",
    name: "Tailwind CSS",
    description: "UI/UX design assistant for Tailwind CSS. Generate components, optimize classes, convert CSS, and create responsive layouts with accessibility features.",
    npmPackage: "tailwindcss-mcp-server",
    category: "design",
    requiresConfig: false,
  },
  {
    id: "shadcn",
    name: "shadcn/ui",
    description: "Access shadcn/ui components and blocks. Browse, search, and install components for React, Svelte, Vue, and React Native with natural language.",
    npmPackage: "@jpisnice/shadcn-ui-mcp-server",
    category: "design",
    requiresConfig: false,
  },
];

/**
 * Get MCP server definition by ID
 */
export function getMCPServer(id: MCPServerId): MCPServerDefinition | undefined {
  return MCP_SERVERS.find((server) => server.id === id);
}

/**
 * Get MCP servers by category
 */
export function getMCPServersByCategory(
  category: MCPServerDefinition["category"]
): MCPServerDefinition[] {
  return MCP_SERVERS.filter((server) => server.category === category);
}
