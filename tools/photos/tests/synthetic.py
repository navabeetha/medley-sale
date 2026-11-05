"""Synthetic fixture generators for the photo pipeline tests.

PUBLIC REPO: everything here is generated at test time from code. Nothing is
read from a real export or a real photo (CLAUDE.md hard rule 1). People, items
and GPS coordinates are invented ("Test Person", a point in the sea off Africa).
"""
from __future__ import annotations

import io
import random

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XlImage
from PIL import Image, ImageDraw

# Fake GPS: 0 deg N, 0 deg E ("Null Island"), obviously not anybody's house.
FAKE_MAKE = "SyntheticCamCo"
FAKE_SERIAL = "SN-SYNTHETIC-12345"


def solid_png(rgb, size=(40, 40)) -> bytes:
    """A lossless solid-colour PNG, so tests can tell images apart by colour."""
    buf = io.BytesIO()
    Image.new("RGB", size, rgb).save(buf, "PNG")
    return buf.getvalue()


def pixel(image_bytes: bytes, xy=(5, 5)):
    """RGB of one pixel of any decodable image bytes."""
    return Image.open(io.BytesIO(image_bytes)).convert("RGB").getpixel(xy)


def dominant_colour(image_bytes: bytes):
    """Colour at the centre of the image; fixtures are solid so this is enough."""
    im = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return im.getpixel((im.width // 2, im.height // 2))


def jpeg_with_gps(size=(300, 200), orientation: int | None = None) -> bytes:
    """A JPEG carrying fake GPS, camera make/serial, an ICC-less EXIF block and XMP."""
    im = Image.effect_noise(size, 40).convert("RGB")
    exif = Image.Exif()
    exif[0x010F] = FAKE_MAKE  # Make
    exif[0xA431] = FAKE_SERIAL  # BodySerialNumber
    if orientation is not None:
        exif[0x0112] = orientation
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"  # GPSLatitudeRef
    gps[2] = (12.0, 34.0, 56.0)  # GPSLatitude
    gps[3] = "E"  # GPSLongitudeRef
    gps[4] = (78.0, 9.0, 10.0)  # GPSLongitude
    buf = io.BytesIO()
    xmp = (
        b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        b"<x:xmpmeta xmlns:x='adobe:ns:meta/'><!--SyntheticXmpMarker--></x:xmpmeta>"
        b'<?xpacket end="w"?>'
    )
    im.save(buf, "JPEG", exif=exif, xmp=xmp, quality=90)
    return buf.getvalue()


def oriented_jpeg_left_red_right_blue(orientation: int = 6) -> bytes:
    """Stored 200 wide x 100 tall, left half red, right half blue, EXIF orientation.

    Orientation 6 means "rotate 90 degrees clockwise to display". Shown upright
    the picture is therefore 100 wide x 200 tall, with the stored LEFT half on
    TOP (red) and the stored RIGHT half at the BOTTOM (blue).
    """
    im = Image.new("RGB", (200, 100), (255, 0, 0))
    ImageDraw.Draw(im).rectangle([100, 0, 199, 99], fill=(0, 0, 255))
    exif = Image.Exif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    im.save(buf, "JPEG", exif=exif, quality=95)
    return buf.getvalue()


def noisy_photo(size=(2000, 1500), seed=1) -> bytes:
    """Photo-like stress image: blotchy low-frequency colour plus sensor-ish noise.

    Pure white noise cannot be squeezed under 120 KB by any encoder, which
    would make the budget test unsatisfiable rather than demanding. This is the
    hard-but-realistic case.
    """
    rnd = random.Random(seed)
    coarse = Image.new("RGB", (40, 30))
    coarse.putdata([tuple(rnd.randrange(256) for _ in range(3)) for _ in range(40 * 30)])
    big = coarse.resize(size, Image.BICUBIC)
    noise = Image.effect_noise(size, 24).convert("RGB")
    im = Image.blend(big, noise, 0.15)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=95)
    return buf.getvalue()


def off_centre_subject(size=(600, 400)):
    """Smooth blue background, one detailed saturated red/yellow subject, far right.

    Returns (jpeg_bytes, subject_box). A naive centre crop (x 100..500) cuts the
    subject (x 450..570) in half; a smart crop must keep it whole.
    """
    w, h = size
    bg = Image.new("RGB", size)
    px = bg.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (20, 40 + x // 20, 120 + y // 10)  # gentle, low-detail gradient
    box = (450, 140, 570, 260)
    rnd = random.Random(7)
    d = ImageDraw.Draw(bg)
    for x in range(box[0], box[2], 6):
        for y in range(box[1], box[3], 6):
            colour = (230, 30, 20) if rnd.random() < 0.6 else (250, 220, 20)
            d.rectangle([x, y, x + 5, y + 5], fill=colour)
    buf = io.BytesIO()
    bg.save(buf, "PNG")
    return buf.getvalue(), box


def is_subject_pixel(rgb) -> bool:
    """Red/yellow subject colours; the background is blue-dominant."""
    r, _, b = rgb
    return r > 180 and b < 100


def striped_midtone(size=(1400, 1000)) -> bytes:
    """Mid-tone image with crisp 8 px stripes: detects blurring and level shifts."""
    im = Image.new("RGB", size, (110, 120, 130))
    d = ImageDraw.Draw(im)
    for x in range(0, size[0], 16):
        d.rectangle([x, 0, x + 7, size[1]], fill=(150, 160, 170))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def build_workbook(path, tabs: dict) -> None:
    """Write an .xlsx with images anchored on rows.

    `tabs` maps tab name -> spec:
      {
        "title_rows": int,          # rows above the header (title/notes)
        "headers": [str, ...],      # header cells, starting at column A
        "rows": [[cell, ...], ...], # data rows, directly below the header
        "images": [(cell_ref, png_bytes), ...],  # anchored floating images
      }
    """
    wb = Workbook()
    wb.remove(wb.active)
    for name, spec in tabs.items():
        ws = wb.create_sheet(name)
        top = spec.get("title_rows", 1)
        for i in range(top):
            ws.cell(row=i + 1, column=1, value=f"Synthetic title {i + 1}")
        for c, h in enumerate(spec["headers"], start=1):
            ws.cell(row=top + 1, column=c, value=h)
        for r, row in enumerate(spec["rows"], start=top + 2):
            for c, v in enumerate(row, start=1):
                ws.cell(row=r, column=c, value=v)
        for ref, data in spec.get("images", []):
            ws.add_image(XlImage(io.BytesIO(data)), ref)
    wb.save(path)


RED, GREEN, BLUE, YELLOW, PURPLE, ORANGE = (
    (255, 0, 0),
    (0, 200, 0),
    (0, 0, 255),
    (255, 255, 0),
    (160, 0, 160),
    (255, 140, 0),
)


def standard_workbook(path) -> dict:
    """The main mapping fixture. Returns the expected facts for assertions.

    Tech: title row 1, header row 2. ID sits in column C (not first) so code
      that assumes column position fails. Name column is `Item`.
      row 3 -> tech-001, 2 images (cols F and G, PURPLE then ORANGE... see below)
      row 4 -> tech-002, 1 image
      row 5 -> NO ID, 1 image (must be skipped and reported)
    Home Things: 2 title rows, header on row 3 (D-027: first of top 5 rows with Person).
      row 4 -> home-001, 1 image
    Books: header row 2, no `Item` column, name under `Brand (+ Link)` (D-028).
      row 3 -> book-001, 1 image
    A stray image on a title row (Tech row 1) is also skipped and reported.
    """
    tabs = {
        "Tech": {
            "title_rows": 1,
            "headers": ["Item", "Price", "ID", "Status", "Person", "Photos", "Extra"],
            "rows": [
                ["Test Camera", 50, "tech-001", "Available", None],
                ["Test Phone", 20, "tech-002", "Available", None],
                ["Unlabelled Thing", 5, None, "Available", None],
            ],
            "images": [
                ("F3", solid_png(RED)),
                ("G3", solid_png(GREEN)),  # second image, same row, to the right
                ("F4", solid_png(BLUE)),
                ("F5", solid_png(YELLOW)),  # row with no ID
                ("F1", solid_png(PURPLE)),  # on the title row
            ],
        },
        "Home Things": {
            "title_rows": 2,
            "headers": ["ID", "Item", "Person", "Photos"],
            "rows": [["home-001", "Test Lamp", None]],
            "images": [("D4", solid_png(ORANGE))],
        },
        "Books": {
            "title_rows": 1,
            "headers": ["Author", "Brand (+ Link)", "Person", "Photos", "ID"],
            "rows": [["Test Author", "Test Novel", None, None, "book-001"]],
            "images": [("D3", solid_png((10, 10, 10)))],
        },
    }
    build_workbook(path, tabs)
    return {
        "tech-001": {"alt": "Test Camera", "colours": [RED, GREEN]},
        "tech-002": {"alt": "Test Phone", "colours": [BLUE]},
        "home-001": {"alt": "Test Lamp", "colours": [ORANGE]},
        "book-001": {"alt": "Test Novel", "colours": [(10, 10, 10)]},
        "skipped": [("Tech", 5), ("Tech", 1)],
    }
