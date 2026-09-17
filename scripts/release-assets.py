"""Assemble portable, managed Host and web downloads from validated builds."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

version = json.loads(Path("package.json").read_text(encoding="utf-8"))["version"]
root = Path("artifacts") / f"release-{version}"
root.mkdir(parents=True, exist_ok=True)
for role, source, destination in [
    ("client", "AgentView.exe", "AgentView.exe"),
    ("host", "AgentView Host.exe", "AgentView.Host.exe"),
]:
    shutil.copyfile(Path("out") / role / source, root / destination)

with zipfile.ZipFile(root / f"AgentView-managed-host-{version}.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
    host = Path("out/host/win-unpacked")
    if not (host / "resources/app.asar").is_file():
        raise SystemExit("The managed Host payload is missing.")
    for file in sorted(host.rglob("*")):
        if file.is_file():
            archive.write(file, "host/" + file.relative_to(host).as_posix())
    for script in ("install-host.ps1", "start-host.ps1"):
        archive.write(Path("scripts") / script, script)
    archive.writestr("INSTALL.txt", f"""AgentView {version} managed Host

Extract this entire archive, then run PowerShell:
.\\install-host.ps1 -PackageDirectory .\\host -InstallDirectory "$env:LOCALAPPDATA\\Hardline Labs\\AgentView Host" -Version {version}

Use the same installation directory as an existing managed Host.
-RegisterStartup optionally enables sign-in startup. -Elevated explicitly opts
into elevated startup and requires administrator PowerShell.
Installing replaces the network Host after readiness checks. The independent
execution worker is preserved; runtime restart is a separate idle-only action.
An already compatible Host does not need replacing for a client-only update.
See https://github.com/HardlineLabs/hardline-agentview/blob/v{version}/docs/host-operation.md
""")

with zipfile.ZipFile(root / f"AgentView-web-{version}.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    web = Path("dist/client")
    if not (web / "sw.js").is_file():
        raise SystemExit("Build the PWA before assembling release downloads.")
    for file in sorted(web.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(web).as_posix())

names = ["AgentView.exe", "AgentView.Host.exe", f"AgentView-managed-host-{version}.zip", f"AgentView-web-{version}.zip"]
lines = []
for name in sorted(names):
    with (root / name).open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    lines.append(f"{digest}  {name}\n")
(root / f"SHA256SUMS-{version}.txt").write_text("".join(lines), encoding="utf-8")
print(root)
