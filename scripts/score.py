"""Deterministic MusicXML inspection and evidence-bound visual review (Python 3.10+).

check uses only stdlib. compare needs Pillow; PDF pages additionally need pdftoppm.
No optical recognition, engraving, hand assignment or timing is fabricated here.
"""
import argparse
import hashlib
import html
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import zipfile
import sys
from fractions import Fraction
import xml.etree.ElementTree as ET


class Failure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def canonical(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def read_json(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def write_json(file, value):
    Path(file).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def report(code, status, **extra):
    return dict(code=code, status=status, **extra)


def text(node, path, default=None):
    found = node.find(path)
    return default if found is None or found.text is None else found.text.strip()


def number(value, label, integer=False):
    try:
        v = Fraction(value)
        if integer and v.denominator != 1:
            raise ValueError()
        return int(v) if integer else v
    except (ValueError, TypeError, ZeroDivisionError):
        raise Failure('INVALID_NUMBER', f'{label}: invalid value {value!r}')


def inspect_musicxml(file):
    data = Path(file).read_bytes()
    # ElementTree does not fetch external DTDs; reject entity declarations as well.
    if b'<!ENTITY' in data.upper() or b'\x00' in data:
        raise Failure('UNSAFE_XML', 'Entity declarations / non UTF-8 XML are unsupported. Export UTF-8 MusicXML.')
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise Failure('INVALID_XML', str(exc))
    for node in root.iter():
        node.tag = node.tag.rsplit('}', 1)[-1]
    if root.tag != 'score-partwise':
        raise Failure('UNSUPPORTED_MUSICXML', 'Expected uncompressed score-partwise MusicXML; timewise/MXL must be explicitly converted first.')
    issues, measures = [], []

    def issue(code, message, mid=None, severity='review', event=None):
        issues.append(dict(code=code, message=message, measureId=mid, eventIndex=event, severity=severity))

    declared = [p.get('id') for p in root.findall('part-list/score-part')]
    parts = root.findall('part')
    ids = [p.get('id') for p in parts]
    if not parts or not declared or len(set(ids)) != len(ids) or set(ids) != set(declared) or len(set(declared)) != len(declared):
        issue('PART_DECLARATION', 'Part list and unique nonempty part ids must match.', severity='error')
    types = {'maxima': 32, 'long': 16, 'breve': 8, 'whole': 4, 'half': 2, 'quarter': 1,
             'eighth': Fraction(1, 2), '16th': Fraction(1, 4), '32nd': Fraction(1, 8),
             '64th': Fraction(1, 16), '128th': Fraction(1, 32), '256th': Fraction(1, 64),
             '512th': Fraction(1, 128), '1024th': Fraction(1, 256)}
    for part in parts:
        pid = part.get('id')
        divisions, meters, staves = None, {}, 1
        ties, slurs, tuplets = {}, {}, {}
        absolute = Fraction(0)
        if not part.findall('measure'):
            issue('EMPTY_PART', 'Part has no measures.', severity='error')
        for mi, measure in enumerate(part.findall('measure')):
            mid = f'{pid}:{mi + 1}'  # Printed measure numbers need not be unique.
            events, cursor, extent, previous = [], Fraction(0), Fraction(0), None
            m = dict(id=mid, part=pid, index=mi + 1, number=measure.get('number'), implicit=measure.get('implicit') == 'yes', events=events)
            measures.append(m)
            for child in measure:
                try:
                    if child.tag == 'attributes':
                        if child.find('divisions') is not None:
                            divisions = number(text(child, 'divisions'), 'divisions')
                            if divisions <= 0:
                                raise Failure('INVALID_DIVISIONS', 'divisions must be positive')
                        if child.find('staves') is not None:
                            staves = number(text(child, 'staves'), 'staves', True)
                            if staves < 1:
                                raise Failure('INVALID_STAFF', 'staves must be positive')
                        for time in child.findall('time'):
                            values = list(time)
                            total = Fraction(0)
                            if time.find('senza-misura') is not None:
                                meters[time.get('number', '*')] = None
                                issue('UNMETERED', 'Unmetered passage needs visual/rhythm review.', mid)
                                continue
                            if len(values) % 2 or not values:
                                raise Failure('INVALID_TIME', 'Expected beats/beat-type pairs')
                            for j in range(0, len(values), 2):
                                if values[j].tag != 'beats' or values[j + 1].tag != 'beat-type':
                                    raise Failure('INVALID_TIME', 'Unsupported time signature structure')
                                beats = sum(number(x, 'beats', True) for x in (values[j].text or '').split('+'))
                                unit = number(values[j + 1].text, 'beat-type', True)
                                if beats <= 0 or unit <= 0:
                                    raise Failure('INVALID_TIME', 'Time signature values must be positive')
                                total += Fraction(beats * 4, unit)
                            meters[time.get('number', '*')] = total
                        for special in ('transpose', 'measure-style', 'staff-details'):
                            if child.find(special) is not None:
                                issue('SPECIAL_ATTRIBUTES', f'{special} preserved; requires interpretation review.', mid)
                    elif child.tag in ('backup', 'forward'):
                        if not divisions or divisions <= 0:
                            raise Failure('MISSING_DIVISIONS', 'Position change needs valid divisions')
                        duration = number(text(child, 'duration'), 'duration')
                        if duration <= 0:
                            raise Failure('INVALID_DURATION', 'backup/forward duration must be positive')
                        delta = duration / divisions
                        cursor += -delta if child.tag == 'backup' else delta
                        if cursor < 0:
                            issue('NEGATIVE_CURSOR', 'backup moves before measure start.', mid, 'error')
                        extent = max(extent, cursor)
                        events.append(dict(kind=child.tag, onsetQuarter=str(cursor), durationQuarter=str(delta), rawXml=ET.tostring(child, encoding='unicode')))
                        previous = None
                    elif child.tag == 'note':
                        ni = len(events)
                        voice, staff_raw = text(child, 'voice'), text(child, 'staff')
                        staff = number(staff_raw, 'staff', True) if staff_raw else 1
                        if not 1 <= staff <= staves:
                            issue('INVALID_STAFF', 'staff outside declared range.', mid, 'error', ni)
                        if voice is None:
                            issue('VOICE_UNDECLARED', 'Voice omitted; no voice/hand inferred.', mid, event=ni)
                        if staff_raw is None:
                            issue('STAFF_UNDECLARED', 'MusicXML default staff=1 retained; explicit assignment needs review.', mid, event=ni)
                        issue('HAND_UNDECLARED', 'MusicXML staff/voice is not a left/right hand declaration.', mid, event=ni)
                        grace, chord = child.find('grace') is not None, child.find('chord') is not None
                        rest = child.find('rest') is not None
                        duration_raw = text(child, 'duration')
                        duration = Fraction(0)
                        if grace:
                            issue('GRACE_TIMING', 'Grace attack timing requires explicit layout/timeline review.', mid, event=ni)
                            if duration_raw is not None:
                                issue('GRACE_DURATION', 'Grace note contains duration.', mid, 'error', ni)
                        else:
                            if not divisions or divisions <= 0:
                                raise Failure('MISSING_DIVISIONS', 'Note needs positive divisions')
                            raw = number(duration_raw, 'duration')
                            if raw <= 0:
                                raise Failure('INVALID_DURATION', 'Non-grace duration must be positive')
                            duration = raw / divisions
                        onset = cursor
                        if chord:
                            if not previous or previous['kind'] == 'rest' or rest or previous['voice'] != voice or previous['grace'] != grace:
                                issue('INVALID_CHORD', 'Chord lacks compatible preceding note in voice.', mid, 'error', ni)
                            else:
                                onset = Fraction(previous['onsetQuarter'])
                                if duration > Fraction(previous['durationQuarter']):
                                    issue('CHORD_DURATION', 'Chord tone exceeds preceding note duration.', mid, 'error', ni)
                        pitch, midi = None, None
                        if sum(child.find(k) is not None for k in ('pitch', 'rest', 'unpitched')) != 1:
                            issue('NOTE_KIND', 'Exactly one of pitch/rest/unpitched is required.', mid, 'error', ni)
                        if child.find('pitch') is not None:
                            step = text(child, 'pitch/step')
                            octave = number(text(child, 'pitch/octave'), 'octave', True)
                            alter = number(text(child, 'pitch/alter', '0'), 'alter')
                            pitch = dict(step=step, octave=octave, alter=str(alter), accidental=text(child, 'accidental'))
                            if step not in 'C D E F G A B'.split() or not 0 <= octave <= 9 or abs(alter) > 4:
                                issue('PITCH_RANGE', 'Invalid step, octave (0..9) or unsupported alteration (>4 semitones).', mid, 'error', ni)
                            else:
                                midi = 12 * (octave + 1) + dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)[step] + alter
                                if not 21 <= midi <= 108:
                                    issue('AIYOUPU_RANGE', 'Written pitch outside A0..C8; verify instrument/transposition.', mid, event=ni)
                                if alter.denominator != 1:
                                    issue('MICROTONAL', 'Fractional alteration retained; renderer support requires review.', mid, event=ni)
                        elif child.find('unpitched') is not None:
                            issue('UNPITCHED', 'Unpitched note cannot supply piano pitch.', mid, event=ni)
                        note_type = text(child, 'type')
                        tm = child.find('time-modification')
                        ratio = Fraction(1)
                        if tm is not None:
                            actual = number(text(tm, 'actual-notes'), 'actual-notes', True)
                            normal = number(text(tm, 'normal-notes'), 'normal-notes', True)
                            if actual <= 0 or normal <= 0:
                                raise Failure('INVALID_TUPLET', 'Tuplet counts must be positive')
                            ratio = Fraction(normal, actual)
                        if note_type in types and not grace:
                            dots = len(child.findall('dot'))
                            expected = Fraction(types[note_type]) * (2 - Fraction(1, 2 ** dots)) * ratio
                            if expected != duration:
                                issue('NOTATED_DURATION_MISMATCH', 'Notated type/dots/tuplet differs from performed duration; retained for review.', mid, event=ni)
                        elif note_type is None and not (rest and child.find('rest').get('measure') == 'yes'):
                            issue('TYPE_UNDECLARED', 'Written note type absent.', mid, event=ni)
                        elif note_type is not None and note_type not in types:
                            issue('UNKNOWN_TYPE', f'Unsupported type: {note_type}', mid, 'error', ni)
                        e = dict(kind='rest' if rest else 'note', onsetQuarter=str(onset), durationQuarter=str(duration),
                                 durationDivisions=duration_raw, divisions=str(divisions) if divisions else None,
                                 voice=voice, staff=staff, staffExplicit=staff_raw is not None, hand=None, pitch=pitch,
                                 midi=str(midi) if midi is not None else None, chord=chord, grace=grace,
                                 type=note_type, dots=len(child.findall('dot')), rawXml=ET.tostring(child, encoding='unicode'))
                        events.append(e)
                        tie_types = [x.get('type') for x in child.findall('tie')]
                        e['ties'] = tie_types
                        e['slurs'] = [dict(type=x.get('type'), number=x.get('number', '1')) for x in child.findall('notations/slur')]
                        e['beams'] = [dict(number=x.get('number', '1'), value=x.text) for x in child.findall('beam')]
                        key = (voice, json.dumps({k: pitch[k] for k in ('step', 'octave', 'alter')}, sort_keys=True) if pitch else None)  # cross-staff ties allowed
                        for action in ('stop', 'start'):
                            if action not in tie_types:
                                continue
                            if rest or pitch is None:
                                issue('INVALID_TIE', 'Tie requires pitched note.', mid, 'error', ni)
                            if action == 'stop':
                                start = ties.pop(key, None)
                                if start is None:
                                    issue('TIE_STOP_WITHOUT_START', 'Tie stop has no matching pitch/voice start.', mid, 'error', ni)
                                elif start != absolute + onset:
                                    issue('TIE_GAP', 'Tie endpoints are not temporally adjacent.', mid, 'error', ni)
                            else:
                                if key in ties:
                                    issue('DUPLICATE_TIE_START', 'Tie starts twice without stop.', mid, 'error', ni)
                                ties[key] = absolute + onset + duration
                        if any(t not in ('start', 'stop') for t in tie_types) or len(tie_types) != len(set(tie_types)):
                            issue('INVALID_TIE', 'Invalid/duplicate tie type.', mid, 'error', ni)
                        for tag, active in (('slur', slurs), ('tuplet', tuplets)):
                            for mark in child.findall(f'notations/{tag}'):
                                k = (voice, mark.get('number', '1'))
                                action = mark.get('type')
                                if action == 'start':
                                    if k in active:
                                        issue('DUPLICATE_SPAN_START', f'{tag} already open.', mid, 'error', ni)
                                    active[k] = mid
                                elif action == 'stop':
                                    if active.pop(k, None) is None:
                                        issue('SPAN_STOP_WITHOUT_START', f'{tag} stop has no start.', mid, 'error', ni)
                                elif action != 'continue' or k not in active:
                                    issue('INVALID_SPAN', f'{tag} invalid continuation/type.', mid, 'error', ni)
                        tied_types = {x.get('type') for x in child.findall('notations/tied')}
                        if tied_types != set(tie_types) and (tied_types or tie_types):
                            issue('TIE_NOTATION_DIFFERENCE', 'Sound tie and visual tied declarations differ.', mid, event=ni)
                        extent = max(extent, onset + duration)
                        if not chord:
                            cursor += duration
                        previous = e
                    elif child.tag in ('barline', 'direction', 'sound'):
                        for mark in child.iter():
                            if mark.tag in ('repeat', 'ending', 'segno', 'coda') or (mark.tag == 'sound' and any(k in mark.attrib for k in ('dacapo', 'dalsegno', 'tocoda', 'fine'))):
                                issue('REPEAT_OR_JUMP', 'Repeat/ending/jump retained; playback expansion needs explicit review.', mid)
                except Failure as exc:
                    issue(exc.code, exc.message, mid, 'error', len(events))
            if not any(e['kind'] in ('note', 'rest') for e in events):
                issue('EMPTY_MEASURE', 'No note/rest events.', mid, 'error')
            if not meters:
                issue('TIME_UNDECLARED', 'No time signature available.', mid)
            note_events = [e for e in events if e['kind'] in ('note', 'rest')]
            for staff in {e['staff'] for e in note_events}:
                meter = meters.get(str(staff), meters.get('*'))
                staff_extent = max((Fraction(e['onsetQuarter']) + Fraction(e['durationQuarter']) for e in note_events if e['staff'] == staff), default=Fraction(0))
                if meter and staff_extent != meter:
                    issue('PICKUP_OR_SHORT_MEASURE' if staff_extent < meter else 'OVERFULL_MEASURE',
                          f'staff {staff}: extent {staff_extent}, meter {meter}; implicit={m["implicit"]}. Do not pad/truncate.', mid,
                          'review' if staff_extent < meter else 'error')
            # Detect overlapping non-chord durations in a voice, without collapsing rests or voices.
            lanes = {}
            for e in note_events:
                if e['grace'] or e['chord']:
                    continue
                lane = (e['voice'], e['staff'])
                onset, dur = Fraction(e['onsetQuarter']), Fraction(e['durationQuarter'])
                if onset < lanes.get(lane, Fraction(0)):
                    issue('VOICE_OVERLAP', 'Non-chord events overlap in voice/staff.', mid, 'error')
                lanes[lane] = onset + dur
            m.update(durationQuarter=str(extent), divisions=str(divisions) if divisions else None,
                     timeByStaff={k: str(v) if v is not None else None for k, v in meters.items()}, staves=staves,
                     rawXml=ET.tostring(measure, encoding='unicode'))
            absolute += extent
        for label, active in (('TIE', ties), ('SLUR', slurs), ('TUPLET', tuplets)):
            if active:
                issue(f'UNSTOPPED_{label}', f'{len(active)} open {label.lower()} span(s) at end of part.', severity='error')
    passed = not any(i['severity'] == 'error' for i in issues)
    return report('STRUCTURAL_OK' if passed else 'STRUCTURAL_INVALID', 'needs_review' if passed else 'invalid',
                  structuralPassed=passed, visualReview=dict(status='pending', complete=False),
                  sourceSha256=sha(file), measures=measures, issues=issues,
                  next=['Review source against re-engraved measures with compare; resolve interpretation/hand declarations.',
                        'Structural checks are not full XSD validation, OMR proof, visual approval or audio alignment.'])


def capabilities():
    entries = importlib.metadata.entry_points(group='aiyoupu.omr')
    return dict(python=sys.executable, version=sys.version, pillow=importlib.util.find_spec('PIL') is not None,
                pdftoppm=shutil.which('pdftoppm'),
                omrModules={n: importlib.util.find_spec(n) is not None for n in ('audiveris', 'homr', 'oemer')},
                adapters=[dict(name=e.name, value=e.value) for e in entries],
                environmentAdapter=os.environ.get('AIYOUPU_OMR_ADAPTER'))


def audiveris_source(src, out, executable):
    exe = Path(executable).resolve()
    if not exe.is_file() or exe.suffix.lower() in ('.cmd', '.bat'):
        raise Failure('OMR_UNAVAILABLE', 'Supply an installed Audiveris executable, not a shell command. No download or installation is performed.')
    target = out / 'omr'
    target.mkdir()
    command = [str(exe), '-batch', '-transcribe', '-export', '-output', str(target), '--', str(src)]
    started = time.time()
    result = subprocess.run(command, capture_output=True, timeout=600, shell=False)
    write_json(out / 'omr-command.json', dict(command=command, startedAt=started, elapsedSeconds=time.time()-started, exitCode=result.returncode))
    (out / 'omr-stdout.txt').write_bytes(result.stdout)
    (out / 'omr-stderr.txt').write_bytes(result.stderr)
    if result.returncode:
        raise Failure('OMR_FAILED', 'Audiveris failed; inspect retained command/stdout/stderr. Do not silently switch to guessed notation.')
    candidates = [p for p in target.rglob('*') if p.suffix.lower() in ('.xml', '.musicxml', '.mxl') and p.is_file()]
    if len(candidates) != 1:
        raise Failure('OMR_OUTPUT_SELECTION_REQUIRED', f'Expected one score, found {len(candidates)}; select/split movements explicitly.')
    candidate = candidates[0]
    dest = out / 'recognized.musicxml'
    if candidate.suffix.lower() == '.mxl':
        with zipfile.ZipFile(candidate) as package:
            container = ET.fromstring(package.read('META-INF/container.xml'))
            roots = [e.attrib['full-path'] for e in container.iter() if e.tag.split('}')[-1] == 'rootfile']
            if len(roots) != 1 or roots[0].startswith(('/', '\\')) or '..' in roots[0].replace('\\', '/').split('/'):
                raise Failure('MXL_CONTAINER_INVALID', 'Ambiguous or unsafe MXL rootfile')
            info = package.getinfo(roots[0])
            if info.file_size > 20 * 1024 * 1024:
                raise Failure('MXL_TOO_LARGE', 'MusicXML exceeds 20 MB limit')
            dest.write_bytes(package.read(roots[0]))
    else:
        shutil.copyfile(candidate, dest)
    inspected = inspect_musicxml(dest)
    write_json(out / 'check.json', inspected)
    return report('OMR_TRANSCRIBED_UNREVIEWED', 'needs_review', engine='installed Audiveris', sourceSha256=sha(src), musicxml=str(dest),
                  structuralPassed=inspected['structuralPassed'], visualReview=dict(status='pending', complete=False),
                  next=['Resolve structure issues, create original/reflow measure comparisons, then STOP for user score approval. Recognition has not been certified.'])


def source(args, out):
    src = Path(args.source).resolve()
    src_hash = sha(src)
    # Reject bad input even on the unavailable branch.
    if src.suffix.lower() == '.pdf':
        if not src.read_bytes().startswith(b'%PDF-'):
            raise Failure('INVALID_SOURCE', 'PDF signature missing')
        raster_pages(src, out, 'source', args.pdftoppm)
    else:
        try:
            from PIL import Image
            with Image.open(src) as im:
                im.verify()
        except Exception as exc:
            raise Failure('INVALID_SOURCE', f'Invalid image: {exc}')
    shutil.copyfile(src, out / ('original-source' + src.suffix))
    if args.audiveris_exe:
        if args.omr or args.omr_module:
            raise Failure('OMR_ADAPTER_REQUIRED', 'Choose one recognition engine only.')
        return audiveris_source(src, out, args.audiveris_exe)
    cap = capabilities()
    executable = args.omr or os.environ.get('AIYOUPU_OMR_ADAPTER')
    entries = {e.name: e for e in importlib.metadata.entry_points(group='aiyoupu.omr')}
    if args.omr and args.adapter != 'aiyoupu-omr/v1':
        raise Failure('OMR_ADAPTER_REQUIRED', 'Explicit --omr requires --adapter aiyoupu-omr/v1; raw vendor CLI is not assumed compatible.')
    request = dict(protocol='aiyoupu-omr/v1', source=str(src), sourceSha256=src_hash, out=str(out / 'omr'))
    if not executable and not args.omr_module:
        return report('OMR_UNAVAILABLE', 'needs_review', structuralPassed=False, visualReview=dict(status='pending', complete=False),
                      sourceSha256=src_hash, capabilities=cap, next=[
                          'Provide an installed professional OMR wrapper: --omr EXE --adapter aiyoupu-omr/v1,',
                          'or registered environment module: --omr-module NAME (entry point group aiyoupu.omr).',
                          'No transcription was produced. MuseScore/VexFlow engraving is not OMR.'])
    (out / 'omr').mkdir()
    write_json(out / 'omr-request.json', request)
    if args.omr_module:
        if executable or args.omr_module not in entries:
            raise Failure('OMR_UNAVAILABLE', 'Module must be one installed aiyoupu.omr entry point; choose only one adapter.')
        # Registered entry point is an explicit trusted environment integration, not a guessed vendor interface.
        response = entries[args.omr_module].load()(request)
    else:
        resolved = shutil.which(executable)
        if not resolved:
            raise Failure('OMR_UNAVAILABLE', f'Adapter not found: {executable}')
        completed = subprocess.run([resolved, '--protocol', 'aiyoupu-omr/v1', '--source', str(src), '--out', request['out']],
                                   capture_output=True, text=True, encoding='utf-8', timeout=120, shell=False)
        (out / 'omr-stdout.txt').write_text(completed.stdout, encoding='utf-8')
        (out / 'omr-stderr.txt').write_text(completed.stderr, encoding='utf-8')
        if completed.returncode:
            raise Failure('OMR_FAILED', f'Adapter exit {completed.returncode}; see saved stdout/stderr.')
        response = json.loads(completed.stdout)
    write_json(out / 'omr-response.json', response)
    if response.get('protocol') != 'aiyoupu-omr/v1' or response.get('sourceSha256') != src_hash or response.get('status') != 'transcribed' or not response.get('engine'):
        raise Failure('OMR_PROTOCOL_ERROR', 'Adapter must return protocol, sourceSha256, status=transcribed, engine and MusicXML path.')
    xml = Path(response.get('musicxml', ''))
    if not xml.is_absolute():
        xml = out / 'omr' / xml
    xml = xml.resolve()
    if not xml.is_relative_to((out / 'omr').resolve()) or not xml.is_file():
        raise Failure('OMR_PROTOCOL_ERROR', 'MusicXML must be a real file inside adapter output directory.')
    inspected = inspect_musicxml(xml)
    write_json(out / 'check.json', inspected)
    return report('OMR_TRANSCRIBED_UNREVIEWED', 'needs_review', structuralPassed=inspected['structuralPassed'],
                  visualReview=dict(status='pending', complete=False), sourceSha256=src_hash,
                  musicxml=str(xml), engine=response['engine'], next=['Inspect check.json and perform measure-by-measure source/layout review. Adapter transcription is unverified.'])


def raster_pages(file, out, prefix, pdftoppm=None):
    from PIL import Image
    file = Path(file)
    if file.suffix.lower() == '.pdf':
        exe = pdftoppm or shutil.which('pdftoppm')
        if not exe:
            raise Failure('PDF_RENDERER_UNAVAILABLE', 'Supply --pdftoppm EXE or put pdftoppm on PATH.')
        result = subprocess.run([exe, '-r', '120', '-png', str(file.resolve()), str(out / prefix)],
                                capture_output=True, timeout=120, shell=False)
        if result.returncode:
            (out / f'{prefix}-render-error.txt').write_bytes(result.stderr)
            raise Failure('PDF_RENDER_FAILED', f'pdftoppm exit {result.returncode}')
        paths = sorted(out.glob(f'{prefix}-*.png'), key=lambda p: int(p.stem.rsplit('-', 1)[1]))
    else:
        with Image.open(file) as im:
            if getattr(im, 'n_frames', 1) != 1:
                raise Failure('MULTIFRAME_SOURCE', 'Convert multiframe images to explicit pages before review.')
            dest = out / f'{prefix}-1.png'
            im.convert('RGB').save(dest)
            paths = [dest]
    if not paths:
        raise Failure('EMPTY_PAGES', 'No raster pages produced')
    return [dict(file=p.name, sha256=sha(p), width=Image.open(p).width, height=Image.open(p).height) for p in paths]


def crop(box, pages, out, name):
    from PIL import Image
    if box is None:
        return None
    if not isinstance(box, dict) or not isinstance(box.get('page'), int) or isinstance(box.get('page'), bool) or not 1 <= box['page'] <= len(pages):
        raise Failure('INVALID_MAPPING', f'{name}: expected one-based page index')
    page = pages[box['page'] - 1]
    rect = box.get('rect')
    if not isinstance(rect, list) or len(rect) != 4 or any(type(v) is not int for v in rect):
        raise Failure('INVALID_MAPPING', f'{name}: rect must be integer [x,y,width,height] in raster pixels')
    x, y, w, h = rect
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > page['width'] or y + h > page['height']:
        raise Failure('INVALID_MAPPING', f'{name}: crop outside page bounds')
    with Image.open(out / page['file']) as im:
        im.crop((x, y, x + w, y + h)).save(out / f'{name}.png')
    return dict(file=f'{name}.png', sha256=sha(out / f'{name}.png'), page=box['page'], rect=rect)


def compare(args, out):
    # All original bytes are bound, including MusicXML and layout raster/PDF, not just SVG.
    bindings = {f'{key}Sha256': sha(getattr(args, key)) for key in ('source', 'musicxml', 'svg', 'timeline', 'layout')}
    checked = inspect_musicxml(args.musicxml)
    write_json(out / 'check.json', checked)
    try:
        root = ET.parse(args.svg).getroot()
        if root.tag.rsplit('}', 1)[-1] != 'svg':
            raise ValueError('Not SVG')
        if not isinstance(read_json(args.timeline), dict):
            raise ValueError('timeline must be an object')
    except Exception as exc:
        raise Failure('INVALID_LAYOUT_INPUT', str(exc))
    pages = {key: raster_pages(getattr(args, key), out, key, args.pdftoppm) for key in ('source', 'layout')}
    # Keep original source/reflow, SVG/timeline and XML alongside raster pages.
    for key in ('source', 'layout', 'musicxml', 'svg', 'timeline'):
        shutil.copyfile(getattr(args, key), out / f'original-{key}{Path(getattr(args, key)).suffix}')
    ids = [m['id'] for m in checked['measures']]
    mapping = read_json(args.mapping) if args.mapping else dict(schema='aiyoupu-score-mapping/v1', bindings=bindings,
                    measures=[dict(id=mid, source=None, layout=None) for mid in ids])
    if mapping.get('schema') != 'aiyoupu-score-mapping/v1' or mapping.get('bindings') != bindings:
        raise Failure('STALE_MAPPING', 'Mapping schema/hashes differ from current source/layout inputs.')
    rows = mapping.get('measures', [])
    if not isinstance(rows, list) or [r.get('id') for r in rows] != ids:
        raise Failure('INVALID_MAPPING', 'Mapping must cover exactly all MusicXML measure ids in order (including parts).')
    write_json(out / 'mapping.json', mapping)
    mapping_hash = canonical(mapping)
    layout_evidence = read_json(args.layout_evidence) if args.layout_evidence else {}
    evidence_ok = (layout_evidence.get('schema') == 'aiyoupu-score-layout/v1' and
                   layout_evidence.get('bindings') == bindings and layout_evidence.get('sameRun') is True and
                   isinstance(layout_evidence.get('runId'), str) and bool(layout_evidence['runId'].strip()) and
                   isinstance(layout_evidence.get('producer'), str) and bool(layout_evidence['producer'].strip()))
    if args.layout_evidence and not evidence_ok:
        raise Failure('STALE_LAYOUT_EVIDENCE', 'Same-run producer declaration/hashes missing or stale.')
    evidence_hash = canonical(layout_evidence)
    write_json(out / 'layout-evidence.json', layout_evidence or dict(schema='aiyoupu-score-layout/v1', bindings=bindings,
               sameRun=False, runId=None, producer=None, status='pending', next='Engraver/timeline producer must supply same-run declaration; this tool cannot attest it.'))
    review = read_json(args.review) if args.review else None
    if review and (review.get('schema') != 'aiyoupu-score-review/v1' or review.get('bindings') != bindings or
                   review.get('mappingSha256') != mapping_hash or review.get('layoutEvidenceSha256') != evidence_hash):
        raise Failure('STALE_REVIEW', 'Review hashes do not match current source/layout/mapping/same-run evidence.')
    approvals = {}
    if review:
        for r in review.get('measures', []):
            if r.get('id') in approvals or r.get('id') not in ids:
                raise Failure('INVALID_REVIEW', 'Duplicate or unknown review measure')
            approvals[r['id']] = r
    results, template = [], []
    for i, row in enumerate(rows):
        crops = {key: crop(row.get(key), pages[key], out, f'm{i + 1}-{key}') for key in ('source', 'layout')}
        crop_hashes = {key: value['sha256'] if value else None for key, value in crops.items()}
        r = approvals.get(row['id'], {})
        if r and r.get('cropSha256') != crop_hashes:
            raise Failure('STALE_REVIEW', f'{row["id"]}: crop bytes changed (including rasterizer changes).')
        status = 'pending'
        if all(crops.values()) and r.get('status') in ('approved', 'difference', 'pending'):
            status = r['status']
            if status == 'approved' and (not isinstance(r.get('reviewer'), str) or not r['reviewer'].strip() or
                                         not isinstance(r.get('note'), str) or not r['note'].strip()):
                raise Failure('INVALID_REVIEW', 'Approval requires reviewer and note resolving observed differences.')
        results.append(dict(id=row['id'], status=status, crops=crops, review=r or None))
        template.append(dict(id=row['id'], status=status, cropSha256=crop_hashes,
                             reviewer=r.get('reviewer', ''), note=r.get('note', '')))
    visual_ok = bool(results) and all(r['status'] == 'approved' for r in results)
    ready = visual_ok and evidence_ok and checked['structuralPassed']
    result = report('SCORE_REVIEW_APPROVED' if ready else 'SCORE_NEEDS_REVIEW', 'reviewed' if ready else 'needs_review',
                    structuralPassed=checked['structuralPassed'], visualReview=dict(status='approved' if visual_ok else 'pending', complete=visual_ok),
                    layoutEvidenceVerified=evidence_ok, bindings=bindings, mappingSha256=mapping_hash,
                    runId=layout_evidence.get('runId') if evidence_ok else None,
                    layoutEvidenceSha256=evidence_hash, pages=pages, measures=results,
                    next=['Open comparison.html; supply actual per-measure rectangles, then rerun compare with --mapping.',
                          'Use review-template.json or the HTML controls to export review.json; rerun with --review.',
                          'Provide producer same-run layout-evidence.json; approval covers visual review only, not audio synchronization or renderer readiness.'] if not ready else
                         ['Visual review approved; separately validate timeline coordinates, hand declarations, repeat expansion and audio alignment.'])
    write_json(out / 'review-template.json', dict(schema='aiyoupu-score-review/v1', bindings=bindings,
               mappingSha256=mapping_hash, layoutEvidenceSha256=evidence_hash, measures=template))
    build_html(out, result, mapping, read_json(out / 'review-template.json'))
    return result


def build_html(out, result, mapping, review):
    payload = json.dumps(dict(report=result, mapping=mapping, review=review), ensure_ascii=True).replace('<', '\\u003c')
    cards = []
    for r in result['measures']:
        imgs = ''.join(f'<div><b>{key}</b><br>' + (f'<img src="{crop["file"]}">' if crop else '<p>pending: no verified measure crop</p>') + '</div>' for key, crop in r['crops'].items())
        cards.append(f'<section><h2>{html.escape(r["id"])} — {r["status"]}</h2><div class="pair">{imgs}</div>'
                     '<label>Review <select><option>pending</option><option>difference</option><option>approved</option></select></label> '
                     '<input placeholder="Reviewer"><input placeholder="Review notes / difference resolution"></section>')
    content = '''<!doctype html><meta charset="utf-8"><title>Measure comparison</title>
<style>body{font:16px system-ui;margin:24px;background:#f4f4f4}section{background:white;padding:16px;margin:16px 0}.pair{display:flex;gap:16px}.pair>div{width:48%}img{max-width:100%}input{margin:8px;width:28%}canvas{max-width:100%;border:1px solid;cursor:crosshair}button,select{padding:8px}</style>
<h1>Source / re-engraved score review</h1><p id="summary"></p>
<p>Every part/measure must have a real crop on both pages. No visual similarity or optical recognition is inferred.
Select a measure and side; click top-left then bottom-right on the page to set a rectangle. Export mapping, rerun compare into a new directory, then review the crops.</p>
<select id="measure"></select><select id="side"><option>source</option><option>layout</option></select><select id="page"></select>
<button id="saveMapping">Export mapping.json</button><p id="coords"></p><canvas id="canvas"></canvas>
<h2>Per-measure review</h2><button id="saveReview">Export review.json</button>''' + ''.join(cards) + '''
<script type="application/json" id="data">''' + payload + '''</script><script>
const d=JSON.parse(document.getElementById('data').textContent),q=id=>document.getElementById(id);
q('summary').textContent=JSON.stringify({status:d.report.status,structuralPassed:d.report.structuralPassed,visualReview:d.report.visualReview,layoutEvidenceVerified:d.report.layoutEvidenceVerified});
for(const r of d.mapping.measures){const o=document.createElement('option');o.textContent=r.id;q('measure').append(o)}
let first=null,img=new Image();const c=q('canvas'),ctx=c.getContext('2d');
function load(){first=null;const p=d.report.pages[q('side').value][Number(q('page').value||1)-1];img.onload=()=>{c.width=img.width;c.height=img.height;ctx.drawImage(img,0,0)};img.src=p.file}
function pages(){q('page').textContent='';d.report.pages[q('side').value].forEach((p,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent='Page '+(i+1);q('page').append(o)});load()}
q('side').onchange=pages;q('page').onchange=load;q('measure').onchange=load;pages();
c.onclick=e=>{const b=c.getBoundingClientRect(),p=[Math.round((e.clientX-b.left)*c.width/b.width),Math.round((e.clientY-b.top)*c.height/b.height)];if(!first){first=p;q('coords').textContent='First corner '+p;return}const rect=[Math.min(first[0],p[0]),Math.min(first[1],p[1]),Math.abs(p[0]-first[0]),Math.abs(p[1]-first[1])];if(!rect[2]||!rect[3])return;d.mapping.measures[q('measure').selectedIndex][q('side').value]={page:Number(q('page').value),rect};ctx.strokeStyle='red';ctx.lineWidth=2;ctx.strokeRect(...rect);q('coords').textContent=JSON.stringify(rect);first=null};
function save(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
q('saveMapping').onclick=()=>save('mapping.json',d.mapping);
document.querySelectorAll('section').forEach((s,i)=>{const r=d.review.measures[i];s.querySelector('select').value=r.status;const inputs=s.querySelectorAll('input');inputs[0].value=r.reviewer;inputs[1].value=r.note});
q('saveReview').onclick=()=>{document.querySelectorAll('section').forEach((s,i)=>{const r=d.review.measures[i],inputs=s.querySelectorAll('input');r.status=s.querySelector('select').value;r.reviewer=inputs[0].value;r.note=inputs[1].value});save('review.json',d.review)};
</script>'''
    (out / 'comparison.html').write_text(content, encoding='utf-8')


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Failure('INVALID_ARGUMENT', message)


def main():
    parser = Parser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True, parser_class=Parser)
    p = sub.add_parser('check'); p.add_argument('--musicxml', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('source'); p.add_argument('--source', required=True); p.add_argument('--out', required=True)
    p.add_argument('--omr'); p.add_argument('--adapter', choices=['aiyoupu-omr/v1']); p.add_argument('--omr-module')
    p.add_argument('--pdftoppm'); p.add_argument('--audiveris-exe')
    p = sub.add_parser('compare')
    for key in ('source', 'musicxml', 'svg', 'timeline', 'layout', 'out'):
        p.add_argument('--' + key, required=True)
    for key in ('mapping', 'review', 'layout-evidence', 'pdftoppm'):
        p.add_argument('--' + key)
    p = sub.add_parser('capabilities'); p.add_argument('--out', required=True)
    out = None
    try:
        args = parser.parse_args()
        candidate = Path(args.out).resolve()
        try:
            candidate.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            raise Failure('OUTPUT_EXISTS', 'Use a new output directory to preserve earlier evidence.')
        out = candidate
        if args.command == 'check':
            result = inspect_musicxml(args.musicxml)
        elif args.command == 'source':
            result = source(args, out)
        elif args.command == 'compare':
            result = compare(args, out)
        else:
            result = report('CAPABILITIES', 'available', capabilities=capabilities(), next=['No packages installed or environments created.'])
    except Failure as exc:
        result = report(exc.code, 'needs_review' if exc.code == 'OMR_UNAVAILABLE' else 'error',
                        structuralPassed=False, visualReview=dict(status='pending', complete=False),
                        message=exc.message, next=['Correct the input or supply the missing tool/evidence; rerun into a new --out directory.'])
    except Exception as exc:
        result = report('INVALID_INPUT_OR_TOOL_FAILURE', 'error', structuralPassed=False,
                        visualReview=dict(status='pending', complete=False), message=f'{type(exc).__name__}: {exc}',
                        next=['Inspect input paths/formats and installed tool capabilities; no success is inferred.'])
    if os.environ.get('AIYOUPU_SCORE_PYTHON_SELECTION'):
        result['pythonSelection'] = json.loads(os.environ['AIYOUPU_SCORE_PYTHON_SELECTION'])
    if out:
        result['reportPath'] = str(out / 'report.json')
        write_json(out / 'report.json', result)
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 2 if result['status'] in ('error', 'invalid') else 3 if result['status'] == 'needs_review' else 0


if __name__ == '__main__':
    sys.exit(main())
