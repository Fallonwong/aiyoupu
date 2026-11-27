import {validateJianpu} from './jianpu-check.mjs';

export const numberOf = ({n, d}) => n / d;
export const escapeXml = value => String(value).replace(/[<>&"']/g, c => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;'}[c]));

export function jianpuPositions(score) {
  const validation = validateJianpu(score);
  if (validation.status === 'invalid') throw new Error(JSON.stringify(validation.errors));
  const voices = new Map(score.voices.map(voice => [voice.id, voice]));
  const tuplets = new Map(score.tuplets.map(group => [group.id, group]));
  const measures = new Map();
  let totalBeats = 0;
  for (const measure of score.measures) {
    const meter = measure.meter ?? score.meter;
    const length = measure.span ? numberOf(measure.span) : 4 * meter.beats / meter.beatUnit;
    measures.set(measure.number, {...measure, position: totalBeats, length, notes: []});
    totalBeats += length;
  }
  const notes = new Map();
  for (const note of score.notes) {
    const measure = measures.get(note.measure);
    const position = numberOf(note.beat);
    const group = tuplets.get(note.tupletId);
    const writtenDuration = numberOf(note.duration);
    const duration = writtenDuration * (group ? numberOf(group.ratio) : 1);
    const voice = voices.get(note.voice);
    const entry = {...note, row: voice.row, hand: voice.hand ?? (voice.row === 'lower' ? 'left' : 'right'),
      position, writtenDuration, duration, startBeat: measure.position + position, endBeat: measure.position + position + duration,
      system: measure.system};
    notes.set(note.id, entry);
    measure.notes.push(entry);
  }
  function anchor(value, defaultVoice) {
    if (value.noteId) {
      const note = notes.get(value.noteId);
      return {note, measure: measures.get(note.measure), voice: note.voice,
        beat: value.edge === 'end' ? note.endBeat : note.startBeat, edge: value.edge};
    }
    const measure = measures.get(value.measure);
    return {measure, voice: value.voice ?? defaultVoice, beat: measure.position + numberOf(value.beat)};
  }
  return {notes, measures, voices, anchor, totalBeats, validation};
}

const black = '#16191c';
const staffFont = 'Arial, Microsoft YaHei, sans-serif';
const path = (d, weight = 1.6) => '<path d="' + d + '" fill="none" stroke="' + black + '" stroke-width="' + weight + '" stroke-linecap="round"/>';
const text = (x, y, label, size, attrs = '') => '<text x="' + x + '" y="' + y + '" fill="' + black + '" font-size="' + size + '" ' + attrs + '>' + escapeXml(label) + '</text>';

export function layoutJianpu(score, {width = 1200} = {}) {
  const source = jianpuPositions(score);
  const systems = new Map();
  const beatGrid = new Map();
  for (const measure of source.measures.values()) {
    const beats = new Set([0,measure.length]);
    for (const note of measure.notes) {
      beats.add(note.position);
      for (let i=0;i<note.extensionDashes;i++) beats.add(note.position+(2-2**-note.dots+i)*note.duration/note.writtenDuration);
    }
    beatGrid.set(measure.number,[...beats].sort((a,b)=>a-b));
  }
  const upper = score.voices.find(voice => voice.row === 'upper').id;
  const lower = score.voices.find(voice => voice.row === 'lower')?.id;
  const positions = new Map();
  const output = [];
  const margin = 50;
  let top = 116;
  for (const measure of source.measures.values()) {
    if (!systems.has(measure.system)) systems.set(measure.system, {id: measure.system, measures: []});
    systems.get(measure.system).measures.push(measure);
  }
  const innerWidth=width-2*margin;
  const available=Math.max(innerWidth,...[...systems.values()].map(system=>{
    const current=innerWidth/system.measures.length-36;
    return Math.max(...system.measures.map(measure=>{
      const beats=beatGrid.get(measure.number);
      return beats.some((beat,i)=>i>0&&(beat-beats[i-1])/measure.length*current<24) ?
        32*(beats.length-1)+42 : 0;
    }))*system.measures.length;
  }));
  width=available+2*margin;
  // Size each system from its written measures and assign shared beat columns.
  for (const system of systems.values()) {
    system.top = top;
    system.hasLower = system.measures.some(measure => measure.voices.includes(lower));
    const stacks = new Map();
    for (const measure of system.measures) {
      for (const note of measure.notes) {
        const key = JSON.stringify([measure.number, note.voice, note.position]);
        if (!stacks.has(key)) stacks.set(key, []);
        stacks.get(key).push(note);
      }
    }
    const upperStack = Math.max(1, ...[...stacks.values()].filter(group => group[0].row === 'upper').map(group => group.length));
    const lowerStack = Math.max(1, ...[...stacks.values()].filter(group => group[0].row === 'lower').map(group => group.length));
    system.upperY = top + 119 + (upperStack - 1) * 51;
    system.lowerY = system.upperY + 155 + (lowerStack - 1) * 51;
    system.bottom = (system.hasLower ? system.lowerY : system.upperY) + 76;
    const columnWidth = (width - 2 * margin) / system.measures.length;
    system.measures.forEach((measure, index) => {
      measure.left = margin + index * columnWidth;
      measure.right = measure.left + columnWidth;
      const beats=beatGrid.get(measure.number);
      const span=columnWidth-36;
      const step=(beat,i)=>i===0?0:(beat-beats[i-1])/measure.length*span;
      const dense=beats.some((beat,i)=>i>0&&step(beat,i)<24);
      const offsets=[0];
      if(dense)for(let i=1;i<beats.length;i++)offsets.push(offsets.at(-1)+Math.max(42,step(beats[i],i)));
      measure.xAt = beat => {
        const origin=measure.left+26;
        if(!dense) return origin+beat/measure.length*span;
        const index=Math.max(1,beats.findIndex(b=>b>=beat-1e-8));
        const fraction=(beat-beats[index-1])/(beats[index]-beats[index-1]);
        return origin+(offsets[index-1]+fraction*(offsets[index]-offsets[index-1]))*span/offsets.at(-1);
      };
      measure.staffY = voice => voice === lower ? system.lowerY : system.upperY;
      const previous = system.measures[index - 1];
      if (measure.voices.includes(lower) && !previous?.voices.includes(lower)) {
        const x = measure.left + 1;
        output.push(path('M' + (x + 6) + ' ' + (system.upperY - 18) + 'Q' + x + ' ' + (system.upperY - 18) + ' ' + x + ' ' + (system.upperY - 8) + 'V' + (system.lowerY + 14) + 'q0 8 6 10', 2.5));
      }
      for (const voice of measure.voices) {
        const y = measure.staffY(voice);
        output.push(path('M' + measure.right + ' ' + (y - 27) + 'v56', measure.barline === 'final' ? 4 : 1.5));
        if (['final','double'].includes(measure.barline)) output.push(path('M' + (measure.right - 6) + ' ' + (y - 27) + 'v56'));
      }
    });
    for (const stack of stacks.values()) {
      const measure = source.measures.get(stack[0].measure);
      stack.forEach((note, i) => {
        positions.set(note.id, {id: note.id, systemId: system.id, x: measure.xAt(note.position), y: measure.staffY(note.voice) - (stack.length - i - 1) * 51});
      });
    }
    top = system.bottom + 20;
  }
  const dot = (x, y, r = 2.2) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + black + '"/>';
  const beamLines = new Map();
  const usedIds = new Set();
  for (const note of source.notes.values()) {
    const {x, y} = positions.get(note.id);
    const measure = source.measures.get(note.measure);
    const beamY = y + 17 + 5 * note.durationLines;
    let glyphId = note.id.replace(/[^a-zA-Z0-9_.:-]/g, '_');
    if (!/^[a-zA-Z]/.test(glyphId)) glyphId = 'note-' + glyphId;
    while (usedIds.has(glyphId)) glyphId += '_';
    usedIds.add(glyphId);
    positions.get(note.id).svgId = glyphId;
    output.push('<g id="' + escapeXml(glyphId) + '" data-note-id="' + escapeXml(note.id) + '">'
      + text(x, y + 11, note.degree, 32, 'text-anchor="middle" font-weight="700"'+(note.ink==='gray'?' opacity="0.55"':'')) + '</g>');
    for (let i = 0; i < Math.abs(note.octave); i++) output.push(dot(x, note.octave > 0 ? y - 21 - 5 * i : Math.max(y + 23, beamY + 5) + 5 * i));
    for (let i = 0; i < note.dots; i++) output.push(dot(x + 15 + 6 * i, y + 2));
    if (note.accidentalSign) output.push(text(x - 13, y - 1, {doubleFlat:'♭♭', flat:'♭', natural:'♮', sharp:'♯', doubleSharp:'♯♯'}[note.accidentalSign], 20, 'text-anchor="end"'));
    if (note.fingering) output.push(text(x + 14, y - 17, note.fingering, 13));
    for (let i = 0; i < note.extensionDashes; i++) {
      const durationFromGlyph = 2 - 2 ** -note.dots;
      const dashX = measure.xAt(note.position + (durationFromGlyph + i) * (note.duration / note.writtenDuration));
      output.push(path('M' + (dashX - 8) + ' ' + (y + 2) + 'h16', 2));
    }
    for (let i = 0; i < note.durationLines; i++) {
      const rowY=measure.staffY(note.voice);
      const unjoined=[note.measure,note.position];
      const key = JSON.stringify([note.system, note.voice, i, note.beamGroupIds?.[i] ?? unjoined, rowY]);
      const line = beamLines.get(key) ?? {left: x - 7, right: x + 7, y: rowY + 17 + 5 * i};
      line.left = Math.min(line.left, x - 7);
      line.right = Math.max(line.right, x + 7);
      beamLines.set(key, line);
    }
    if (note.lyric) {
      const lyricY = measure.staffY(note.voice) + 56;
      output.push(text(x, lyricY, note.lyric.text, 20, 'text-anchor="middle"'));
      if (note.lyric.punctuation) output.push(text(x + 16, lyricY, note.lyric.punctuation, 18, 'text-anchor="start"'));
    }
  }
  for (const line of beamLines.values()) output.push(path('M' + line.left + ' ' + line.y + 'H' + line.right, 2));

  function point(anchor, fallbackVoice) {
    const a = source.anchor(anchor, fallbackVoice);
    const p = a.note && positions.get(a.note.id);
    return {system: a.measure.system, x: p && a.edge === 'start' ? p.x : a.measure.xAt(a.beat - a.measure.position),
      y: p?.y ?? a.measure.staffY(a.voice ?? upper), voice: a.voice ?? upper};
  }
  function segments(a, b, draw) {
    const active = [...systems.values()].filter(system => system.id >= a.system && system.id <= b.system);
    active.forEach((system, i) => {
      const x1 = i === 0 ? a.x : margin;
      const x2 = i === active.length - 1 ? b.x : width - margin;
      const y = a.voice === lower ? system.lowerY : system.upperY;
      draw(x1, x2, i === 0 ? a.y : y, i === active.length - 1 && b.system === system.id ? b.y : y, i, active.length);
    });
  }
  const markOffsets = {crescendo: 66, diminuendo: 66, tie: 31, slur: 38, tempoText: 93, tempoMark: 93, expressionText: 94, dynamic: 45, accent: 52, staccato: 20, pedal: 55};
  for (const mark of score.annotations) {
    const a = point(mark.start);
    const b = mark.end && point(mark.end, a.voice);
    const sign = mark.placement === 'below' ? 1 : -1;
    const offset = markOffsets[mark.type] * sign;
    if (mark.type==='tie'&&mark.value==='shared') continue;
    if (['tie','slur'].includes(mark.type)) segments(a, b, (x1, x2, y1, y2) => {
      output.push(path('M' + x1 + ' ' + (y1 + offset) + 'Q' + ((x1 + x2) / 2) + ' ' + ((y1 + y2) / 2 + offset + 21 * sign) + ' ' + x2 + ' ' + (y2 + offset)));
    });
    else if (['crescendo','diminuendo'].includes(mark.type)) segments(a, b, (x1, x2, y1, y2, i, count) => {
      const opening = index => 8 * (mark.type === 'crescendo' ? index / count : 1 - index / count);
      const y = Math.min(y1, y2) + offset;
      for (const direction of [-1, 1]) output.push(path('M' + x1 + ' ' + (y + direction * opening(i)) + 'L' + x2 + ' ' + (y + direction * opening(i + 1))));
    });
    else if (mark.type === 'pedal') segments(a,b,(x1,x2,y1)=>{
      const y=y1+offset+16;
      output.push(text(x1,y,'Ped.',17,'font-style="italic"'),path('M'+(x1+37)+' '+y+'H'+x2+'v-10'));
    });
    else if (mark.type === 'staccato'&&mark.value==='▼') {
      const n=source.anchor(mark.start).note;
      const y=a.y+offset+sign*(12+5*Math.max(0,(n?.octave??0)-1));
      output.push('<path d="M'+(a.x-4)+' '+y+'h8l-4 '+(-sign*7)+'Z" fill="'+black+'"/>');
    }
    else if (mark.type === 'staccato') output.push(dot(a.x, a.y + offset, 2.5));
    else output.push(text(a.x, a.y + offset, mark.value ?? '>', mark.type === 'accent' ? 18 : 20, 'font-style="italic"'));
  }
  for (const group of score.tuplets) {
    const first = [...source.notes.values()].find(note => note.tupletId === group.id);
    const a = point(group.start, first.voice), b = point(group.end, first.voice);
    const sign = group.placement === 'below' ? 1 : -1;
    segments(a, b, (x1, x2, y1, y2) => {
      const y = Math.min(y1, y2) + 46 * sign;
      const center = (x1 + x2) / 2;
      if (group.bracket === 'arc') output.push(path('M' + x1 + ' ' + y + 'Q' + center + ' ' + (y + sign * 15) + ' ' + x2 + ' ' + y));
      if (group.bracket === 'bracket' && x2 - x1 > 32) output.push(path('M' + x1 + ' ' + (y - sign * 6) + 'v' + sign * 6 + 'H' + (center - 11) + 'M' + (center + 11) + ' ' + y + 'H' + x2 + 'v' + (-sign * 6)));
      output.push(text(center, y - 3, group.label ?? group.count, 17, 'text-anchor="middle"'));
    });
  }

  const glyph = ['♭♭', '♭', '', '♯', '♯♯'][score.tonic.accidental + 2];
  const header = text(width / 2, 53, score.title, 34, 'text-anchor="middle" font-weight="700"')
    + text(margin, 92, '1 = ' + score.tonic.step + glyph + '    ' + score.meter.beats + '/' + score.meter.beatUnit, 23)
    + text(width - margin, 92, (score.credits ?? []).join('　'), 18, 'text-anchor="end"');
  const height = top;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" font-family="' + staffFont + '">' + header + output.join('') + '</svg>';
  const systemBounds = [...systems.values()].map(system => ({id: system.id, left: margin, right: width - margin, top: system.top + 22, bottom: system.bottom}));
  const measureBounds = new Map([...source.measures].map(([number,measure])=>{
    const system=systems.get(measure.system);
    return [number,{x:measure.left-7,y:system.top,width:measure.right-measure.left+14,height:system.bottom-system.top}];
  }));
  return {svg, positions, systemBounds, measureBounds, width, height};
}
