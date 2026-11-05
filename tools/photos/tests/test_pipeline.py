"""Red-step tests for the S-05 photo pipeline (brief 7.1, 8.1 T-16, D-019, D-027, D-028).

Interface under test (tools/photos/pipeline.py, not written yet):

  extract_images(xlsx_path) -> list[(tab:str, row:int, image_bytes:bytes)]
      row is the 1-based sheet row of the image's top-left anchor. Order: tab
      order, then row, then column.
  map_to_items(xlsx_path, extracted) -> (items, skipped)
      items:   {item_id: {"alt": str, "images": [bytes, ...]}}  (left-to-right)
      skipped: [{"tab": str, "row": int, "reason": str}, ...]
  process(image_bytes) -> (thumb_webp, full_webp, width, height)
      width/height are those of the FULL image as stored.
  run(xlsx_path, out_dir, contact_sheet_path) -> report dict with "skipped"
      Writes <out_dir>/manifest.json and the .webp files; contact sheet elsewhere.

manifest.json shape (paths are relative to the manifest's own folder):
  { "<ITEM ID>": [ {"thumb": "<id>-1-thumb.webp", "full": "<id>-1.webp",
                    "width": int, "height": int, "alt": str}, ... ], ... }
"""
from __future__ import annotations

import io
import json
import struct
from pathlib import Path

import pytest
from PIL import Image, ImageStat

import pipeline  # noqa: E402  (tools/photos/pipeline.py)
import synthetic as syn

THUMB_MAX_BYTES = 12 * 1024  # brief 8.1
FULL_MAX_BYTES = 120 * 1024  # brief 8.1


def decode(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im.load()
    return im


def near(a, b, tol=12):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def riff_chunks(webp: bytes):
    """Four-character codes of the top-level chunks in a WebP (RIFF) file."""
    assert webp[:4] == b"RIFF" and webp[8:12] == b"WEBP"
    out, pos = [], 12
    while pos + 8 <= len(webp):
        fourcc = webp[pos : pos + 4].decode("ascii")
        (size,) = struct.unpack("<I", webp[pos + 4 : pos + 8])
        out.append(fourcc)
        pos += 8 + size + (size & 1)
    return out


@pytest.fixture
def workbook(tmp_path):
    path = tmp_path / "export.xlsx"
    return path, syn.standard_workbook(path)


# ---------------------------------------------------------------- 1. mapping


def test_extract_images_reports_tab_and_anchor_row_of_every_image(workbook):
    path, _ = workbook
    got = pipeline.extract_images(path)
    assert sorted((tab, row) for tab, row, _ in got) == sorted(
        [("Tech", 3), ("Tech", 3), ("Tech", 4), ("Tech", 5), ("Tech", 1),
         ("Home Things", 4), ("Books", 3)]
    )
    assert all(isinstance(b, bytes) and syn.pixel(b) for _, _, b in got)


def test_images_map_to_items_by_id_column_not_by_position(workbook):
    # ID is column C on Tech, A on Home Things and E on Books.
    path, expected = workbook
    items, _ = pipeline.map_to_items(path, pipeline.extract_images(path))
    assert set(items) == {"tech-001", "tech-002", "home-001", "book-001"}
    for item_id in items:
        got = [syn.dominant_colour(b) for b in items[item_id]["images"]]
        assert got == expected[item_id]["colours"], item_id


def test_several_images_on_one_row_all_belong_to_that_item_left_to_right(workbook):
    path, expected = workbook
    items, _ = pipeline.map_to_items(path, pipeline.extract_images(path))
    assert [syn.dominant_colour(b) for b in items["tech-001"]["images"]] == [syn.RED, syn.GREEN]


def test_header_row_below_title_rows_is_found_by_person_cell(workbook):
    # Home Things has two title rows, so its header is row 3 (D-027).
    path, _ = workbook
    items, _ = pipeline.map_to_items(path, pipeline.extract_images(path))
    assert "home-001" in items


def test_image_on_a_row_with_no_id_is_skipped_and_reported(workbook):
    path, expected = workbook
    items, skipped = pipeline.map_to_items(path, pipeline.extract_images(path))
    assert {(s["tab"], s["row"]) for s in skipped} == set(expected["skipped"])
    assert all(s["reason"] for s in skipped)
    # The yellow no-ID image and the purple title-row image appear nowhere.
    mapped = [syn.dominant_colour(b) for v in items.values() for b in v["images"]]
    assert syn.YELLOW not in mapped and syn.PURPLE not in mapped


def test_tab_without_a_person_header_in_top_five_rows_skips_its_images(tmp_path):
    path = tmp_path / "x.xlsx"
    syn.build_workbook(path, {"Odd": {
        "headers": ["ID", "Item", "Photos"],  # no Person cell anywhere
        "rows": [["odd-001", "Test Thing", None]],
        "images": [("C3", syn.solid_png(syn.RED))],
    }})
    items, skipped = pipeline.map_to_items(path, pipeline.extract_images(path))
    assert items == {}
    assert [(s["tab"], s["row"]) for s in skipped] == [("Odd", 3)]


def test_alt_text_is_the_item_name_with_books_using_brand_column(workbook):
    path, expected = workbook
    items, _ = pipeline.map_to_items(path, pipeline.extract_images(path))
    for item_id, want in expected.items():
        if item_id != "skipped":
            assert items[item_id]["alt"] == want["alt"], item_id  # D-028 for book-001


# --------------------------------------------------------------- 2. orientation


def test_exif_orientation_is_applied_to_pixels_and_dimensions():
    _, full, w, h = pipeline.process(syn.oriented_jpeg_left_red_right_blue(6))
    im = decode(full).convert("RGB")
    assert (w, h) == (100, 200) == im.size  # landscape 200x100 stored, portrait shown
    # Stored-left (red) ends up on top after a 90 degree clockwise turn.
    assert near(im.getpixel((50, 20)), syn.RED)
    assert near(im.getpixel((50, 180)), syn.BLUE)


def test_thumbnail_is_also_upright():
    thumb, _, _, _ = pipeline.process(syn.oriented_jpeg_left_red_right_blue(6))
    im = decode(thumb).convert("RGB")
    assert im.getpixel((72, 5))[0] > 150 and im.getpixel((72, 5))[2] < 100  # red on top
    assert im.getpixel((72, 138))[2] > 150 and im.getpixel((72, 138))[0] < 100  # blue below


# ------------------------------------------------- 3. metadata stripped (T-16)


@pytest.mark.parametrize("orientation", [None, 6])
def test_output_has_no_gps_exif_xmp_or_icc_at_all(orientation):
    src = syn.jpeg_with_gps(orientation=orientation)
    # Sanity: the fixture really carries GPS, otherwise this test proves nothing.
    assert 0x8825 in Image.open(io.BytesIO(src)).getexif()
    assert syn.FAKE_MAKE.encode() in src

    thumb, full, _, _ = pipeline.process(src)
    for out in (thumb, full):
        im = Image.open(io.BytesIO(out))
        assert im.format == "WEBP"
        assert len(im.getexif()) == 0 and not im.getexif().get_ifd(0x8825)
        for key in ("exif", "xmp", "icc_profile"):
            assert key not in im.info, key
        # Container level: only bitstream chunks, no EXIF / XMP / ICCP chunk.
        assert set(riff_chunks(out)) <= {"VP8 ", "VP8L", "VP8X"}
        assert b"EXIF" not in out and b"XMP " not in out and b"ICCP" not in out
        for marker in (syn.FAKE_MAKE.encode(), syn.FAKE_SERIAL.encode(), b"SyntheticXmpMarker"):
            assert marker not in out


def test_run_output_files_carry_no_metadata_either(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": ["Item", "ID", "Person", "Photos"],
        "rows": [["Test Camera", "tech-001", None, None]],
        "images": [("D3", syn.jpeg_with_gps())],
    }})
    out = tmp_path / "public" / "photos"
    pipeline.run(xlsx, out, tmp_path / "private" / "sheet.jpg")
    webps = list(out.glob("*.webp"))
    assert webps
    for f in webps:
        data = f.read_bytes()
        assert set(riff_chunks(data)) <= {"VP8 ", "VP8L", "VP8X"}
        assert syn.FAKE_MAKE.encode() not in data


