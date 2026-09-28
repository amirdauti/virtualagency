// Each VA semantic release resolves Claude Code's current native release, checks
// the official SHA-256, and runs our offline protocol gate before activation.
// A failed download/check leaves the previous active version in place.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { createWriteStream, createReadStream } = require("node:fs");
const { verifyClaude, run } = require("./claude-compatibility");
const RELEASES = "https://downloads.claude.ai/claude-code-releases";

async function json(file) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; } }
async function atomic(file, data) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n", {mode: 0o600});
  await fs.rename(temp, file);
}
async function response(url) {
  const result = await fetch(url, {signal: AbortSignal.timeout(60000)});
  if (!result.ok) throw new Error(`CLI download failed (HTTP ${result.status})`);
  return result;
}
function platform() {
  let name = `${process.platform}-${process.arch}`;
  if (process.platform === "linux" && !process.report?.getReport().header.glibcVersionRuntime) name += "-musl";
  return name;
}
async function ensureClaude({release, root = path.join(os.homedir(), ".virtual-agency/claude-cli"), force = false} = {}) {
  await fs.mkdir(root, {recursive: true, mode: 0o700});
  const activeFile = path.join(root, "active.json");
  const statusFile = path.join(root, "update-status.json");
  const active = await json(activeFile);
  const status = await json(statusFile);
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const validActive = active && /^\d+\.\d+\.\d+$/.test(active.version)
    && await fs.stat(path.join(root, active.version, executable)).then(s => s.isFile()).catch(() => false);
  if (!force && validActive && status?.release === release && status.status === "ready") return active;
  // Retry failures on the next launch, at most once per hour for the same release.
  if (!force && status?.release === release && status.status === "failed" && Date.now() - Date.parse(status.checked_at) < 3600000) return validActive ? active : null;
  let lock;
  try { lock = await fs.open(path.join(root, "update.lock"), "wx", 0o600); }
  catch (e) {
    if (e.code !== "EEXIST") throw e;
    const stat = await fs.stat(path.join(root, "update.lock")).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 600000) { await fs.rm(path.join(root, "update.lock"), {force: true}); return ensureClaude({release, root, force}); }
    return validActive ? active : null;
  }
  let latest;
  try {
    latest = (await (await response(`${RELEASES}/latest`)).text()).trim();
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error("Invalid Claude release manifest");
    const manifest = await (await response(`${RELEASES}/${latest}/manifest.json`)).json();
    const entry = manifest.platforms?.[platform()];
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.checksum)) throw new Error("No verified Claude download for this platform");
    const stage = path.join(root, latest);
    await fs.mkdir(stage, {recursive: true, mode: 0o700});
    const binary = path.join(stage, executable);
    const digest = async file => {
      const hash = crypto.createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      return hash.digest("hex");
    };
    let matches = false;
    try { matches = await digest(binary) === entry.checksum; } catch {}
    if (!matches) {
      const download = `${binary}.download-${process.pid}`;
      try {
        const data = await response(`${RELEASES}/${latest}/${platform()}/claude${process.platform === "win32" ? ".exe" : ""}`);
        await pipeline(data.body, createWriteStream(download, {mode: 0o700}));
        if (await digest(download) !== entry.checksum) throw new Error("Claude download checksum mismatch");
        await fs.rename(download, binary);
      } finally { await fs.rm(download, {force: true}); }
    }
    const version = await run(binary, ["--version"], {}, 10000);
    if (version.code !== 0 || !version.stdout.includes(latest)) throw new Error("Claude version probe failed");
    const compatibility = await verifyClaude(binary, {capture: path.join(root, "compatibility-events.jsonl")});
    const next = {version: latest, checksum: entry.checksum, release, checked_at: new Date().toISOString(), compatibility};
    // Only the small manifest is switched; existing processes keep their binary.
    await atomic(activeFile, next);
    await atomic(statusFile, {status: "ready", release, latest_version: latest, checked_at: next.checked_at});
    return next;
  } catch (error) {
    await atomic(statusFile, {status: "failed", release, latest_version: latest || null, checked_at: new Date().toISOString(), message: error.message});
    console.error(`[virtual-agency-server] Claude update not activated: ${error.message}. Keeping the previous CLI.`);
    return validActive ? active : null;
  } finally { await lock.close(); await fs.rm(path.join(root, "update.lock"), {force: true}); }
}
module.exports = {ensureClaude};
if (require.main === module) ensureClaude({release: require("../package.json").version, force: process.argv.includes("--force")}).then(async result => {
  const status = await json(path.join(os.homedir(), ".virtual-agency/claude-cli/update-status.json"));
  if (!result || status?.status !== "ready") process.exitCode = 1;
  else console.log(`Claude Code ${result.version}: compatibility checked`);
}).catch(error => {console.error(error.message); process.exitCode = 1;});
