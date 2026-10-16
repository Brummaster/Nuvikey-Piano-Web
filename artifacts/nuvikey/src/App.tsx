import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  AudioLines,
  AudioWaveform,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Music2,
  Volume2,
  Waves,
} from 'lucide-react';
import { useAudioEngine, type InstrumentId } from '@/hooks/use-audio-engine';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const INSTRUMENTS: { id: InstrumentId; label: string }[] = [
  { id: 'acoustic_grand_piano', label: 'Piano acústico' },
  { id: 'lead_2_sawtooth', label: 'Sintetizador' },
  { id: 'synth_brass_1', label: 'Rave Stab' },
  { id: 'electric_piano_1', label: 'Piano eléctrico' },
  { id: 'flute', label: 'Flauta' },
  { id: 'marimba', label: 'Marimba' },
  { id: 'clarinet', label: 'Clarinete' },
  { id: 'drawbar_organ', label: 'Órgano' },
  { id: 'violin', label: 'Violín' },
];

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const BLACK_PITCHES = new Set([1, 3, 6, 8, 10]);
const COMPUTER_KEYS = [
  'a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j',
  'k', 'o', 'l', 'p', ';', "'", ']', '\\', '2', '3', '5', '6',
];

type KeyDescription = { midi: number; label: string; isBlack: boolean; whiteIndex: number };

