"""One-pass MusicXML pipeline: engrave, measure, build timeline in a single process.

Verovio regenerates element ids per process, so all three stages must share one run.
Coordinates are measured in headless Chromium from that same SVG.
"""
import argparse, json, os, re, subprocess, sys
import xml.etree.ElementTree as ET
from pathlib import Path

NOTE_NAMES = {'c': 'C', 'd': 'D', 'e': 'E', 'f': 'F', 'g': 'G', 'a': 'A', 'b': 'B'}

def fail(code, message, nxt):
    print(json.dumps({"status": "blocked", "code": code, "message": message, "next": nxt}, ensure_ascii=False))
    raise SystemExit(3)


def musicxml_notes(path):
    """Read authoritative pitch, staff, voice and duration from MusicXML.

    This is not a second engraver. It is the semantic source used to check the
    SVG's reading order and to reject a partial or mismatched layout.
    """
    root = ET.fromstring(Path(path).read_text(encoding='utf-8-sig'))
    for node in root.iter():
        node.tag = node.tag.rsplit('}', 1)[-1]
    notes = []
    for part in root.findall('part'):
        for measure_index, measure in enumerate(part.findall('measure'), 1):
            measure_id = f'{part.get("id") or "P1"}:{measure_index}'
            for note in measure.findall('note'):
                if note.find('rest') is not None or note.find('grace') is not None:
                    continue
                pitch = note.find('pitch')
                if pitch is None:
                    continue
                step = pitch.findtext('step')
                octv = pitch.findtext('octave')
                if not step or octv is None:
                    continue
                alter = float(pitch.findtext('alter') or 0)
                suffix = 'b' if alter < 0 else '#' if alter > 0 else ''
                notes.append({
                    'part': part.get('id') or 'P1',
                    'measureId': measure_id,
                    'measureNumber': measure.get('number'),
                    'pickup': measure.get('implicit') == 'yes',
                    'pitch': f'{step}{suffix}{octv}',
                    'pname': step.lower(),
                    'accidental': 'b' if alter < 0 else '#' if alter > 0 else '',
                    'staff': int(note.findtext('staff') or 1),
                    'voice': note.findtext('voice') or '1',
                    'tieStart': any(t.get('type') == 'start' for t in note.findall('tie') + note.findall('notations/tied')),
                    'tieStop': any(t.get('type') == 'stop' for t in note.findall('tie') + note.findall('notations/tied')),
                    'slurs': [{'id': s.get('number') or '1', 'type': s.get('type')} for s in note.findall('notations/slur')],
                    'beams': [{'number': b.get('number') or '1', 'value': b.text} for b in note.findall('beam')],
                })
    return notes


def svg_note_order(svg):
    """Return note ids in document order with the staff that contains each one.

    Verovio emits a staff group inside each measure; reading the SVG tree avoids
    assigning a hand from pitch, page position or a separate timemap ordering.
    """
    root = ET.fromstring(svg)
    for node in root.iter():
        node.tag = node.tag.rsplit('}', 1)[-1]
    parent = {child: node for node in root.iter() for child in node}

    def classes(node):
        return set((node.get('class') or '').split())

    def containing(node, tag, cls):
        current = node
        while current in parent:
            current = parent[current]
            if current.tag == tag and cls in classes(current):
                return current
        return None

    result = []
    for node in root.iter():
        if node.tag != 'g' or 'note' not in classes(node):
            continue
        staff_group = containing(node, 'g', 'staff')
        if staff_group is None:
            fail('NOTE_WITHOUT_STAFF', f'note {node.get("id")!r} has no staff ancestor',
                 'Keep the Verovio measure/staff grouping; do not flatten the SVG.')
        siblings = [child for child in parent[staff_group].findall('g') if 'staff' in classes(child)]
        try:
            staff = siblings.index(staff_group) + 1
        except ValueError:
            fail('STAFF_GROUP_INVALID', str(node.get('id')), 'Re-engrave from the same MusicXML.')
        system_group = containing(node, 'g', 'system')
        result.append({'id': node.get('id'), 'staff': staff, 'system': system_group.get('id') if system_group is not None else None})
    return result


