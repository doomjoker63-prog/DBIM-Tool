"""Restyle a DBIM report so its typography, colours and tables follow a reference report.

The reference's look is captured in a JSON "style profile" (templates/style-*.json). apply_profile() walks the generated
document and applies it by role (cover, headings, body text, each kind of table, captions, header/footer, page border).
Only formatting changes: no text is added or removed, except that the unfilled [ORG] / [1/2] placeholders in the page
header are replaced with the report's real values.
"""
import json
import re

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Twips
from docx.table import Table
from docx.text.paragraph import Paragraph

TBLPR_ORDER = ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription"]
TCPR_ORDER = ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"]
JC = {"left": WD_ALIGN_PARAGRAPH.LEFT, "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT, "both": WD_ALIGN_PARAGRAPH.JUSTIFY}


def load_profile(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ low-level XML helpers
def ordered_set(parent, el, order):
    """Replace parent's child with el's tag, inserting at the schema position given by `order`."""
    tag = el.tag.split("}")[1]
    for old in parent.findall(qn("w:" + tag)):
        parent.remove(old)
    idx = order.index(tag)
    after = [qn("w:" + t) for t in order[idx + 1:]]
    for i, child in enumerate(list(parent)):
        if child.tag in after:
            parent.insert(i, el)
            return el
    parent.append(el)
    return el


def mk(tag, **attrs):
    e = OxmlElement("w:" + tag)
    for k, v in attrs.items():
        e.set(qn("w:" + k), str(v))
    return e


def set_fonts(rpr, name):
    f = rpr.find(qn("w:rFonts"))
    if f is None:
        f = mk("rFonts")
        rpr.insert(0, f)
    for a in list(f.attrib):
        del f.attrib[a]
    for k in ("ascii", "hAnsi", "cs", "eastAsia"):
        f.set(qn("w:" + k), name)


def rpr_put(rpr, tag, **attrs):
    for old in rpr.findall(qn("w:" + tag)):
        rpr.remove(old)
    rpr.append(mk(tag, **attrs))


def rpr_drop(rpr, *tags):
    for t in tags:
        for old in rpr.findall(qn("w:" + t)):
            rpr.remove(old)


def fmt_run(r, font=None, sz=None, bold=None, italic=None, color=None, plain_link=False):
    """Set fonts, size, weight, slant and colour on a w:r element (also those inside hyperlinks and fields)."""
    rpr = r.get_or_add_rPr()
    if font:
        set_fonts(rpr, font)
    if sz:
        rpr_put(rpr, "sz", val=sz)
        rpr_put(rpr, "szCs", val=sz)
    for flag, tags in ((bold, ("b", "bCs")), (italic, ("i", "iCs"))):
        if flag is True:
            for t in tags:
                rpr_put(rpr, t)
        elif flag is False:
            rpr_drop(rpr, *tags)
    if color:
        rpr_put(rpr, "color", val=color)
    if plain_link:  # table-of-contents entries: black, not underlined, like the reference
        rpr_drop(rpr, "rStyle")
        rpr_put(rpr, "u", val="none")


def runs_of(p_el):
    return list(p_el.iter(qn("w:r")))


def fmt_par(p_el, parent, align=None, before=None, after=None, line=None, left=None, first=None, keep_next=None):
    p = Paragraph(p_el, parent)
    pf = p.paragraph_format
    if align:
        pf.alignment = JC[align]
    if before is not None:
        pf.space_before = Twips(before)
    if after is not None:
        pf.space_after = Twips(after)
    if line is not None:
        pf.line_spacing = line / 240.0
    if left is not None:
        pf.left_indent = Twips(left)
    if first is not None:
        pf.first_line_indent = Twips(first)
    if keep_next is not None:
        pf.keep_with_next = keep_next
    return p


# ------------------------------------------------------------------ styles
def style_el(doc, name):
    try:
        return doc.styles[name].element
    except KeyError:
        return None


def restyle_style(doc, name, font=None, sz=None, bold=None, color=None, italic=None, before=None, after=None, line=None, align=None, indent_left=None):
    st = style_el(doc, name)
    if st is None:
        return
    rpr = st.find(qn("w:rPr"))
    if rpr is None:
        rpr = mk("rPr")
        # rPr goes after pPr in a style element
        ppr = st.find(qn("w:pPr"))
        (ppr.addnext(rpr) if ppr is not None else st.append(rpr))
    if font:
        set_fonts(rpr, font)
    if sz:
        rpr_put(rpr, "sz", val=sz)
        rpr_put(rpr, "szCs", val=sz)
    if bold is not None:
        rpr_drop(rpr, "b", "bCs")
        if bold:
            rpr.append(mk("b"))
            rpr.append(mk("bCs"))
    if italic is not None:
        rpr_drop(rpr, "i", "iCs")
        if italic:
            rpr.append(mk("i"))
    if color:
        rpr_drop(rpr, "color")
        rpr.append(mk("color", val=color))
    s = doc.styles[name]
    pf = s.paragraph_format
    if before is not None:
        pf.space_before = Twips(before)
    if after is not None:
        pf.space_after = Twips(after)
    if line is not None:
        pf.line_spacing = line / 240.0
    if align:
        pf.alignment = JC[align]
    if indent_left is not None:
        pf.left_indent = Twips(indent_left)


def apply_styles(doc, P):
    F, S, C, SP = P["fonts"], P["sizes"], P["colors"], P["spacing"]
    restyle_style(doc, "Normal", font=F["body"], sz=22)
    restyle_style(doc, "Heading 1", font=F["heading"], sz=S["h1"], bold=True, color=C["h1"], before=SP["h1"]["before"], after=SP["h1"]["after"])
    restyle_style(doc, "Heading 2", font=F["heading"], sz=S["h2"], bold=True, color=C["h2"], before=SP["h2"]["before"], after=SP["h2"]["after"])
    restyle_style(doc, "TOC Heading", font=F["body"], sz=S["tocHeading"], bold=True, color=C["tocHeading"])
    restyle_style(doc, "toc 1", font=F["toc"], sz=S["toc1"], bold=True, after=60)
    restyle_style(doc, "toc 2", font=F["toc"], sz=S["toc2"], bold=True, after=40)
    restyle_style(doc, "Body Text", font=F["body"], sz=S["body"], align="both", after=SP["body"]["after"], line=SP["body"]["line"])
    restyle_style(doc, "Header", font=F["header"], sz=S["header"], color=C["headerText"])
    restyle_style(doc, "Footer", font=F["footer"], sz=S["footer"])


# ------------------------------------------------------------------ tables
def tc_list(tr):
    return tr.findall(qn("w:tc"))


def span_of(tc):
    pr = tc.find(qn("w:tcPr"))
    g = pr.find(qn("w:gridSpan")) if pr is not None else None
    return int(g.get(qn("w:val"))) if g is not None else 1


def tc_text(tc):
    return "".join(t.text or "" for t in tc.iter(qn("w:t"))).strip()


def set_geometry(tbl, P, widths, indent, align=None):
    """Fixed layout, explicit widths, borders and cell padding, so columns never collapse and words are not broken."""
    T = P["tables"]
    pr = tbl._tbl.tblPr
    ordered_set(pr, mk("tblW", w=sum(widths), type="dxa"), TBLPR_ORDER)
    for old in pr.findall(qn("w:jc")):
        pr.remove(old)
    if align:
        ordered_set(pr, mk("jc", val=align), TBLPR_ORDER)
    ordered_set(pr, mk("tblInd", w=indent, type="dxa"), TBLPR_ORDER)
    b = mk("tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b.append(mk(side, val=T["border"]["style"], sz=T["border"]["size"], space=0, color=P["colors"]["border"]))
    ordered_set(pr, b, TBLPR_ORDER)
    ordered_set(pr, mk("tblLayout", type="fixed"), TBLPR_ORDER)
    m = mk("tblCellMar")
    for side in ("top", "left", "bottom", "right"):
        m.append(mk(side, w=T["cellMargins"][side], type="dxa"))
    ordered_set(pr, m, TBLPR_ORDER)
    grid = tbl._tbl.find(qn("w:tblGrid"))
    for g in list(grid):
        grid.remove(g)
    for w in widths:
        grid.append(mk("gridCol", w=w))
    for tr in tbl._tbl.findall(qn("w:tr")):
        col = 0
        for tc in tc_list(tr):
            span = span_of(tc)
            ordered_set(tc.get_or_add_tcPr(), mk("tcW", w=sum(widths[col:col + span]), type="dxa"), TCPR_ORDER)
            col += span


def set_fill(tc, hex_fill):
    pr = tc.get_or_add_tcPr()
    if hex_fill:
        ordered_set(pr, mk("shd", val="clear", color="auto", fill=hex_fill), TCPR_ORDER)
    else:
        for old in pr.findall(qn("w:shd")):
            pr.remove(old)


def set_valign(tc, v="center"):
    ordered_set(tc.get_or_add_tcPr(), mk("vAlign", val=v), TCPR_ORDER)


def style_cell(tc, parent, font, sz, bold=None, color=None, align=None, SP=None, italic=None):
    SP = SP or {"before": 30, "after": 30}
    for p_el in tc.findall(qn("w:p")):
        fmt_par(p_el, parent, align=align, before=SP["before"], after=SP["after"], line=240)
        for r in runs_of(p_el):
            fmt_run(r, font=font, sz=sz, bold=bold, italic=italic, color=color)


def row_flags(tr, header=False, cant_split=False):
    pr = tr.find(qn("w:trPr"))
    if pr is None:
        pr = mk("trPr")
        tc0 = tr.find(qn("w:tc"))
        tc0.addprevious(pr) if tc0 is not None else tr.append(pr)
    for tag, on in (("cantSplit", cant_split), ("tblHeader", header)):
        for old in pr.findall(qn("w:" + tag)):
            pr.remove(old)
        if on:
            pr.append(mk(tag))


def table_kind(tbl):
    rows = tbl._tbl.findall(qn("w:tr"))
    first = tc_text(tc_list(rows[0])[0]) if rows else ""
    ncols = len(tbl._tbl.find(qn("w:tblGrid")))
    if first == "STATUS":
        return "finding"
    if first.startswith("S. No") and ncols >= 5:
        return "checklist"
    if first.startswith("Sr. No") or first.startswith("S. No"):
        return "summary"
    if first in ("OPEN", "CLOSED") and ncols == 2:
        return "legend"
    return "kv"


def status_look(text):
    """(fill, text colour) for an OPEN / CLOSED status cell."""
    t = text.strip().upper()
    if t.startswith("CLOSED"):
        return "00B050", "000000"
    if t.startswith("OPEN"):
        return "EE0000", "FFFFFF"
    return None, None


def style_kv(tbl, doc, P):
    F, S, C, SP = P["fonts"], P["sizes"], P["colors"], P["spacing"]
    T = P["tables"]["kv"]
    set_geometry(tbl, P, T["widths"], T["indent"])
    for tr in tbl._tbl.findall(qn("w:tr")):
        tcs = tc_list(tr)
        if len(tcs) == 1 or (len(tcs) == 2 and tc_text(tcs[0]) == tc_text(tcs[1]) and tc_text(tcs[0])):
            for tc in tcs[:1]:  # merged header band
                set_fill(tc, C["tableHeaderFill"])
                set_valign(tc)
                style_cell(tc, doc._body, F["table"], S["kv"], bold=True, color=C["tableHeaderText"], align="center", SP=SP["cell"])
            continue
        for i, tc in enumerate(tcs):
            set_fill(tc, None)
            set_valign(tc)
            style_cell(tc, doc._body, F["table"], S["kv"], bold=(i == 0), color=None, align="left", SP=SP["cell"])


def style_legend(tbl, doc, P):
    F, S, SP = P["fonts"], P["sizes"], P["spacing"]
    T = P["tables"]["legend"]
    set_geometry(tbl, P, T["widths"], T["indent"])
    for tr in tbl._tbl.findall(qn("w:tr")):
        tcs = tc_list(tr)
        for i, tc in enumerate(tcs):
            set_valign(tc)
            if i == 0:
                fill, colr = status_look(tc_text(tc))
                if fill:
                    set_fill(tc, fill)
                style_cell(tc, doc._body, F["table"], S["kv"], bold=True, color=colr, align="center", SP=SP["cell"])
            else:
                style_cell(tc, doc._body, F["table"], S["kv"], bold=False, align="left", SP=SP["cell"])


def style_summary(tbl, doc, P):
    F, S, C, SP = P["fonts"], P["sizes"], P["colors"], P["spacing"]
    T = P["tables"]["summary"]
    set_geometry(tbl, P, T["widths"], T["indent"], T.get("align"))
    for ri, tr in enumerate(tbl._tbl.findall(qn("w:tr"))):
        row_flags(tr, header=(ri == 0), cant_split=True)
        for i, tc in enumerate(tc_list(tr)):
            set_valign(tc)
            if ri == 0:
                set_fill(tc, C["tableHeaderFill"])
                style_cell(tc, doc._body, F["table"], S["tableHeader"], bold=True, color=C["tableHeaderText"], align="center", SP=SP["cell"])
            elif i == 2:
                fill, colr = status_look(tc_text(tc))
                if fill:
                    set_fill(tc, fill)
                style_cell(tc, doc._body, F["table"], S["kv"], bold=True, color=colr, align="center", SP=SP["cell"])
            else:
                style_cell(tc, doc._body, F["table"], S["kv"], bold=False, align="center" if i == 0 else "left", SP=SP["cell"])


def style_checklist(tbl, doc, P):
    F, S, C, SP = P["fonts"], P["sizes"], P["colors"], P["spacing"]
    T = P["tables"]["checklist"]
    set_geometry(tbl, P, T["widths"], T["indent"], T.get("align"))
    cell = {"before": 20, "after": 20}
    for ri, tr in enumerate(tbl._tbl.findall(qn("w:tr"))):
        tcs = tc_list(tr)
        row_flags(tr, header=(ri == 0), cant_split=True)
        merged = len(tcs) == 1 or (len(tcs) > 1 and len({tc_text(t) for t in tcs}) == 1 and tc_text(tcs[0]))
        if ri == 0:
            for tc in tcs:
                set_fill(tc, C["tableHeaderFill"])
                set_valign(tc)
                style_cell(tc, doc._body, F["table"], S["checklistHeader"], bold=True, color=C["tableHeaderText"], align="center", SP=cell)
        elif merged:  # category row ("A. Colours")
            for tc in tcs:
                set_fill(tc, C["categoryFill"])
                set_valign(tc)
                style_cell(tc, doc._body, F["table"], S["checklistCategory"], bold=True, color=C["categoryText"], align="left", SP=cell)
        else:
            for i, tc in enumerate(tcs):
                set_fill(tc, None)
                set_valign(tc)
                if i == 4:
                    colr = C["verdict"].get(tc_text(tc))
                    style_cell(tc, doc._body, F["table"], S["checklist"], bold=True, color=colr, align="center", SP=cell)
                else:
                    style_cell(tc, doc._body, F["table"], S["checklist"], bold=False, color=None, align="center" if i in (0, 2) else "left", SP=cell)


def split_caption(p_el):
    """'Figure 3: text' -> bold-italic 'Figure 3:' + italic text, like the reference's 'POC 11.1.1:' captions."""
    runs = [r for r in p_el.iter(qn("w:r")) if r.find(qn("w:t")) is not None]
    full = "".join((r.find(qn("w:t")).text or "") for r in runs)
    m = re.match(r"^(Figure\s*\d*\s*:)\s*", full)
    if not m or not runs:
        return
    label, rest = m.group(1) + " ", full[m.end():]
    first = runs[0]
    for r in runs[1:]:
        r.getparent().remove(r)
    first.find(qn("w:t")).text = label
    first.find(qn("w:t")).set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    second = __import__("copy").deepcopy(first)
    second.find(qn("w:t")).text = rest
    second.find(qn("w:t")).set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    first.addnext(second)
    second.set("dbimCaptionBody", "1") if False else None
    p_el.set("{http://schemas.microsoft.com/office/word/2010/wordml}dummy", "") if False else None
    return first, second


def style_finding(tbl, doc, P):
    F, S, C, SP = P["fonts"], P["sizes"], P["colors"], P["spacing"]
    T = P["tables"]["finding"]
    set_geometry(tbl, P, T["widths"], T["indent"])
    justified = ("DESCRIPTION", "IMPACT", "RECOMMENDATIONS", "RETEST REMARK")
    for tr in tbl._tbl.findall(qn("w:tr")):
        tcs = tc_list(tr)
        if len(tcs) < 2:
            continue
        label = tc_text(tcs[0])
        set_fill(tcs[0], C["labelFill"])
        set_valign(tcs[0])
        style_cell(tcs[0], doc._body, F["table"], S["findingLabel"], bold=True, color="000000", align="left", SP=SP["cell"])
        v = tcs[1]
        if label == "STATUS":
            fill, colr = status_look(tc_text(v))
            set_fill(v, fill)
            set_valign(v)
            style_cell(v, doc._body, F["table"], S["finding"], bold=True, color=colr, align="left", SP=SP["cell"])
            continue
        set_fill(v, None)
        set_valign(v, "center")
        if label == "PROOF OF CONCEPT":
            for p_el in v.findall(qn("w:p")):
                text = "".join(t.text or "" for t in p_el.iter(qn("w:t"))).strip()
                has_img = p_el.find(".//" + qn("w:drawing")) is not None
                if has_img:
                    fmt_par(p_el, doc._body, align="center", before=60, after=0, line=240)
                elif text:
                    fmt_par(p_el, doc._body, align="center", before=SP["caption"]["before"], after=SP["caption"]["after"], line=240)
                    for r in runs_of(p_el):
                        fmt_run(r, font=F["table"], sz=S["caption"], italic=True, color=C["caption"], bold=False)
                    parts = split_caption(p_el)
                    if parts:
                        fmt_run(parts[0], font=F["table"], sz=S["caption"], italic=True, bold=True, color=C["caption"])
            continue
        style_cell(v, doc._body, F["table"], S["finding"], bold=False, color=None, align="both" if label in justified else "left", SP=SP["cell"])


STYLERS = {"kv": style_kv, "legend": style_legend, "summary": style_summary, "checklist": style_checklist, "finding": style_finding}


# ------------------------------------------------------------------ body text, headings, cover, TOC
def style_body(doc, P):
    F, S, C, SP, IND = P["fonts"], P["sizes"], P["colors"], P["spacing"], P["indent"]
    body = doc.element.body
    non_empty, in_findings, seen_heading = 0, False, False
    for el in list(body):
        if el.tag != qn("w:p"):
            continue
        p = Paragraph(el, doc._body)
        text = p.text.strip()
        style = p.style.name if p.style is not None else "Normal"
        low = style.lower()
        if style == "Heading 1":
            seen_heading = True
            in_findings = text.lower().startswith(("8.", "11.")) and "detailed" in text.lower()
            fmt_par(el, doc._body, before=SP["h1"]["before"], after=SP["h1"]["after"])
            for r in runs_of(el):
                fmt_run(r, font=F["heading"], sz=S["h1"], bold=True, color=C["h1"])
        elif style == "Heading 2":
            seen_heading = True
            if in_findings:
                fmt_par(el, doc._body, before=SP["h2"]["before"], after=SP["h2"]["after"], left=IND["h2Finding"], first=0)
            else:
                fmt_par(el, doc._body, before=SP["h2"]["before"], after=SP["h2"]["after"], left=0, first=IND["h2"])
            for r in runs_of(el):
                fmt_run(r, font=F["heading"], sz=S["h2"], bold=True, color=C["h2"])
        elif style == "TOC Heading":
            for r in runs_of(el):
                fmt_run(r, font=F["body"], sz=S["tocHeading"], bold=True, color=C["tocHeading"])
        elif low.startswith("toc"):
            level2 = low.endswith("2")
            for r in runs_of(el):
                fmt_run(r, font=F["toc"], sz=S["toc2" if level2 else "toc1"], bold=True, color="000000", plain_link=True)
        elif text and not seen_heading and non_empty < len(SP["cover"]):
            idx = non_empty
            non_empty += 1
            navy = idx < 4
            fmt_par(el, doc._body, align="center", before=SP["cover"][idx])
            for r in runs_of(el):
                fmt_run(r, font=F["cover"], sz=S["coverDate"] if idx == 6 else S["coverTitle"], bold=True, color=C["coverTitle"] if navy else C["coverPlain"])
        elif text.upper() in ("THE END", "OF", "DOCUMENT"):
            for r in runs_of(el):
                fmt_run(r, font=F["cover"], sz=S["coverTitle"], bold=True, color=C["coverTitle"])
        elif text:
            if text.startswith("•"):
                fmt_par(el, doc._body, align="left", after=SP["bullet"]["after"], line=SP["bullet"]["line"])
                size = S["bullet"]
            else:
                fmt_par(el, doc._body, align="both", after=SP["body"]["after"], line=SP["body"]["line"])
                size = S["body"]
            for r in runs_of(el):
                fmt_run(r, font=F["body"], sz=size, color=None)


# ------------------------------------------------------------------ page: header, footer, watermark, border
def style_page(doc, P, meta):
    F, S, C = P["fonts"], P["sizes"], P["colors"]
    sec = doc.sections[0]
    sec.different_first_page_header_footer = True  # cover page: watermark only, no footer (like the reference)
    sp = sec._sectPr
    if P["page"].get("border"):
        for old in sp.findall(qn("w:pgBorders")):
            sp.remove(old)
        b = mk("pgBorders", display="notFirstPage", offsetFrom="page")
        for side in ("top", "left", "bottom", "right"):
            b.append(mk(side, val=P["page"]["border"]["style"], sz=P["page"]["border"]["size"], space=P["page"]["border"]["space"], color="auto"))
        pg_mar = sp.find(qn("w:pgMar"))
        pg_mar.addnext(b)

    # default header: drop the watermark (it stays on the first-page header), fill the placeholders
    hdr = sec.header
    org, level = meta.get("organisation") or "", meta.get("level") or 1
    for p in hdr.paragraphs:
        for r in list(p._p.findall(qn("w:r"))):
            if r.find(qn("w:pict")) is not None or r.find(qn("w:drawing")) is not None:
                if P["page"].get("watermarkFirstPageOnly"):
                    p._p.remove(r)
        text = "".join(t.text or "" for t in p._p.iter(qn("w:t")))
        if "[ORG]" in text or "DBIM Level" in text:
            for r in list(p._p.findall(qn("w:r"))):
                p._p.remove(r)
            run = p.add_run(f"{org} – DBIM Level-{level} Test Report" if org else f"DBIM Level-{level} Test Report")
            fmt_run(run._r, font=F["header"], sz=S["header"], color=C["headerText"], bold=False)
            p.paragraph_format.alignment = JC["center"]
    # footer: same family as the reference (Times New Roman)
    for p in sec.footer.paragraphs:
        for r in runs_of(p._p):
            fmt_run(r, font=F["footer"], sz=S["footer"])


def apply_profile(doc, P, meta=None):
    meta = meta or {}
    apply_styles(doc, P)
    style_body(doc, P)
    for tbl_el in list(doc.element.body.findall(qn("w:tbl"))):
        tbl = Table(tbl_el, doc._body)
        STYLERS[table_kind(tbl)](tbl, doc, P)
    style_page(doc, P, meta)
