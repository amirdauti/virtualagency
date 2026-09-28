const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const {ensureClaude} = require("../bin/ensure-claude-cli");

test("failed CLI protocol or checksum checks preserve the last working install", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "va-updater-test-"));
  const originalFetch = global.fetch;
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const old = {version: "1.0.0", release: "old"};
  const candidate = Buffer.from(`#!${process.execPath}\nif(process.argv.includes('--version')) console.log('2.1.999'); else process.exit(1);\n`);
  const checksum = crypto.createHash("sha256").update(candidate).digest("hex");
  let corrupt = false;
  global.fetch = async url => {
    if (url.endsWith("/latest")) return new Response("2.1.999");
    if (url.endsWith("/manifest.json")) return Response.json({platforms: Object.fromEntries([`${process.platform}-${process.arch}`, `${process.platform}-${process.arch}-musl`].map(key => [key, {checksum}]))});
    return new Response(corrupt ? Buffer.from("corrupt") : candidate);
  };
  try {
    await fs.mkdir(path.join(root, old.version));
    await fs.writeFile(path.join(root, old.version, executable), "old working binary");
    await fs.writeFile(path.join(root, "active.json"), JSON.stringify(old));
    const result = await ensureClaude({release: "new", root, force: true});
    assert.equal(result.version, old.version);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "active.json"))), old);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, "update-status.json"))).status, "failed");
    await fs.rm(path.join(root, "2.1.999"), {recursive: true});
    corrupt = true;
    await ensureClaude({release: "new", root, force: true});
    assert.match(JSON.parse(await fs.readFile(path.join(root, "update-status.json"))).message, /checksum mismatch/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "active.json"))), old);
    assert.equal(await fs.readFile(path.join(root, old.version, executable), "utf8"), "old working binary");
  } finally { global.fetch = originalFetch; await fs.rm(root, {recursive: true, force: true}); }
});
