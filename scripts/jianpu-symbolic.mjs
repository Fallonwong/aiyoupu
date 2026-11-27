import {hashObject} from './audio.mjs';
import {jianpuPositions} from './jianpu-layout.mjs';

const steps = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const degrees = [null, 0, 2, 4, 5, 7, 9, 11];
const pitches = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const levels = {pppppp:15, ppppp:20, pppp:26, ppp:32, pp:40, p:52, mp:64, mf:76, f:88, ff:100,
  fff:110, ffff:116, fffff:122, ffffff:126, sf:100, sfz:110, sffz:120, sfp:86, sfpp:82, fp:90, rf:95, rfz:105, fz:105};

export function tempoSeconds(score, source = jianpuPositions(score)) {
  const marks = score.tempo.map(mark => ({...mark, beat: source.anchor(mark.at).beat}));
  const seconds = (bpm, slope, distance) => Math.abs(slope) < 1e-10 ? 60 * distance / bpm : 60 * Math.log1p(slope * distance / bpm) / slope;
  return beat => {
    let total = 0;
    for (const [i, mark] of marks.entries()) {
      if (beat <= mark.beat) break;
      const next = marks[i + 1];
      const end = Math.min(beat, next?.beat ?? beat);
      const slope = mark.transition === 'linear' ? (next.bpm - mark.bpm) / (next.beat - mark.beat) : 0;
      total += seconds(mark.bpm, slope, end - mark.beat);
    }
    return total;
  };
}

export function jianpuSymbolic(check) {
  if (check.schema !== 'aiyoupu-jianpu-check/v1' || check.structuralPassed !== true ||
      !/^[a-f0-9]{64}$/.test(check.sourceSha256 ?? '') || hashObject(check.score) !== check.scoreObjectSha256) {
    throw new Error('JIANPU_CHECK_INVALID: rebuild from the checked JianpuJSON');
  }
  const {score} = check;
  const source = jianpuPositions(score);
  if (!source.validation.readyForPlayback) throw new Error('JIANPU_PLAYBACK_UNRESOLVED: ' + JSON.stringify(source.validation));
  const secondsAt = tempoSeconds(score, source);
  const dynamics = [];
  const hairpins = [];
  const marks = new Map();
  const noteMarks = id => {
    if (!marks.has(id)) marks.set(id, {ties: [], slurs: [], articulation: []});
    return marks.get(id);
  };
  for (const mark of score.annotations) {
    const start = source.anchor(mark.start);
    const end = mark.end && source.anchor(mark.end, start.voice);
    const voice = start.voice ?? end?.voice;
    if (mark.type === 'dynamic') dynamics.push({beat: start.beat, voice, value: levels[mark.value]});
    if (['crescendo','diminuendo'].includes(mark.type)) hairpins.push({start: start.beat, end: end.beat, voice, direction: mark.type === 'crescendo' ? 1 : -1});
    if (mark.type === 'tie') {
      noteMarks(start.note.id).ties.push('start');
      noteMarks(end.note.id).ties.push('stop');
    }
    if (mark.type === 'slur') {
      noteMarks(start.note.id).slurs.push({number: mark.id, type: 'start'});
      noteMarks(end.note.id).slurs.push({number: mark.id, type: 'stop'});
    }
    if (['staccato','accent'].includes(mark.type)) {
      const type=mark.type==='staccato'&&mark.value==='▼'?'staccatissimo':mark.type;
      for(const note of start.measure.notes) {
        if(note.voice===start.note.voice&&note.position===start.note.position) noteMarks(note.id).articulation.push(type);
      }
    }
  }
  dynamics.sort((a, b) => a.beat - b.beat || Number(!!a.voice) - Number(!!b.voice));
  hairpins.sort((a, b) => a.start - b.start);
  const applies = (mark, voice) => !mark.voice || mark.voice === voice;
  const dynamicAt = (beat, voice) => dynamics.findLast(mark => mark.beat <= beat && applies(mark, voice));
  function velocityAt(beat, voice) {
    const explicit = dynamicAt(beat, voice);
    let baseline = explicit?.value ?? levels.mp;
    for (const pin of hairpins) {
      if (pin.start > beat || !applies(pin, voice)) continue;
      const start = dynamicAt(pin.start, voice)?.value ?? baseline;
      const endMark = dynamics.findLast(mark => Math.abs(mark.beat - pin.end) < 1e-9 && applies(mark, voice));
      const target = endMark?.value ?? Math.max(16, Math.min(123, start + 18 * pin.direction));
      if (beat <= pin.end) {
        const amount = (secondsAt(beat) - secondsAt(pin.start)) / (secondsAt(pin.end) - secondsAt(pin.start));
        return Math.round(start + (target - start) * amount);
      }
      if (!explicit || explicit.beat < pin.end) baseline = target;
    }
    return baseline;
  }
  const root = 12 * (score.tonic.octave + 1) + steps[score.tonic.step] + score.tonic.accidental;
  const events = [...source.notes.values()].map(note => {
    const midi = note.degree === 0 ? null : root + degrees[note.degree] + note.accidental + 12 * note.octave;
    if (midi !== null && (midi < 21 || midi > 108)) throw new Error('JIANPU_PIANO_RANGE: ' + note.id);
    const pitch = midi === null ? null : pitches[midi % 12] + (Math.floor(midi / 12) - 1);
    const measure = source.measures.get(note.measure);
    const articulations = marks.get(note.id) ?? {ties: [], slurs: [], articulation: []};
    return {id: note.id, writtenId: note.id, measureId: String(note.measure), occurrence: 1, pickup: measure.span !== undefined,
      part: 'Jianpu', voice: note.voice, staff: note.row === 'upper' ? 1 : 2, hand: note.hand, kind: pitch ? 'note' : 'rest',
      pitch, midi, startBeat: note.startBeat, endBeat: note.endBeat, ties: articulations.ties, slurs: articulations.slurs, beams: [],
      ...(pitch ? {velocity: Math.min(127, velocityAt(note.startBeat, note.voice) + (articulations.articulation.includes('accent') ? 9 : 0)),
        articulation: articulations.articulation, ...(note.fingering ? {fingering: note.fingering} : {})} : {})};
  }).sort((a, b) => a.startBeat - b.startBeat || a.staff - b.staff);
  const symbolic = {schema: 'aiyoupu-symbolic-events/v2', sourceSha256: check.sourceSha256, events,
    playback: {kind: 'jianpu/v1', tempo: score.tempo, order: score.measures.map(measure => measure.number)}};
  symbolic.scoreSha256 = hashObject(symbolic);
  return symbolic;
}
