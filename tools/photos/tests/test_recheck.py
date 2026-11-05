"""Tests added after the S-05 QA re-check: ICC + orientation (S2), committed
fixture output (S3), and mutants that survived."""
from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageCms

import pipeline
import synthetic as syn

HEADERS = ["Item", "ID", "Person", "Photos"]
REPO_ROOT = Path(__file__).resolve().parents[3]
PIPELINE_PY = Path(pipeline.__file__).resolve()


def decode(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im.load()
    return im


def tree(folder: Path):
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


# ------------------------------------------ 1. ICC profile + orientation (S2)


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP", "MPO"])
def test_process_gives_upright_output_when_source_has_icc_and_orientation(fmt):
    # Phone photos carry both. Stored 200x100, orientation 6 -> shown 100x200, red on top.
    src = syn.icc_oriented_image(fmt, syn.srgb_icc())
    assert Image.open(io.BytesIO(src)).getexif().get(0x0112) == 6  # fixture sanity
    thumb, full, w, h = pipeline.process(src)
    assert (w, h) == (100, 200)
    im = decode(full).convert("RGB")
    assert im.size == (100, 200)
    assert im.getpixel((50, 20))[0] > 200 and im.getpixel((50, 180))[2] > 200
    t = decode(thumb).convert("RGB")
    assert t.getpixel((72, 5))[0] > 150 and t.getpixel((72, 138))[2] > 150


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP", "MPO"])
def test_run_gives_upright_output_for_icc_plus_orientation_media_in_the_workbook(tmp_path, fmt):
    base, planted = tmp_path / "base.xlsx", tmp_path / "planted.xlsx"
    syn.build_workbook(base, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]],
        "images": [("D3", syn.solid_png(syn.RED))],
    }})
    syn.rewrite_zip(base, planted, replace={"xl/media/image1.png": syn.icc_oriented_image(fmt, syn.srgb_icc())})
    out = tmp_path / "public" / "photos"
    pipeline.run(planted, out, tmp_path / "private" / "c.jpg")
    entry = json.loads((out / "manifest.json").read_text())["tech-001"][0]
    assert (entry["width"], entry["height"]) == (100, 200)
    assert decode((out / entry["full"]).read_bytes()).size == (100, 200)


# ---------------------------------- 2. ICC -> sRGB conversion is really applied


def test_non_srgb_profile_is_converted_so_pixels_differ_from_the_same_pixels_without_one():
    profile = syn.linear_rgb_icc()
    # Sanity: the hand-built profile loads in littlecms and is not a no-op to sRGB.
    prof = ImageCms.ImageCmsProfile(io.BytesIO(profile))
    probe = ImageCms.profileToProfile(Image.new("RGB", (2, 2), (64, 64, 64)), prof,
                                      ImageCms.createProfile("sRGB"), outputMode="RGB")
    assert probe.getpixel((0, 0))[0] > 120  # hand calc: linear 64/255 -> sRGB ~137

    # Mid-tone with a little texture so level stretching has something to work on.
    im = Image.new("RGB", (300, 200), (64, 64, 64))
    for x in range(0, 300, 10):
        im.paste((90, 90, 90), (x, 0, x + 5, 200))
    plain, tagged = io.BytesIO(), io.BytesIO()
    im.save(plain, "PNG")
    im.save(tagged, "PNG", icc_profile=profile)

    def mean(data):
        _, full, _, _ = pipeline.process(data)
        px = list(decode(full).convert("L").getdata())
        return sum(px) / len(px)

    # Converting linear -> sRGB brightens mid-tones by roughly 70 levels; demand 25.
    assert mean(tagged.getvalue()) - mean(plain.getvalue()) > 25


# ------------------------------- 3. no fixture output committed to public/


FIXTURE_ID_PREFIXES = ("tech-", "home-", "book-", "gad-", "misc-", "noise-", "dup-", "thumb", "big-thumb")
FIXTURE_TEXT = ("Zebra", "Quokka", "Secret Name", "Synthetic", "Test Camera", "Test Phone", "Test Lamp", "Test Novel")


def tracked(path: str):
    out = subprocess.run(["git", "ls-files", path], cwd=REPO_ROOT, capture_output=True, text=True, check=True)
    return [line for line in out.stdout.splitlines() if line]


