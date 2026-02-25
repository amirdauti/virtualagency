# @virtualagency/server

Rust-powered Virtual Agency server packaged as an npm CLI.

Includes a `--version` flag in the wrapper CLI so users can verify installed package version quickly.
This package is published from GitHub Actions via npm Trusted Publisher.

## Install

```bash
npm install -g @virtualagency/server
```

Or run without installing globally:

```bash
npx @virtualagency/server
```

## Usage

```bash
virtual-agency-server --port 1337
virtual-agency-server --version
```

The `--port` flag sets `VIRTUAL_AGENCY_PORT` for the server process.

## Custom Binary

If you want to run your own binary build, set:

```bash
VIRTUAL_AGENCY_SERVER_BINARY=/absolute/path/to/virtual-agency-server virtual-agency-server
```

## Packaging Notes

This package expects prebuilt binaries to exist in `dist/` with names:

- `virtual-agency-server-macos-arm64`
- `virtual-agency-server-macos-x64`
- `virtual-agency-server-linux-x64`
- `virtual-agency-server-linux-arm64`
- `virtual-agency-server-windows-x64.exe`
- `virtual-agency-server-windows-arm64.exe`

Only binaries that exist at publish time are included in the npm tarball.

Release note: this package may be republished with patch versions to validate hosted auto-rollout behavior.
