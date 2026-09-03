#!/usr/bin/env python3
"""
Generates standard macOS Solid Square White App Icon for DoDB.
- Full 1024x1024 solid white square (radius = 0, no transparency, macOS clips the squircle natively)
- Generates build/darwin/icon.icns matching Apple's strict iconset specifications
- Generates transparent icon for Windows (build/windows/icon.ico)
"""

import os
import shutil
import subprocess
from PIL import Image

def generate_all_icons():
    canvas = 1024

    # 1. Generate full solid 1024x1024 white square (no radius, macOS clips the squircle natively)
    icon_img = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))

    # Elephant Mascot
    el = Image.open("assets/elephant_raw.png").convert("RGBA")
    bbox = el.getbbox()
    if bbox:
        el = el.crop(bbox)

    target_dim = 720
    scale_f = target_dim / max(el.size)
    el_w = int(el.size[0] * scale_f)
    el_h = int(el.size[1] * scale_f)
    el = el.resize((el_w, el_h), Image.Resampling.LANCZOS)

    el_x = (canvas - el_w) // 2
    el_y = (canvas - el_h) // 2

    # Paste elephant onto solid white square
    icon_img.paste(el, (el_x, el_y), mask=el)

    icon_img.save("assets/icon.png", "PNG", optimize=True)
    icon_img.save("ui/public/icon.png", "PNG", optimize=True)
    print("✓ Created solid square assets/icon.png & ui/public/icon.png")

    # 2. Build standard .iconset and .icns for macOS
    iconset_dir = "/tmp/dodb.iconset"
    shutil.rmtree(iconset_dir, ignore_errors=True)
    os.makedirs(iconset_dir, exist_ok=True)

    sizes = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]

    for filename, sz in sizes:
        resized = icon_img.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(os.path.join(iconset_dir, filename), "PNG")

    os.makedirs("build/darwin", exist_ok=True)
    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", "build/darwin/icon.icns"], check=True)
    shutil.rmtree(iconset_dir, ignore_errors=True)
    print("✓ Created build/darwin/icon.icns")

    if os.path.isdir("dist/dodb.app/Contents/Resources"):
        shutil.copy("build/darwin/icon.icns", "dist/dodb.app/Contents/Resources/icon.icns")
        print("✓ Updated dist/dodb.app/Contents/Resources/icon.icns")

    # 3. Build transparent Windows icon
    os.makedirs("build/windows", exist_ok=True)
    el_raw = Image.open("assets/elephant_raw.png")
    el_raw.save("build/windows/icon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("✓ Created build/windows/icon.ico (transparent)")

if __name__ == "__main__":
    generate_all_icons()
