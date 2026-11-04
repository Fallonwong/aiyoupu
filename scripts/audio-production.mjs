import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256,probeMedia,audioFeatures,run,failure} from './audio.mjs';
import {musicIdentity,performance} from './music.mjs';
import {executeLogged} from './execution.mjs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>sha256(fs.readFileSync(p));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const fresh=p=>{if(fs.existsSync(p))throw failure('OUTPUT_EXISTS',p,'Choose a new output path; never overwrite the current song.');};
export function audioPlan({musescore,soundfont,authorizedProjects=[]}={}){
  const programs=[musescore],fonts=[soundfont];
  if(process.platform==='win32'){
    programs.push(path.join(process.env.ProgramFiles??'C:/Program Files','MuseScore 4/bin/MuseScore4.exe'));
    fonts.push(path.join(process.env.ProgramFiles??'C:/Program Files','MuseScore 4/sound/MS Basic.sf3'));
  }
  const lookup=spawnSync(process.platform==='win32'?'where.exe':'which',['MuseScore4'],{encoding:'utf8',windowsHide:true,timeout:5000});
  if(lookup.status===0)programs.push(...lookup.stdout.trim().split(/\r?\n/));
  for(const root of authorizedProjects)for(const dir of ['sound','soundfonts','SoundFonts']){
    const p=path.resolve(root,dir);if(fs.existsSync(p))for(const f of fs.readdirSync(p))if(/\.sf[23]$/i.test(f))fonts.push(path.join(p,f));
  }
  const unique=values=>[...new Set(values.filter(Boolean).map(p=>path.resolve(p)))];
  const engines=unique(programs).filter(p=>fs.statSync(p,{throwIfNoEntry:false})?.isFile()).map(p=>{
    const r=spawnSync(p,['--version'],{encoding:'utf8',windowsHide:true,timeout:15000});
    return {path:p,available:r.status===0&&!r.error,version:(r.stdout||r.stderr||'').trim(),error:r.error?.message??null};
  });
  const soundfonts=unique(fonts).filter(p=>fs.statSync(p,{throwIfNoEntry:false})?.isFile()).map(p=>({path:p,bytes:fs.statSync(p).size,sha256:hash(p),licenseFile:fs.existsSync(path.join(path.dirname(p),'MS Basic_License.md'))?path.join(path.dirname(p),'MS Basic_License.md'):null}));
  return {schema:'aiyoupu-audio-plan/v1',status:engines.some(e=>e.available)&&soundfonts.length?'EXISTING_AUDIO_CANDIDATE':'AUDIO_SETUP_REQUIRED',engines,soundfonts,installed:false,limits:'Candidates are not proof of selected instrument or audible quality. MuseScore Basic selects its bundled MS Basic; arbitrary SoundFonts need a separately verified adapter.',next:'Reuse available tools, render a short audition, then obtain actual listening approval. Report missing tools and download sizes before requesting any installation.'};
}
function receipt(audio,timeline,extra){
  const media=probeMedia(audio),features=audioFeatures(audio);
  if(!media.streams.some(s=>s.codec_type==='audio'))throw failure('AUDIO_STREAM_MISSING',audio,'Provide decoded audible audio.');
  return {schema:'aiyoupu-audio-evidence/v1',audio:path.resolve(audio),audioSha256:hash(audio),musicSha256:musicIdentity(timeline),duration:media.duration,audibility:{rms:features.rms,peak:features.peak},...extra};
}
export function renderScoreAudio({musicxml,timeline,musescore,soundfont,out}){
  fresh(out);fresh(out+'.audio.json');fresh(out+'.command.json');
  performance(timeline,{strict:true});
  if(timeline.sourceMusicxmlSha256!==hash(musicxml))throw failure('SOURCE_SCORE_BINDING_REQUIRED','MusicXML differs from approved timeline source','Use the full approved MusicXML; a cropped audition cannot substitute for the complete song.');
  const bundled=path.resolve(path.dirname(musescore),'../sound/MS Basic.sf3');
  if(fs.realpathSync(soundfont)!==fs.realpathSync(bundled))throw failure('SOUNDFONT_ADAPTER_REQUIRED','MuseScore Basic uses its bundled MS Basic, not an arbitrary supplied file','Use the matching bundled font or a separately verified renderer; do not falsely claim a custom font was loaded.');
  const inputs=[musicxml,musescore,soundfont];
  const fingerprints=Object.fromEntries(inputs.map(p=>[path.resolve(p),hash(p)]));
  const version=spawnSync(musescore,['--version'],{encoding:'utf8',windowsHide:true,timeout:15000});
  if(version.status!==0)throw failure('AUDIO_ENGINE_UNAVAILABLE',version.stderr||version.error?.message,'Use an existing verified executable.');
  executeLogged(musescore,['--sound-profile','MuseScore Basic','-o',path.resolve(out),path.resolve(musicxml)],{cwd:path.dirname(path.resolve(out)),log:out+'.command.json'});
  for(const [p,h]of Object.entries(fingerprints))if(hash(p)!==h)throw failure('AUDIO_SOURCE_CHANGED',p,'Inputs changed during export; retain the log and retry only after diagnosis.');
  const result=receipt(out,timeline,{kind:'sampled-score-export',scope:'full-score',purpose:'production-candidate',engine:{path:path.resolve(musescore),version:(version.stdout||version.stderr).trim(),profile:'MuseScore Basic'},soundfont:{path:path.resolve(soundfont),sha256:hash(soundfont)},fingerprints:{...fingerprints,[path.resolve(out+'.command.json')]:hash(out+'.command.json')},limits:'Profile selects MS Basic; actual instrument assignment and timbre still need audition. Export is not yet aligned or user approved. Preserve reverb/release tails.'});
  write(out+'.audio.json',result);return {status:'FULL_SCORE_AUDIO_EXPORTED_UNALIGNED',audio:path.resolve(out),evidence:path.resolve(out+'.audio.json'),duration:result.duration,next:'Check leading silence, score end and release tail. Master to a new file if needed; audition before export.'};
}
export function validateAudioEvidence(file,audio,timeline,{draft=false}={}){
  const r=read(file);
  if(r.schema!=='aiyoupu-audio-evidence/v1'||r.audioSha256!==hash(audio)||r.musicSha256!==musicIdentity(timeline))throw failure('AUDIO_EVIDENCE_STALE','Audio or music differs from its production evidence','Rebuild audio from the approved song, then obtain new keyframe/audition approval.');
  if(!['sampled-score-export','provided-recording','calibration-preview'].includes(r.kind)||r.scope!=='full-score')throw failure('AUDIO_PROVENANCE_REQUIRED','Missing full-song audio provenance','Retain the real source/engine/mastering chain; never register an excerpt as a full song.');
  if(r.kind==='calibration-preview'&&!draft)throw failure('PREVIEW_AUDIO_NOT_PRODUCTION','Simple waveform synthesis is calibration-only','Use a recording or auditioned sampled instrument for production. Explicit draft remains available.');
  for(const [p,h]of Object.entries(r.fingerprints??{}))if(!fs.existsSync(p)||hash(p)!==h)throw failure('AUDIO_EVIDENCE_STALE',p,'Source, engine, font or production logs changed.');
  return r;
}
export function registerRecording({audio,timeline,out}){
  fresh(out);const r=receipt(audio,timeline,{kind:'provided-recording',scope:'full-score',purpose:'production-candidate',fingerprints:{},limits:'User-supplied recording declaration, not automatic source authentication. Align and audition the complete song.'});write(out,r);return {status:'RECORDING_REGISTERED_UNALIGNED',evidence:path.resolve(out)};
}
export function masterAudio({evidence,timeline,out,leadSeconds=0,gainDb=0,durationSeconds}){
  fresh(out);fresh(out+'.audio.json');fresh(out+'.command.json');
  const r=read(evidence);validateAudioEvidence(evidence,r.audio,timeline);
  if(!Number.isFinite(leadSeconds)||leadSeconds<0||!Number.isFinite(gainDb)||Math.abs(gainDb)>18)throw failure('MIX_PARAMETERS_INVALID','Use nonnegative leading silence and finite gain within +/-18dB','Review changes in the final audition.');
  const total=durationSeconds??r.duration+leadSeconds;
  if(!Number.isFinite(total)||total<=0)throw failure('MIX_PARAMETERS_INVALID','Positive target duration required','Preserve the score and sound release.');
  // Trim only a near-silent tail. Never alter note envelopes to satisfy onset thresholds.
  const cut=total-leadSeconds;
  if(cut<=0)throw failure('MIX_PARAMETERS_INVALID','Target ends before music begins','Choose a complete song duration.');
  if(cut<r.duration-.001){
    const bytes=run('ffmpeg',['-v','error','-i',r.audio,'-ss',String(cut),'-vn','-ac','1','-ar','22050','-f','f32le','pipe:1'],{encoding:null,maxBuffer:256*1024*1024});
    let square=0,peak=0;for(let i=0;i+4<=bytes.length;i+=4){const x=bytes.readFloatLE(i);square+=x*x;peak=Math.max(peak,Math.abs(x));}
    const rms=Math.sqrt(square/Math.max(1,bytes.length/4));
    if(rms>.001||peak>.005)throw failure('AUDIBLE_TAIL_TRIM_BLOCKED',`Tail RMS ${rms}, peak ${peak}`,'Preserve the release tail or extend the composition; do not truncate audible notes.');
  }
  const filter=`adelay=${leadSeconds*1000}:all=1,volume=${gainDb}dB,apad,atrim=duration=${total}`;
  executeLogged('ffmpeg',['-v','error','-i',r.audio,'-af',filter,'-ar','44100','-ac','2','-c:a','pcm_s24le',path.resolve(out)],{log:out+'.command.json'});
  const result=receipt(out,timeline,{...r,audio:path.resolve(out),audioSha256:hash(out),duration:total,mix:{leadSeconds,gainDb,durationSeconds:total},fingerprints:{...r.fingerprints,[path.resolve(r.audio)]:hash(r.audio),[path.resolve(evidence)]:hash(evidence),[path.resolve(out+'.command.json')]:hash(out+'.command.json')}});
  // receipt metadata must describe the final file, not inherited source measurements.
  result.audibility=audioFeatures(out);result.duration=probeMedia(out).duration;
  if(result.audibility.peak>=.999)throw failure('AUDIO_CLIPPING_REVIEW','Master reaches digital full scale','Reduce gain; failed output is retained for diagnosis, without a valid receipt.');
  write(out+'.audio.json',result);return {status:'MASTER_CREATED_UNALIGNED',audio:path.resolve(out),evidence:path.resolve(out+'.audio.json'),next:'Re-run alignment and include this exact master in the user audition. Soundfont/profile/master changes invalidate audition approval.'};
}