def test_no_synthetic_fixture_output_is_tracked_under_public_photos():
    names = tracked("public/photos")
    bad = [n for n in names if Path(n).name.lower().startswith(FIXTURE_ID_PREFIXES)]
    assert bad == [], f"fixture-named files are committed (they would deploy): {bad}"
    for n in names:
        if n.endswith("manifest.json"):
            text = (REPO_ROOT / n).read_text()
            assert not any(word in text for word in FIXTURE_TEXT), f"{n} holds fixture text"


def test_running_the_cli_in_a_scratch_folder_never_writes_into_the_repos_public_folder(tmp_path):
    before = tree(REPO_ROOT / "public")
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]],
        "images": [("D3", syn.solid_png(syn.RED))],
    }})
    work = tmp_path / "work"
    work.mkdir()
    proc = subprocess.run([sys.executable, str(PIPELINE_PY), str(xlsx)], cwd=work, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    assert tree(REPO_ROOT / "public") == before
    assert (work / "public" / "photos" / "manifest.json").is_file()


# --------------------------------------------------- 4. surviving mutants


def test_image_on_header_row_is_skipped_as_header_row_and_never_published(tmp_path):
    # The header row's own ID cell reads "ID" (text), and the data row right below
    # has a real ID. The picture on the header row must be reported as sitting on
    # the title/header rows, not mistaken for an item row or merely "no ID".
    xlsx = tmp_path / "e.xlsx"
    syn.build_workbook(xlsx, {"Tech": {
        "title_rows": 1, "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]],
        "images": [("D2", syn.solid_png(syn.RED)), ("D1", syn.solid_png(syn.GREEN))],
    }})
    items, skipped = pipeline.map_to_items(xlsx, pipeline.extract_images(xlsx))
    assert items == {}
    assert sorted((s["tab"], s["row"]) for s in skipped) == [("Tech", 1), ("Tech", 2)]
    for s in skipped:
        assert "header" in s["reason"].lower() or "title" in s["reason"].lower()
    by_row = {s["row"]: s["reason"].lower() for s in skipped}
    assert "header" in by_row[2]  # the header row itself is named as such


def record_webp_qualities(monkeypatch):
    qualities = []
    real_save = Image.Image.save

    def spy(self, fp, format=None, **params):
        if format == "WEBP":
            qualities.append(params.get("quality"))
        return real_save(self, fp, format, **params)

    monkeypatch.setattr(Image.Image, "save", spy)
    return qualities


def test_quality_floor_is_exactly_30_never_29_and_30_is_used_when_needed(monkeypatch):
    qualities = record_webp_qualities(monkeypatch)
    with pytest.raises(ValueError):
        pipeline.process(syn.white_noise_png(2000))  # cannot fit at any quality
    used = [q for q in qualities if q is not None]
    assert min(used) == 30  # reached the floor (a higher floor would stop sooner) and not below


def test_image_that_only_fits_at_the_floor_quality_is_still_accepted(monkeypatch):
    # Measured: this 1200x900 photo is 114 KB at q30 and over 120 KB at q34.
    qualities = record_webp_qualities(monkeypatch)
    _, full, _, _ = pipeline.process(syn.needs_shrinking_photo(alpha=0.3))
    assert len(full) <= 120 * 1024
    assert 30 in qualities


def cli(cwd, *args):
    return subprocess.run([sys.executable, str(PIPELINE_PY), *args], cwd=cwd, capture_output=True, text=True, timeout=120)


def test_cli_allow_empty_flag_lets_an_empty_export_replace_an_existing_manifest(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    full_x, empty_x = tmp_path / "full.xlsx", tmp_path / "empty.xlsx"
    syn.build_workbook(full_x, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]],
        "images": [("D3", syn.solid_png(syn.RED))]}})
    syn.build_workbook(empty_x, {"Tech": {
        "headers": HEADERS, "rows": [["Synthetic Name", "tech-001", None, None]], "images": []}})
    assert cli(work, str(full_x)).returncode == 0
    manifest = work / "public" / "photos" / "manifest.json"
    published = manifest.read_text()
    assert json.loads(published)

    refused = cli(work, str(empty_x))  # without the flag: stops, changes nothing
    assert refused.returncode != 0
    assert manifest.read_text() == published

    allowed = cli(work, str(empty_x), "--allow-empty")
    assert allowed.returncode == 0, allowed.stdout + allowed.stderr
    assert json.loads(manifest.read_text()) == {}
    assert list((work / "public" / "photos").glob("*.webp")) == []
