type ChimeKind = 'approaching' | 'arriving';

let audioContext: AudioContext | null = null;

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext ??= new AudioContextConstructor();
  return audioContext;
}

export async function unlockArrivalChimes() {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state === 'suspended') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  }
}

export async function playArrivalChime(kind: ChimeKind) {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state === 'suspended') await context.resume();
  } catch {
    return false;
  }
  if (context.state !== 'running') return false;

  const notes = kind === 'approaching'
    ? [
        { frequency: 659.25, offset: 0, duration: 0.16 },
        { frequency: 880, offset: 0.18, duration: 0.22 },
        { frequency: 659.25, offset: 0.52, duration: 0.16 },
        { frequency: 880, offset: 0.7, duration: 0.22 },
        { frequency: 783.99, offset: 1.04, duration: 0.16 },
        { frequency: 987.77, offset: 1.22, duration: 0.32 },
      ]
    : [
        { frequency: 987.77, offset: 0, duration: 0.16 },
        { frequency: 783.99, offset: 0.18, duration: 0.16 },
        { frequency: 659.25, offset: 0.36, duration: 0.28 },
        { frequency: 987.77, offset: 0.72, duration: 0.16 },
        { frequency: 783.99, offset: 0.9, duration: 0.16 },
        { frequency: 659.25, offset: 1.08, duration: 0.42 },
      ];
  const start = context.currentTime + 0.02;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-18, start);
  compressor.knee.setValueAtTime(12, start);
  compressor.ratio.setValueAtTime(8, start);
  compressor.attack.setValueAtTime(0.003, start);
  compressor.release.setValueAtTime(0.18, start);
  compressor.connect(context.destination);

  for (const note of notes) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = start + note.offset;
    const noteEnd = noteStart + note.duration;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.34, noteStart + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain);
    gain.connect(compressor);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
  }
  return true;
}