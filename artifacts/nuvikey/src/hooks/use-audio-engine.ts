import { useCallback, useEffect, useRef, useState } from 'react';

export type InstrumentId =
  | 'acoustic_grand_piano'
  | 'lead_2_sawtooth'
  | 'synth_brass_1'
  | 'electric_piano_1'
  | 'flute'
  | 'marimba'
  | 'clarinet'
  | 'drawbar_organ'
  | 'violin';

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'error';

const SOUND_FONT_ROOT =
  'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';
const SAMPLE_ROOTS = [24, 36, 48, 60, 72, 84, 96];
const SUSTAINED_INSTRUMENTS = new Set<InstrumentId>([
  'lead_2_sawtooth',
  'electric_piano_1',
  'flute',
  'clarinet',
  'drawbar_organ',
  'violin',
]);
const INSTRUMENT_NAMES: Record<InstrumentId, string> = {
  acoustic_grand_piano: 'piano acústico',
  lead_2_sawtooth: 'sintetizador',
  synth_brass_1: 'Rave Stab',
  electric_piano_1: 'piano eléctrico',
  flute: 'flauta',
  marimba: 'marimba',
  clarinet: 'clarinete',
  drawbar_organ: 'órgano',
  violin: 'violín',
};
const ROOT_NAMES: Record<number, string> = {
  0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
  6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
};

interface AudioVoice {
  id: string;
  note: number;
  startedAt: number;
  sourceNodes: AudioBufferSourceNode[];
  envelope: GainNode;
  released: boolean;
  pendingRelease: boolean;
  looped: boolean;
  stopping: boolean;
  remainingSources: number;
}

interface AudioGraph {
  context: AudioContext;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;
}

const sampleCache = new Map<InstrumentId, Promise<Map<number, AudioBuffer>>>();

function makeImpulse(context: AudioContext, seconds = 2.35) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const decay = Math.pow(1 - i / length, 3.2);
      data[i] = (Math.random() * 2 - 1) * decay * (channel === 0 ? 1 : 0.94);
    }
  }
  return impulse;
}

function getGraph(graphRef: { current: AudioGraph | null }) {
  if (graphRef.current) return graphRef.current;
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Este navegador no admite audio web.');
  const context = new AudioContextConstructor();
  const master = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const convolver = context.createConvolver();
  const limiter = context.createDynamicsCompressor();
  convolver.buffer = makeImpulse(context);
  limiter.threshold.value = -16;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.24;
  dry.connect(limiter);
  wet.connect(convolver);
  convolver.connect(limiter);
  limiter.connect(master);
  master.connect(context.destination);
  master.gain.value = 0.78 * 0.68;
  wet.gain.value = 0.28;
  graphRef.current = { context, master, limiter, dry, wet, convolver };
  return graphRef.current;
}

async function loadBank(context: AudioContext, instrument: InstrumentId) {
  const cached = sampleCache.get(instrument);
  if (cached) return cached;
  const pending = Promise.all(
    SAMPLE_ROOTS.map(async (midi) => {
      const octave = Math.floor(midi / 12) - 1;
      const noteName = `${ROOT_NAMES[midi % 12]}${octave}`;
      const url = `${SOUND_FONT_ROOT}/${instrument}-mp3/${noteName}.mp3`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`No se pudo cargar una muestra de audio (${response.status}).`);
      const audioData = await response.arrayBuffer();
      return [midi, await context.decodeAudioData(audioData)] as const;
    }),
  ).then((entries) => new Map<number, AudioBuffer>(entries));
  sampleCache.set(instrument, pending);
  try {
    return await pending;
  } catch (error) {
    sampleCache.delete(instrument);
    throw error;
  }
}

function nearestSample(bank: Map<number, AudioBuffer>, note: number) {
  let closest = SAMPLE_ROOTS[0];
  for (const root of bank.keys()) {
    if (Math.abs(root - note) < Math.abs(closest - note)) closest = root;
  }
  const buffer = bank.get(closest);
  if (!buffer) throw new Error('Las muestras del instrumento seleccionado no están disponibles.');
  return { buffer, root: closest };
}

