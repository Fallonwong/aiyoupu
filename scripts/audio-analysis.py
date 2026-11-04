"""Local, dependency-light spectral/DTW proposal. Never certifies note accuracy.
Only NumPy and FFmpeg are required. No downloads, model loading or auto-install.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import numpy as np


def features(audio, ffmpeg='ffmpeg', hop=220, nfft=4096):
    r = subprocess.run([ffmpeg, '-v', 'error', '-i', str(audio), '-t', '600.01', '-vn', '-ac', '1', '-ar', '22050', '-f', 'f32le', 'pipe:1'], capture_output=True, timeout=120, check=True)
    x = np.frombuffer(r.stdout, dtype='<f4')
    if x.size < nfft or x.size > 22050 * 600 or not np.isfinite(x).all() or np.max(np.abs(x)) < .001:
        raise ValueError('Audio must be audible, finite and between one FFT window and 600 seconds; split longer material explicitly')
    padded = np.pad(x, (nfft//2, nfft//2))
    frames = np.lib.stride_tricks.sliding_window_view(padded, nfft)[::hop]
    pitches = np.arange(21, 109)
    frequencies = 440 * 2 ** ((pitches - 69) / 12)
    bins = np.arange(nfft//2+1) * 22050 / nfft
    # Log-frequency, octave-preserving evidence. Harmonics remain a known ambiguity.
    masks = [np.where(np.abs(12*np.log2(np.maximum(bins, 1)/f)) <= .65)[0] for f in frequencies]
    energy, salience = [], []
    for start in range(0, len(frames), 256):
        block = frames[start:start+256]
        spec = np.abs(np.fft.rfft(block * np.hanning(nfft), axis=1))
        salience.append(np.stack([spec[:, m].max(axis=1) if len(m) else spec[:, np.argmin(np.abs(bins-f))] for m, f in zip(masks, frequencies)], axis=1))
        energy.extend(np.sqrt((block * block).mean(axis=1)).tolist())
    salience = np.log1p(np.concatenate(salience))
    salience /= np.maximum(np.linalg.norm(salience, axis=1, keepdims=True), 1e-9)
    chroma = np.zeros((len(salience), 12))
    for i, p in enumerate(pitches):
        chroma[:, p % 12] += salience[:, i]
    chroma /= np.maximum(np.linalg.norm(chroma, axis=1, keepdims=True), 1e-9)
    # Short windows locate attack candidates independently of the long pitch FFT.
    # This is intentionally not a note transcription or an observed time map.
    short = np.pad(x, (hop//2, hop))
    rms = np.sqrt(np.mean(np.lib.stride_tricks.sliding_window_view(short, hop)[::hop] ** 2, axis=1))
    rms = np.convolve(rms, np.ones(5)/5, mode='same')
    rise = np.maximum(0, rms - np.r_[np.zeros(3), rms[:-3]])
    peaks = []
    threshold = max(float(rise.max()) * .25, .0002)
    for k in range(2, len(rise)-2):
        if rise[k] >= threshold and rise[k] == max(rise[k-2:k+3]):
            if peaks and k-peaks[-1] < 10:
                if rise[k] > rise[peaks[-1]]: peaks[-1] = k
            else: peaks.append(k)
    onsets = [max(0, k*hop/22050-.020) for k in peaks]
    return dict(salience=salience, chroma=chroma, energy=np.asarray(energy), step=hop/22050, duration=len(x)/22050, onsetCandidates=onsets)


def onset_alignment(notes, f):
    """Monotone attack-group edit path. Repeats/omissions remain explicit doubts."""
    beats = sorted(set(n['startBeat'] for n in notes))
    times = f.get('onsetCandidates', [])
    if len(beats) < 2 or len(times) < 2 or len(beats)*len(times) > 1000000:
        return None
    expected = np.zeros((len(beats), 88))
    for i, beat in enumerate(beats):
        for n in notes:
            if n['startBeat'] == beat and 21 <= n['midi'] <= 108: expected[i,n['midi']-21] = 1
    expected /= np.maximum(np.linalg.norm(expected, axis=1, keepdims=True), 1e-9)
    rows = np.array([f['salience'][min(len(f['salience'])-1,int((t+.045)/f['step']))] for t in times])
    cost = 1-expected @ rows.T
    # Broad position prior breaks some ties; it must not be mistaken for repeat recognition.
    position = np.abs(np.linspace(0,1,len(beats))[:,None]-np.linspace(0,1,len(times))[None,:])
    cost += .15*position
    n,m=cost.shape;dp=np.full((n+1,m+1),np.inf);dp[0,:]=np.arange(m+1)*.55;dp[:,0]=np.arange(n+1)*.55
    parent=np.zeros((n,m),dtype=np.uint8)
    for i in range(n):
        for j in range(m):
            options=(dp[i,j]+cost[i,j],dp[i,j+1]+.55,dp[i+1,j]+.55)
            k=int(np.argmin(options));dp[i+1,j+1]=options[k];parent[i,j]=k
    i,j=n-1,m-1;matched=[];omitted=[];extra=[]
    while i>=0 and j>=0:
        k=parent[i,j]
        if k==0: matched.append((i,j));i-=1;j-=1
        elif k==1: omitted.append(beats[i]);i-=1
        else: extra.append(times[j]);j-=1
    omitted.extend(beats[:i+1]);extra.extend(times[:j+1]);matched.reverse()
    return dict(anchors=[dict(beat=beats[i],seconds=times[j],method='interpolated',status='needs_review',basis='short-window-attack-edit-path') for i,j in matched],
        unmatchedScoreBeats=sorted(omitted),unmatchedAudioAttacks=sorted(extra),meanCost=float(np.mean([cost[i,j] for i,j in matched])) if matched else None)


def align(symbolic, f, bpm, max_cells=4000000):
    if not np.isfinite(bpm) or bpm <= 0:
        raise ValueError('Positive nominal BPM required for initialization, not a synchronization certificate')
    notes = [n for n in symbolic['events'] if n['kind'] == 'note' and 'stop' not in n.get('ties', [])]
    beats = sorted(set(n['startBeat'] for n in notes))
    # Coarse 50 Hz; bounded memory with explicit failure rather than silent truncation.
    stride = 2
    chroma = f['chroma'][::stride]
    pitch = f['salience'][::stride]
    step = f['step']*stride
    count = int(np.ceil(max(n['endBeat'] for n in symbolic['events'])*60/bpm/step))+1
    if count*len(chroma) > max_cells:
        raise ValueError('DTW budget exceeded; provide explicitly reviewed segments/anchors')
    expected = np.zeros((count, 12)); expected_pitch = np.zeros((count, 88))
    for n in symbolic['events']:
        if n['kind'] != 'note':
            continue
        a = int(n['startBeat']*60/bpm/step); b = max(a+1, int(n['endBeat']*60/bpm/step))
        expected[a:b, n['midi'] % 12] = 1
        if 21 <= n['midi'] <= 108:
            expected_pitch[a:b, n['midi']-21] = 1
    expected /= np.maximum(np.linalg.norm(expected, axis=1, keepdims=True), 1e-9)
    expected_pitch /= np.maximum(np.linalg.norm(expected_pitch, axis=1, keepdims=True), 1e-9)
    cost = 1 - .65*(expected @ chroma.T) - .35*(expected_pitch @ pitch.T)
    # A path is always only a proposal: global DTW does not resolve repeat/version ambiguity.
    n, m = cost.shape
    dp = np.full((n+1, m+1), np.inf, dtype=np.float32); dp[0, 0] = 0
    parent = np.zeros((n, m), dtype=np.uint8)
    for i in range(n):
        center = i*m/max(1, n)
        for j in range(max(0, int(center-m*.3-50)), min(m, int(center+m*.3+50))):
            candidates = (dp[i, j], dp[i, j+1]+.12, dp[i+1, j]+.12)
            k = int(np.argmin(candidates)); dp[i+1, j+1] = cost[i, j]+candidates[k]; parent[i, j] = k
    if not np.isfinite(dp[n, m]):
        raise ValueError('No constrained path')
    path = []; i, j = n-1, m-1
    while i >= 0 and j >= 0:
        path.append((i, j)); k = parent[i, j]
        if k == 0: i -= 1; j -= 1
        elif k == 1: i -= 1
        else: j -= 1
    path.reverse()
    mapping = {}
    for a, b in path: mapping.setdefault(a, []).append(b)
    proposals = []
    for beat in beats:
        a = min(n-1, int(beat*60/bpm/step)); targets = mapping.get(a, [])
        if targets: proposals.append(dict(beat=beat, seconds=float(np.median(targets)*step), method='interpolated', status='needs_review'))
    coarse_proposals = proposals
    attack_path = onset_alignment(notes, f)
    if attack_path and attack_path['anchors']:
        proposals = attack_path['anchors']
    note_evidence = []
    for item in notes:
        nearest = min(proposals, key=lambda p: abs(p['beat']-item['startBeat']))
        t = int((nearest['seconds']+.045)/f['step']); row = f['salience'][min(t, len(f['salience'])-1)]
        top = (np.argsort(row)[-8:][::-1]+21).tolist()
        note_evidence.append(dict(id=item['id'], expectedMidi=item['midi'], candidateSeconds=nearest['seconds'], candidatePitches=top, expectedInTop8=item['midi'] in top, status='needs_review'))
    measure_diagnostics = []
    for measure in dict.fromkeys(item['measureId'] for item in symbolic['events']):
        items = [item for item in symbolic['events'] if item['measureId'] == measure]
        lo = max(0, int(min(item['startBeat'] for item in items)*60/bpm/step))
        hi = min(n-1, int(max(item['endBeat'] for item in items)*60/bpm/step))
        matched = [(a, b) for a, b in path if lo <= a <= hi]
        measure_diagnostics.append(dict(measureId=measure, status='needs_review', candidateAudioStart=min((b for a,b in matched), default=0)*step,
            candidateAudioEnd=max((b for a,b in matched), default=0)*step, meanCost=float(np.mean([cost[a,b] for a,b in matched])) if matched else None))
    signatures = {}
    for measure in dict.fromkeys(item['measureId'] for item in symbolic['events']):
        items = [item for item in symbolic['events'] if item['measureId'] == measure]
        beginning = min(item['startBeat'] for item in items)
        # A warning only: identical pitch/rhythm passages may have several alignments.
        signature = json.dumps([(item['midi'],round(item['startBeat']-beginning,6),round(item['endBeat']-item['startBeat'],6)) for item in items])
        signatures.setdefault(signature, []).append(measure)
    return dict(candidateAnchors=proposals, coarseDtwAnchors=coarse_proposals, attackAlignment=attack_path, noteEvidence=note_evidence, measureDiagnostics=measure_diagnostics,
        structure=dict(status='needs_review', repeatedWrittenPassages=[v for v in signatures.values() if len(v)>1],
            extraOrMissingNotes='not_certified', arrangementIdentity='not_certified'), meanPathCost=float(dp[n, m]/len(path)), cells=int(n*m))


def main():
    p=argparse.ArgumentParser(); p.add_argument('--audio', required=True); p.add_argument('--events', required=True); p.add_argument('--out', required=True); p.add_argument('--bpm', type=float, required=True); p.add_argument('--ffmpeg', default='ffmpeg')
    a=p.parse_args(); dest=Path(a.out)
    if dest.exists(): raise ValueError('OUTPUT_EXISTS')
    began=time.perf_counter(); symbolic=json.loads(Path(a.events).read_text(encoding='utf-8-sig')); f=features(a.audio, a.ffmpeg)
    result=align(symbolic, f, a.bpm)
    result.update(schema='aiyoupu-analysis-candidate/v2', status='needs_review', accuracyCertified=False, scoreSha256=symbolic['scoreSha256'], audioSha256=hashlib.sha256(Path(a.audio).read_bytes()).hexdigest(), audioDuration=f['duration'], elapsedSeconds=time.perf_counter()-began, method='numpy-fft-pitch-chroma-dtw-and-short-window-attack-edit-path', limitations=['No calibrated pitch confidence; harmonic/pedal ambiguity.', 'Attack heuristics may miss soft/legato notes or add spurious peaks.', 'No automatic repeat/arrangement disambiguation.', 'Candidate anchors cannot authorize production or be relabeled observed.', 'No note-off estimation. Human/reference evidence is required.'])
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open('x', encoding='utf-8') as out: json.dump(result, out, ensure_ascii=False, indent=2)
    print(json.dumps(dict(status='needs_review', output=str(dest), elapsedSeconds=result['elapsedSeconds'])))


if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print(json.dumps(dict(status='blocked', error=str(exc), accuracyCertified=False))); raise SystemExit(2)
