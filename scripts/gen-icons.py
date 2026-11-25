#!/usr/bin/env python3
"""Generate PWA icons for the Nidaa app (purple theme, Arabic wordmark)."""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FG = (255, 255, 255, 255)
BG = (88, 28, 135, 255)          # deep purple
BG2 = (124, 58, 237, 255)        # bright violet


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_wordmark(img, text, sub_text=None):
    d = ImageDraw.Draw(img)
    w, h = img.size
    # gradient background (vertical)
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(BG[0] + (BG2[0] - BG[0]) * t)
        g = int(BG[1] + (BG2[1] - BG[1]) * t)
        b = int(BG[2] + (BG2[2] - BG[2]) * t)
        d.line([(0, y), (w, y)], fill=(r, g, b, 255))
    # main Arabic wordmark "نداء"
    fsize = int(h * 0.34)
    font = ImageFont.truetype(FONT, fsize)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (w - tw) / 2 - bbox[0]
    y = (h - th) / 2 - bbox[1] - (h * 0.06 if sub_text else 0)
    d.text((x, y), text, font=font, fill=FG)
    if sub_text:
        sf = ImageFont.truetype(FONT, int(h * 0.075))
        d.text(((w - d.textlength(sub_text, font=sf)) / 2, h * 0.68), sub_text, font=sf, fill=(237, 233, 254, 255))
    return img


def phone_icon(size):
    """Maskable-safe icon: phone handset + sound waves on purple."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(size * 0.08)
    rounded(d, (m, m, size - m, size - m), int(size * 0.22), BG2)
    # handset
    cx, cy = size * 0.5, size * 0.42
    d.rounded_rectangle((cx - size * 0.05, cy - size * 0.16, cx + size * 0.05, cy + size * 0.16), radius=int(size * 0.05), fill=FG)
    d.ellipse((cx - size * 0.10, cy - size * 0.21, cx + size * 0.10, cy - size * 0.13), fill=FG)
    d.ellipse((cx - size * 0.10, cy + size * 0.13, cx + size * 0.10, cy + size * 0.21), fill=FG)
    # waves
    for i, r in enumerate((0.22, 0.30, 0.38)):
        d.arc((cx - size * r, cy - size * r, cx + size * r, cy + size * r), start=200, end=340,
              fill=(237, 233, 254, 255 - i * 70), width=int(size * 0.035))
    return img


import os
out = os.path.join(os.path.dirname(__file__), "..", "public")
os.makedirs(out, exist_ok=True)

for s in (192, 512):
    draw_wordmark(Image.new("RGBA", (s, s)), "نداء").save(os.path.join(out, f"icon-{s}.png"))
phone_icon(512).save(os.path.join(out, "icon-maskable-512.png"))
draw_wordmark(Image.new("RGBA", (180, 180)), "نداء").save(os.path.join(out, "apple-touch-icon.png"))
# favicon
draw_wordmark(Image.new("RGBA", (64, 64)), "نداء").save(os.path.join(out, "favicon.png"))
print("icons written to", os.path.abspath(out))
