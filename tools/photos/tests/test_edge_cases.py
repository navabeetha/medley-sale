"""Tests for D-029 (photo pipeline edge cases): stale files, duplicate IDs,
multi-row anchors, CLI output hygiene, and the "thumb" naming rule."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import pipeline
import synthetic as syn

HEADERS = ["Item", "ID", "Person", "Photos"]
PIPELINE_PY = Path(pipeline.__file__).resolve()


def two_item_book(path, ids=("tech-001", "tech-002")):
    syn.build_workbook(path, {"Tech": {
        "headers": HEADERS,
        "rows": [[f"Synthetic Name {i}", item_id, None, None] for i, item_id in enumerate(ids, 1)],
        "images": [(f"D{2 + i}", syn.solid_png(c)) for i, c in enumerate([syn.RED, syn.BLUE][: len(ids)], 1)],
    }})


def snapshot(folder: Path):
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


# --------------------------------------------- 1. stale files (D-029 rule 3)


def test_photo_removed_from_sheet_disappears_from_output_and_manifest(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    out = tmp_path / "public" / "photos"
    sheet = tmp_path / "private" / "c.jpg"

    two_item_book(xlsx)
    pipeline.run(xlsx, out, sheet)
    stale = sorted(p.name for p in out.glob("tech-002*"))
    assert len(stale) == 2  # thumb + full, so the removal below is meaningful

    # Bystanders that must survive: a non-webp in out_dir, a webp in a subfolder
    # of out_dir, and a webp outside out_dir.
    (out / "notes.txt").write_text("keep")
    (out / "sub").mkdir()
    (out / "sub" / "nested.webp").write_bytes(b"nested")
    outside = tmp_path / "public" / "other.webp"
    outside.write_bytes(b"outside")

    two_item_book(xlsx, ids=("tech-001",))  # seller deleted the second item's photo
    pipeline.run(xlsx, out, sheet)

    assert not any(p.name in stale for p in out.iterdir())
    assert set(json.loads((out / "manifest.json").read_text())) == {"tech-001"}
    assert (out / "tech-001-1.webp").is_file() and (out / "tech-001-1-thumb.webp").is_file()
    assert (out / "notes.txt").read_text() == "keep"
    assert (out / "sub" / "nested.webp").read_bytes() == b"nested"
    assert outside.read_bytes() == b"outside"


# ------------------------------------------ 2. duplicate IDs (D-029 rule 4)


def assert_nothing_written_on_duplicate(tmp_path, tabs, rows_expected):
    xlsx = tmp_path / "dup.xlsx"
    syn.build_workbook(xlsx, tabs)
    out = tmp_path / "public" / "photos"
    out.mkdir(parents=True)
    (out / "old.webp").write_bytes(b"old")  # pre-existing output must not be cleaned or changed
    (out / "manifest.json").write_text("{}")
    before = snapshot(out)
    sheet = tmp_path / "private" / "c.jpg"

    with pytest.raises(ValueError) as err:
        pipeline.run(xlsx, out, sheet)
    msg = str(err.value)
    assert "dup-001" in msg
    for row in rows_expected:
        assert str(row) in msg
    assert snapshot(out) == before
    assert not sheet.exists()


def test_duplicate_id_on_two_rows_of_one_tab_stops_naming_id_and_rows(tmp_path):
    assert_nothing_written_on_duplicate(tmp_path, {"Tech": {
        "headers": HEADERS,
        "rows": [["Synthetic A", "dup-001", None, None], ["Synthetic B", "dup-001", None, None]],
        "images": [("D3", syn.solid_png(syn.RED)), ("D4", syn.solid_png(syn.BLUE))],
    }}, rows_expected=[3, 4])


def test_duplicate_id_across_two_tabs_stops_naming_id_and_rows(tmp_path):
    assert_nothing_written_on_duplicate(tmp_path, {
        "Tech": {"headers": HEADERS, "rows": [["Synthetic A", "dup-001", None, None]],
                 "images": [("D3", syn.solid_png(syn.RED))]},
        "Gym": {"title_rows": 2, "headers": HEADERS, "rows": [["Synthetic B", "dup-001", None, None]],
                "images": [("D4", syn.solid_png(syn.BLUE))]},
    }, rows_expected=[3, 4])


# ----------------------------------- 3. multi-row anchor (D-029 rule 5)


def test_image_stretched_over_several_rows_belongs_to_its_top_left_row(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS,
        "rows": [["Synthetic A", "tech-001", None, None],
                 ["Synthetic B", "tech-002", None, None],
                 ["Synthetic C", "tech-003", None, None]],
        "images": [("D3", syn.solid_png(syn.RED), "D5")],  # top-left row 3, spans rows 3-5
    }})
    extracted = pipeline.extract_images(xlsx)
    assert [(t, r) for t, r, _ in extracted] == [("Tech", 3)]
    items, skipped = pipeline.map_to_items(xlsx, extracted)
    assert set(items) == {"tech-001"} and skipped == []


# ------------------------------------------------------ 4. CLI smoke


def test_cli_prints_counts_and_ids_only_never_cell_text(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS,
        "rows": [["Zebra Lamp Secret Name", "tech-001", None, None],
                 ["Quokka Chair Secret Name", None, None, None]],  # no ID: gets reported
        "images": [("D3", syn.solid_png(syn.RED)), ("D4", syn.solid_png(syn.BLUE))],
    }})
    cwd = tmp_path / "work"  # the CLI writes public/photos and private/ relative to cwd
    cwd.mkdir()
    # -I would drop the script dir; pass the venv interpreter and the script path directly.
    proc = subprocess.run([sys.executable, str(PIPELINE_PY), str(xlsx)], cwd=cwd,
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    shown = proc.stdout + proc.stderr
    assert "1" in shown  # counts are printed
    for secret in ("Zebra", "Quokka", "Secret Name", "Synthetic title"):
        assert secret not in shown
    assert (cwd / "public" / "photos" / "manifest.json").is_file()
    assert (cwd / "private").is_dir()
    assert not any("contact" in p.name for p in (cwd / "public").rglob("*"))


def test_cli_duplicate_id_error_names_id_but_no_cell_text_and_exits_nonzero(tmp_path):
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS,
        "rows": [["Zebra Lamp Secret Name", "dup-001", None, None],
                 ["Quokka Chair Secret Name", "dup-001", None, None]],
        "images": [("D3", syn.solid_png(syn.RED))],
    }})
    cwd = tmp_path / "work"
    cwd.mkdir()
    proc = subprocess.run([sys.executable, str(PIPELINE_PY), str(xlsx)], cwd=cwd,
                          capture_output=True, text=True, timeout=120)
    shown = proc.stdout + proc.stderr
    assert proc.returncode != 0
    assert "dup-001" in shown
    assert "Secret Name" not in shown and "Zebra" not in shown
    assert not (cwd / "public" / "photos" / "manifest.json").exists()


# ----------------------------------------- 5. "thumb" in an item ID


@pytest.mark.parametrize("item_id", ["thumb-1", "Big-THUMB-2", "Thumbnail"])
def test_item_id_containing_thumb_never_makes_a_full_image_name_look_like_a_thumbnail(tmp_path, item_id):
    # tools/size-budget.mjs treats any photos/ file with "thumb" in its name as a
    # 12 KB thumbnail, so a full image must never contain it.
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS,
        "rows": [["Synthetic A", item_id, None, None]],
        "images": [("D3", syn.noisy_photo((1200, 900)))],
    }})
    out = tmp_path / "public" / "photos"
    pipeline.run(xlsx, out, tmp_path / "private" / "c.jpg")
    entry = json.loads((out / "manifest.json").read_text())[item_id][0]  # key keeps the real ID
    assert "thumb" not in entry["full"].lower()
    assert "thumb" in entry["thumb"].lower()
    assert (out / entry["full"]).is_file() and (out / entry["thumb"]).is_file()
    assert (out / entry["full"]).stat().st_size <= 120 * 1024
    assert (out / entry["thumb"]).stat().st_size <= 12 * 1024
