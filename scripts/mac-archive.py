"""Create an unsigned Mac app archive without losing UNIX modes or framework symlinks.

On macOS use the normal Electron Packager path. Windows uses this archive-only
fallback because its filesystem cannot create the prebuilt framework's symlinks.
The included command applies a local ad-hoc signature on the target Mac.
"""
import copy
import plistlib
import stat
import sys
import zipfile
from pathlib import Path

source, target, app_asar, icon, version = sys.argv[1:]
Path(target).parent.mkdir(parents=True, exist_ok=True)
root = "Animo.app/Contents/"
installer = '''#!/bin/bash
set -euo pipefail
animo_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
animo_app="$animo_dir/Animo.app"
if [[ ! -d "$animo_app" ]]; then
  echo "Animo.app must be in the same folder as this command."
  exit 1
fi
# Local testing signature only; public distribution needs Developer ID/notarization.
/usr/bin/codesign --force --deep --sign - "$animo_app"
/usr/bin/open "$animo_app"
'''
readme = '''Animo for macOS — unsigned development build

1. Extract this archive using macOS Archive Utility (preserves framework symlinks).
2. Run Open-Animo.command from the same folder as Animo.app.
   It applies a local ad-hoc signature and opens this copy of Animo.
   No Node.js or .NET installation is needed.
3. Use the cat's context menu or menu-bar cat icon to control it.
   Command+Option+C: hide/show. Command+Option+R: recall.

macOS runtime has not been verified on the Windows development host.
This build is not notarized. macOS may require approval under Privacy & Security.
For public distribution, build/sign/notarize on a Mac with a Developer ID.
'''

def entry(name, data, mode=stat.S_IFREG | 0o644):
    item = zipfile.ZipInfo(name)
    item.create_system = 3
    item.external_attr = mode << 16
    item.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(item, data)

with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=4) as archive:
    for item in original.infolist():
        # Development bundles are re-signed locally, never represented as notarized.
        if "/_CodeSignature/" in item.filename:
            continue
        if item.filename == "Electron.app/Contents/Resources/default_app.asar":
            continue
        data = original.read(item.filename)
        new = copy.copy(item)
        new.filename = item.filename.replace("Electron.app/", "Animo.app/", 1)
        if item.filename == "Electron.app/Contents/Info.plist":
            info = plistlib.loads(data)
            info.update(CFBundleName="Animo", CFBundleDisplayName="Animo", CFBundleIdentifier="com.animo.desktopcat",
                        CFBundleShortVersionString=version, CFBundleVersion=version, LSUIElement=True,
                        LSApplicationCategoryType="public.app-category.entertainment", NSRequiresAquaSystemAppearance=False)
            # Keep CFBundleExecutable and helper names consistent with the binary archive.
            data = plistlib.dumps(info)
        elif item.filename == "Electron.app/Contents/Resources/electron.icns":
            data = Path(icon).read_bytes()
        archive.writestr(new, data)
    entry(root + "Resources/app.asar", Path(app_asar).read_bytes())
    entry("Open-Animo.command", installer.encode(), stat.S_IFREG | 0o755)
    entry("README-Mac.txt", readme.encode())

with zipfile.ZipFile(source) as original, zipfile.ZipFile(target) as result:
    old_links = {i.filename.replace("Electron.app/", "Animo.app/", 1): original.read(i) for i in original.infolist() if stat.S_ISLNK(i.external_attr >> 16)}
    for name, link in old_links.items():
        assert stat.S_ISLNK(result.getinfo(name).external_attr >> 16), f"Symlink mode lost: {name}"
        assert result.read(name) == link, f"Symlink target lost: {name}"
    info = plistlib.loads(result.read(root + "Info.plist"))
    assert info["CFBundleIdentifier"] == "com.animo.desktopcat" and info["LSUIElement"]
    assert result.getinfo(root + "Resources/app.asar").file_size > 0
    assert result.getinfo(root + "MacOS/" + info["CFBundleExecutable"]).external_attr >> 16 & 0o111
    print(f"Verified Mac archive: {len(old_links)} framework symlinks, executable permissions, app.asar and Info.plist.")
