#!/usr/bin/env python3
"""
Generates standard macOS Big Sur+ White Squircle App Icon for DoDB.
- Canvas: 1024x1024
- Squircle Tile: 824x824 at corner radius 185px (Apple HIG standard)
- Background: Clean crisp Apple White/Silver gradient
- Soft realistic ambient drop shadows
"""

import math
from PIL import Image, ImageDraw, ImageFilter

def create_macos_icon(input_elephant_path, output_icon_path, bg_style="light"):
    canvas = 1024
    tile_size = 824
    r = 185
    margin = 100

    # 1. Base Canvas
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))

    # 2. Multi-layer Apple Drop Shadow for Squircle
    s_layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(s_layer)
    s_draw.rounded_rectangle((margin + 4, margin + 26, margin + tile_size - 4, margin + tile_size + 24), radius=r, fill=(0, 0, 0, 95))
    s_layer = s_layer.filter(ImageFilter.GaussianBlur(30))

    s_layer_2 = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    s_draw_2 = ImageDraw.Draw(s_layer_2)
    s_draw_2.rounded_rectangle((margin + 8, margin + 16, margin + tile_size - 8, margin + tile_size + 14), radius=r, fill=(0, 0, 0, 130))
    s_layer_2 = s_layer_2.filter(ImageFilter.GaussianBlur(12))

    img = Image.alpha_composite(img, s_layer)
    img = Image.alpha_composite(img, s_layer_2)

    # 3. Create Squircle Tile with Crisp White/Silver Gradient
    if bg_style == "light":
        c_top = (255, 255, 255)       # #ffffff pure white
        c_bottom = (240, 243, 248)    # #f0f3f8 soft silver
    else:
        c_top = (28, 35, 52)
        c_bottom = (12, 16, 25)

    scale = 2
    ts_hr = tile_size * scale
    r_hr = r * scale

    tile_hr = Image.new("RGBA", (ts_hr, ts_hr), (0, 0, 0, 0))
    draw_hr = ImageDraw.Draw(tile_hr)

    # Render gradient
    for y in range(ts_hr):
        t = y / float(ts_hr)
        t_curve = 0.5 - 0.5 * math.cos(t * math.pi)
        cr = int(c_top[0] * (1 - t_curve) + c_bottom[0] * t_curve)
        cg = int(c_top[1] * (1 - t_curve) + c_bottom[1] * t_curve)
        cb = int(c_top[2] * (1 - t_curve) + c_bottom[2] * t_curve)
        draw_hr.line([(0, y), (ts_hr, y)], fill=(cr, cg, cb, 255))

    # Mask for squircle
    mask_hr = Image.new("L", (ts_hr, ts_hr), 0)
    m_draw = ImageDraw.Draw(mask_hr)
    m_draw.rounded_rectangle((0, 0, ts_hr - 1, ts_hr - 1), radius=r_hr, fill=255)

    tile_hr.putalpha(mask_hr)

    # Subtle 1px inner bevel rim
    bevel_layer = Image.new("RGBA", (ts_hr, ts_hr), (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(bevel_layer)
    if bg_style == "light":
        b_draw.rounded_rectangle((1, 1, ts_hr - 2, ts_hr - 2), radius=r_hr - 1, outline=(255, 255, 255, 230), width=2)
        b_draw.rounded_rectangle((3, 3, ts_hr - 4, ts_hr - 4), radius=r_hr - 2, outline=(0, 0, 0, 22), width=2)
    else:
        b_draw.rounded_rectangle((1, 1, ts_hr - 2, ts_hr - 2), radius=r_hr - 1, outline=(255, 255, 255, 40), width=2)
        b_draw.rounded_rectangle((3, 3, ts_hr - 4, ts_hr - 4), radius=r_hr - 2, outline=(0, 0, 0, 80), width=2)

    tile_hr = Image.alpha_composite(tile_hr, bevel_layer)
    tile_final = tile_hr.resize((tile_size, tile_size), Image.Resampling.LANCZOS)

    # Paste tile onto canvas
    img.paste(tile_final, (margin, margin), mask=tile_final)

    # 4. Elephant Mascot
    el = Image.open(input_elephant_path).convert("RGBA")
    bbox = el.getbbox()
    if bbox:
        el = el.crop(bbox)

    target_dim = 610
    scale_f = target_dim / max(el.size)
    el_w = int(el.size[0] * scale_f)
    el_h = int(el.size[1] * scale_f)
    el = el.resize((el_w, el_h), Image.Resampling.LANCZOS)

    el_x = (canvas - el_w) // 2
    el_y = (canvas - el_h) // 2 + 4

    # Soft character shadow
    el_shadow = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    alpha = el.split()[3]
    black_el = Image.new("RGBA", (el_w, el_h), (0, 0, 0, 90))
    el_shadow.paste(black_el, (el_x, el_y + 10), mask=alpha)
    el_shadow = el_shadow.filter(ImageFilter.GaussianBlur(14))

    img.paste(el_shadow, (0, 0), mask=el_shadow)
    img.paste(el, (el_x, el_y), mask=el)

    img.save(output_icon_path, "PNG", optimize=True)
    print(f"✓ Created macOS White Squircle App Icon -> {output_icon_path}")

if __name__ == "__main__":
    create_macos_icon("assets/elephant_raw.png", "assets/icon.png", bg_style="light")
