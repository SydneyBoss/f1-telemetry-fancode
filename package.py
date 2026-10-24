#!/usr/bin/env python3
"""
Packaging script for F1 Telemetry Extension
Builds a production-ready ZIP archive for the Chrome Web Store and Edge Add-ons.
"""

import json
import os
import zipfile

def package():
    # Read version from manifest.json
    with open('manifest.json', 'r') as f:
        manifest = json.load(f)
    version = manifest.get('version', '1.0.0')

    dist_dir = 'dist'
    os.makedirs(dist_dir, exist_ok=True)
    zip_path = os.path.join(dist_dir, f'f1-telemetry-fancode-v{version}.zip')

    files_to_pack = [
        'manifest.json',
        'background.js',
        'icons/icon16.png',
        'icons/icon48.png',
        'icons/icon128.png',
        'icons/icon.svg',
        'content/hud.js',
        'content/hud.css',
        'content/openf1.js',
        'popup/popup.html',
        'popup/popup.css',
        'popup/popup.js',
        'README.md'
    ]

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for file in files_to_pack:
            if os.path.exists(file):
                zipf.write(file)
                print(f"  + Added: {file}")
            else:
                print(f"  ! Warning: {file} not found!")

    size_kb = os.path.getsize(zip_path) / 1024
    print(f"\n[DONE] Successfully generated store-ready package:")
    print(f"       -> {zip_path} ({size_kb:.1f} KB)")
    print(f"       Upload this .zip directly to Chrome Web Store or Edge Add-ons!")

if __name__ == '__main__':
    package()
