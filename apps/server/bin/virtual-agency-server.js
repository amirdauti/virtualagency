#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DIST_BINARY_NAMES = {
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

function getPackageVersion() {
  try {
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const content = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(content);
    return parsed.version || "unknown";
  } catch {
    return "unknown";
  }
}

function printHelp() {
  console.log(`virtual-agency-server\n\nRuns the Virtual Agency Rust server binary.\n\nUsage:\n  virtual-agency-server [--port <number>]\n  virtual-agency-server --help\n  virtual-agency-server --version\n\nOptions:\n  --port <number>   Sets VIRTUAL_AGENCY_PORT for the server process.\n  -h, --help        Show this help message.\n  -v, --version     Show npm package version.\n\nEnvironment:\n  VIRTUAL_AGENCY_SERVER_BINARY  Absolute path to a custom server binary.\n  VIRTUAL_AGENCY_PORT           Default port (used when --port is not passed).\n`);
}

function parseArgs(argv) {
  let port;
  let version = false;
  const passthrough = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      return { help: true, version: false, port, passthrough: [] };
    }

    if (arg === "-v" || arg === "--version") {
      version = true;
      continue;
    }

    if (arg === "--port") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --port");
      }
      port = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      const value = arg.slice("--port=".length);
      if (!value) {
        throw new Error("Missing value for --port");
      }
      port = value;
      continue;
    }

    passthrough.push(arg);
  }

  return { help: false, version, port, passthrough };
}

function resolveBinaryPath() {
  const custom = process.env.VIRTUAL_AGENCY_SERVER_BINARY;
  if (custom) {
    return path.resolve(custom);
  }

  const byArch = DIST_BINARY_NAMES[process.platform];
  const fileName = byArch && byArch[process.arch];
  if (!fileName) {
    return null;
  }

  return path.join(__dirname, "..", "dist", fileName);
}

function ensureExecutable(binaryPath) {
  if (process.platform === "win32") return;
  const stat = fs.statSync(binaryPath);
  const executeMask = 0o111;
  if ((stat.mode & executeMask) === executeMask) return;
  fs.chmodSync(binaryPath, 0o755);
}

function start() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[virtual-agency-server] ${error.message}`);
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  if (parsed.version) {
    console.log(getPackageVersion());
    process.exit(0);
  }

  const binaryPath = resolveBinaryPath();
  if (!binaryPath) {
    console.error(
      `[virtual-agency-server] Unsupported platform/arch: ${process.platform}/${process.arch}. ` +
        "Set VIRTUAL_AGENCY_SERVER_BINARY to run a custom binary.",
    );
    process.exit(1);
  }

  if (!fs.existsSync(binaryPath)) {
    console.error(
      `[virtual-agency-server] Missing binary at ${binaryPath}. ` +
        "Build or add the matching file under apps/server/dist before publishing.",
    );
    process.exit(1);
  }

  try {
    ensureExecutable(binaryPath);
  } catch (error) {
    console.error(`[virtual-agency-server] Failed to prepare binary: ${error.message}`);
    process.exit(1);
  }

  const env = {
    ...process.env,
    VIRTUAL_AGENCY_PORT: parsed.port || process.env.VIRTUAL_AGENCY_PORT || "1337",
  };

  const child = spawn(binaryPath, parsed.passthrough, {
    stdio: "inherit",
    env,
  });

  child.on("error", (error) => {
    console.error(`[virtual-agency-server] Failed to launch binary: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

start();
