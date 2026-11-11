"""Make LibreOffice's Thai ActualText readable through ordinary ToUnicode too.

Only font dictionaries and font selections change; glyphs and positions stay intact.
shortcut: supports the manual's simple one-byte TrueType fonts, extend for other PDF encodings.
"""
from pathlib import Path
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject,ContentStream,TextStringObject,ByteStringObject
import re,sys,unicodedata

def cmap(mapping):
    pairs=[f'<{k:02X}> <{v.encode("utf-16-be").hex().upper()}>' for k,v in sorted(mapping.items())]
    chunks=['\n'.join([f'{len(pairs[i:i+100])} beginbfchar',*pairs[i:i+100],'endbfchar']) for i in range(0,len(pairs),100)]
    text='/CIDInit /ProcSet findresource begin\n12 dict begin begincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /ThaiText def /CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'+'\n'.join(chunks)+'\nendcmap CMapName currentdict /CMap defineresource pop end end'
    stream=DecodedStreamObject();stream.set_data(text.encode('ascii'));return stream

def repair(source,target):
    writer=PdfWriter();writer.clone_document_from_reader(PdfReader(source))
    originals={};clones={};count=0
    for page in writer.pages:
        fonts=page['/Resources']['/Font'];stream=ContentStream(page.get_contents(),writer)
        def glyphs(operands,operator):
            items=[operands[0]] if operator==b'Tj' else operands[0]
            return b''.join(v.original_bytes if isinstance(v,TextStringObject) else bytes(v) for v in items if isinstance(v,(TextStringObject,ByteStringObject)))
        spans={};stack=[]
        for index,(operands,operator) in enumerate(stream.operations):
            if operator in (b'BDC',b'BMC'):
                actual=operands[1].get('/ActualText') if operator==b'BDC' and isinstance(operands[1],DictionaryObject) else None
                state={'text':unicodedata.normalize('NFKC',str(actual)),'count':0,'offset':0} if actual is not None else None
                spans[index]=state;stack.append(state)
            state=next((v for v in reversed(stack) if v is not None),None)
            if operator in (b'Tj',b'TJ') and state is not None:state['count']+=len(glyphs(operands,operator))
            if operator==b'EMC':stack.pop()
        current=None;size=None;stack=[];operations=[]
        for index,(operands,operator) in enumerate(stream.operations):
            if operator==b'Tf':current,size=operands
            if operator in (b'BDC',b'BMC'):
                stack.append(spans[index])
            state=next((v for v in reversed(stack) if v is not None),None)
            if operator in (b'Tj',b'TJ') and state is not None:
                font=fonts[current].get_object();identity=font.indirect_reference.idnum
                assert font['/Subtype']=='/TrueType' and int(font['/LastChar'])<=255
                codes=glyphs(operands,operator)
                assert codes
                actual=state['text'];offset=state['offset']
                assert len(actual)>=state['count'] and len(set(codes))==len(codes),'Unsupported shaped cluster'
                # Empty Unicode targets make PDF.js fall back to raw control characters.
                mapping={code:actual[offset+i:offset+i+1] if offset+i<state['count']-1 else actual[offset+i:] for i,code in enumerate(codes)}
                key=(identity,tuple(sorted(mapping.items())))
                if key not in clones:
                    clone=DictionaryObject(dict(font));clone[NameObject('/ToUnicode')]=writer._add_object(cmap(mapping))
                    clones[key]=writer._add_object(clone)
                name=NameObject('/ThaiText'+str(clones[key].idnum));fonts[name]=clones[key]
                operations.extend([([name,size],b'Tf'),(operands,operator),([current,size],b'Tf')])
                state['offset']+=len(codes);count+=1
            else:operations.append((operands,operator))
            if operator==b'EMC':
                ended=stack.pop()
                assert ended is None or 0<ended['offset']==ended['count'],'ActualText has no supported text operation'
        assert not stack
        stream.operations=operations;page[NameObject('/Contents')]=writer._add_object(stream)
        for key,value in list(fonts.items()):
            if str(key).startswith('/ThaiText'):continue
            font=value.get_object();identity=font.indirect_reference.idnum
            if identity in originals or '/ToUnicode' not in font:continue
            original=font['/ToUnicode'].get_data().decode('ascii')
            assert 'beginbfrange' not in original
            mapping={}
            for block in re.findall(r'beginbfchar(.*?)endbfchar',original,re.S):
                for encoded,unicode in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>',block):
                    text=bytes.fromhex(unicode).decode('utf-16-be');mapping[int(encoded,16)]=text[:1]
            font[NameObject('/ToUnicode')]=writer._add_object(cmap(mapping));originals[identity]=True
    writer.write(target)
    text=''.join(p.extract_text() for p in PdfReader(target).pages)
    assert not any(ord(c)<32 and c not in '\n\r\t' for c in text)
    print(f'{Path(target).name}: repaired {count} shaped text spans using {len(clones)} reusable character maps')

if __name__=='__main__':repair(Path(sys.argv[1]),Path(sys.argv[2]))
