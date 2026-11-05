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
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from openpyxl import load_workbook
from PIL import Image, ImageDraw, ImageOps

THUMB_SIZE = 144
THUMB_MAX_BYTES = 12 * 1024  # brief 8.1
FULL_LONGEST_SIDE = 1000
FULL_MAX_BYTES = 120 * 1024  # brief 8.1
MIN_QUALITY = 30  # D-031 rule 4: below this a photo looks bad; give up and say so instead
HEADER_SEARCH_ROWS = 5  # D-027: the header is the first of the top 5 rows with "Person"


# ---------------------------------------------------------------- 1. extract


_NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_NS_XDR = "{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}"
_NS_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def _rels(zf, part):
    """{rId: absolute zip path} for a part's .rels file (empty if it has none)."""
    folder, name = posixpath.split(part)
    rels_path = posixpath.join(folder, "_rels", name + ".rels")
    if rels_path not in zf.namelist():
        return {}
    out = {}
    for rel in ET.fromstring(zf.read(rels_path)):
        target = rel.get("Target", "")
        out[rel.get("Id")] = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(folder, target))
    return out


_NS_MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"


def _has_picture(anchor):
    return next(anchor.iter(_NS_A + "blip"), None) is not None


def _anchors(parent):
    """Yield the real drawing anchors under `parent` (one per placed object).

    An mc:AlternateContent wrapper holds the same drawing twice (Choice for newer
    Excel, Fallback for older). Take the Choice's anchors if it holds a picture,
    otherwise the Fallback's, so a picture is never counted twice and each one keeps
    the position of the anchor that actually contains it.
    """
    for el in parent:
        if el.tag == _NS_MC + "AlternateContent":
            for branch in (b for tag in ("Choice", "Fallback") for b in el.findall(_NS_MC + tag)):
                chosen = [a for a in _anchors(branch) if _has_picture(a)]
                if chosen:
                    yield from chosen
                    break
        elif el.tag.endswith("Anchor"):
            yield el


def _scan(xlsx_path):
    """Read pictures straight from the workbook zip. Returns (images, media_files, media_used).

    images: [(tab, row_or_None, bytes)] in tab, row, column order. `row` is the
    1-based row of the top-left anchor, or None for an absoluteAnchor picture
    (floating on the page, tied to no cell). Bytes are the xl/media file exactly
    as stored (D-031 rule 1), because openpyxl re-saves some formats and loses
    the EXIF orientation.
    """
    found = []
    used = set()
    with zipfile.ZipFile(xlsx_path) as zf:
        media = {n for n in zf.namelist() if n.startswith("xl/media/") and not n.endswith("/")}
        sheets = [(sh.get("name"), sh.get(_NS_REL + "id")) for sh in ET.fromstring(zf.read("xl/workbook.xml")).iter(_NS_MAIN + "sheet")]
        wb_rels = _rels(zf, "xl/workbook.xml")
        for tab_index, (tab, rid) in enumerate(sheets):
            sheet_part = wb_rels.get(rid)
            if not sheet_part:
                continue
            for rel in ET.fromstring(zf.read(sheet_part)).iter(_NS_MAIN + "drawing"):
                drawing_part = _rels(zf, sheet_part).get(rel.get(_NS_REL + "id"))
                if not drawing_part or drawing_part not in zf.namelist():
                    continue
                drawing_rels = _rels(zf, drawing_part)
                for anchor in _anchors(ET.fromstring(zf.read(drawing_part))):
                    blip = next(anchor.iter(_NS_A + "blip"), None)
                    target = drawing_rels.get(blip.get(_NS_REL + "embed")) if blip is not None else None
                    if target not in media:
                        continue  # a shape or chart, not a picture we can read
                    used.add(target)
                    start = anchor.find(_NS_XDR + "from")  # the picture's OWN anchor, never a neighbour's
                    if start is None:  # absoluteAnchor
                        row, col = None, 0
                    else:
                        row = int(start.find(_NS_XDR + "row").text) + 1  # file is 0-based
                        col = int(start.find(_NS_XDR + "col").text)
                    found.append((tab_index, -1 if row is None else row, col, tab, row, zf.read(target)))
    found.sort(key=lambda f: f[:3])
    return [(tab, row, data) for _, _, _, tab, row, data in found], len(media), len(used)


def extract_images(xlsx_path):
    """Return [(tab, row, image_bytes)] ordered by tab, then row, then column.

    `row` is the 1-based sheet row of the image's top-left anchor, so a picture
    that straddles several rows belongs to the first one. It is None for an
    absoluteAnchor picture, which map_to_items reports as skipped.
    """
    return _scan(xlsx_path)[0]


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
    # That fallback is for Books only (D-031 rule 5): elsewhere Brand is a brand, not a name.
    names = ("item", "brand (+ link)", "brand") if _norm(ws.title) == "books" else ("item",)
    name_col = _column_of(ws, header, *names)
    rows = {}
    for r in range(header + 1, ws.max_row + 1):
        raw = ws.cell(row=r, column=id_col).value
        item_id = str(raw).strip() if raw is not None else ""
        if not item_id:
            continue
        name = ws.cell(row=r, column=name_col).value if name_col else None
        rows[r] = (item_id, str(name).strip() if name is not None else "")
    return header, rows


