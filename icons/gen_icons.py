"""Generate PNG icons for Sidekick AI Chrome extension."""
from PIL import Image, ImageDraw, ImageFont
import os, math

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-rect background
    r = max(2, int(size * 0.18))
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(26, 29, 39, 255))

    # Draw a simple 4-pointed star (✦) manually
    cx, cy = size / 2, size / 2
    outer = size * 0.38
    inner = size * 0.14
    pts = []
    for i in range(8):
        angle = math.radians(i * 45 - 90)
        radius = outer if i % 2 == 0 else inner
        pts.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))

    draw.polygon(pts, fill=(79, 142, 247, 255))

    return img

for sz in [16, 32, 48, 128]:
    icon = draw_icon(sz)
    path = os.path.join(OUT_DIR, f"icon{sz}.png")
    icon.save(path)
    print(f"Saved {path}")
