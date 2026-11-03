"""Fill the Levithan DBIM report template from a JSON payload produced by `dbim report`.

usage: python fill_template.py payload.json
The payload carries every string to insert; this script only edits the .docx (python-docx).
"""
import copy
import json
import sys

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches
from docx.table import Table
from docx.text.paragraph import Paragraph

CAT_ROW = lambda row: len({c.text.strip() for c in row.cells}) == 1


def set_par_text(par, text):
    """Replace a paragraph's text, keeping the first run's formatting."""
    runs = par.runs
    if not runs:
        par.add_run(text)
        return
    runs[0].text = text
    for r in runs[1:]:
        r._element.getparent().remove(r._element)


def set_cell(cell, text):
    pars = cell.paragraphs
    set_par_text(pars[0], text)
    for p in pars[1:]:
        p._element.getparent().remove(p._element)


def set_cell_lines(cell, lines):
    """One paragraph per line, cloning the first paragraph's formatting."""
    pars = cell.paragraphs
    proto = copy.deepcopy(pars[0]._element)
    for p in pars:
        p._element.getparent().remove(p._element)
    for ln in lines or [""]:
        el = copy.deepcopy(proto)
        cell._element.append(el)
        set_par_text(Paragraph(el, cell), ln)


def find_par(d, pred):
    for p in d.paragraphs:
        if pred(p.text):
            return p
    return None


