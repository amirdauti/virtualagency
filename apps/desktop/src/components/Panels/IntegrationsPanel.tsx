import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  createNangoConnectSession,
  deleteNangoConnection,
  listNangoConnections,
  loadIntegrationsMarkdown,
  type NangoConnectionInfo,
  saveIntegrationsMarkdown,
} from "../../lib/api";

interface IntegrationsPanelProps {
  agentId: string;
}

interface IntegrationEntry {
  id: string;
  name: string;
  description: string;
  value: string;
}

interface StoredIntegration {
  name: string;
  description: string;
  value: string;
}

const START_MARKER = "<!-- VIRTUAL_AGENCY_INTEGRATIONS_JSON_START -->";
const END_MARKER = "<!-- VIRTUAL_AGENCY_INTEGRATIONS_JSON_END -->";
const GOOGLE_INTEGRATION_ID = "google";

function createEntry(): IntegrationEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: "",
    description: "",
    value: "",
  };
}

function parseIntegrations(markdown: string): StoredIntegration[] {
  const start = markdown.indexOf(START_MARKER);
  const end = markdown.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) return [];

  const block = markdown.slice(start + START_MARKER.length, end);
  const jsonMatch = block.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[1]) as Array<Partial<StoredIntegration>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => ({
        name: String(entry.name || "").trim(),
        description: String(entry.description || "").trim(),
        value: String(entry.value || "").trim(),
      }))
      .filter((entry) => entry.name || entry.description || entry.value);
  } catch {
    return [];
  }
}