# ----------------------------------------------------- 4. sizes and dimensions


def test_thumbnail_is_exactly_144_square_webp_within_12_kb_even_for_noisy_input():
    thumb, _, _, _ = pipeline.process(syn.noisy_photo())
    im = Image.open(io.BytesIO(thumb))
    assert im.format == "WEBP" and im.size == (144, 144)
    assert len(thumb) <= THUMB_MAX_BYTES


@pytest.mark.parametrize("size", [(2000, 1500), (1500, 2000)])
def test_full_image_longest_side_is_1000_webp_within_120_kb(size):
    _, full, w, h = pipeline.process(syn.noisy_photo(size))
    im = Image.open(io.BytesIO(full))
    assert im.format == "WEBP"
    assert max(im.size) == 1000
    assert (w, h) == im.size
    # Aspect ratio kept (to rounding).
    assert abs(im.width / im.height - size[0] / size[1]) < 0.01
    assert len(full) <= FULL_MAX_BYTES


def test_small_source_is_not_upscaled_but_thumbnail_is_still_144_square():
    src = io.BytesIO()
    Image.new("RGB", (400, 300), (90, 140, 60)).save(src, "PNG")
    thumb, full, w, h = pipeline.process(src.getvalue())
    assert (w, h) == (400, 300) == decode(full).size  # decision: never upscale full
    assert decode(thumb).size == (144, 144)


# ------------------------------------------------------------ 5. smart crop


