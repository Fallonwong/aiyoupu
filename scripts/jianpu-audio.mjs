import {escapeXml, jianpuPositions} from './jianpu-layout.mjs';
import {parseMidi} from './midi.mjs';
import {tempoSeconds} from './jianpu-symbolic.mjs';

const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
const lcm = (a, b) => a / gcd(a, b) * b;
const labels = ['quarter','eighth','16th','32nd','64th','128th','256th'];

export function auditJianpuAudio(score, symbolic, bytes, tolerance = 1 / 30) {
  const performed = parseMidi(bytes).notes;
  const seconds = tempoSeconds(score);
  const expected = symbolic.events.filter(event => event.kind === 'note' && !event.ties.includes('stop'));
  const matches = new Set();
  let maxOnsetError = 0;
  for (const note of expected) {
    const time = seconds(note.startBeat);
    let best = -1;
    let error = Infinity;
    for (const [i, candidate] of performed.entries()) {
      if (matches.has(i) || candidate.pitch !== note.midi || candidate.velocity !== note.velocity) continue;
      const difference = Math.abs(candidate.startSeconds - time);
      if (difference < error) {
        best = i;
        error = difference;
      }
    }
    if (best < 0 || error > tolerance) throw new Error('JIANPU_AUDIO_NOTE_MISMATCH: ' + note.id + ' pitch/velocity/time');
    matches.add(best);
    maxOnsetError = Math.max(maxOnsetError, error);
  }
  if (matches.size !== performed.length) throw new Error('JIANPU_AUDIO_NOTE_MISMATCH: audio engine emitted additional attacks');
  return {writtenAttacks:expected.length, renderedAttacks:performed.length, maxOnsetError, tolerance};
}

