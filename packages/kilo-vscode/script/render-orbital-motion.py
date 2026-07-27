#!/usr/bin/env python3

import argparse
import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 96
SCALE = 4
FRAMES = 96
TAU = math.tau


def unit(value):
    length = math.sqrt(sum(item * item for item in value))
    return tuple(item / length for item in value)


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def basis(normal):
    axis = (0.0, 0.0, 1.0)
    u = unit(cross(axis, normal))
    return u, cross(normal, u)


def blend(layer, segments, theme, width):
    draw = ImageDraw.Draw(layer, "RGBA")
    dark = theme == "dark"

    for item in segments:
        x1, y1, x2, y2, light = item
        base = 118 + round(light * 72) if dark else 64 + round(light * 86)
        alpha = 148 + round(light * 76)
        edge = (12, 22, 34, 178) if dark else (30, 42, 54, 152)
        glass = (base, min(255, base + 12), min(255, base + 25), alpha)
        shine = (
            (232, 246, 255, 118 + round(light * 112))
            if dark
            else (255, 255, 255, 112 + round(light * 98))
        )
        length = max(1.0, math.hypot(x2 - x1, y2 - y1))
        offset = 0.62 * SCALE
        ox = -(y2 - y1) / length * offset
        oy = (x2 - x1) / length * offset
        draw.line((x1, y1, x2, y2), fill=edge, width=round(width * 1.34), joint="curve")
        draw.line((x1, y1, x2, y2), fill=glass, width=round(width), joint="curve")
        draw.line(
            (x1 + ox, y1 + oy, x2 + ox, y2 + oy),
            fill=shine,
            width=max(SCALE, round(width * 0.22)),
        )


def sphere(theme):
    radius = 9.2 * SCALE
    size = round(radius * 2 + 12 * SCALE)
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    center = size / 2
    dark = theme == "dark"

    for y in range(size):
        for x in range(size):
            dx = (x - center) / radius
            dy = (y - center) / radius
            distance = math.sqrt(dx * dx + dy * dy)
            if distance > 1:
                continue
            z = math.sqrt(max(0.0, 1 - distance * distance))
            diffuse = max(0.0, -0.5 * dx - 0.65 * dy + 0.85 * z)
            glint = math.exp(-((dx + 0.35) ** 2 + (dy + 0.42) ** 2) / 0.045)
            rim = (1 - z) ** 0.7
            if dark:
                value = round(52 + diffuse * 92 + glint * 105 + rim * 38)
                color = (value, min(255, value + 10), min(255, value + 22), round(205 + z * 45))
            else:
                value = round(92 + diffuse * 78 + glint * 82 + rim * 40)
                color = (value, min(255, value + 8), min(255, value + 14), round(205 + z * 40))
            pixels[x, y] = color

    glow = Image.new("RGBA", image.size)
    gd = ImageDraw.Draw(glow, "RGBA")
    gd.ellipse((5 * SCALE, 5 * SCALE, size - 5 * SCALE, size - 5 * SCALE), fill=(225, 242, 255, 85))
    glow = glow.filter(ImageFilter.GaussianBlur(3 * SCALE))
    return Image.alpha_composite(glow, image)


def ring(normal, radius, phase):
    u, v = basis(normal)
    points = []
    steps = 144

    for index in range(steps + 1):
        angle = TAU * index / steps
        point = tuple(
            radius * (math.cos(angle) * u[axis] + math.sin(angle) * v[axis])
            for axis in range(3)
        )
        points.append(point)

    segments = []
    for index in range(steps):
        one = points[index]
        two = points[index + 1]
        depth = (one[2] + two[2]) / 2
        travel = (math.cos(TAU * index / steps - phase) + 1) / 2
        facing = max(0.0, min(1.0, 0.5 + depth / (radius * 1.35)))
        light = travel * 0.68 + facing * 0.32
        segments.append(
            (
                depth,
                (
                    (SIZE / 2 + one[0]) * SCALE,
                    (SIZE / 2 + one[1]) * SCALE,
                    (SIZE / 2 + two[0]) * SCALE,
                    (SIZE / 2 + two[1]) * SCALE,
                    light,
                ),
            )
        )
    return segments


