"""Versioned, explicit import contract. Field names follow the researcher Rev1 mapping."""

from __future__ import annotations

import io
from datetime import date, datetime
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

# One row per entity/observation. Batch metadata repeats only for another activation lot.
SHEETS = {
    "experiment_batch": (
        "batch_code experiment_date site operator treatment_group donor_strain donor_preparation "
        "donor_derivation donor_batch_code lot_no activated_at n_activated"
    ).split(),
    "embryo": "batch_code lot_no embryo_code seq_in_lot well_position exit_stage exit_reason exit_at".split(),
    "clone_fish": (
        "fish_code embryo_code dob donor_strain donor_preparation donor_derivation donor_batch_code status "
        "biological_condition first_abnormal_on sex site fish_box fin_clipped exit_date exit_reason remarks"
    ).split(),
    "embryo_observation": "embryo_code stage observed_at outcome biological_condition observer".split(),
    "fish_observation": "fish_code observed_on outcome biological_condition observer".split(),
    "control_arm_count": "batch_code arm_type stage n_normal n_abnormal".split(),
    "specimen": "specimen_code fish_code specimen_kind specimen_type collected_on frozen_on storage".split(),
}
REQUIRED = {
    "experiment_batch": set(SHEETS["experiment_batch"]) - {"donor_batch_code"},
    "embryo": {"batch_code", "lot_no", "seq_in_lot"},
    "clone_fish": {"fish_code", "status", "biological_condition", "sex"},
    "embryo_observation": set(SHEETS["embryo_observation"]),
    "fish_observation": set(SHEETS["fish_observation"]),
    "control_arm_count": set(SHEETS["control_arm_count"]),
    "specimen": {"specimen_code", "fish_code", "specimen_kind", "specimen_type"},
}
ENUMS = {
    "donor_preparation": ["DISSOCIATED", "CHUNKS", "UNKNOWN"],
    "donor_derivation": ["FRESH", "CRYOPRESERVED", "UNKNOWN"],
    "biological_condition": ["NORMAL", "ABNORMAL", "UNDETERMINED"],
    "sex": ["M", "F", "UNKNOWN"],
    "status": ["ALIVE", "DEAD", "FROZEN", "DISCARDED", "UNKNOWN"],
    "outcome": ["ALIVE", "DEAD", "NOT_OBSERVED"],
    "specimen_kind": ["CL", "CLA", "RT", "DC"],
    "specimen_type": ["WHOLE_EMBRYO", "CAUDAL_FIN_CLIP", "ANAL_FIN_CLIP", "LEFTOVER_CELLS", "WHOLE_ADULT", "UNKNOWN"],
    "arm_type": ["NATURAL_BREEDING", "IVF"],
    "fin_clipped": ["true", "false"],
    "storage": ["-20", "-80"],
}


