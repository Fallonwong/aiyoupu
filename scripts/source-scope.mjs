import fs from 'node:fs';
import {sha256,failure} from './audio.mjs';
// This verifies declared coverage and frozen source evidence, not OCR or note accuracy.
export function checkSourceScope({source,inventory,check,selection}){
  const originalSourceSha256=sha256(fs.readFileSync(source));
  if(inventory.schema!=='aiyoupu-source-inventory/v1'||inventory.sourceSha256!==originalSourceSha256||!Number.isInteger(inventory.measureCount)||inventory.measureCount<=0||!inventory.observer||!Object.keys(inventory.fingerprints??{}).length)throw failure('SOURCE_INVENTORY_REQUIRED','Need an evidence-bound inventory of the original','Inspect original pages; do not invent measure counts or tempo.');
  for(const [p,h]of Object.entries(inventory.fingerprints))if(!fs.existsSync(p)||sha256(fs.readFileSync(p))!==h)throw failure('SOURCE_INVENTORY_STALE',p,'Regenerate inventory from the actual source.');
  if(!check.structuralPassed||!check.measures?.length)throw failure('SCORE_STRUCTURE_REQUIRED','Checked MusicXML required','Use score check first.');
  const part=check.measures[0].part,measures=check.measures.filter(m=>m.part===part&&!m.implicit),issues=[];
  const mode=selection?.scope??'full-score';
  if(mode==='full-score'){
    if(measures.length!==inventory.measureCount)issues.push({code:'SOURCE_MEASURE_COVERAGE',originalMeasures:inventory.measureCount,xmlMeasures:measures.length});
  }else if(mode==='excerpt'){
    const rows=selection.mapping;
    if(!Array.isArray(rows)||rows.length!==measures.length||new Set(rows.map(r=>r.xmlMeasureId)).size!==measures.length||measures.some(m=>!rows.some(r=>r.xmlMeasureId===m.id))||rows.some(r=>!Number.isInteger(r.sourceMeasure)||r.sourceMeasure<1||r.sourceMeasure>inventory.measureCount)||!selection.reason?.trim()||!selection.messageRef?.trim())issues.push({code:'EXCERPT_MAPPING_REQUIRED'});
  }else issues.push({code:'SOURCE_SCOPE_INVALID'});
  const tempi=[...new Set(check.measures.flatMap(m=>[...String(m.rawXml??'').matchAll(/tempo="([\d.]+)"/g)].map(m=>Number(m[1]))))];
  const tempoDifference=inventory.tempoBpm>0&&tempi.some(t=>Math.abs(t-inventory.tempoBpm)>.01);
  return {schema:'aiyoupu-source-scope/v1',status:issues.length?'blocked':'scope_consistent_unreviewed',originalSourceSha256,musicxmlSha256:check.sourceSha256,scope:mode,originalMeasures:inventory.measureCount,xmlMeasures:measures.length,originalTempoBpm:inventory.tempoBpm??null,xmlTempi:tempi,tempoDifference,issues,observer:inventory.observer,accuracyCertified:false,limits:'Coverage only. A tempo difference alone is not an arrangement mismatch; note-level original/reflow review and user approval remain required.'};
}
