import fs from 'node:fs';import path from 'node:path';
import {run,failure} from './audio.mjs';
import {executeLogged} from './execution.mjs';

/** Keep the original .95 threshold; refine coarse lag candidates to single samples. */
export function verifyAudioTransfer(source,output,{ffmpeg='ffmpeg',fps=30}={}){
  const decode=file=>run(ffmpeg,['-v','error','-i',file,'-vn','-ac','1','-ar','11025','-f','s16le','pipe:1'],{encoding:null,maxBuffer:256*1024*1024});
  const a=decode(source),b=decode(output),rate=11025,window=rate/2|0,limit=Math.ceil(2/fps*rate),samples=[];
  const count=Math.min(a.length,b.length)/2|0;
  for(let region=0;region<5;region++){
    const start=Math.floor((count-window)*region/4);if(start<0)continue;let energy=0;
    for(let i=0;i<window;i+=4)energy+=(a.readInt16LE((start+i)*2)/32768)**2;
    if(energy/window<1e-7)continue;
    const similarityAt=lag=>{let dot=0,aa=0,bb=0;for(let i=0;i<window;i+=4){const j=start+i+lag;if(j<0||j>=b.length/2)continue;const x=a.readInt16LE((start+i)*2),y=b.readInt16LE(j*2);dot+=x*y;aa+=x*x;bb+=y*y;}return dot/Math.sqrt(Math.max(1,aa*bb));};
    let best={similarity:-1,lagSamples:0};
    for(let lag=-limit;lag<=limit;lag+=4){const similarity=similarityAt(lag);if(similarity>best.similarity)best={similarity,lagSamples:lag};}
    const center=best.lagSamples;
    for(const lag of new Set([0,...Array.from({length:7},(_,i)=>center+i-3)])){
      if(lag < -limit || lag > limit)continue;const similarity=similarityAt(lag);if(similarity>best.similarity)best={similarity,lagSamples:lag};
    }
    samples.push({region,...best,lagSeconds:best.lagSamples/rate});
  }
  if(!samples.length||samples.some(s=>s.similarity<.95))throw failure('AUDIO_TRANSFER_REVIEW_REQUIRED','Output audio differs from the reviewed master','Inspect encoding, offsets, gain and source selection; do not change notes or envelopes.');
  return {status:'sampled_master_transfer_passed',samples,limits:'Sampled master preservation only, not every pitch or all samples.'};
}

/** Re-encode only the reviewed audio; copy the rendered video without changing its frames. */
export function muxReviewedAudio({video,audio,out,durationSeconds,ffmpeg='ffmpeg'}){
  if(fs.existsSync(out))throw failure('OUTPUT_EXISTS',out,'Choose a new output file.');
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0)throw failure('DURATION_REQUIRED','Positive composition duration required','Use the frozen timeline duration.');
  executeLogged(ffmpeg,['-v','error','-i',path.resolve(video),'-i',path.resolve(audio),'-map','0:v:0','-map','1:a:0',
    '-c:v','copy','-c:a','aac','-b:a','320k','-t',String(durationSeconds),'-movflags','+faststart',path.resolve(out)],{log:out+'.mux-command.json'});
  return verifyAudioTransfer(audio,out,{ffmpeg});
}