function noteName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function Keyboard({ octave, activeNotes, instrument, onStart, onStop }: {
  octave: number;
  activeNotes: number[];
  instrument: InstrumentId;
  onStart: (id: string, midi: number, instrument: InstrumentId, velocity?: number) => void;
  onStop: (id: string) => void;
}) {
  const pointerIds = useRef(new Map<number, string>());
  const keys = useMemo<KeyDescription[]>(() => {
    const startMidi = (octave + 1) * 12;
    let whiteIndex = 0;
    return Array.from({ length: 24 }, (_, offset) => {
      const midi = startMidi + offset;
      const isBlack = BLACK_PITCHES.has(midi % 12);
      const description = { midi, label: noteName(midi), isBlack, whiteIndex };
      if (!isBlack) whiteIndex += 1;
      return description;
    });
  }, [octave]);

  const press = useCallback((event: PointerEvent<HTMLButtonElement>, key: KeyDescription) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    const id = `pointer-${event.pointerId}`;
    pointerIds.current.set(event.pointerId, id);
    onStart(id, key.midi, instrument, event.pointerType === 'mouse' ? 0.76 : 0.86);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [instrument, onStart]);

  const release = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const id = pointerIds.current.get(event.pointerId);
    if (id) {
      onStop(id);
      pointerIds.current.delete(event.pointerId);
    }
  }, [onStop]);

  const whiteKeys = keys.filter((key) => !key.isBlack);
  const blackKeys = keys.filter((key) => key.isBlack);

  return (
    <div className="keybed" aria-label={`Teclado de piano de ${octave} octavas`} data-testid="keyboard">
      {whiteKeys.map((key) => (
        <button
          key={key.midi}
          type="button"
          className={`white-key${activeNotes.includes(key.midi) ? ' active' : ''}`}
          aria-label={`Tocar ${key.label}`}
          aria-pressed={activeNotes.includes(key.midi)}
          data-testid={`key-${key.label.replace('♯', 'sharp')}`}
          onPointerDown={(event) => press(event, key)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        >
          <span className="key-note">{key.label}</span>
        </button>
      ))}
      {blackKeys.map((key) => (
        <button
          key={key.midi}
          type="button"
          className={`black-key${activeNotes.includes(key.midi) ? ' active' : ''}`}
          style={{ left: `${((key.whiteIndex - 0.29) / 14) * 100}%` }}
          aria-label={`Tocar ${key.label}`}
          aria-pressed={activeNotes.includes(key.midi)}
          data-testid={`key-${key.label.replace('♯', 'sharp')}`}
          onPointerDown={(event) => press(event, key)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        >
          <span className="key-note">{key.label}</span>
        </button>
      ))}
    </div>
  );
}

function Home() {
  const [instrument, setInstrument] = useState<InstrumentId>('acoustic_grand_piano');
  const [octave, setOctave] = useState(3);
  const [volume, setVolume] = useState(0.78);
  const [reverb, setReverb] = useState(0.38);
  const engine = useAudioEngine();
  const heldPhysicalKeys = useRef(new Map<string, string>());
  const selectedName = INSTRUMENTS.find((item) => item.id === instrument)?.label ?? 'Piano acústico';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = COMPUTER_KEYS.indexOf(event.key.toLowerCase());
      if (index < 0) return;
      event.preventDefault();
      const id = `physical-${event.key.toLowerCase()}`;
      heldPhysicalKeys.current.set(event.key.toLowerCase(), id);
      engine.startNote(id, (octave + 1) * 12 + index, instrument, 0.76);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const id = heldPhysicalKeys.current.get(event.key.toLowerCase());
      if (id) {
        engine.stopNote(id);
        heldPhysicalKeys.current.delete(event.key.toLowerCase());
      }
    };
    const onBlur = () => {
      heldPhysicalKeys.current.forEach((id) => engine.stopNote(id));
      heldPhysicalKeys.current.clear();
      engine.stopAll();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [engine.startNote, engine.stopNote, engine.stopAll, instrument, octave]);

  const shiftOctave = (delta: number) => {
    setOctave((current) => Math.max(1, Math.min(6, current + delta)));
    engine.stopAll();
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><AudioWaveform size={19} strokeWidth={2.4} /></div>
          <div className="brand-name">nuvi<span style={{ color: '#c2ed58' }}>key</span></div>
          <span className="brand-tag">toca el momento</span>
        </div>
        <div className="top-right">
          <span className={`live-dot${engine.status === 'loading' ? ' status-dot loading' : ''}`} />
          <span data-testid="status-engine">{engine.status === 'ready' ? 'Listo para tocar' : 'Estudio en línea'}</span>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div>
          <div className="eyebrow">Tu instrumento de bolsillo</div>
          <h1 id="page-title">Encuentra tu <span>sonido.</span></h1>
        </div>
        <p className="hero-note">Un espacio para tocar.<br />Sin ajustes. Solo sonido.</p>
      </section>

      <section className="control-deck" aria-label="Controles de instrumento y sonido">
        <div className="control-card instrument-control">
          <div className="control-heading"><span>01 / Instrumento</span><AudioLines size={14} /></div>
          <div className="instrument-select" role="group" aria-label="Elige un instrumento">
            {INSTRUMENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="instrument-button"
                aria-pressed={instrument === item.id}
                aria-label={`Seleccionar ${item.label}`}
                data-testid={`instrument-${item.id}`}
                onClick={() => setInstrument(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-card">
          <div className="control-heading"><span>02 / Salida</span><Volume2 size={14} /></div>
          <label className="sr-only" htmlFor="volume-level">Volumen general</label>
          <div className="range-row">
            <input
              id="volume-level"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              aria-label="Volumen general"
              data-testid="input-volume"
              onChange={(event) => {
                const value = Number(event.target.value);
                setVolume(value);
                engine.setVolume(value);
              }}
            />
            <span className="range-value" data-testid="text-volume">{Math.round(volume * 100)}%</span>
          </div>
          <span className="instrument-current" data-testid="text-current-instrument">{selectedName}</span>
        </div>

        <div className="control-card">
          <div className="control-heading"><span>03 / Espacio</span><Waves size={14} /></div>
          <label className="sr-only" htmlFor="reverb-level">Cantidad de reverberación</label>
          <div className="range-row">
            <input
              id="reverb-level"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={reverb}
              aria-label="Cantidad de reverberación"
              data-testid="input-reverb"
              onChange={(event) => {
                const value = Number(event.target.value);
                setReverb(value);
                engine.setReverb(value);
              }}
            />
            <span className="range-value" data-testid="text-reverb">{Math.round(reverb * 100)}%</span>
          </div>
          <span className="instrument-current">Resonancia de sala</span>
        </div>

        <div className="control-card octave-card">
          <div className="control-heading"><span>04 / Registro</span><Music2 size={14} /></div>
          <div className="octave-actions">
            <button type="button" className="icon-button" aria-label="Bajar una octava" data-testid="button-octave-down" disabled={octave <= 1} onClick={() => shiftOctave(-1)}>
              <ChevronDown size={16} />
            </button>
            <span className="octave-number" data-testid="text-octave">C{octave} <small>— C{octave + 2}</small></span>
            <button type="button" className="icon-button" aria-label="Subir una octava" data-testid="button-octave-up" disabled={octave >= 6} onClick={() => shiftOctave(1)}>
              <ChevronUp size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="keyboard-wrap" aria-label="Teclado musical">
        <div className="keyboard-topline">
          <div className="keyboard-caption"><span className="live-dot" /><span>Dos octavas</span><span className="key-count">/ 24 teclas</span></div>
          <span className="keyboard-hint">Toca, haz clic o usa el teclado del ordenador</span>
        </div>
        <Keyboard
          octave={octave}
          activeNotes={engine.activeNotes}
          instrument={instrument}
          onStart={engine.startNote}
          onStop={engine.stopNote}
        />
        <div className="keyboard-bottom">
          <span>Mapa de teclas <strong>A — ' / 24 notas</strong></span>
          <span>Respuesta <strong>dinámica</strong></span>
        </div>
      </section>

      <section className="bottom-row" aria-label="Controles de interpretación">
        <div className="utility-card">
          <div>
            <div className="utility-title">Pedal de sustain</div>
            <div className="utility-sub">Mantén las notas al soltar las teclas</div>
          </div>
          <div className="sustain-pedal">
            <span className="sr-only" data-testid="status-sustain">{engine.sustain ? 'Sustain activado' : 'Sustain desactivado'}</span>
            <button
              type="button"
              className="pedal"
              aria-pressed={engine.sustain}
              aria-label="Activar o desactivar el pedal de sustain"
              data-testid="button-sustain"
              onClick={() => engine.setSustain(!engine.sustain)}
            >
              {engine.sustain ? 'Sustain activado' : 'Sustain desactivado'}
            </button>
          </div>
        </div>

        <div className="utility-card">
          <div>
            <div className="utility-title">Metrónomo</div>
            <div className="utility-sub" data-testid="status-metronome">{engine.metronome ? 'Marcando el ritmo' : 'Elige tu tempo'}</div>
          </div>
          <div className="tempo-control">
            <label className="sr-only" htmlFor="tempo">Tempo en pulsos por minuto</label>
            <input
              id="tempo"
              type="range"
              min="50"
              max="180"
              step="1"
              value={engine.bpm}
              aria-label="Tempo del metrónomo"
              data-testid="input-tempo"
              onChange={(event) => engine.setTempo(Number(event.target.value))}
            />
            <span className="tempo-number" data-testid="text-tempo">{engine.bpm}</span>
            <button
              type="button"
              className="pedal"
              aria-pressed={engine.metronome}
              aria-label={engine.metronome ? 'Apagar el metrónomo' : 'Encender el metrónomo'}
              data-testid="button-metronome"
              onClick={() => engine.toggleMetronome(engine.bpm)}
            >
              {engine.metronome ? 'Detener' : 'Iniciar'}
            </button>
          </div>
        </div>
      </section>

      <div className="status-line" role="status" aria-live="polite" data-testid="status-audio">
        <span className={`status-dot ${engine.status}`} />
        <span className="status-message">{engine.statusMessage}</span>
        {engine.status === 'error' && (
          <button
            className="icon-button"
            type="button"
            aria-label="Reintentar la carga de muestras"
            data-testid="button-retry-audio"
            onClick={() => engine.prepareInstrument(instrument)}
          >
            <AudioLines size={13} />
          </button>
        )}
      </div>

      <footer className="footer">
        <span>NUVIKEY <span style={{ color: '#a8cc59' }}>·</span> SONIDO, SIN COMPLICACIONES</span>
        <span className="footer-credit">
          Muestras FluidR3_GM ·{' '}
          <a href="https://github.com/gleitz/midi-js-soundfonts" target="_blank" rel="noreferrer">MIDI.js Soundfonts / Benjamin Gleitzman</a>
          {' '}· <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a>
        </span>
        <span className="footer-right">Pulsa <strong>A</strong> para tocar <CircleHelp size={11} style={{ verticalAlign: 'middle', marginLeft: 5 }} /></span>
      </footer>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
