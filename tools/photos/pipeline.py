"""S-05 photo pipeline: sheet export (.xlsx) -> web-ready photos (brief 7.1, 8.1).

What it does, in order:
  1. extract_images  - pull every picture out of the .xlsx, with its tab and the
                       sheet row of its top-left anchor (D-029 rule 5).
  2. map_to_items    - attach each picture to an item by the `ID` column of that
                       row (never by column position, brief 4.1). Pictures that
                       can't be attached are skipped and reported, not guessed.
  3. process         - orientation applied, ALL metadata dropped (GPS, EXIF, XMP,
                       ICC), light levels, a 144x144 smart-cropped thumbnail and
                       a full image (longest side 1000, never upscaled), as WebP.
  4. run             - writes public/photos/<id>-<n>.webp, <id>-<n>-thumb.webp and
                       manifest.json, plus a contact sheet for a human to eyeball.

Conventions other code relies on:
  * Only thumbnails have "thumb" in their file name (tools/size-budget.mjs gives
    those a 12 KB limit and everything else under photos/ 120 KB).
  * The output folder is fully owned by this tool: stale .webp files are removed
    (D-029 rule 3). Nothing outside the output folder is ever deleted.
  * Output is deterministic, so rerunning on the same export changes nothing in git.

PUBLIC REPO: this code never prints or stores cell text other than item IDs.
Real exports stay in private/ (gitignored).

CLI:  python tools/photos/pipeline.py private/<export>.xlsx
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

from openpyxl import load_workbook
from PIL import Image, ImageDraw, ImageOps

THUMB_SIZE = 144
THUMB_MAX_BYTES = 12 * 1024  # brief 8.1
FULL_LONGEST_SIDE = 1000
FULL_MAX_BYTES = 120 * 1024  # brief 8.1
HEADER_SEARCH_ROWS = 5  # D-027: the header is the first of the top 5 rows with "Person"


# ---------------------------------------------------------------- 1. extract


def extract_images(xlsx_path):
    """Return [(tab, row, image_bytes)] ordered by tab, then row, then column.

    `row` is the 1-based sheet row of the image's top-left anchor, so a picture
    that straddles several rows belongs to the first one.
    """
    wb = load_workbook(xlsx_path)  # not read_only: that mode drops images
    found = []
    for tab_index, ws in enumerate(wb.worksheets):
        for img in ws._images:
            anchor = img.anchor
            if isinstance(anchor, str):  # only for images we added ourselves, not loaded ones
                continue
            # openpyxl's anchors are 0-based; sheet rows are 1-based.
            found.append((tab_index, anchor._from.row + 1, anchor._from.col, ws.title, img._data()))
    found.sort(key=lambda f: f[:3])
    return [(tab, row, data) for _, row, _, tab, data in found]


# ------------------------------------------------------------------ 2. map


def _norm(value):
    return str(value).strip().lower() if value is not None else ""


def _find_header(ws):
    """Row number of the header row, or None (D-027)."""
    for r in range(1, HEADER_SEARCH_ROWS + 1):
        if any(_norm(c.value) == "person" for c in ws[r]):
            return r
    return None


def _column_of(ws, header_row, *names):
    """First column (1-based) whose header matches one of `names`, in priority order."""
    headers = {}
    for c in ws[header_row]:
        headers.setdefault(_norm(c.value), c.column)
    for name in names:
        if name in headers:
            return headers[name]
    return None


def _read_tab(ws):
    """Return (header_row, {row: (id, name)}) for a tab, or None if it has no usable header.

    Raises ValueError if two rows share an ID (D-029 rule 4).
    """
    header = _find_header(ws)
    if header is None:
        return None
    id_col = _column_of(ws, header, "id")
    if id_col is None:
        return None
    # D-028: Books has no `Item` column; the name is under `Brand (+ Link)` (or `Brand`).
    name_col = _column_of(ws, header, "item", "brand (+ link)", "brand")
    rows = {}
    for r in range(header + 1, ws.max_row + 1):
        raw = ws.cell(row=r, column=id_col).value
        item_id = str(raw).strip() if raw is not None else ""
        if not item_id:
            continue
        name = ws.cell(row=r, column=name_col).value if name_col else None
        rows[r] = (item_id, str(name).strip() if name is not None else "")
    return header, rows


def map_to_items(xlsx_path, extracted):
    """Attach pictures to items. Returns (items, skipped).

    items:   {id: {"alt": item name, "images": [bytes, ...]}}, images left to right
    skipped: [{"tab", "row", "reason"}] for pictures that could not be attached
    """
    wb = load_workbook(xlsx_path)
    tabs = {}
    seen = {}  # id -> (tab, row), for the duplicate check across the whole workbook
    for ws in wb.worksheets:
        tab = _read_tab(ws)
        tabs[ws.title] = tab
        if tab is None:
            continue
        for row, (item_id, _) in tab[1].items():
            if item_id in seen:
                other_tab, other_row = seen[item_id]
                raise ValueError(
                    f"Duplicate ID {item_id!r}: tab {other_tab!r} row {other_row} "
                    f"and tab {ws.title!r} row {row}. IDs must be unique; nothing was written."
                )
            seen[item_id] = (ws.title, row)

    items, skipped = {}, []
    for tab_name, row, data in extracted:
        tab = tabs.get(tab_name)
        if tab is None:
            reason = f"tab has no header row with a Person cell in its top {HEADER_SEARCH_ROWS} rows, or no ID column"
        elif row <= tab[0]:
            reason = "image sits on a title or header row"
        elif row not in tab[1]:
            reason = "no ID in this row"
        else:
            item_id, name = tab[1][row]
            entry = items.setdefault(item_id, {"alt": name or item_id, "images": []})
            entry["images"].append(data)
            continue
        skipped.append({"tab": tab_name, "row": row, "reason": reason})
    return items, skipped


# -------------------------------------------------------------- 3. process


def _flatten_to_rgb(im):
    """RGB, with any transparency composited onto white (WebP from RGBA would keep alpha)."""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(bg, rgba).convert("RGB")
    return im.convert("RGB")


def _to_srgb(im):
    """Convert from an embedded ICC profile to sRGB, since the profile is dropped later.

    Best effort: an unreadable profile just means we keep the pixels as they are.
    """
    profile = im.info.get("icc_profile")
    if not profile:
        return im
    try:
        from PIL import ImageCms

        src = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        return ImageCms.profileToProfile(im, src, ImageCms.createProfile("sRGB"), outputMode="RGB")
    except Exception:
        return im


def _light_levels(im):
    """Gentle contrast stretch, the same for all channels so colours don't shift.

    Like autocontrast, but the black and white points may move at most 16 levels
    in from either end, so a flat grey photo is nudged rather than blown up.
    """
    hist = im.convert("L").histogram()
    total = sum(hist)
    cut = total * 0.005  # ignore the darkest / lightest half percent as outliers
    lo = acc = 0
    for i, n in enumerate(hist):
        acc += n
        if acc > cut:
            lo = i
            break
    hi = 255
    acc = 0
    for i in range(255, -1, -1):
        acc += hist[i]
        if acc > cut:
            hi = i
            break
    lo, hi = min(lo, 16), max(hi, 239)
    scale = 255.0 / (hi - lo)
    lut = [max(0, min(255, round((v - lo) * scale))) for v in range(256)]
    return im.point(lut * 3)


def _saliency_window(im):
    """Left/top of the square crop (in `im` pixels) that holds the most visual detail.

    Pillow-only "smart crop": on a small copy, measure local detail as the
    squared colour change between neighbouring pixels (squared, so a strongly
    detailed subject outweighs a faintly textured background), then slide the
    square window along the long side and keep the one with the most detail.
    A slight pull toward the centre breaks ties (e.g. on a plain background).
    """
    w, h = im.size
    side = min(w, h)
    if w == h:
        return 0, 0
    k = 200 / max(w, h)
    small = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.BILINEAR)
    sw, sh = small.size
    px = list(small.getdata())

    def diff(a, b):
        return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])

    # profile[i] = total detail in column i (landscape) or row i (portrait)
    horizontal = w > h
    profile = [0.0] * (sw if horizontal else sh)
    for y in range(sh - 1):
        for x in range(sw - 1):
            p = px[y * sw + x]
            e = diff(p, px[y * sw + x + 1]) ** 2 + diff(p, px[(y + 1) * sw + x]) ** 2
            profile[x if horizontal else y] += e
    win = max(1, round(side * k))
    n = len(profile)
    win = min(win, n)
    best, best_pos = None, 0
    running = sum(profile[:win])
    for pos in range(0, n - win + 1):
        if pos:
            running += profile[pos + win - 1] - profile[pos - 1]
        centre_pull = abs(pos - (n - win) / 2) / max(1, n)  # 0 at centre, small otherwise
        score = running * (1 - 0.02 * centre_pull)
        if best is None or score > best:
            best, best_pos = score, pos
    offset = min(round(best_pos / k), (w if horizontal else h) - side)
    return (offset, 0) if horizontal else (0, offset)


def _encode_webp(im, max_bytes, start_quality):
    """Encode as WebP, stepping quality down until the file fits the byte budget.

    Saved with no exif/xmp/icc arguments and an emptied `info`, so Pillow has
    nothing to write besides the bitstream. method=6 is slowest/smallest and
    deterministic.
    """
    im = im.copy()
    im.info.clear()
    data = b""
    for quality in range(start_quality, 0, -4):
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=quality, method=6)
        data = buf.getvalue()
        if len(data) <= max_bytes:
            break
    return data


def process(image_bytes):
    """Return (thumb_webp, full_webp, width, height); width/height are the full image's."""
    im = Image.open(io.BytesIO(image_bytes))
    im.load()
    im = _to_srgb(im)
    im = ImageOps.exif_transpose(im)  # orientation applied to the pixels...
    im = _flatten_to_rgb(im)  # ...and convert() gives a fresh image carrying no metadata
    im.info.clear()

    # Full image: shrink only (D-029 rule 1), then lightly adjust levels.
    longest = max(im.size)
    if longest > FULL_LONGEST_SIDE:
        k = FULL_LONGEST_SIDE / longest
        full = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    else:
        full = im
    full = _light_levels(full)

    # Thumbnail: smart square crop from the leveled full image, then scale to 144.
    left, top = _saliency_window(full)
    side = min(full.size)
    thumb = full.crop((left, top, left + side, top + side)).resize((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)

    return (
        _encode_webp(thumb, THUMB_MAX_BYTES, 80),
        _encode_webp(full, FULL_MAX_BYTES, 82),
        full.width,
        full.height,
    )


# ------------------------------------------------------------------- 4. run


def _file_stem(item_id):
    """Safe file-name stem for an ID. "thumb" is reserved for real thumbnails (size-budget rule)."""
    stem = re.sub(r"[^A-Za-z0-9_-]", "_", item_id)
    return re.sub("thumb", "thmb", stem, flags=re.IGNORECASE)


def _contact_sheet(entries, path):
    """A grid of the thumbnails, labelled with item IDs only, so a person can check the crops."""
    cols, label_h, pad = 6, 14, 6
    cell_w, cell_h = THUMB_SIZE + pad, THUMB_SIZE + label_h + pad
    rows = max(1, -(-len(entries) // cols))
    sheet = Image.new("RGB", (cols * cell_w + pad, rows * cell_h + pad), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (label, thumb_bytes) in enumerate(entries):
        x, y = pad + (i % cols) * cell_w, pad + (i // cols) * cell_h
        sheet.paste(Image.open(io.BytesIO(thumb_bytes)).convert("RGB"), (x, y + label_h))
        draw.text((x, y), label[:24], fill=(0, 0, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, quality=85)


def run(xlsx_path, out_dir, contact_sheet_path):
    """Run the whole pipeline. Returns a report dict (counts and the skipped list)."""
    out_dir, contact_sheet_path = Path(out_dir), Path(contact_sheet_path)
    # The contact sheet is for review only and must never be published (S-05 notes).
    if contact_sheet_path.resolve().is_relative_to(out_dir.resolve()):
        raise ValueError("The contact sheet must be outside the public photo folder.")

    extracted = extract_images(xlsx_path)
    items, skipped = map_to_items(xlsx_path, extracted)  # raises on duplicate IDs, before any write

    manifest, files, sheet_entries, stems = {}, {}, [], {}
    for item_id, item in items.items():
        stem = _file_stem(item_id)
        if stems.setdefault(stem, item_id) != item_id:
            raise ValueError(f"IDs {stems[stem]!r} and {item_id!r} would share file names; nothing was written.")
        manifest[item_id] = []
        for n, data in enumerate(item["images"], start=1):
            thumb, full, width, height = process(data)
            entry = {"thumb": f"{stem}-{n}-thumb.webp", "full": f"{stem}-{n}.webp",
                     "width": width, "height": height, "alt": item["alt"]}
            manifest[item_id].append(entry)
            files[entry["thumb"]], files[entry["full"]] = thumb, full
            sheet_entries.append((f"{item_id} #{n}", thumb))

    out_dir.mkdir(parents=True, exist_ok=True)
    removed = 0
    for old in out_dir.glob("*.webp"):  # D-029 rule 3: only inside out_dir
        if old.name not in files:
            old.unlink()
            removed += 1
    for name, data in files.items():
        (out_dir / name).write_bytes(data)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    _contact_sheet(sheet_entries, contact_sheet_path)

    return {"items": len(manifest), "photos": len(sheet_entries), "removed": removed, "skipped": skipped}


def main(argv):
    if len(argv) != 2:
        print("usage: python tools/photos/pipeline.py private/<export>.xlsx")
        return 2
    try:
        report = run(argv[1], Path("public/photos"), Path("private/contact-sheet.jpg"))
    except ValueError as err:
        print(f"Stopped: {err}")  # names tab, rows and ID only, never other cell text
        return 1
    print(f"{report['photos']} photos for {report['items']} items written to public/photos/ "
          f"({report['removed']} stale files removed).")
    print("Contact sheet: private/contact-sheet.jpg")
    if report["skipped"]:
        print(f"{len(report['skipped'])} images skipped:")
        for s in report["skipped"]:
            print(f"  tab {s['tab']!r} row {s['row']}: {s['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