def test_smart_crop_keeps_the_off_centre_subject_whole():
    src, _box = syn.off_centre_subject()
    thumb, _, _, _ = pipeline.process(src)
    im = decode(thumb).convert("RGB")
    assert im.size == (144, 144)
    w, h = im.size
    subject = [(x, y) for y in range(h) for x in range(w) if syn.is_subject_pixel(im.getpixel((x, y)))]

    # A plain centre crop of the same source, for comparison.
    full = decode(src).convert("RGB")
    side = min(full.size)
    left = (full.width - side) // 2
    centre = full.crop((left, 0, left + side, side)).resize((144, 144))
    centre_subject = sum(syn.is_subject_pixel(centre.getpixel((x, y))) for y in range(h) for x in range(w))

    assert len(subject) > 1.5 * max(centre_subject, 1)  # more of the subject than a centre crop
    xs, ys = [p[0] for p in subject], [p[1] for p in subject]
    # Subject is wholly inside: its bounding box does not touch the thumbnail edge.
    assert min(xs) > 0 and min(ys) > 0 and max(xs) < w - 1 and max(ys) < h - 1


# ------------------------------------------------- 6. light levels only


def test_levels_adjustment_is_light_mean_brightness_stays_close():
    src = syn.striped_midtone()
    _, full, _, _ = pipeline.process(src)
    ref = decode(src).convert("L").resize(decode(full).size, Image.LANCZOS)
    got = decode(full).convert("L")
    assert abs(ImageStat.Stat(got).mean[0] - ImageStat.Stat(ref).mean[0]) <= 20  # of 255


def test_no_blur_or_denoise_fine_detail_survives():
    src = syn.striped_midtone()
    _, full, _, _ = pipeline.process(src)
    ref = decode(src).convert("L").resize(decode(full).size, Image.LANCZOS)
    got = decode(full).convert("L")

    def edge_energy(im):  # mean absolute horizontal neighbour difference
        px = list(im.getdata())
        w = im.width
        return sum(abs(px[i] - px[i + 1]) for i in range(0, len(px) - 1) if (i + 1) % w) / len(px)

    assert edge_energy(got) >= 0.6 * edge_energy(ref)


# --------------------------------------------------------- 7. contact sheet


def test_run_writes_contact_sheet_to_given_private_path_not_public(tmp_path, workbook):
    path, _ = workbook
    out = tmp_path / "public" / "photos"
    sheet = tmp_path / "private" / "contact-sheet.jpg"
    pipeline.run(path, out, sheet)
    assert sheet.is_file()
    assert Image.open(sheet).size[0] > 144  # a real image with room for several crops
    assert not any("contact" in p.name for p in out.rglob("*"))
    assert not sheet.resolve().is_relative_to(out.resolve())


def test_run_refuses_a_contact_sheet_inside_the_public_photo_folder(tmp_path, workbook):
    path, _ = workbook
    out = tmp_path / "public" / "photos"
    with pytest.raises(ValueError):
        pipeline.run(path, out, out / "contact-sheet.jpg")


# ------------------------------------------------- 8. idempotent re-run


def snapshot(folder: Path):
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def test_rerun_on_same_input_gives_identical_files_and_no_duplicates(tmp_path, workbook):
    path, _ = workbook
    out = tmp_path / "public" / "photos"
    sheet = tmp_path / "private" / "c.jpg"
    pipeline.run(path, out, sheet)
    first = snapshot(out)
    pipeline.run(path, out, sheet)
    assert snapshot(out) == first


# ------------------------------------------------- 9. manifest and naming


def test_manifest_lists_every_photo_with_width_height_alt_and_existing_files(tmp_path, workbook):
    path, expected = workbook
    out = tmp_path / "public" / "photos"
    report = pipeline.run(path, out, tmp_path / "private" / "c.jpg")
    manifest = json.loads((out / "manifest.json").read_text())

    assert set(manifest) == {"tech-001", "tech-002", "home-001", "book-001"}
    assert len(manifest["tech-001"]) == 2 and len(manifest["tech-002"]) == 1
    for item_id, entries in manifest.items():
        for e in entries:
            assert set(e) == {"thumb", "full", "width", "height", "alt"}
            assert e["alt"] == expected[item_id]["alt"]
            assert isinstance(e["width"], int) and isinstance(e["height"], int)
            assert decode((out / e["full"]).read_bytes()).size == (e["width"], e["height"])
            assert decode((out / e["thumb"]).read_bytes()).size == (144, 144)
    assert {(s["tab"], s["row"]) for s in report["skipped"]} == set(expected["skipped"])


def test_only_thumbnails_have_thumb_in_name_and_all_outputs_respect_budgets(tmp_path):
    # tools/size-budget.mjs: "thumb" in the name -> 12 KB, otherwise 120 KB.
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": ["Item", "ID", "Person", "Photos"],
        "rows": [["Test Camera", "tech-001", None, None]],
        "images": [("D3", syn.noisy_photo())],
    }})
    out = tmp_path / "public" / "photos"
    pipeline.run(xlsx, out, tmp_path / "private" / "c.jpg")
    files = [p for p in out.rglob("*") if p.is_file() and p.name != "manifest.json"]
    assert files and all(p.suffix == ".webp" for p in files)
    for p in files:
        limit = THUMB_MAX_BYTES if "thumb" in p.name else FULL_MAX_BYTES
        assert p.stat().st_size <= limit, p.name
    manifest = json.loads((out / "manifest.json").read_text())
    for e in manifest["tech-001"]:
        assert "thumb" in e["thumb"] and "thumb" not in e["full"]
