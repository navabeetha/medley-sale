"""Pictures wrapped in mc:AlternateContent (markup-compatibility wrapper).

Rule (PM, after QA re-check): the row comes from the anchor that actually
CONTAINS the picture, never from another anchor nested in the same wrapper. If
the picture's own anchor has no `from` (absoluteAnchor) it is skipped with a
reason, never guessed from a neighbour.
"""
from __future__ import annotations

import re

import pytest

import pipeline
import synthetic as syn

MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
HEADERS = ["Item", "ID", "Person", "Photos"]


def base_workbook(path):
    # Data rows 3, 4, 5 -> t-001, t-002, t-003. One picture, anchored at D3 (row 3).
    syn.build_workbook(path, {"Tech": {
        "headers": HEADERS,
        "rows": [["Synthetic A", "t-001", None, None], ["Synthetic B", "t-002", None, None],
                 ["Synthetic C", "t-003", None, None]],
        "images": [("D3", syn.solid_png(syn.RED))],
    }})


def picture_anchor(xml: str) -> str:
    return re.search(r"<oneCellAnchor>.*</oneCellAnchor>", xml, re.S).group(0)


def at_row(anchor: str, row: int) -> str:
    return re.sub(r"<row>\d+</row>", f"<row>{row - 1}</row>", anchor, count=1)


def absolute(anchor: str) -> str:
    out = re.sub(r"<oneCellAnchor><from>.*?</from>", '<absoluteAnchor><pos x="0" y="0"/>', anchor, flags=re.S)
    return out.replace("</oneCellAnchor>", "</absoluteAnchor>")


def shape_anchor(row: int) -> str:
    """A non-picture shape (no blip) anchored on the given 1-based row."""
    return (f"<oneCellAnchor><from><col>3</col><colOff>0</colOff><row>{row - 1}</row><rowOff>0</rowOff></from>"
            '<ext cx="1" cy="1"/><sp><nvSpPr><cNvPr id="9" name="s"/><cNvSpPr/></nvSpPr><spPr/></sp>'
            "<clientData/></oneCellAnchor>")


def wrapped(choice: str, fallback: str | None):
    """Build an edit_drawing function wrapping the picture's anchor in AlternateContent."""
    def edit(xml: str) -> str:
        pic = picture_anchor(xml)
        parts = f'<mc:Choice Requires="a14">{choice(pic)}</mc:Choice>'
        if fallback is not None:
            parts += f"<mc:Fallback>{fallback(pic)}</mc:Fallback>"
        return xml.replace(pic, f"<mc:AlternateContent {MC}>{parts}</mc:AlternateContent>")
    return edit


def plant(tmp_path, edit):
    base, planted = tmp_path / "base.xlsx", tmp_path / "ac.xlsx"
    base_workbook(base)
    syn.rewrite_zip(base, planted, edit_drawing=edit)
    return planted


def image_counts(items):
    return {k: len(v["images"]) for k, v in items.items()}


def test_plain_alternate_content_wrapped_picture_is_placed_at_its_own_row(tmp_path):
    # Guards against reading only direct-child anchors (which would drop it).
    xlsx = plant(tmp_path, wrapped(lambda pic: pic, None))
    extracted = pipeline.extract_images(xlsx)
    assert [(t, r) for t, r, _ in extracted] == [("Tech", 3)]
    items, skipped = pipeline.map_to_items(xlsx, extracted)
    assert image_counts(items) == {"t-001": 1} and skipped == []


def test_picture_in_the_fallback_takes_its_row_not_the_row_of_a_shape_in_the_choice(tmp_path):
    # Choice = non-picture shape on row 5; Fallback = the picture on row 3.
    xlsx = plant(tmp_path, wrapped(lambda pic: shape_anchor(5), lambda pic: pic))
    extracted = pipeline.extract_images(xlsx)
    assert [(t, r) for t, r, _ in extracted] == [("Tech", 3)]
    items, skipped = pipeline.map_to_items(xlsx, extracted)
    assert image_counts(items) == {"t-001": 1}  # not t-003 (row 5)
    assert skipped == []


@pytest.mark.parametrize("fallback_row", [3, 4])
def test_picture_in_both_choice_and_fallback_yields_one_image_at_the_choice_row(tmp_path, fallback_row):
    xlsx = plant(tmp_path, wrapped(lambda pic: pic, lambda pic: at_row(pic, fallback_row)))
    extracted = pipeline.extract_images(xlsx)
    assert [(t, r) for t, r, _ in extracted] == [("Tech", 3)]  # exactly one, at the Choice's row
    items, _ = pipeline.map_to_items(xlsx, extracted)
    assert image_counts(items) == {"t-001": 1}


def test_picture_whose_own_anchor_has_no_from_is_skipped_not_placed_by_a_neighbours_row(tmp_path):
    # The picture sits in an absoluteAnchor (no from). A different anchor in the
    # same wrapper (a shape on row 5) must not lend it a row.
    xlsx = plant(tmp_path, wrapped(lambda pic: absolute(pic), lambda pic: shape_anchor(5)))
    items, skipped = pipeline.map_to_items(xlsx, pipeline.extract_images(xlsx))
    assert items == {}  # in particular, nothing attached to t-003
    assert len(skipped) == 1 and skipped[0]["tab"] == "Tech" and skipped[0]["reason"]