def main(path):
    P = json.load(open(path, encoding="utf-8"))
    m = P["meta"]
    d = docx.Document(P["template"])
    T = d.tables
    left = []  # placeholders still unfilled, reported back to the CLI

    def put(cell, value, label):
        if value:
            set_cell(cell, value)
        else:
            left.append(label)

    # ---- cover
    for p in d.paragraphs[:20]:
        if p.text.startswith("LEVEL"):
            set_par_text(p, f"LEVEL – {m['level']}  TEST REPORT")
        elif p.text == "[ORGANISATION NAME]":
            set_par_text(p, m["organisation"].upper() if m["organisation"] and not m["organisation"].startswith("[") else p.text)
            if p.text.startswith("["):
                left.append("organisation")
        elif p.text == "[Month DD, YYYY]":
            set_par_text(p, P["today"])

    # ---- key/value tables
    t0 = T[0]
    set_cell(t0.rows[0].cells[1], f"DBIM Guidelines Level – {m['level']} Test Report")
    put(t0.rows[1].cells[1], m["organisation"] if not m["organisation"].startswith("[") else "", "organisation")
    put(t0.rows[2].cells[1], m["application"] if not m["application"].startswith("[") else "", "application")
    set_cell(t0.rows[3].cells[1], m["version"])
    put(t0.rows[4].cells[1], m["jobReceived"], "jobReceived")
    put(t0.rows[5].cells[1], m["reportNo"] if "[" not in m["reportNo"] else "", "reportNo")
    set_cell(t0.rows[6].cells[1], P["today"])
    t1 = T[1]
    set_cell(t1.rows[1].cells[1], P["today"])
    put(t1.rows[3].cells[1], m["submittedTo"]["name"], "submittedTo.name")
    put(t1.rows[4].cells[1], m["submittedTo"]["address"], "submittedTo.address")
    put(t1.rows[5].cells[1], m["submittedTo"]["email"], "submittedTo.email")
    t3 = T[3]
    put(t3.rows[1].cells[1], m["application"] if not m["application"].startswith("[") else "", "application")
    set_cell(t3.rows[2].cells[1], P["site"])
    t4 = T[4]
    put(t4.rows[1].cells[1], m["startDate"], "startDate")
    put(t4.rows[2].cells[1], m["endDate"], "endDate")

    # ---- text sections
    p = find_par(d, lambda t: t.startswith("[State any constraints"))
    if p:
        set_par_text(p, P["constraints"])
    p = find_par(d, lambda t: "axe-core 4.10.2" in t)
    if p and P.get("axeVersion"):
        set_par_text(p, p.text.replace("4.10.2", P["axeVersion"]))
    p = find_par(d, lambda t: "Digital Brand Identity Manual (DBIM) Version 3.0" in t)
    if p and not P["ministry"]:
        set_par_text(p, "•   Digital Brand Identity Manual (DBIM) Version 3.0 (January 2025) – Section F, Compliance Matrix: Generic Checklist (46 items), applicable to all types of government organisations.")
    elif p:
        set_par_text(p, p.text.replace(" [Delete (ii) if the Ministry checklist is not applicable.]", ""))

    # ---- checklists
    def fill_checklist(tbl, rows):
        for row in tbl.rows[1:]:
            if CAT_ROW(row):
                continue
            no = int(row.cells[0].text.strip())
            r = rows.get(str(no))
            if not r:
                continue
            set_cell(row.cells[3], r["remarks"])
            set_cell(row.cells[4], r["compliance"])

    fill_checklist(T[6], P["generic"])
    note = find_par(d, lambda t: t.startswith("[Delete section 6.2"))
    h62 = find_par(d, lambda t: t.startswith("6.2 Ministry"))
    if P["ministry"]:
        fill_checklist(T[7], P["ministryRows"])
        if note:
            note._element.getparent().remove(note._element)
    else:
        for el in (h62, note):
            if el is not None:
                el._element.getparent().remove(el._element)
        T[7]._element.getparent().remove(T[7]._element)

    # ---- summary table
    findings = P["findings"]
    st = T[8]
    proto = copy.deepcopy(st.rows[1]._tr)
    for r in list(st.rows[1:]):
        st._tbl.remove(r._tr)
    rows = [(str(i + 1), f"8.{i + 1}  {f['title']}", f["status"]) for i, f in enumerate(findings)] or [("", "No non-compliance observed by the automated scan", "-")]
    for a, b, c in rows:
        tr = copy.deepcopy(proto)
        st._tbl.append(tr)
        row = Table(st._tbl, st._parent).rows[-1]
        set_cell(row.cells[0], a)
        set_cell(row.cells[1], b)
        set_cell(row.cells[2], c)

    # ---- detailed findings (section 8): clone the 8.1 block per finding
    body = d.element.body
    kids = list(body)
    def is_head(e, style, prefix):
        if e.tag != qn("w:p"):
            return False
        par = Paragraph(e, d._body)
        return par.style is not None and par.style.name == style and par.text.startswith(prefix)

    i81 = next(i for i, e in enumerate(kids) if is_head(e, "Heading 2", "8.1 "))
    i82 = next(i for i, e in enumerate(kids) if is_head(e, "Heading 2", "8.2 "))
    i9 = next(i for i, e in enumerate(kids) if is_head(e, "Heading 1", "9. General"))
    block = [copy.deepcopy(e) for e in kids[i81:i82]]
    # TOC bookmarks inside the prototype would be duplicated per finding (duplicate ids make Word offer to "repair")
    for e in block:
        for bm in list(e.iter(qn("w:bookmarkStart"), qn("w:bookmarkEnd"))):
            bm.getparent().remove(bm)
    for e in kids[i81:i9]:
        body.remove(e)
    anchor = kids[i9]

    def pic_into(cell, f):
        pars = cell.paragraphs
        pr = pars[0]
        for r in list(pr.runs):
            r._element.getparent().remove(r._element)
        if f.get("proof"):
            pr.add_run().add_picture(f["proof"]["file"], width=Inches(5.2))
            set_par_text(pars[1], f["proof"]["caption"]) if len(pars) > 1 else None
        else:
            pr.add_run("Screenshot not available for this finding.")
            if len(pars) > 1:
                set_par_text(pars[1], "")

    toc_entries = []
    if not findings:
        para = copy.deepcopy(block[0])
        anchor.addprevious(para)
        set_par_text(Paragraph(para, d._body), "No non-compliance observations were recorded by the automated scan.")
    for i, f in enumerate(findings):
        els = [copy.deepcopy(e) for e in block]
        for e in els:
            anchor.addprevious(e)
        head = Paragraph(els[0], d._body)
        set_par_text(head, f"8.{i + 1} {f['title']}")
        bm_name = f"_Toc9000{i + 1:03d}"
        bs = OxmlElement("w:bookmarkStart")
        bs.set(qn("w:id"), str(9000 + i))
        bs.set(qn("w:name"), bm_name)
        els[0].insert(1, bs)
        be = OxmlElement("w:bookmarkEnd")
        be.set(qn("w:id"), str(9000 + i))
        els[0].append(be)
        toc_entries.append((bm_name, f"8.{i + 1} {f['title']}"))
        tbl = Table(next(e for e in els if e.tag == qn("w:tbl")), d._body)
        r = tbl.rows
        set_cell(r[0].cells[1], f["status"])
        set_cell(r[1].cells[1], f["reference"])
        set_cell_lines(r[2].cells[1], f["description"])
        set_cell(r[3].cells[1], f["impact"])
        set_cell_lines(r[4].cells[1], f["urls"])
        set_cell(r[5].cells[1], f["recommendation"])
        if m["level"] == 1:
            tbl._tbl.remove(r[6]._tr)
            poc = tbl.rows[6]
        else:
            set_cell_lines(r[6].cells[1], f.get("retest") or ["Not retested."])
            poc = r[7]
        pic_into(poc.cells[1], f)

    # table of contents: replace the template's two sample entries (8.1, 8.2) with one per finding
    toc_pars = [Paragraph(e, d._body) for e in body if e.tag == qn("w:p")]
    toc_pars = [p for p in toc_pars if p.style is not None and p.style.name.startswith("toc")]
    samples = [p for p in toc_pars if p.text.startswith(("8.1 ", "8.2 "))]
    nine = next((p for p in toc_pars if p.text.startswith("9. General")), None)
    if samples and nine is not None:
        proto_toc = copy.deepcopy(samples[0]._element)
        for sp in samples:
            sp._element.getparent().remove(sp._element)
        for name, title in toc_entries:
            el = copy.deepcopy(proto_toc)
            hl = el.find(qn("w:hyperlink"))
            hl.set(qn("w:anchor"), name)
            ts = list(hl.iter(qn("w:t")))
            ts[0].text = title
            ts[-1].text = ""  # page number is filled when Word updates fields
            for it in hl.iter(qn("w:instrText")):
                it.text = f" PAGEREF {name} \\h "
            nine._element.addprevious(el)

    # ask Word to refresh the table of contents (headings changed) when the file is opened
    st_el = d.settings.element
    if st_el.find(qn("w:updateFields")) is None:
        uf = st_el.makeelement(qn("w:updateFields"), {qn("w:val"): "true"})
        # schema order: updateFields precedes hdrShapeDefaults, footnotePr, endnotePr, compat, docVars, rsids ...
        for tag in ("w:hdrShapeDefaults", "w:footnotePr", "w:endnotePr", "w:compat", "w:docVars", "w:rsids"):
            nxt = st_el.find(qn(tag))
            if nxt is not None:
                nxt.addprevious(uf)
                break
        else:
            st_el.append(uf)

    if P.get("style"):
        import os
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from style_profile import apply_profile, load_profile
        apply_profile(d, load_profile(P["style"]), P.get("meta"))

    d.save(P["out"])
    print(json.dumps({"saved": P["out"], "placeholdersLeft": left}))


if __name__ == "__main__":
    main(sys.argv[1])