export function jianpuAudioXml(score, symbolic) {
  const source = jianpuPositions(score);
  const secondsAt = tempoSeconds(score, source);
  const groups = new Map(score.tuplets.map(group => [group.id, group]));
  const divisions = [
    ...score.notes.flatMap(note => [note.beat.d, note.duration.d * (groups.get(note.tupletId)?.ratio.d ?? 1)]),
    ...score.measures.map(measure => measure.span?.d ?? (measure.meter ?? score.meter).beatUnit),
    ...score.tempo.map(mark => mark.at.beat?.d ?? 1),
    ...score.annotations.filter(mark=>mark.type==='pedal').flatMap(mark=>[mark.start.beat?.d??1,mark.end.beat?.d??1]),
  ].reduce(lcm, 1);
  if (!Number.isSafeInteger(divisions) || divisions > 1000000) throw new Error('JIANPU_AUDIO_RESOLUTION: timing grid exceeds supported divisions');
  const ticks = beats => {
    const value = beats * divisions;
    if (Math.abs(value - Math.round(value)) > 0.00001) throw new Error('JIANPU_AUDIO_RESOLUTION: beat does not fit the timing grid');
    return Math.round(value);
  };
  const pedal = score.annotations.filter(mark=>mark.type==='pedal').flatMap(mark=>{
    const start=source.anchor(mark.start), end=source.anchor(mark.end,start.voice);
    return [{position:ticks(start.beat),voice:start.voice,start:true},{position:ticks(end.beat),voice:end.voice,start:false}];
  });
  const allTicks = new Set([0, ticks(source.totalBeats)]);
  for (const note of source.notes.values()) {
    allTicks.add(ticks(note.startBeat));
    allTicks.add(ticks(note.endBeat));
  }
  for (const tempo of score.tempo) allTicks.add(ticks(source.anchor(tempo.at).beat));
  for (const measure of source.measures.values()) allTicks.add(ticks(measure.position));
  const timePoints = [...allTicks].sort((a, b) => a - b);
  let prevBpm;
  const tempoMarks = new Map();
  for (let i = 0; i + 1 < timePoints.length; i++) {
    const start = timePoints[i] / divisions;
    const stop = timePoints[i + 1] / divisions;
    const bpm = Math.round(10 ** 7 * 60 * (stop - start) / (secondsAt(stop) - secondsAt(start))) / 10 ** 7;
    if (bpm !== prevBpm) tempoMarks.set(timePoints[i], bpm);
    prevBpm = bpm;
  }
  const byId = new Map(symbolic.events.map(event => [event.id, event]));
  const noteXml = (note, chord) => {
    const data = byId.get(note.id);
    const sounding = !!data.pitch;
    const pitch = sounding && /^([A-G])(#?)(-?\d+)$/.exec(data.pitch);
    const duration = ticks(note.duration);
    const altered = pitch?.[2] ? '<alter>1</alter>' : '';
    const content = pitch ? '<pitch><step>' + pitch[1] + '</step>' + altered + '<octave>' + pitch[3] + '</octave></pitch>' : '<rest/>';
    const ties = sounding ? ['stop','start'].filter(kind => data.ties.includes(kind)) : [];
    const tieXml = ties.map(kind => '<tie type="' + kind + '"/>').join('');
    const tiedXml = ties.map(kind => '<tied type="' + kind + '"/>').join('');
    const group = groups.get(note.tupletId);
    const timeModification = group ? '<time-modification><actual-notes>' + group.count + '</actual-notes><normal-notes>' + group.ratio.n + '</normal-notes></time-modification>' : '';
    const short=sounding&&(data.articulation.includes('staccatissimo')?'staccatissimo':data.articulation.includes('staccato')?'staccato':'');
    const art=short?'<articulations><'+short+'/></articulations>':'';
    const notations = tiedXml || art ? '<notations>' + tiedXml + art + '</notations>' : '';
    const writtenType = note.extensionDashes === 0 ? '<type>' + labels[note.durationLines] + '</type>' + '<dot/>'.repeat(note.dots) : '';
    const dynamics = sounding ? ' dynamics="' + (data.velocity * 100 / 90).toFixed(4) + '"' : '';
    return '<note' + dynamics + '>' + (chord ? '<chord/>' : '') + content + '<duration>' + duration + '</duration>' + tieXml + '<voice>1</voice>' + writtenType + timeModification + notations + '</note>';
  };
  const attributes = (meter, i, first) => '<attributes>' + (first ? '<divisions>' + divisions + '</divisions>' : '') +
    '<time><beats>' + meter.beats + '</beats><beat-type>' + meter.beatUnit + '</beat-type></time>' +
    (first ? i === 0 ? '<clef><sign>G</sign><line>2</line></clef>' : '<clef><sign>F</sign><line>4</line></clef>' : '') + '</attributes>';
  const forward = duration => duration > 0 ? '<forward><duration>' + duration + '</duration></forward>' : '';
  const partDefinitions = score.voices.map((_, i) => '<score-part id="P' + (i + 1) + '"><part-name>Piano</part-name><score-instrument id="I' +
    (i + 1) + '"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I' + (i + 1) +
    '"><midi-channel>' + (i + 1) + '</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>').join('');
  const parts = score.voices.map((voice, i) => {
    let prevMeter;
    const bars = [...source.measures.values()].map(measure => {
      const values = measure.notes.filter(note => note.voice === voice.id).sort((a, b) => a.position - b.position || b.duration - a.duration);
      const meter = measure.meter ?? score.meter;
      const start = ticks(measure.position);
      const length = ticks(measure.length);
      let content = !prevMeter || prevMeter.beats !== meter.beats || prevMeter.beatUnit !== meter.beatUnit ? attributes(meter, i, !prevMeter) : '';
      prevMeter = meter;
      const directions=pedal.filter(mark=>mark.voice===voice.id).map(mark=>({position:mark.position,
        xml:'<direction placement="below"><direction-type><pedal type="'+(mark.start?'start':'stop')+
          '" line="yes"/></direction-type><sound damper-pedal="'+(mark.start?'yes':'no')+'"/></direction>'}));
      if(i===0)for(const [position,bpm] of tempoMarks) directions.push({position,
        xml:'<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>'+bpm+'</per-minute></metronome></direction-type>'+
          '<sound tempo="'+bpm+'"/></direction>'});
      directions.sort((a,b)=>a.position-b.position);
      let directionCursor=start;
      for(const mark of directions)if(mark.position>=start&&mark.position<start+length){
        content+=forward(mark.position-directionCursor)+mark.xml;
        directionCursor=mark.position;
      }
      if(directionCursor>start)content+='<backup><duration>'+(directionCursor-start)+'</duration></backup>';
      let cursor = 0;
      let prior = -1;
      for (const note of values) {
        const onset = ticks(note.position);
        const chord = onset === prior;
        if (!chord) {
          content += forward(onset - cursor);
          cursor = onset + ticks(note.duration);
        }
        content += noteXml(note, chord);
        prior = onset;
      }
      content += forward(length - cursor);
      return '<measure number="' + measure.number + '"' + (measure.span ? ' implicit="yes"' : '') + '>' + content + '</measure>';
    }).join('');
    return '<part id="P' + (i + 1) + '">' + bars + '</part>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>' + escapeXml(score.title) +
    '</work-title></work><part-list>' + partDefinitions + '</part-list>' + parts + '</score-partwise>';
}
