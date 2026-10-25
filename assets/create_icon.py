from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

size = 512
scale = 4
image = Image.new('RGBA', (size * scale, size * scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, size * scale - 8, size * scale - 8), radius=112 * scale,
                       fill='#151b27', outline='#4c617f', width=8 * scale)
draw.rounded_rectangle((63 * scale, 64 * scale, 449 * scale, 448 * scale), radius=32 * scale,
                       fill='#1d2a3c', outline='#426b9e', width=5 * scale)

nodes = [(120, 154, '#a86bff'), (256, 154, '#278bff'), (392, 154, '#ffab36'),
         (185, 320, '#36c7bd'), (327, 320, '#58d485')]
for a, b in [(0, 1), (1, 2), (0, 3), (1, 3), (1, 4), (2, 4)]:
    x1, y1, _ = nodes[a]
    x2, y2, _ = nodes[b]
    draw.line((x1 * scale, y1 * scale, x2 * scale, y2 * scale), fill='#b1c9e9', width=12 * scale)
for x, y, color in nodes:
    draw.rounded_rectangle(((x - 32) * scale, (y - 27) * scale,
                            (x + 32) * scale, (y + 27) * scale), radius=14 * scale,
                           fill=color, outline='#e2efff', width=4 * scale)

image = image.resize((512, 512), Image.Resampling.LANCZOS)
out = Path(__file__).with_name('icon.ico')
image.save(out, format='ICO', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(out)