def normalized_pitch(step, accidental, octave):
    return (str(step).lower(), str(accidental or ''), str(octave))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--musicxml', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--browser', required=True)
    ap.add_argument('--verovio', required=True)
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--width', type=int, default=1600)
    ap.add_argument('--seed', type=int, default=12345)
    a = ap.parse_args()

    sys.path.insert(0, a.verovio)
    try:
        import verovio
    except Exception as exc:
        fail('VEROVIO_UNAVAILABLE', f'cannot import verovio: {exc}', 'Point --verovio at an existing module.')

    tk = verovio.toolkit()
    if not tk.loadData(Path(a.musicxml).read_text(encoding='utf-8-sig')):
        fail('MUSICXML_UNREADABLE', a.musicxml, 'Export valid score-partwise MusicXML.')
    tk.setOptions({'pageWidth': a.width, 'scale': 42, 'adjustPageHeight': True, 'breaks': 'auto',
                   'header': 'none', 'footer': 'none', 'svgViewBox': True, 'svgHtml5': False,
                   'xmlIdSeed': a.seed})
    svg = tk.renderToSVG(1)
    if not svg or '<svg' not in svg:
        fail('ENGRAVE_FAILED', 'Verovio returned no SVG', 'Inspect the MusicXML.')
    tm = tk.renderToTimemap({'includeMeasures': True})

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    (out / 'score.svg').write_text(svg, encoding='utf-8')

    note_ids = re.findall(r'<g id="([^"]+)" class="note"', svg)
    if not note_ids:
        fail('NO_NOTE_ELEMENTS', 'No note groups in the engraved SVG', 'Check the MusicXML has pitched notes.')

    # Bind each engraved note to the staff it actually sits on. The semantic
    # MusicXML list then checks pitch and order, so an id/timemap collision or a
    # different layout cannot silently move a note to the other hand.
    engraved = svg_note_order(svg)
    semantic = musicxml_notes(a.musicxml)
    if len(engraved) != len(semantic):
        fail('ENGRAVED_NOTE_COUNT_MISMATCH',
             f'MusicXML has {len(semantic)} pitched notes but the SVG has {len(engraved)}',
             'Engrave and measure the same MusicXML; do not combine versions.')
    svg_by_id = {item['id']: item for item in engraved}

    vb = re.search(r'viewBox="([^"]+)"', svg)
    if not vb:
        fail('VIEWBOX_MISSING', 'SVG has no viewBox', 'Render with svgViewBox enabled.')

    page = out / '_measure.html'
    page.write_text('<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host"></div><pre id="result">pending</pre>'
        '<script>const svgText=' + json.dumps(svg).replace('<', '\\u003c') + ';'
        'document.getElementById("host").innerHTML=svgText;'
        'const ids=' + json.dumps(note_ids).replace('<', '\\u003c') + ';'
        'const root=document.querySelector("svg");const inv=root.getScreenCTM().inverse();'
        'const res=ids.map(id=>{const el=document.getElementById(id);if(!el)return{id,missing:true};'
        'const b=el.getBBox();const p=new DOMPoint(b.x+b.width/2,b.y+b.height/2)'
        '.matrixTransform(el.getScreenCTM()).matrixTransform(inv);'
        'return{id,x:p.x,y:p.y,w:b.width,h:b.height};});'
        'const systems=[...root.querySelectorAll("g.system")].map(el=>{const b=el.getBBox(),m=el.getScreenCTM();'
        'const p=new DOMPoint(b.x,b.y).matrixTransform(m).matrixTransform(inv),q=new DOMPoint(b.x+b.width,b.y+b.height).matrixTransform(m).matrixTransform(inv);'
        'return {top:p.y,bottom:q.y,left:p.x,right:q.x};});'
        'document.getElementById("result").textContent=JSON.stringify({viewBox:[root.viewBox.baseVal.x,root.viewBox.baseVal.y,root.viewBox.baseVal.width,root.viewBox.baseVal.height],notes:res,systems});'
        '</script>', encoding='utf-8')

    puppeteer_core = os.environ.get('AIYOUPU_PUPPETEER_CORE', '')
    if not puppeteer_core:
        fail('PUPPETEER_CORE_REQUIRED', 'No Chromium measurement driver was found',
             'Place puppeteer-core in the Skill runtime node_modules or set AIYOUPU_PUPPETEER_CORE.')
    script = (
        "const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);"
        "const puppeteer=require(" + json.dumps(puppeteer_core) + ");"
        "(async()=>{const b=await puppeteer.launch({executablePath:process.argv[2],headless:'new'});"
        "const p=await b.newPage();await p.goto('file:///'+process.argv[3].replace(/\\\\/g,'/'));"
        "await p.waitForFunction(()=>document.getElementById('result').textContent!=='pending',{timeout:60000});"
        "console.log(await p.$eval('#result',e=>e.textContent));await b.close();})()"
        ".catch(e=>{console.error(e.message);process.exit(1)});"
    )
    nodef = out / '_measure.mjs'
    nodef.write_text(script, encoding='utf-8')
    proc = subprocess.run(['node', str(nodef), a.browser, str(page)], capture_output=True, text=True, encoding='utf-8')
    if proc.returncode != 0:
        fail('MEASURE_FAILED', proc.stderr.strip()[:600], 'Check the browser executable and self-contained SVG.')

    data = json.loads(proc.stdout.strip().splitlines()[-1])
    pos = {n['id']: (n['x'], n['y']) for n in data['notes'] if not n.get('missing')}
    if len(pos) != len(note_ids):
        fail('MEASURE_INCOMPLETE', f"measured {len(pos)} of {len(note_ids)}", 'Re-measure the same SVG.')

    scale = a.width / float(data['viewBox'][2]) if data['viewBox'][2] else 1.0
    height = float(data['viewBox'][3]) * scale

    meta = {}
    for entry in tm:
        for nid in entry.get('on', []) or []:
            if nid in meta:
                continue
            try:
                attrs = tk.getElementAttr(nid)
            except Exception:
                continue
            if not attrs or 'pname' not in attrs:
                continue
            pname = str(attrs['pname']).lower()
            octv = attrs.get('oct')
            if pname in NOTE_NAMES and octv is not None:
                meta[nid] = {'pitch': f'{NOTE_NAMES[pname]}{octv}', 'tstamp': entry.get('tstamp'), 'end': None}
    for entry in tm:
        for nid in entry.get('off', []) or []:
            if nid in meta:
                meta[nid]['end'] = entry.get('tstamp')

    if not meta:
        fail('NO_SEMANTIC_NOTES', 'Verovio returned no pitch attributes', 'Check the MusicXML.')

    missing_svg = [nid for nid in meta if nid not in svg_by_id]
    if missing_svg:
        fail('SEMANTIC_NOTE_NOT_ENGRAVED',
             f'{len(missing_svg)} timemap notes are absent from the SVG (e.g. {missing_svg[:3]})',
             'Rebuild ids and geometry in one Verovio process.')

    grouped = {}
    semantics_by_id = {g['id']: s for g, s in zip(engraved, semantic)}
    for nid, info in meta.items():
        grouped.setdefault(int(round(float(info['tstamp'] or 0))), []).append(nid)

    fps = a.fps
    events = []
    # A tie continuation has its own written notehead but does not start a new
    # sounding attack. Preserve it for notation review, while keeping the
    # timeline's attack events aligned with the audible score.
    for ms, ids in sorted(grouped.items()):
        pts = [{'x': pos[i][0] * scale, 'y': pos[i][1] * scale} for i in ids]
        cx = sum(p['x'] for p in pts) / len(pts)
        cy = sum(p['y'] for p in pts) / len(pts)
        start = ms / 1000.0 * fps
        end_ms = max((meta[i]['end'] or meta[i]['tstamp']) for i in ids)
        dur = max(1.0, (float(end_ms) - ms) / 1000.0 * fps)
        events.append({'frame': start, 'x': cx, 'y': cy,
            'notes': [{**semantics_by_id[i], 'measureId': semantics_by_id[i].get('measureId'),
                       'measureNumber': semantics_by_id[i].get('measureNumber'),
                       'pickup': semantics_by_id[i].get('pickup', False),
                       'occurrence': 1, 'durationFrames': max(1.0, (float(meta[i]['end'] or ms) - ms) / 1000.0 * fps),
                       'id': i, 'x': q['x'], 'y': q['y'],
                       'attack': not semantics_by_id[i]['tieStop'], 'soundingStartFrame': start,
                       'soundingEndFrame': float(meta[i]['end'] or ms) / 1000.0 * fps}
                      for i, q in zip(ids, pts)]})

    # Semantic order checks the rendered reading order, including repeated pitches
    # on both staves. A mismatch blocks instead of correlating by guesswork.
    for index, (svg_note, xml_note) in enumerate(zip(engraved, semantic)):
        attrs = tk.getElementAttr(svg_note['id'])
        rendered = normalized_pitch(attrs.get('pname'),
                                    'b' if str(attrs.get('accid', '')).lower().startswith('f')
                                    else '#' if str(attrs.get('accid', '')).lower().startswith('s') else '',
                                    attrs.get('oct'))
        expected = normalized_pitch(xml_note['pname'], xml_note['accidental'],
                                    xml_note['pitch'][-1])
        semantic[index]['renderedPitch'] = f'{rendered[0]}{rendered[1]}{rendered[2]}'
        if rendered[0] != expected[0] or rendered[2] != expected[2]:
            fail('ENGRAVED_PITCH_ORDER_MISMATCH',
                 f'note #{index}: SVG {rendered[0]}{rendered[2]} vs MusicXML {xml_note["pitch"]}',
                 'Use one engraving run and inspect any copied/unsupported notation.')
        svg_note['pitch'] = xml_note['pitch']

    staff_counts = {}
    for item in engraved:
        staff_counts[item['staff']] = staff_counts.get(item['staff'], 0) + 1

    # Split each onset into one event per hand. A chord can contain both staves;
    # keeping the whole event under a single hand would move real left-hand notes
    # into the right-hand glow and hide them from the left-hand trail.
    split_events = []
    for e in events:
        groups = {}
        for note in e['notes']:
            staff = svg_by_id[note['id']]['staff']
            groups.setdefault('left' if staff == 2 else 'right', []).append(note)
        for hand, notes in groups.items():
            xs = [n['x'] for n in notes]
            ys = [n['y'] for n in notes]
            split_events.append({**e, 'hand': hand, 'staff': 2 if hand == 'left' else 1,
                                 'notes': notes,
                                 'x': sum(xs) / len(xs), 'y': sum(ys) / len(ys)})
    split_events.sort(key=lambda e: (e['frame'], e['hand']))
    events = split_events

    max_ms = max((meta[i]['end'] or meta[i]['tstamp']) for i in meta)
    # The final frame belongs to the stream, not one extra second after it.
    duration = max(1, int(round(float(max_ms) / 1000.0 * fps)) + 1)
    # Camera follows the current system, not one hand's notehead. The two staves
    # form one reading band, so both hands stay centred; switching systems uses a
    # short smoothstep so the view does not jump at a line break.
    system_of_id = {item['id']: item['system'] for item in engraved}
    system_points = {}
    for e in events:
        ids = e['notes']
        system_id = system_of_id.get(ids[0]['id']) if ids else None
        if system_id is None:
            continue
        point = system_points.setdefault(system_id, {'frame': e['frame'], 'xs': [], 'ys': [], 'last': e['frame']})
        point['xs'].extend(n['x'] for n in e['notes'])
        point['ys'].extend(n['y'] for n in e['notes'])
        point['last'] = max(point['last'], e['frame'])
    systems = sorted((
        {'id': key, 'frame': value['frame'], 'last': value['last'],
         'y': sum(value['ys']) / len(value['ys'])
         if value['ys'] else 0}
        for key, value in system_points.items() if value['ys']), key=lambda item: item['frame'])

    # The camera must travel, not step. Taking one coordinate per attack and
    # holding it until the next attack leaves the picture identical for the
    # whole note value and then cuts, which renders as a slideshow. The easing
    # here keeps every measured attack position exact (so a landing is never
    # smeared past its note) while filling the frames between attacks.
    landing = sorted({e['frame'] for e in events})
    x_at = {}
    for e in events:
        x_at.setdefault(e['frame'], e['x'])
    focus = []
    cursor = 0
    for f in range(duration):
        active = [s for s in systems if s['frame'] <= f] or systems[:1]
        current = active[-1] if active else {'frame': 0, 'y': 0}
        current_index = systems.index(current) if current in systems else 0
        upcoming = [s for s in systems if s['frame'] > current['frame']]
        next_system = upcoming[0] if upcoming else None
        # Advance the cursor to the last landing at or before this frame so the
        # loop stays linear in frame count instead of rescanning every event.
        while cursor + 1 < len(landing) and landing[cursor + 1] <= f:
            cursor += 1
        if not landing:
            cx = 0
        elif landing[cursor] > f:
            cx = x_at[landing[0]]
        elif cursor + 1 >= len(landing):
            cx = x_at[landing[cursor]]
        else:
            # Names must not shadow the argparse namespace held in `a`.
            prev_frame, next_frame = landing[cursor], landing[cursor + 1]
            t = (f - prev_frame) / max(1, next_frame - prev_frame)
            eased = t * t * (3 - 2 * t)
            cx = x_at[prev_frame] + (x_at[next_frame] - x_at[prev_frame]) * eased
        cy = current.get('y', 0) if current else 0
        if current and next_system:
            transition = 14
            start = next_system['frame'] - transition
            if f >= start:
                t = max(0.0, min(1.0, (f - start) / transition))
                t = t * t * (3 - 2 * t)
                cy = current['y'] + (next_system['y'] - current['y']) * t
        focus.append({'focusX': cx, 'focusY': cy})

    timeline = {'fps': fps, 'durationInFrames': duration, 'scoreWidth': a.width,
                'scoreHeight': round(height, 2), 'events': events, 'focusPath': focus,
                'status': 'measured_preview_only',
                'systemBounds': [{k: v * scale for k, v in b.items()} for b in data['systems']]}
    (out / 'timeline.json').write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    hands = {'right': sum(1 for e in events for n in e['notes'] if svg_by_id[n['id']]['staff'] == 1),
             'left': sum(1 for e in events for n in e['notes'] if svg_by_id[n['id']]['staff'] == 2)}
    print(json.dumps({'status': 'ready_for_direction', 'events': len(events),
        'notes': sum(len(e['notes']) for e in events), 'hands': hands,
        'semanticNotes': len(semantic),
        'durationFrames': duration, 'scoreWidth': a.width, 'scoreHeight': round(height, 2),
        'svg': str((out / 'score.svg').resolve()), 'timeline': str((out / 'timeline.json').resolve()),
        'pitchSource': 'MusicXML structure, checked note-by-note against Verovio SVG',
        'staffCounts': staff_counts, 'approval': 'none',
        'limits': 'Staff comes from the engraved SVG; pitch/order are checked against the same MusicXML. Preview needs score review, not an automatic approval.'}, ensure_ascii=False))

if __name__ == '__main__':
    main()