def _decodable(data):
    try:
        Image.open(io.BytesIO(data)).load()
        return True
    except Exception:
        return False


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
        if row is None:
            reason = "picture has an absolute anchor (not tied to a row)"
        elif not _decodable(data):
            reason = "image could not be decoded (corrupt or unsupported format)"
        elif tab is None:
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
    """Encode as WebP, stepping quality down (floor MIN_QUALITY) until it fits the byte budget.

    Raises ValueError if even the floor is too big; an over-budget file is never returned.
    Saved with no exif/xmp/icc arguments and an emptied `info`, so Pillow has
    nothing to write besides the bitstream. method=6 is slowest/smallest and
    deterministic.
    """
    im = im.copy()
    im.info.clear()
    qualities = list(range(start_quality, MIN_QUALITY, -4)) + [MIN_QUALITY]
    for quality in qualities:
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=quality, method=6)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    raise ValueError(f"does not fit {max_bytes // 1024} KB even at quality {MIN_QUALITY}")


def process(image_bytes):
    """Return (thumb_webp, full_webp, width, height); width/height are the full image's."""
    im = Image.open(io.BytesIO(image_bytes))
    im.load()
    # Orientation first: exif_transpose reads the tag from the image it is given, and
    # converting colours first would lose it and ship sideways photos. Then colour
    # (the ICC profile is dropped later), then fresh RGB pixels with no metadata.
    im = ImageOps.exif_transpose(im)  # orientation applied to the pixels...
    im = _to_srgb(im)
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


def _published_items(out_dir):
    """True if out_dir/manifest.json already lists at least one item."""
    try:
        return bool(json.loads((out_dir / "manifest.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return False


def run(xlsx_path, out_dir, contact_sheet_path, allow_empty=False):
    """Run the whole pipeline. Returns a report dict (counts and the skipped list)."""
    out_dir, contact_sheet_path = Path(out_dir), Path(contact_sheet_path)
    # The contact sheet is for review only and must never be published (S-05 notes).
    if contact_sheet_path.resolve().is_relative_to(out_dir.resolve()):
        raise ValueError("The contact sheet must be outside the public photo folder.")

    extracted, media_files, media_used = _scan(xlsx_path)
    items, skipped = map_to_items(xlsx_path, extracted)  # raises on duplicate IDs, before any write

    # D-031 rule 3: a run that places nothing must not wipe photos already published
    # (typically the wrong file, or an export made without images).
    if not items and not allow_empty and _published_items(out_dir):
        raise ValueError("No images were placed, but public photos already exist. Nothing was changed. "
                         "Check you exported the right file, or pass allow_empty to clear the photos.")

    manifest, files, sheet_entries, stems = {}, {}, [], {}
    for item_id, item in items.items():
        stem = _file_stem(item_id)
        if stems.setdefault(stem, item_id) != item_id:
            raise ValueError(f"IDs {stems[stem]!r} and {item_id!r} would share file names; nothing was written.")
        manifest[item_id] = []
        for n, data in enumerate(item["images"], start=1):
            try:
                thumb, full, width, height = process(data)
            except ValueError as err:  # over budget (D-031 rule 4); nothing has been written yet
                raise ValueError(f"Photo {n} of item {item_id!r} {err}. Nothing was written.") from err
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

    return {"items": len(manifest), "photos": len(sheet_entries), "removed": removed, "skipped": skipped,
            "unplaced_media": media_files - media_used}


def main(argv):
    args = [a for a in argv[1:] if a != "--allow-empty"]
    if len(args) != 1:
        print("usage: python tools/photos/pipeline.py private/<export>.xlsx [--allow-empty]")
        return 2
    # Default folders are relative to the current folder. `npm run photos` always runs
    # from the repo root. (A test pins this; run it from the repo root if calling directly.)
    out_dir, sheet = Path("public/photos"), Path("private/contact-sheet.jpg")
    try:
        report = run(args[0], out_dir, sheet, allow_empty="--allow-empty" in argv)
    except ValueError as err:
        print(f"Stopped: {err}")  # names tab, rows and ID only, never other cell text
        return 1
    print(f"{report['photos']} photos for {report['items']} items written to public/photos/ "
          f"({report['removed']} stale files removed).")
    print("Contact sheet: private/contact-sheet.jpg")
    if report["unplaced_media"]:
        print(f"{report['unplaced_media']} image files in the workbook were not placed on any row.")
    if report["skipped"]:
        print(f"{len(report['skipped'])} images skipped:")
        for s in report["skipped"]:
            print(f"  tab {s['tab']!r} row {s['row']}: {s['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
