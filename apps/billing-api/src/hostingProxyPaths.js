const ALLOWED_PREFIXES = [
  "/api/agents",
  "/api/terminals",
  "/api/files",
  "/api/events",
  "/api/browse",
  "/api/integrations",
];

// Key management still passes through Clerk authentication and the caller's
// own hosted server. Do not expose other provider or agent-control endpoints.
const PROVIDER_PATHS = new Set([
  "/api/providers/deepseek",
  "/api/providers/deepseek/test",
]);

export function isAllowedHostingProxyPath(pathname) {
  return PROVIDER_PATHS.has(pathname) || ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
