import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const distDir = path.join(packageRoot, "dist");
const workspaceRoot = path.resolve(packageRoot, "..", "..");

const binaryNames = [
  "virtual-agency-server-macos-arm64",
  "virtual-agency-server-macos-x64",
  "virtual-agency-server-linux-x64",
  "virtual-agency-server-linux-arm64",
  "virtual-agency-server-windows-x64.exe",
  "virtual-agency-server-windows-arm64.exe",
];

const platformMap = {
  darwin: {
    arm64: "virtual-agency-server-macos-arm64",
    x64: "virtual-agency-server-macos-x64",
  },
  linux: {
    x64: "virtual-agency-server-linux-x64",
    arm64: "virtual-agency-server-linux-arm64",
  },
  win32: {
    x64: "virtual-agency-server-windows-x64.exe",
    arm64: "virtual-agency-server-windows-arm64.exe",
  },
};

function syncCurrentPlatformBinary() {
  const byArch = platformMap[process.platform];
  const distName = byArch && byArch[process.arch];
  if (!distName) return;

  const releaseName = process.platform === "win32" ? "virtual-agency-server.exe" : "virtual-agency-server";
  const releaseBinary = path.join(workspaceRoot, "target", "release", releaseName);
  if (!fs.existsSync(releaseBinary)) return;

  fs.mkdirSync(distDir, { recursive: true });
  const distBinary = path.join(distDir, distName);
  fs.copyFileSync(releaseBinary, distBinary);
  if (!distName.endsWith(".exe")) {
    fs.chmodSync(distBinary, 0o755);
  }
  console.log(`[prepare-npm-dist] Synced ${distName} from target/release`);
}

syncCurrentPlatformBinary();

const existing = binaryNames.filter((name) => fs.existsSync(path.join(distDir, name)));

if (existing.length === 0) {
  throw new Error(
    "No server binaries found in apps/server/dist. Build and place at least one binary before packing.",
  );
}

for (const name of existing) {
  if (name.endsWith(".exe")) continue;
  const fullPath = path.join(distDir, name);
  const mode = fs.statSync(fullPath).mode;
  if ((mode & 0o111) !== 0o111) {
    fs.chmodSync(fullPath, 0o755);
  }
}

console.log(`[prepare-npm-dist] Found ${existing.length} binary file(s): ${existing.join(", ")}`);