function findSmoothLoop(buffer: AudioBuffer) {
  if (buffer.duration < 0.7) return null;
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const sampleAt = (seconds: number) => data[Math.min(data.length - 1, Math.floor(seconds * rate))] ?? 0;
  const startMinimum = 0.12;
  const startMaximum = Math.min(0.42, buffer.duration * 0.35);
  const endMinimum = Math.max(startMaximum + 0.2, 0.55);
  const endMaximum = Math.min(1.4, buffer.duration - 0.08);
  if (endMaximum <= endMinimum) return null;
  let bestStart = startMinimum;
  let bestEnd = endMinimum;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let start = startMinimum; start <= startMaximum; start += 0.004) {
    const beforeStart = sampleAt(start - 0.003);
    const valueStart = sampleAt(start);
    const slopeStart = valueStart - beforeStart;
    for (let end = endMinimum; end <= endMaximum; end += 0.004) {
      const beforeEnd = sampleAt(end - 0.003);
      const valueEnd = sampleAt(end);
      const slopeEnd = valueEnd - beforeEnd;
      const score = Math.abs(valueStart - valueEnd) + Math.abs(slopeStart - slopeEnd) * 2;
      if (score < bestScore) {
        bestScore = score;
        bestStart = start;
        bestEnd = end;
      }
    }
  }
  return { start: bestStart, end: bestEnd };
}

