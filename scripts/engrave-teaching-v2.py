"""Prepare an unapproved flat teaching layout using an existing Verovio module."""
import argparse,hashlib,importlib,json,pathlib,re,sys

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--musicxml',required=True)
    parser.add_argument('--out',required=True,help='New directory; never overwrites a previous revision')
    parser.add_argument('--module-dir',help='Existing Verovio module directory; does not install anything')
    args=parser.parse_args()
    if args.module_dir:sys.path.insert(0,str(pathlib.Path(args.module_dir).resolve()))
    verovio=importlib.import_module('verovio')
    out=pathlib.Path(args.out)
    if out.exists():raise ValueError('OUTPUT_EXISTS: choose a new revision directory')
    source=pathlib.Path(args.musicxml).read_bytes()
    options={'inputFrom':'musicxml','breaks':'none','header':'none','footer':'none','pageWidth':2600,
             'pageHeight':900,'adjustPageHeight':True,'scale':40,'pageMarginTop':20,'pageMarginBottom':20,
             'pageMarginLeft':20,'pageMarginRight':20,'spacingStaff':30,'spacingSystem':12,
             'lyricTopMinMargin':8,'lyricHeightFactor':1.2,'lyricSize':4.5,'svgViewBox':True}
    toolkit=verovio.toolkit()
    if not toolkit.setOptions(options) or not toolkit.loadData(source.decode('utf-8-sig')):raise ValueError('VEROVIO_INPUT_FAILED')
    svg=toolkit.renderToSVG(1)
    # IDs identify the exact notehead, not its parent note (which can include lyrics/stems).
    # Metadata only: no glyph, lyric, path or transform is changed.
    heads=[0]
    def identify(match):
        if re.search(r'\bid=',match.group(0)):return match.group(0)
        heads[0]+=1
        return match.group(0)[:-1]+' id="teaching-head-'+str(heads[0])+'">'
    svg=re.sub(r'<g\b[^>]*\bclass="notehead"[^>]*>',identify,svg).encode('utf-8')
    out.mkdir(parents=True)
    (out/'score-teaching-v2.svg').write_bytes(svg)
    evidence={'status':'unapproved-engraving','tool':'Verovio','version':toolkit.getVersion(),'options':options,
              'sourceMusicxmlSha256':hashlib.sha256(source).hexdigest(),'scoreSha256':hashlib.sha256(svg).hexdigest(),
              'next':'Measure every notehead and rebuild timeline/layout/focusPath from this SVG; inspect every lyric and onset, then request actual score approval.'}
    (out/'engraving-v2.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(evidence,ensure_ascii=False))

if __name__=='__main__':main()