def frame(index, theme):
    progress = index / FRAMES
    turn = progress * TAU
    specs = (
        (
            34.0,
            math.radians(72 + 6 * math.sin(turn)),
            math.radians(90 + 9 * math.sin(turn)),
            turn,
        ),
        (
            32.5,
            math.radians(58 + 7 * math.sin(-turn + 1.2)),
            math.radians(6 + 11 * math.sin(-turn + 0.5)),
            -turn + 2.1,
        ),
        (
            31.0,
            math.radians(64 + 8 * math.sin(turn + 2.0)),
            math.radians(142 + 10 * math.sin(turn + 1.0)),
            turn + 4.2,
        ),
    )
    segments = []

    for radius, tilt, azimuth, phase in specs:
        normal = (
            math.sin(tilt) * math.cos(azimuth),
            math.sin(tilt) * math.sin(azimuth),
            math.cos(tilt),
        )
        segments.extend(ring(normal, radius, progress * TAU + phase))

    segments.sort(key=lambda item: item[0])
    far = [item[1] for item in segments if item[0] <= 0]
    near = [item[1] for item in segments if item[0] > 0]
    image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE))
    glow = Image.new("RGBA", image.size)
    glow_draw = ImageDraw.Draw(glow, "RGBA")
    glow_color = (170, 216, 255, 82) if theme == "dark" else (50, 92, 138, 62)

    for item in far + near:
        glow_draw.line(item[:4], fill=glow_color, width=6 * SCALE)
    glow = glow.filter(ImageFilter.GaussianBlur(3.2 * SCALE))
    image = Image.alpha_composite(image, glow)

    far_layer = Image.new("RGBA", image.size)
    blend(far_layer, far, theme, 4.35 * SCALE)
    image = Image.alpha_composite(image, far_layer)

    core = sphere(theme)
    image.alpha_composite(core, ((image.width - core.width) // 2, (image.height - core.height) // 2))

    near_layer = Image.new("RGBA", image.size)
    blend(near_layer, near, theme, 4.35 * SCALE)
    image = Image.alpha_composite(image, near_layer)

    glint = Image.new("RGBA", image.size)
    gd = ImageDraw.Draw(glint, "RGBA")
    brightest = max((item for item in near if item[4] > 0.92), key=lambda item: item[4], default=None)
    if brightest:
        gx = (brightest[0] + brightest[2]) / 2
        gy = (brightest[1] + brightest[3]) / 2
        color = (255, 255, 255, 205)
        gd.ellipse((gx - 1.6 * SCALE, gy - 1.6 * SCALE, gx + 1.6 * SCALE, gy + 1.6 * SCALE), fill=color)
        gd.line((gx - 3.4 * SCALE, gy, gx + 3.4 * SCALE, gy), fill=color, width=SCALE)
        gd.line((gx, gy - 3.4 * SCALE, gx, gy + 3.4 * SCALE), fill=color, width=SCALE)
    glint = glint.filter(ImageFilter.GaussianBlur(0.5 * SCALE))
    image = Image.alpha_composite(image, glint)

    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def render(root, theme):
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"orbital-{theme}-") as tmp:
        folder = Path(tmp)
        files = []
        for index in range(FRAMES):
            path = folder / f"{index:03}.png"
            frame(index, theme).save(path, optimize=True)
            files.append(path)

        (root / "orbital.png").write_bytes(files[0].read_bytes())
        command = ["img2webp", "-loop", "0", "-mixed", "-min_size"]
        for index, path in enumerate(files):
            duration = 17 if index % 3 else 16
            command.extend(["-d", str(duration), "-lossy", "-q", "72", "-m", "6", "-exact", str(path)])
        command.extend(["-o", str(root / "orbital.webp")])
        subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for theme in ("dark", "light"):
        render(args.output / theme, theme)


if __name__ == "__main__":
    main()
