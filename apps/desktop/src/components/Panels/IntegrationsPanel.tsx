import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { loadIntegrationsMarkdown, saveIntegrationsMarkdown } from "../../lib/api";

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
  const [status, setStatus] = useState<string>("");

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
