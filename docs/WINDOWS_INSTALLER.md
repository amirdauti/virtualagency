# Windows Installer (MSI) via CI, deploy locally

Hetzner is IP-restricted to allow uploads only from your local machine, so the intended flow is:

1) CI builds the MSI on a Windows runner
2) You download the MSI to your machine
3) You `scp` it to Hetzner (same as the current deploy style)

## One-time setup

- Ensure GitHub CLI is installed and authenticated:
  - `gh auth login`
  - If `gh` can’t infer the repo (because your git remote uses an SSH alias), set it explicitly:
    - `export REPO=amirdauti/virtualagency`

## Build MSI (GitHub Actions) and download it locally

From the repo root:

```bash
./scripts/build_windows_msi_from_ci.sh
```

This saves the MSI to:
- `dist/windows/VirtualAgencyServer.msi`

To force an MSI version:

```bash
./scripts/build_windows_msi_from_ci.sh 0.1.123
```

## Deploy MSI to Hetzner (from your machine)

```bash
scp dist/windows/VirtualAgencyServer.msi \
  root@virtualagency.ai:/var/www/virtual-agency/downloads/VirtualAgencyServer-windows.msi
```

## What the MSI does

- Installs `virtual-agency-server.exe` into `%LOCALAPPDATA%\\VirtualAgency\\Server\\`
- Creates Start Menu + Desktop shortcuts
- Performs a major upgrade (new MSI replaces old)
- Auto-starts the server after first install

## Notes on trust warnings

Unsigned MSIs/EXEs commonly trigger SmartScreen/Chrome warnings until reputation is established.
To reduce/remove warnings, Authenticode-sign the MSI/EXE (ideally EV cert) and timestamp it.
