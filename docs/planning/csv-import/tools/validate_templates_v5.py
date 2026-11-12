"""Read-only checks for the three customer-facing v5 files."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from pypdf import PdfReader
from unicodedata import normalize
import re
from validate_templates_v4 import Q,values

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'v5'

def check():
    promotion_at=None
    for kind in ('experiment','registry'):
        with ZipFile(OUT/f'{kind}-template-v5.xlsx') as z:
            assert z.testzip() is None
            custom=E.fromstring(z.read('docProps/custom.xml'))
            assert {p.get('name'):p[0].text for p in custom}=={'template_version':'5','template_kind':kind}
            strings=[''.join(s.itertext()) for s in E.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
            sheets=[E.fromstring(z.read(f'xl/worksheets/sheet{i}.xml')) for i in (2,3,4)]
            d=[values(s,strings) for s in sheets]
            tables={}
            for name in z.namelist():
                if name.startswith('xl/tables/') and name.endswith('.xml'):
                    t=E.fromstring(z.read(name));tables[t.get('name')]=t.get('ref')
            assert tables==({'Lots':'A12:M62','Aggregate':'A67:AQ117'} if kind=='experiment' else {'Specimens':'A7:C207'})
            embryo=kind=='experiment';s=sheets[1 if embryo else 0];data=d[1 if embryo else 0]
            first,end,tag,helper=(8,1607,'F','D') if embryo else (9,808,'T','B')
            roles=['OUTCOME','TIME','CONDITION','OBSERVER'] if embryo else ['OUTCOME','CONDITION','DATE','OBSERVER']
            for row in range(first,end,4):assert [data[f'{tag}{row+i}'] for i in range(4)]==roles
            for addr in data:
                c=re.match('[A-Z]+',addr).group();r=int(re.search('[0-9]+',addr).group())
                if r>=first:assert c in (tag,helper),(kind,addr)
            cf=s.findall(Q('conditionalFormatting'));death=cf[0][0].find(Q('formula')).text
            assert cf[0].get('sqref')==('M8:AL1607' if embryo else 'Z9:OE808')
            cell='M8' if embryo else 'Z9'
            assert f'LEN({cell}&"")>0' in death and f'{cell}=0' in death and f'{cell}="0"' in death
            assert f'{cell}=1' not in death
            formulas=[r.find(Q('formula')).text for c in cf for r in c]
            assert any('NOT(IFERROR(' in f and 'UPPER(' in f for f in formulas)
            assert any('NOT(IFERROR(' in f and 'CODE(' in f for f in formulas) if embryo else True
            for sheet in sheets[:2]:
                assert all(v.get('showInputMessage')=='0' and v.get('showErrorMessage')=='1' for v in sheet.find(Q('dataValidations')))
                assert any('NOT(IFERROR(' in r.find(Q('formula')).text for c in sheet.findall(Q('conditionalFormatting')) for r in c)
            if embryo:
                rows={int(r.get('r')):r for r in sheets[0].find(Q('sheetData'))}
                assert all(rows[r].get('hidden')!='1' and rows[r].get('outlineLevel') is None for lo,hi in ((13,62),(68,117)) for r in range(lo,hi+1))
                assert d[0].get('N12') is None and d[2].get('N10') is None
                assert d[2]['M22']=='1' and d[2]['AE26']=='0'
                assert d[2]['I22']=='3D' and all(d[2][f'{c}22']=='1' for c in ('AH','AI','AJ'))
                assert float(d[2]['AH23'])<float(d[2]['AI23'])<float(d[2]['AJ23'])<float(d[2]['K22'])
                promotion_at=float(d[2]['K22'])
                assert any(c.get('sqref').startswith('AH9:AL9') for c in cf)
                assert any(c.get('sqref')=='AH9:AL1605' and c[0].find(Q('formula')).text=='AND($F9="TIME",LEN(AH8&"")>0,LEN(AH9&"")=0)' for c in cf)
                assert not any(v.find(Q('formula1')).text=='TRUE' for v in sheets[0].find(Q('dataValidations')))
            else:
                assert data['Z8']=='d1' and data['OE8']=='d370'
                assert all(f'{c}{r}' not in d[2] for r in range(10,14) for c in ('Z','AA','AB'))
                assert 'ไม่มีวันที่ตรวจ' in d[2]['S10']
                assert promotion_at is not None and float(d[2]['Z8'])>promotion_at
                assert d[2]['K6']==d[2]['AA8'] and d[2]['P6']==d[2]['AB8']
            print(kind+': v5 identity, blank forms, complete death ranges, paste-warning rules and examples checked')
    expected={'experiment-template-v5.xlsx','registry-template-v5.xlsx','คู่มือการกรอกข้อมูล-v5.pdf'}
    assert {p.name for p in OUT.iterdir()}==expected,'Delivery folder must contain only three files'
    pdf=PdfReader(OUT/'คู่มือการกรอกข้อมูล-v5.pdf')
    assert len(pdf.pages)==13 and all(len(p.extract_text().strip())>300 for p in pdf.pages)
    for index,heading in ((2,'การเตรียมข้อมูลจากไฟล์เดิม'),(3,'การเตรียมผลตรวจเอ็มบริโอ'),(4,'การเตรียมข้อมูลทะเบียนปลา')):
        assert normalize('NFKC',heading) in normalize('NFKC',pdf.pages[index].extract_text()),heading
    text=normalize('NFKC',''.join(p.extract_text() for p in pdf.pages))
    for word in ('ข้อมูล','คู่มือ','Frozen','Degenerated','Discarded','การทดลอง','ทะเบียนปลา','รอตรวจ:','ส่งไฟล์กลับมาได้เลยครับ','ไม่มีเครื่องหมาย','อย่าใส่ LOST','ช่องระยะที่ทำเครื่องหมาย','Day1','Legacy import','ไม่ทราบผู้ทำการทดลอง','Germ ring'):
        assert normalize('NFKC',word) in text,word
    assert not any(w in text for w in ('ร่างนำร่อง','ทีมจะแปลง','หมายเหตุของร่าง','pilot/','0 หรือ ALIVE = มีชีวิต'))
    assert '25/04/2026 13:00' in text and '27/04/2026 09:00' in text
    assert normalize('NFKC','วันที่กระตุ้น + n วัน') in text
    assert not any(normalize('NFKC',w) in text for w in ('รอยืนยันวิธีนับ','ไม่ทราบวันที่”'))
    assert not any(ord(c)<32 and c not in '\n\r\t' for c in text),'Control characters in PDF text'
    assert 'v5' in text and '28 ต.ค. 2026' in text
    assert not any(normalize('NFKC',w) in text for w in ('ผู้ดูแล','ยืนยันนำเข้า','ก่อนนำเข้า','วิธีกรอกในรุ่น','รุ่นของแบบฟอร์ม','แบบฟอร์มรุ่น 5','Power/Pulse/LED','คนทำ'))
    assert not re.search(normalize('NFKC','ผู้ทำ')+'(?!การทดลอง)',re.sub(r'\s+','',text))
    print('Manual: 13 searchable pages, three preparation sections, self-entry instructions, pending-review workflow; exactly three deliverables')

if __name__=='__main__':check()