def template_bytes(state: Any) -> bytes:
    book = Workbook()
    guide = book.active
    guide.title = "Instructions"
    for row in [
        ["KUVTH import template v1", "วิธีกรอก"],
        ["Headers", "ใช้ชื่อ column และชื่อ sheet เดิมตาม Rev1 ห้ามเปลี่ยนชื่อ ห้ามใส่สูตร"],
        ["Rows", "แถว 1 เป็นชื่อ column เริ่มกรอกแถว 2 ลบหรือเว้นว่าง sheet ที่ไม่ใช้ได้"],
        ["Required", "หัว column สีส้มต้องมีค่า ยกเว้น field ที่ระบบหาได้จาก embryo_code"],
        ["Order", "ระบบเชื่อม batch_code + lot_no → embryo_code → fish_code → specimen_code"],
        ["experiment_batch", "1 แถวต่อ activation lot ใช้ batch_code เดิมเมื่อเป็นการทดลองเดียวกัน"],
        ["embryo", "1 แถวต่อเอ็มบริโอที่ติดตาม ไม่สร้างเอ็มบริโอจากยอด n_activated อัตโนมัติ"],
        ["embryo_code", "เว้นได้ ระบบสร้าง {batch_code}_{lot_no}_{seq_in_lot} ใช้รหัสนี้ใน sheet อ้างอิง"],
        ["clone_fish", "dob และ donor ต้องมีถ้าไม่ระบุ embryo_code; running_no และ ID ระบบสร้างให้"],
        ["donor", "เลือก donor ที่มีอยู่จาก Reference ให้ตรง strain/preparation/derivation/batch_code"],
        ["Master data", "site/operator/observer/treatment_group/fish_box ต้องตรง Reference เพิ่มผ่านระบบก่อน import"],
        ["Dates", "YYYY-MM-DD; เวลา YYYY-MM-DD HH:MM[:SS] ใช้ timezone ของ site; observed_on เป็นวันไทย"],
        ["Unknown", "ไม่ทราบเพศใช้ UNKNOWN (ND ใน Rev1); ไม่ทราบสถานะใช้ UNKNOWN ห้ามอนุมานจากผลเก่า"],
        ["Outcomes", "ใช้ ALIVE/DEAD ฯลฯ ตาม dropdown ห้ามใช้ 0/1 เพราะ mapping เดิมขัดกัน"],
        ["Conditions", "biological_condition = NORMAL/ABNORMAL/UNDETERMINED ไม่ใช่ข้อความสุขภาพอิสระ"],
        ["Exit", "ปลา DEAD/FROZEN/DISCARDED ต้องมี exit_date และ exit_reason ตรงกับ status"],
        ["QC", "NBD ใน Rev1 ใช้ NATURAL_BREEDING; จำนวน QC เป็นยอดรวม ไม่สร้างเอ็มบริโอรายตัว"],
        ["Specimens", "specimen_kind คือกลุ่มรหัส CL/CLA/RT/DC; specimen_type คือวัสดุตัวอย่าง"],
        ["Safety", "ตรวจทุกแถวก่อนยืนยัน ถ้าผิดจะไม่บันทึกบางส่วน ไม่ทับรายการเดิมหรือข้ามแถวเงียบ ๆ"],
    ]:
        guide.append(row)
    for name, fields in REQUIRED.items():
        guide.append([f"Required: {name}", ", ".join(sorted(fields))])
    for name, columns in SHEETS.items():
        sheet = book.create_sheet(name)
        sheet.append(columns)
        for index, field in enumerate(columns, 1):
            values = ENUMS.get(field)
            if field == "outcome":
                values = (values or []) + (["DEGENERATED"] if name == "embryo_observation" else ["FROZEN", "DISCARDED"])
            if values:
                validation = DataValidation(type="list", formula1='"' + ",".join(values) + '"')
                validation.errorTitle = "Invalid value"
                validation.error = "Choose a value from the list"
                validation.showErrorMessage = True
                validation.errorStyle = "stop"
                sheet.add_data_validation(validation)
                validation.add(f"{sheet.cell(1, index).column_letter}2:{sheet.cell(1, index).column_letter}20000")
            sheet.cell(1, index).fill = PatternFill("solid", fgColor="B45309" if field in REQUIRED[name] else "24564D")
            sheet.column_dimensions[sheet.cell(1, index).column_letter].width = max(22, len(field) + 3)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
    reference = book.create_sheet("Reference")
    reference.append(["resource", "code / name", "preparation", "donor_derivation", "donor_batch_code", "time_zone"])
    for resource, key in [
        ("sites", "code"),
        ("operators", "name"),
        ("treatment-groups", "code"),
        ("fish-boxes", "boxCode"),
        ("donor-cell-lines", "strain"),
    ]:
        for item in state.entities[resource].values():
            if item.get("active") is False or item.get("deletedAt"):
                continue
            reference.append(
                [
                    resource,
                    item.get(key),
                    item.get("preparation"),
                    item.get("preservation"),
                    item.get("batchCode"),
                    item.get("timeZone"),
                ]
            )
    reference.append(["stage", "Use short labels below"])
    profiles = [p for p in state.entities["timing-profiles"].values() if p.get("isCurrent") and not p.get("deletedAt")]
    for entry in profiles[0].get("entries", []) if profiles else []:
        reference.append(["stage", entry.get("shortLabel"), entry.get("stageCode"), entry.get("stageScope")])
    for sheet in book:
        sheet.freeze_panes = "A2"
        for cell in sheet[1]:
            cell.font = Font(name="Tahoma", bold=True, color="FFFFFF", size=11)
            if cell.fill.patternType is None:
                cell.fill = PatternFill("solid", fgColor="24564D")
        sheet.row_dimensions[1].height = 30
    guide.column_dimensions["A"].width = 25
    guide.column_dimensions["B"].width = 110
    for row in guide.iter_rows(min_row=2):
        guide.row_dimensions[row[0].row].height = 38
        for cell in row:
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            cell.font = Font(name="Tahoma", size=11)
    for column in "ABCDEF":
        reference.column_dimensions[column].width = 28
    for row in reference:
        for cell in row:
            if isinstance(cell.value, str):
                cell.data_type = "s"
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def parse_template(name: str, matrix: list, sheet: Any) -> None:
    """Validate headers without losing unknown columns or source coordinates."""
    from .import_sources import SourceIssue, SourceRecord

    if not matrix:
        return
    headers = [str(value).strip() if value is not None else "" for value in matrix[0]]
    populated = any(any(v not in (None, "") for v in row) for row in matrix[1:])
    if not populated:
        return
    unknown = [h for h in headers if h and (h not in SHEETS[name] or headers.count(h) > 1)]
    missing = REQUIRED[name] - set(headers)
    if unknown or missing:
        sheet.issues.append(
            SourceIssue(
                "blocking",
                "template_headers",
                f"Unknown/duplicate columns: {unknown}; missing columns: {sorted(missing)}",
                name,
                1,
            )
        )
    for row_no, row in enumerate(matrix[1:], 2):
        if not any(v not in (None, "") for v in row):
            continue
        values = {}
        for index, value in enumerate(row):
            if value in (None, ""):
                continue
            if index >= len(headers) or not headers[index]:
                sheet.issues.append(
                    SourceIssue("blocking", "template_headers", "Value without a column name", name, row_no)
                )
                continue
            values[headers[index]] = value.isoformat() if isinstance(value, (date, datetime)) else value
        sheet.records.append(SourceRecord(name, f"A{row_no}", row_no, f"schema:{name}", values, dict(values)))
    sheet.row_count = len(sheet.records)