export function useAudioEngine() {
  const graphRef = useRef<AudioGraph | null>(null);
  const voicesRef = useRef(new Map<string, AudioVoice>());
  const allVoicesRef = useRef(new Set<AudioVoice>());
  const pendingRef = useRef(new Map<string, symbol>());
  const cancelledRef = useRef(new Set<symbol>());
  const sustainRef = useRef(false);
  const volumeRef = useRef(0.78);
  const reverbRef = useRef(0.38);
  const metronomeRef = useRef<number | null>(null);
  const beatRef = useRef(0);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Toca una tecla para empezar');
  const [sustain, setSustainState] = useState(false);
  const [metronome, setMetronomeState] = useState(false);
  const [bpm, setBpmState] = useState(96);

  const syncNotes = useCallback(() => {
    const notes = Array.from(voicesRef.current.values())
      .filter((voice) => !voice.released)
      .map((voice) => voice.note);
    setActiveNotes(Array.from(new Set(notes)));
  }, []);

  const releaseVoice = useCallback((voice: AudioVoice, fast = false, forceStop = false) => {
    if (voice.released && !forceStop) return;
    if (voice.stopping) return;
    voice.released = true;
    if (voicesRef.current.get(voice.id) === voice) voicesRef.current.delete(voice.id);
    syncNotes();
    voice.stopping = true;
    const graph = graphRef.current;
    if (!graph) return;
    const now = graph.context.currentTime;
    const duration = fast ? 0.035 : 0.28;
    voice.envelope.gain.cancelScheduledValues(now);
    voice.envelope.gain.setValueAtTime(Math.max(voice.envelope.gain.value, 0.0001), now);
    voice.envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    voice.sourceNodes.forEach((source) => {
      try {
        source.stop(now + duration + 0.025);
      } catch {
        // A source can already be ending after a rapid repeated key press.
      }
    });
  }, [syncNotes]);

  const startNote = useCallback(async (
    id: string,
    note: number,
    instrument: InstrumentId,
    velocity = 0.82,
  ) => {
    const existing = voicesRef.current.get(id);
    if (existing) releaseVoice(existing, true, true);
    const previousPending = pendingRef.current.get(id);
    if (previousPending) cancelledRef.current.add(previousPending);
    const token = Symbol(id);
    const graph = getGraph(graphRef);
    graph.master.gain.value = volumeRef.current * 0.68;
    graph.wet.gain.value = reverbRef.current * 0.72;
    graph.dry.gain.value = 1 - reverbRef.current * 0.16;
    pendingRef.current.set(id, token);
    try {
      await graph.context.resume();
      setStatus('loading');
      setStatusMessage(`Cargando muestras de ${INSTRUMENT_NAMES[instrument]}`);
      const bank = await loadBank(graph.context, instrument);
      if (cancelledRef.current.has(token) || pendingRef.current.get(id) !== token) {
        if (pendingRef.current.get(id) === token) {
          setStatus('ready');
          setStatusMessage('Muestras listas');
        }
        return;
      }
      const now = graph.context.currentTime;
      const { buffer, root } = nearestSample(bank, note);
      const envelope = graph.context.createGain();
      const isRave = instrument === 'synth_brass_1';
      const looped = SUSTAINED_INSTRUMENTS.has(instrument);
      const initialGain = Math.max(0.0001, velocity * (isRave ? 0.35 : 0.68));
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(initialGain, now + 0.012);
      envelope.connect(graph.dry);
      envelope.connect(graph.wet);

      const sourceNodes: AudioBufferSourceNode[] = [];
      const layers = isRave ? [
        { semitones: 0, cents: -7, level: 0.63 },
        { semitones: 7, cents: 5, level: 0.24 },
        { semitones: 12, cents: 9, level: 0.16 },
      ] : [{ semitones: 0, cents: 0, level: 1 }];
      layers.forEach((layer) => {
        const sample = nearestSample(bank, note + layer.semitones);
        const source = graph.context.createBufferSource();
        const layerGain = graph.context.createGain();
        source.buffer = sample.buffer;
        source.playbackRate.value =
          2 ** ((note + layer.semitones - sample.root) / 12) * 2 ** (layer.cents / 1200);
        layerGain.gain.value = layer.level;
        source.connect(layerGain);
        layerGain.connect(envelope);
        if (looped) {
          const loop = findSmoothLoop(sample.buffer);
          if (loop) {
            source.loop = true;
            source.loopStart = loop.start;
            source.loopEnd = loop.end;
          }
        }
        source.start(now);
        sourceNodes.push(source);
      });
      const voice: AudioVoice = {
        id, note, startedAt: performance.now(), sourceNodes, envelope, released: false,
        pendingRelease: false, looped, stopping: false, remainingSources: sourceNodes.length,
      };
      sourceNodes.forEach((source) => {
        source.onended = () => {
          voice.remainingSources -= 1;
          if (voice.remainingSources > 0) return;
          allVoicesRef.current.delete(voice);
          if (voicesRef.current.get(voice.id) === voice) voicesRef.current.delete(voice.id);
          syncNotes();
        };
      });
      voicesRef.current.set(id, voice);
      allVoicesRef.current.add(voice);
      if (allVoicesRef.current.size > 32) {
        const oldest = Array.from(allVoicesRef.current)
          .sort((a, b) => a.startedAt - b.startedAt)[0];
        if (oldest && oldest !== voice) releaseVoice(oldest, true, true);
      }
      setStatus('ready');
      setStatusMessage('Muestras listas');
      syncNotes();
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'No se pudieron cargar las muestras.');
    } finally {
      if (pendingRef.current.get(id) === token) pendingRef.current.delete(id);
      cancelledRef.current.delete(token);
    }
  }, [releaseVoice, syncNotes]);

  const stopNote = useCallback((id: string) => {
    const token = pendingRef.current.get(id);
    if (token) cancelledRef.current.add(token);
    const voice = voicesRef.current.get(id);
    if (!voice) return;
    if (sustainRef.current) {
      voice.pendingRelease = true;
      return;
    }
    releaseVoice(voice);
  }, [releaseVoice]);

  const stopAll = useCallback(() => {
    pendingRef.current.forEach((token) => cancelledRef.current.add(token));
    sustainRef.current = false;
    setSustainState(false);
    allVoicesRef.current.forEach((voice) => releaseVoice(voice, true, true));
  }, [releaseVoice]);

  const setVolume = useCallback((value: number) => {
    volumeRef.current = value;
    if (graphRef.current) {
      graphRef.current.master.gain.setTargetAtTime(value * 0.68, graphRef.current.context.currentTime, 0.025);
    }
  }, []);

  const setReverb = useCallback((value: number) => {
    reverbRef.current = value;
    if (graphRef.current) {
      graphRef.current.wet.gain.setTargetAtTime(value * 0.72, graphRef.current.context.currentTime, 0.04);
      graphRef.current.dry.gain.setTargetAtTime(1 - value * 0.16, graphRef.current.context.currentTime, 0.04);
    }
  }, []);

  const setSustain = useCallback((enabled: boolean) => {
    sustainRef.current = enabled;
    setSustainState(enabled);
    if (!enabled) voicesRef.current.forEach((voice) => {
      if (voice.pendingRelease) releaseVoice(voice);
    });
  }, [releaseVoice]);

  const toggleMetronome = useCallback((tempo = bpm) => {
    const graph = getGraph(graphRef);
    void graph.context.resume();
    if (metronomeRef.current !== null) {
      window.clearInterval(metronomeRef.current);
      metronomeRef.current = null;
      setMetronomeState(false);
      return;
    }
    beatRef.current = 0;
    const tick = () => {
      const currentGraph = graphRef.current;
      if (!currentGraph) return;
      const context = currentGraph.context;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = beatRef.current % 4 === 0 ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.048);
      oscillator.connect(gain);
      gain.connect(currentGraph.master);
      oscillator.start(now);
      oscillator.stop(now + 0.055);
      beatRef.current += 1;
    };
    tick();
    metronomeRef.current = window.setInterval(tick, 60000 / tempo);
    setMetronomeState(true);
  }, [bpm]);

  const setTempo = useCallback((tempo: number) => {
    setBpmState(tempo);
    if (metronomeRef.current !== null) {
      window.clearInterval(metronomeRef.current);
      metronomeRef.current = window.setInterval(() => {
        const currentGraph = graphRef.current;
        if (!currentGraph) return;
        const now = currentGraph.context.currentTime;
        const oscillator = currentGraph.context.createOscillator();
        const gain = currentGraph.context.createGain();
        oscillator.frequency.value = beatRef.current++ % 4 === 0 ? 1320 : 880;
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        oscillator.connect(gain);
        gain.connect(currentGraph.master);
        oscillator.start(now);
        oscillator.stop(now + 0.055);
      }, 60000 / tempo);
    }
  }, []);

  const prepareInstrument = useCallback(async (instrument: InstrumentId) => {
    try {
      const graph = getGraph(graphRef);
      graph.master.gain.value = volumeRef.current * 0.68;
      graph.wet.gain.value = reverbRef.current * 0.72;
      graph.dry.gain.value = 1 - reverbRef.current * 0.16;
      await graph.context.resume();
      setStatus('loading');
      setStatusMessage(`Cargando muestras de ${INSTRUMENT_NAMES[instrument]}`);
      await loadBank(graph.context, instrument);
      setStatus('ready');
      setStatusMessage('Muestras listas');
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'No se pudieron cargar las muestras.');
    }
  }, []);

  useEffect(() => {
    const releaseOnBlur = () => stopAll();
    const releaseOnHide = () => {
      if (document.visibilityState === 'hidden') stopAll();
    };
    window.addEventListener('blur', releaseOnBlur);
    document.addEventListener('visibilitychange', releaseOnHide);
    return () => {
      window.removeEventListener('blur', releaseOnBlur);
      document.removeEventListener('visibilitychange', releaseOnHide);
      if (metronomeRef.current !== null) window.clearInterval(metronomeRef.current);
      allVoicesRef.current.forEach((voice) => releaseVoice(voice, true, true));
      graphRef.current?.context.close();
    };
  }, [releaseVoice, stopAll]);

  return {
    activeNotes,
    status,
    statusMessage,
    sustain,
    metronome,
    bpm,
    startNote,
    stopNote,
    stopAll,
    setVolume,
    setReverb,
    setSustain,
    toggleMetronome,
    setTempo,
    prepareInstrument,
  };
}
