"""Read-only structural checks for the v4 customer delivery."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from pypdf import PdfReader
import openpyxl
import re

ROOT=Path(__file__).resolve().parents[1]
CURRENT=ROOT/'current'
Q=lambda s:'{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'+s

def values(sheet,strings):
    result={}
    for c in sheet.iter(Q('c')):
        if c.get('t')=='inlineStr':v=''.join(c.find(Q('is')).itertext())
        elif c.get('t')=='s':v=strings[int(c.find(Q('v')).text)]
        else:
            v=c.find(Q('v'));v=v.text if v is not None else None
        if v is not None:result[c.get('r')]=v
    return result

def check():
    ref=openpyxl.load_workbook(next((ROOT/'sources').glob('[[]Rev1[]]*')),read_only=True,data_only=True)
    source=ref['รายชื่อ stage']
    pairs=sorted((int(source.cell(r,c).value),re.match('[A-Z0-9]+',source.cell(r,c+1).value).group()) for r in range(4,22) for c in (1,3))
    stages=[s for _,s in pairs];ref.close()
    for kind in ('experiment','registry'):
        with ZipFile(CURRENT/f'{kind}-template-final.xlsx') as z:
            assert z.testzip() is None
            custom=E.fromstring(z.read('docProps/custom.xml'))
            assert {p.get('name'):p[0].text for p in custom}=={'template_version':'4','template_kind':kind}
            book=E.fromstring(z.read('xl/workbook.xml'))
            expected=['ข้อมูลการทดลอง','ผลเอ็มบริโอ','ตัวอย่าง'] if kind=='experiment' else ['ทะเบียนปลา','ตัวอย่างที่เก็บ','ตัวอย่าง']
            assert [s.get('name') for s in book.find(Q('sheets'))]==expected
            strings=[''.join(s.itertext()) for s in E.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
            tables={}
            for member in z.namelist():
                if member.startswith('xl/tables/') and member.endswith('.xml'):
                    t=E.fromstring(z.read(member));tables[t.get('name')]=t.get('ref')
            assert tables==({'Lots':'A12:N62','Aggregate':'A67:AQ117'} if kind=='experiment' else {'Specimens':'A7:C207'})
            sheets=[E.fromstring(z.read(f'xl/worksheets/sheet{i}.xml')) for i in (2,3,4)]
            data=[values(s,strings) for s in sheets]
            for d in data:
                assert not any(any(word in str(v) for word in ('NBD','IVF','ผลกลุ่มควบคุม')) for v in d.values())
            for sheet in sheets:
                for dv in sheet.findall('.//'+Q('dataValidation')):
                    assert dv.get('showInputMessage')=='0' and dv.get('showErrorMessage')=='1'
                assert not any('#REF!' in (f.text or '') for f in sheet.iter(Q('f')))
            embryo=kind=='experiment'
            matrix=sheets[1 if embryo else 0];d=data[1 if embryo else 0]
            start,count,tag,helper,last=(8,400,'F','D','AL') if embryo else (9,200,'T','B','OE')
            roles=['OUTCOME','TIME','CONDITION','OBSERVER'] if embryo else ['OUTCOME','CONDITION','DATE','OBSERVER']
            assert matrix.find(Q('dimension')).get('ref')==f'A1:{last}{start+count*4-1}'
            for base in range(start,start+count*4,4):
                assert [d[f'{tag}{base+i}'] for i in range(4)]==roles
            for c in matrix.iter(Q('c')):
                col=re.match('[A-Z]+',c.get('r')).group();rn=int(re.search('[0-9]+',c.get('r')).group())
                if rn>=start:
                    assert col in (tag,helper) or c.get('r') not in d,(kind,c.get('r'))
            validations=matrix.find(Q('dataValidations'))
            first='M' if embryo else 'Z'
            for base in (start,start+4*(count//2),start+4*(count-1)):
                assert any(f'{first}{base+3}:' in x.get('sqref','') and x.get('type')=='textLength' and x.find(Q('formula1')).text=='150' for x in validations)
            if embryo:
                exp=data[0];rows={int(r.get('r')):r for r in sheets[0].find(Q('sheetData'))}
                assert exp['A65']=='2. ยอดนับรวม (ตัว)'
                assert [exp[f'{openpyxl.utils.get_column_letter(c)}67'] for c in range(4,40)]==stages
                assert [d[f'{openpyxl.utils.get_column_letter(c)}7'] for c in range(13,39)]==stages[:26]
                for lo,hi in ((13,62),(68,117)):
                    assert all(rows[r].get('hidden')!='1' for r in range(lo,lo+3))
                    assert all(rows[r].get('hidden')=='1' and rows[r].get('outlineLevel')=='1' for r in range(lo+3,hi+1))
                assert any('COUNTIF(LotNumbers,A68)>0' in (x.find(Q('formula1')).text or '') and x.get('sqref')=='A68:A117' for x in sheets[0].find(Q('dataValidations')))
                sample=data[2]
                assert sample['A15']=='2. ยอดนับรวม' and sample['A17']=='2'
                assert [sample[f'F{r}'] for r in range(22,26)]==roles
                assert sample['N25']=='June' and sample['AE25']=='Bee'
            else:
                assert [d[f'{c}8'] for c in ('V','W','X','Y')]==['cl_specimen_code','rt_specimen_code','dc_specimen_code','cla_specimen_code']
                assert d['Z8']=='d1' and d['OE8']=='d370'
                assert any('UPPER(J9)="ABNORMAL"' in (x.find(Q('formula1')).text or '') for x in validations)
                assert any('I9="ALIVE"' in (x.find(Q('formula1')).text or '') and x.get('allowBlank')=='0' for x in validations)
                for c in ('V','W','X','Y'):
                    assert any(f'{c}9 ' in x.get('sqref','') and x.get('type')=='custom' for x in validations)
                spec=data[1];assert [spec[f'{c}6'] for c in 'ABC']==['No','CODE','Specimen type']
                assert [spec[f'{c}7'] for c in 'ABC']==['no','specimen_code','specimen_type']
                assert not any(int(re.search('[0-9]+',a).group())>=8 for a in spec)
                sample=data[2];records={sample[f'B{r}']:sample[f'C{r}'] for r in range(18,22)}
                links={(sample[f'{c}{r}'],sample[f'A{r}']) for r in (6,10) for c in ('V','W','X')}
                assert len(records)==4 and len(links)==6 and all(code in records for code,_ in links)
                assert records['DC_EXAMPLE_01']=='left over cells'
            print(kind+': v4 headers, blank forms, matrix roles, native controls, examples and no QC checked')
    with ZipFile(CURRENT/'คู่มือการกรอกข้อมูล-v4.docx') as z:
        text=' '.join(E.fromstring(z.read('word/document.xml')).itertext())
    for value in ('experiment-template-final.xlsx','registry-template-final.xlsx','2 ตาราง','CL / RT / DC / CLA','Specimen type','วันที่ตรวจจริง','เวลาศูนย์'):
        assert value in text,value
    assert not any(v in text for v in ('ผลกลุ่มควบคุม','NBD','IVF','v3.','ทั้ง 3 ส่วน','ทั้งสามส่วน'))
    assert 'สำหรับแบบฟอร์มฉบับ 4' not in text
    assert 'experiment-template-v4.xlsx' not in text and 'registry-template-v4.xlsx' not in text
    pdf=PdfReader(CURRENT/'คู่มือการกรอกข้อมูล-v4.pdf')
    assert len(pdf.pages)==9 and all(len(p.extract_text().strip())>300 for p in pdf.pages)
    print('Manual: matching v4 filenames, two-table guidance, nine populated pages and no QC checked')

if __name__=='__main__':check()
