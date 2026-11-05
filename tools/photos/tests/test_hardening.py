"""Tests for D-031 (hardening after S-05 QA) and for mutants QA showed survive.

Pinned names/shapes introduced here:
  run(xlsx, out_dir, contact_sheet, allow_empty=False)
  report["unplaced_media"]: int, number of xl/media files not placed as an image
  skipped entries keep {"tab", "row", "reason"}; an absoluteAnchor entry's
      reason mentions "anchor"
  Over-budget / empty-export refusals are ValueError.
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

import pipeline
import synthetic as syn

HEADERS = ["Item", "ID", "Person", "Photos"]


def decode(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im.load()
    return im


def snapshot(folder: Path):
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def two_image_book(path, first=None, second=None):
    syn.build_workbook(path, {"Tech": {
        "headers": HEADERS,
        "rows": [["Synthetic Name 1", "tech-001", None, None], ["Synthetic Name 2", "tech-002", None, None]],
        "images": [("D3", first or syn.solid_png(syn.RED)), ("D4", second or syn.solid_png(syn.BLUE))],
    }})


# --------------------------------------------- D-031 rule 1: raw media bytes


@pytest.mark.parametrize("fmt", ["MPO", "WEBP"])
def test_orientation_survives_for_formats_openpyxl_would_resave(tmp_path, fmt):
    raw = syn.sideways_landscape_image(fmt)
    base, planted = tmp_path / "base.xlsx", tmp_path / "planted.xlsx"
    two_image_book(base)
    # openpyxl numbers media in insertion order: image1 is the first picture (row 3).
    syn.rewrite_zip(base, planted, replace={"xl/media/image1.png": raw})

    # The bytes handed on are the media file as stored, not a re-encoded copy.
    first = [b for t, r, b in pipeline.extract_images(planted) if r == 3][0]
    assert first == raw

    out = tmp_path / "public" / "photos"
    pipeline.run(planted, out, tmp_path / "private" / "c.jpg")
    entry = json.loads((out / "manifest.json").read_text())["tech-001"][0]
    assert (entry["width"], entry["height"]) == (100, 200)  # upright, not 200x100
    full = decode((out / entry["full"]).read_bytes()).convert("RGB")
    assert full.getpixel((50, 20))[0] > 200 and full.getpixel((50, 180))[2] > 200  # red top, blue bottom


# ------------------------------------- D-031 rule 2: unplaceable images


def test_absolute_anchor_image_is_skipped_with_reason_and_the_run_continues(tmp_path):
    base, planted = tmp_path / "base.xlsx", tmp_path / "abs.xlsx"
    two_image_book(base)
    syn.rewrite_zip(base, planted, edit_drawing=syn.first_anchor_to_absolute)

    out = tmp_path / "public" / "photos"
    report = pipeline.run(planted, out, tmp_path / "private" / "c.jpg")  # must not raise

    assert len(report["skipped"]) == 1
    entry = report["skipped"][0]
    assert entry["tab"] == "Tech" and "anchor" in entry["reason"].lower()
    manifest = json.loads((out / "manifest.json").read_text())
    assert "tech-002" in manifest and not manifest.get("tech-001")  # the other image still published


def test_undecodable_media_is_reported_in_skipped_not_dropped_silently(tmp_path):
    base, planted = tmp_path / "base.xlsx", tmp_path / "bad.xlsx"
    two_image_book(base)
    syn.rewrite_zip(base, planted, replace={"xl/media/image1.png": b"not an image at all"})

    out = tmp_path / "public" / "photos"
    report = pipeline.run(planted, out, tmp_path / "private" / "c.jpg")

    assert [(s["tab"], s["row"]) for s in report["skipped"]] == [("Tech", 3)]
    assert report["skipped"][0]["reason"]
    manifest = json.loads((out / "manifest.json").read_text())
    assert "tech-002" in manifest and not manifest.get("tech-001")


def test_media_file_with_no_placement_is_counted_as_unplaced(tmp_path):
    base, planted = tmp_path / "base.xlsx", tmp_path / "extra.xlsx"
    two_image_book(base)
    syn.rewrite_zip(base, planted, add={"xl/media/image99.png": syn.solid_png(syn.GREEN)})
    report = pipeline.run(planted, tmp_path / "public" / "photos", tmp_path / "private" / "c.jpg")
    assert report["unplaced_media"] == 1


def test_clean_export_reports_zero_unplaced_media(tmp_path):
    base = tmp_path / "base.xlsx"
    two_image_book(base)
    report = pipeline.run(base, tmp_path / "public" / "photos", tmp_path / "private" / "c.jpg")
    assert report["unplaced_media"] == 0


# ------------------------------------------- D-031 rule 3: empty export


def no_image_book(path):
    syn.build_workbook(path, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name 1", "tech-001", None, None]], "images": []}})


def published_folder(tmp_path):
    """A public/photos that already lists an item, built by a normal run."""
    full_xlsx = tmp_path / "full.xlsx"
    two_image_book(full_xlsx)
    out = tmp_path / "public" / "photos"
    pipeline.run(full_xlsx, out, tmp_path / "private" / "c.jpg")
    assert json.loads((out / "manifest.json").read_text())
    return out


def test_export_with_zero_images_refuses_when_photos_are_already_published(tmp_path):
    out = published_folder(tmp_path)
    before = snapshot(out)
    empty = tmp_path / "empty.xlsx"
    no_image_book(empty)
    sheet = tmp_path / "private" / "second.jpg"

    with pytest.raises(ValueError):
        pipeline.run(empty, out, sheet)
    assert snapshot(out) == before  # nothing deleted, manifest untouched
    assert not sheet.exists()


def test_allow_empty_lets_a_zero_image_export_clear_the_published_photos(tmp_path):
    out = published_folder(tmp_path)
    empty = tmp_path / "empty.xlsx"
    no_image_book(empty)
    pipeline.run(empty, out, tmp_path / "private" / "c.jpg", allow_empty=True)
    assert json.loads((out / "manifest.json").read_text()) == {}
    assert list(out.glob("*.webp")) == []


@pytest.mark.parametrize("existing", [None, "{}"])
def test_zero_images_is_fine_when_nothing_is_published_yet(tmp_path, existing):
    out = tmp_path / "public" / "photos"
    if existing is not None:
        out.mkdir(parents=True)
        (out / "manifest.json").write_text(existing)
    empty = tmp_path / "empty.xlsx"
    no_image_book(empty)
    pipeline.run(empty, out, tmp_path / "private" / "c.jpg")  # must not raise
    assert json.loads((out / "manifest.json").read_text()) == {}


# ------------------------------------------- D-031 rule 4: hard budgets


def test_file_that_cannot_fit_the_budget_raises_naming_the_item_and_writes_nothing(tmp_path):
    xlsx = tmp_path / "noise.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name", "noise-001", None, None]],
        "images": [("D3", syn.white_noise_png(2000))],
    }})
    out = tmp_path / "public" / "photos"
    with pytest.raises(ValueError, match="noise-001"):
        pipeline.run(xlsx, out, tmp_path / "private" / "c.jpg")
    assert not out.exists() or snapshot(out) == {}


def test_quality_never_drops_below_30_even_when_giving_up(tmp_path, monkeypatch):
    qualities = []
    real_save = Image.Image.save

    def spy(self, fp, format=None, **params):
        if format == "WEBP":
            qualities.append(params.get("quality"))
        return real_save(self, fp, format, **params)

    monkeypatch.setattr(Image.Image, "save", spy)
    try:
        pipeline.process(syn.white_noise_png(2000))
    except ValueError:
        pass
    assert qualities and min(q for q in qualities if q is not None) >= 30


def test_full_image_that_misses_budget_at_first_quality_is_shrunk_until_it_fits():
    _, full, _, _ = pipeline.process(syn.needs_shrinking_photo())
    assert len(full) <= 120 * 1024  # fails if the quality loop never steps down


def test_thumbnail_that_misses_budget_at_first_quality_is_shrunk_until_it_fits():
    thumb, _, _, _ = pipeline.process(syn.uniform_noise_png(144))
    assert len(thumb) <= 12 * 1024
    assert decode(thumb).size == (144, 144)


# --------------------------------------------- D-031 rule 5: alt fallback


def test_brand_fallback_for_alt_text_applies_on_books_only(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {
        "Books": {"headers": ["Author", "Brand", "ID", "Person", "Photos"],  # plain Brand also OK
                  "rows": [["Test Author", "Test Novel", "book-001", None, None]],
                  "images": [("E3", syn.solid_png(syn.RED))]},
        "Gadgets": {"headers": ["Brand", "ID", "Person", "Photos"],  # not Books: Brand is a brand
                    "rows": [["Test Brand Co", "gad-001", None, None]],
                    "images": [("D3", syn.solid_png(syn.BLUE))]},
        "Misc": {"headers": ["ID", "Person", "Photos"],  # no name column at all
                 "rows": [["misc-001", None, None]],
                 "images": [("C3", syn.solid_png(syn.GREEN))]},
    })
    items, _ = pipeline.map_to_items(xlsx, pipeline.extract_images(xlsx))
    assert items["book-001"]["alt"] == "Test Novel"
    assert items["gad-001"]["alt"] == "gad-001"  # falls back to the ID, not the brand
    assert items["misc-001"]["alt"] == "misc-001"


# ------------------------------------------ surviving mutants from QA


def test_levels_really_stretch_a_low_contrast_image():
    # Smooth ramp 100..140 (range 40) with no texture: "light levels" must widen it.
    im = Image.new("RGB", (400, 300))
    px = im.load()
    for x in range(400):
        for y in range(300):
            v = 100 + x * 40 // 399
            px[x, y] = (v, v, v)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    _, full, _, _ = pipeline.process(buf.getvalue())
    out = decode(full).convert("L")
    lo, hi = out.getpixel((2, 150)), out.getpixel((397, 150))
    # Hand calculation: black/white points move to 16/239 at most, a factor of
    # 255/223 = 1.14 on a 40-level range. Require a clear widening (>= 5%), well
    # below the cap, to survive compression noise.
    assert (hi - lo) >= 40 * 1.05


def test_transparent_pixels_are_flattened_onto_white_not_black():
    rgba = Image.new("RGBA", (300, 400), (0, 0, 0, 0))  # fully transparent, RGB part black
    ImageDraw.Draw(rgba).ellipse([75, 100, 225, 300], fill=(200, 30, 30, 255))
    buf = io.BytesIO()
    rgba.save(buf, "PNG")
    thumb, full, _, _ = pipeline.process(buf.getvalue())
    for out in (thumb, full):
        corner = decode(out).convert("RGB").getpixel((2, 2))
        assert min(corner) >= 235, corner


def test_images_on_one_row_are_ordered_by_column_even_if_added_out_of_order(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]],
        "images": [("H3", syn.solid_png(syn.RED)), ("E3", syn.solid_png(syn.GREEN)),
                   ("F3", syn.solid_png(syn.BLUE))],  # inserted H, E, F
    }})
    items, _ = pipeline.map_to_items(xlsx, pipeline.extract_images(xlsx))
    assert [syn.dominant_colour(b) for b in items["tech-001"]["images"]] == [syn.GREEN, syn.BLUE, syn.RED]


def test_image_on_the_header_row_itself_is_skipped_and_reported(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]],
        "images": [("D2", syn.solid_png(syn.RED))],  # row 2 is the header row
    }})
    items, skipped = pipeline.map_to_items(xlsx, pipeline.extract_images(xlsx))
    assert items == {}
    assert [(s["tab"], s["row"]) for s in skipped] == [("Tech", 2)]


@pytest.mark.parametrize("title_rows, recognised", [(4, True), (5, False)])
def test_header_is_searched_in_the_top_five_rows_only(tmp_path, title_rows, recognised):
    # title_rows=4 puts Person on row 5 (found); title_rows=5 puts it on row 6 (not).
    xlsx = tmp_path / "e.xlsx"
    data_row = title_rows + 2
    syn.build_workbook(xlsx, {"Tech": {
        "title_rows": title_rows,
        "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]],
        "images": [(f"D{data_row}", syn.solid_png(syn.RED))],
    }})
    items, skipped = pipeline.map_to_items(xlsx, pipeline.extract_images(xlsx))
    assert ("tech-001" in items) is recognised
    assert bool(skipped) is (not recognised)


def test_contact_sheet_labels_use_item_ids_never_item_names(tmp_path, monkeypatch):
    drawn = []
    real_text = ImageDraw.ImageDraw.text

    def spy(self, xy, text, *args, **kwargs):
        drawn.append(str(text))
        return real_text(self, xy, text, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, "text", spy)
    xlsx = tmp_path / "e.xlsx"
    two_image_book(xlsx)
    pipeline.run(xlsx, tmp_path / "public" / "photos", tmp_path / "private" / "c.jpg")
    assert any("tech-001" in t for t in drawn)
    assert not any("Synthetic Name" in t for t in drawn)