function esc(value: string): string {
  return value.replace(/`/g, "\\`");
}

function buildIntegrationsMarkdown(entries: StoredIntegration[]): string {
  const now = new Date().toISOString();
  const cleaned = entries
    .map((entry) => ({
      name: entry.name.trim(),
      description: entry.description.trim(),
      value: entry.value.trim(),
    }))
    .filter((entry) => entry.name || entry.description || entry.value);

  const summary = cleaned.length
    ? cleaned
        .map(
          (entry, index) =>
            `### ${index + 1}. ${esc(entry.name || "Unnamed Integration")}\nDescription: ${esc(entry.description || "No description")}\nValue: \`${esc(entry.value || "")}\``,
        )
        .join("\n\n")
    : "_No integrations configured yet._";

  return `# Agent Integrations

This file stores credentials and integration context for this agent workspace.
Last updated: ${now}

## Credentials

${summary}

${START_MARKER}
\`\`\`json
${JSON.stringify(cleaned, null, 2)}
\`\`\`
${END_MARKER}
`;
}

export function IntegrationsPanel({ agentId }: IntegrationsPanelProps) {
  const [entries, setEntries] = useState<IntegrationEntry[]>([createEntry()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connections, setConnections] = useState<NangoConnectionInfo[]>([]);
  const [removingConnectionId, setRemovingConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [connectionsStatus, setConnectionsStatus] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus("");

    void (async () => {
      try {
        const markdown = await loadIntegrationsMarkdown(agentId);
        if (cancelled) return;

        const parsed = parseIntegrations(markdown);
        if (parsed.length > 0) {
          setEntries(parsed.map((entry) => ({ id: createEntry().id, ...entry })));
        } else {
          setEntries([createEntry()]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[IntegrationsPanel] Failed to load integrations:", err);
          setStatus("Failed to load integrations");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const hasAnyData = useMemo(
    () => entries.some((entry) => entry.name.trim() || entry.description.trim() || entry.value.trim()),
    [entries],
  );

  const updateEntry = useCallback((id: string, field: keyof Omit<IntegrationEntry, "id">, value: string) => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)));
  }, []);

  const addEntry = useCallback(() => {
    setEntries((prev) => [...prev, createEntry()]);
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.id !== id);
      return next.length > 0 ? next : [createEntry()];
    });
  }, []);

  const handleSave = useCallback(async () => {
    const cleaned: StoredIntegration[] = entries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      value: entry.value,
    }));

    setSaving(true);
    setStatus("");
    try {
      const markdown = buildIntegrationsMarkdown(cleaned);
      await saveIntegrationsMarkdown(agentId, markdown);
      setStatus("Saved to .virtual-agency/integrations.md");
    } catch (err) {
      console.error("[IntegrationsPanel] Failed to save integrations:", err);
      setStatus("Failed to save integrations");
    } finally {
      setSaving(false);
    }
  }, [agentId, entries]);

  const handleConnectGoogle = useCallback(async () => {
    setConnectingGoogle(true);
    setStatus("");

    try {
      const session = await createNangoConnectSession(agentId, GOOGLE_INTEGRATION_ID);
      if (!session.session_token) {
        throw new Error("Missing Nango connect session token");
      }

      const connectUrl =
        (session.connect_link && session.connect_link.trim()) ||
        `https://app.nango.dev/connect/session?session_token=${encodeURIComponent(session.session_token)}`;
      const popup = window.open(connectUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        throw new Error("Popup blocked by browser");
      }
      setStatus("Opened Nango connect flow for Google in a new window.");
      setConnectionsStatus("After completing OAuth, click Refresh in oAuth Connections.");
    } catch (err) {
      console.error("[IntegrationsPanel] Failed to start Nango Google connect:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus(`Failed to start Google connect: ${message}`);
    } finally {
      setConnectingGoogle(false);
    }
  }, [agentId]);

  const loadGoogleConnections = useCallback(
    async (options?: { silent?: boolean }) => {
      setLoadingConnections(true);
      if (!options?.silent) setConnectionsStatus("");

      try {
        const response = await listNangoConnections(agentId, GOOGLE_INTEGRATION_ID);
        setConnections(response.connections || []);
        if (!options?.silent) {
          setConnectionsStatus(
            response.total > 0
              ? `Loaded ${response.total} oAuth connection${response.total === 1 ? "" : "s"}.`
              : "No oAuth connections found for this agent yet.",
          );
        }
      } catch (err) {
        console.error("[IntegrationsPanel] Failed to list Nango connections:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        setConnectionsStatus(`Failed to load oAuth connections: ${message}`);
      } finally {
        setLoadingConnections(false);
      }
    },
    [agentId],
  );

  const handleRemoveConnection = useCallback(
    async (connectionId: string) => {
      const confirmed = window.confirm(
        `Disconnect oAuth connection '${connectionId}' for this agent?`,
      );
      if (!confirmed) return;

      setRemovingConnectionId(connectionId);
      setConnectionsStatus("");

      try {
        await deleteNangoConnection(agentId, connectionId, GOOGLE_INTEGRATION_ID);
        setConnections((prev) =>
          prev.filter((connection) => connection.connection_id !== connectionId),
        );
        setConnectionsStatus(`Disconnected connection '${connectionId}'.`);
      } catch (err) {
        console.error("[IntegrationsPanel] Failed to delete Nango connection:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        setConnectionsStatus(`Failed to disconnect connection: ${message}`);
      } finally {
        setRemovingConnectionId(null);
      }
    },
    [agentId],
  );

  useEffect(() => {
    void loadGoogleConnections({ silent: true });
  }, [loadGoogleConnections]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-[#969696]">
        Loading integrations...
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 flex flex-col gap-4">
      <div className="text-sm text-[#cccccc]">
        Add integration credentials with descriptions. They are saved to
        <code className="ml-1 text-[#9cdcfe]">.virtual-agency/integrations.md</code>
        so the agent can reference them while working.
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={addEntry}
          className="px-3 py-1.5 rounded text-[12px] font-medium text-[#cccccc] border border-[#3c3c3c] hover:bg-[#2a2a2a] flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Integration
        </button>
        <button
          onClick={handleConnectGoogle}
          disabled={connectingGoogle}
          className={`px-3 py-1.5 rounded text-[12px] font-medium border flex items-center gap-2 ${
            connectingGoogle
              ? "text-[#777] border-[#3c3c3c] bg-[#252526] cursor-not-allowed"
              : "text-[#a5b4fc] border-[#36417e] bg-[#1f2448] hover:bg-[#272d5a]"
          }`}
        >
          {connectingGoogle ? "Connecting Google..." : "Connect Google"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !hasAnyData}
          className={`px-3 py-1.5 rounded text-[12px] font-medium border flex items-center gap-2 ${
            saving || !hasAnyData
              ? "text-[#777] border-[#3c3c3c] bg-[#252526] cursor-not-allowed"
              : "text-[#9ae6b4] border-[#2f6f42] bg-[#11301b] hover:bg-[#154022]"
          }`}
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Integrations"}
        </button>
      </div>

      {status && <div className="text-[12px] text-[#7dd3fc]">{status}</div>}

      <div className="border border-[#3c3c3c] rounded-md p-3 bg-[#252526] flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] text-[#cccccc] font-medium">oAuth Connections</div>
          <button
            onClick={() => void loadGoogleConnections()}
            disabled={loadingConnections}
            className={`px-2 py-1 rounded text-[11px] border flex items-center gap-1 ${
              loadingConnections
                ? "text-[#777] border-[#3c3c3c] bg-[#252526] cursor-not-allowed"
                : "text-[#9cdcfe] border-[#36546b] bg-[#1f2b33] hover:bg-[#263741]"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingConnections ? "animate-spin" : ""}`} />
            {loadingConnections ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {connectionsStatus && (
          <div className="text-[11px] text-[#7dd3fc]">{connectionsStatus}</div>
        )}

        {connections.length === 0 ? (
          <div className="text-[12px] text-[#969696]">
            No oAuth connections yet for this agent.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {connections.map((connection) => (
              <div
                key={connection.connection_id}
                className="border border-[#3c3c3c] rounded p-2 bg-[#1e1e1e] flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[12px] text-[#e5e7eb] font-mono break-all">
                    {connection.connection_id}
                  </div>
                  <div className="text-[11px] text-[#9ca3af]">
                    Status: {connection.status || "unknown"}
                  </div>
                  {connection.updated_at && (
                    <div className="text-[11px] text-[#6b7280]">
                      Updated: {connection.updated_at}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void handleRemoveConnection(connection.connection_id)}
                  disabled={removingConnectionId === connection.connection_id}
                  className={`p-1 rounded ${
                    removingConnectionId === connection.connection_id
                      ? "text-[#666] cursor-not-allowed"
                      : "text-[#fca5a5] hover:text-[#f87171] hover:bg-[#3f1f1f]"
                  }`}
                  aria-label={`Disconnect ${connection.connection_id}`}
                  title="Disconnect connection"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {entries.map((entry) => (
          <div key={entry.id} className="border border-[#3c3c3c] rounded-md p-3 bg-[#252526] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[12px] text-[#969696] font-medium">Integration</div>
              <button
                onClick={() => removeEntry(entry.id)}
                className="p-1 text-[#969696] hover:text-red-400"
                aria-label="Remove integration"
                title="Remove integration"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <input
              value={entry.name}
              onChange={(e) => updateEntry(entry.id, "name", e.target.value)}
              placeholder="Name (e.g. X API Key)"
              className="h-9 px-2 rounded border border-[#3c3c3c] bg-[#1e1e1e] text-[#e5e7eb] text-[12px] outline-none focus:border-[#007fd4]"
            />
            <input
              value={entry.description}
              onChange={(e) => updateEntry(entry.id, "description", e.target.value)}
              placeholder="Description (what this key is used for)"
              className="h-9 px-2 rounded border border-[#3c3c3c] bg-[#1e1e1e] text-[#e5e7eb] text-[12px] outline-none focus:border-[#007fd4]"
            />
            <input
              value={entry.value}
              onChange={(e) => updateEntry(entry.id, "value", e.target.value)}
              placeholder="Secret value"
              className="h-9 px-2 rounded border border-[#3c3c3c] bg-[#1e1e1e] text-[#e5e7eb] text-[12px] outline-none focus:border-[#007fd4] font-mono"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
