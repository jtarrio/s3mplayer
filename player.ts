import { Channel, Command, Instrument, Song } from "./song";

export type Options = {
  context?: BaseAudioContext;
  destination?: AudioNode;
};

export class Player extends EventTarget {
  constructor(private song: Song, options?: Options) {
    super();
    this.speed = song.speed;
    this.tempo = song.tempo;
    this.order = 0;
    this.row = 0;
    this.currentTick = this.speed;
    this.jump = false;
    this.break = false;
    this.running = false;
    this.timePlayed = 0;
    this.startTime = 0;
    this.ctx = options?.destination?.context || options?.context;
    this.destination = options?.destination;
    this.globalVolume;
    this.channels = new Map();
    this.samples = [];
  }

  public speed: number;
  public tempo: number;
  private order: number;
  private row: number;
  private currentTick: number;
  private jump: boolean;
  private break: boolean;
  private running: boolean;
  private timePlayed: number;
  private startTime: number;
  private ctx?: BaseAudioContext;
  private destination?: AudioNode;
  private globalVolume?: GainNode;
  private channels: Map<number, ChannelPlayer>;
  private samples: Sample[];

  play() {
    this.init();
    this.startTime = this.ctx!.currentTime - this.timePlayed;
    this.currentTick = this.speed;
    this.running = true;
    this.doFrame();
  }

  stop() {
    this.running = false;
    this.channels.forEach((c) => c.stop());
  }

  getSample(num: number): Sample {
    return this.samples[num];
  }

  jumpToOrder(order: number) {
    this.row = -1;
    if (!this.break && !this.jump) {
      this.order = order;
      if (this.order >= this.song.orders.length) this.order = 0;
    }
    this.jump = true;
  }

  breakPattern(row: number) {
    this.row = row - 1;
    if (row > 62) this.row = -1;
    if (!this.break && !this.jump) {
      ++this.order;
      if (this.order >= this.song.orders.length) this.order = 0;
    }
    this.break = true;
  }

  get tick(): number {
    return this.currentTick;
  }

  get volume(): number {
    return this.globalVolume ? this.globalVolume.gain.value : this.song.volume;
  }

  set volume(volume: number) {
    if (this.globalVolume) {
      this.globalVolume.gain.value = volume;
    } else {
      this.song.volume = volume;
    }
  }

  addEventListener<K extends keyof PlayerEventMap>(
    type: K,
    listener: (this: Player, ev: PlayerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: any,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options
    );
  }

  private init() {
    if (this.globalVolume) return;
    if (!this.ctx) this.ctx = new AudioContext();
    if (!this.destination) this.destination = this.ctx.destination;
    this.globalVolume = this.ctx!.createGain();
    this.globalVolume.gain.value = this.song.volume;
    this.globalVolume.connect(this.destination);
    this.startTime = this.ctx.currentTime;
    this.song.channels.forEach((channel, num) =>
      this.channels.set(
        num,
        new ChannelPlayer(
          this.destination!,
          this,
          this.song.flags.fastVolumeSlide,
          channel
        )
      )
    );
    this.song.instruments.forEach((instrument) =>
      this.samples.push(sampleFromInstrument(this.ctx!, instrument))
    );
  }

  private doFrame() {
    while (this.ctx!.currentTime - this.startTime > this.timePlayed) {
      this.doTick();
      this.timePlayed += 2.5 / this.tempo;
    }
    if (this.running) requestAnimationFrame(() => this.doFrame());
  }

  private doTick() {
    if (!this.running) return;

    this.currentTick++;
    if (this.currentTick < this.speed) {
      this.updateEffects();
      return;
    }
    if (!this.running) {
      this.stop();
      return;
    }
    if (this.row >= 64) {
      this.row = 0;
      this.order++;
    }
    if (this.order == this.song.orders.length) {
      this.stop();
      return;
    }
    let proceed = this.dispatchEvent(
      new BeforePlayEvent({ order: this.order, row: this.row })
    );
    if (!proceed) {
      this.stop();
      return;
    }
    this.break = false;
    this.jump = false;
    this.currentTick = 0;
    this.doRow();
    this.row++;
  }

  private doRow() {
    let pattern = this.song.patterns[this.song.orders[this.order]];
    let row = pattern[this.row];
    this.channels.forEach((chn) => chn.doRow());
    for (const cmd of row) {
      this.channels.get(cmd.channel)!.doCommand(cmd);
    }
  }

  private updateEffects() {
    this.channels.forEach((chn) => chn.updateEffects());
  }
}

export type Measure = { order: number; row: number };
abstract class PlayerEvent extends CustomEvent<Measure> {
  constructor(type: string, measure: Measure) {
    super(type, { detail: measure, bubbles: true, cancelable: true });
  }
}

export class BeforePlayEvent extends PlayerEvent {
  constructor(measure: Measure) {
    super("before-play", measure);
  }
}

interface PlayerEventMap {
  "before-play": BeforePlayEvent;
}

enum Effect {
  Speed = 1,
  Jump = 2,
  Break = 3,
  Slide = 4,
  PitchDown = 5,
  PitchUp = 6,
  NotePortamento = 7,
  Vibrato = 8,
  Tremor = 9,
  Arpeggio = 10,
  VibratoSlide = 11,
  PortaSlide = 12,
  Offset = 15,
  Retrig = 17,
  Tremolo = 18,
  SMulti = 19,
  Tempo = 20,
  FineVibrato = 21,
  Volume = 22,
}

enum Subeffect {
  NoteDelay = 0x0d,
}

const kVibratoWave = [
  // 0-7
  0, 24, 49, 74, 97, 120, 141, 161,
  // 8-15
  180, 197, 212, 224, 235, 244, 250, 253,
  // 16-23
  255, 253, 250, 244, 235, 224, 212, 197,
  // 24-31
  180, 161, 141, 120, 97, 74, 49, 24,
];

const kNotePeriods = [
  // C0
  27392, 25856, 24384, 23040, 21696, 20480, 19328, 18240, 17216, 16256, 15360,
  14496,
  // C1
  13696, 12928, 12192, 11520, 10848, 10240, 9664, 9120, 8608, 8128, 7680, 7248,
  // C2
  6848, 6464, 6096, 5760, 5424, 5120, 4832, 4560, 4304, 4064, 3840, 3624,
  // C3
  3424, 3232, 3048, 2880, 2712, 2560, 2416, 2280, 2152, 2032, 1920, 1812,
  // C4
  1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 906,
  // C5
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  // C6
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  // C7
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
  // C8
  107, 101, 95, 90, 85, 80, 75, 71, 67, 63, 60, 56,
];

const kC2Spd = 8363;
const kC2Period = kNotePeriods[48];
const kSysFrequency = kC2Spd * kC2Period;

class ChannelPlayer {
  constructor(
    destination: AudioNode,
    private player: Player,
    private fastVolumeSlide: boolean,
    channel: Channel
  ) {
    this.ctx = destination.context;
    this.gain = this.ctx.createGain();
    this.panner = this.ctx.createStereoPanner();
    this.effectInfo = new EffectInfo();
    this.state = NewChannelState();
    this.nextState = EmptyNextState();

    this.gain.gain.value = 1;
    this.panner.pan.value = channel.pan;
    this.gain.connect(this.panner);
    this.panner.connect(destination);
  }

  private ctx: BaseAudioContext;
  private gain: GainNode;
  private panner: StereoPannerNode;
  private sound?: AudioBufferSourceNode;
  private effectInfo: EffectInfo;
  private state: ChannelState;
  private nextState: NextState;

  stop() {
    if (!this.sound) return;
    this.sound.stop();
    this.sound = undefined;
  }

  doRow() {
    this.effectInfo.currentEffect = undefined;
  }

  doCommand(cmd: Command) {
    let trigger = false;
    let note = this.state.note;
    let sample = this.state.sample;
    let period = this.state.period;

    if (cmd.instrument !== undefined) {
      sample = this.player.getSample(cmd.instrument);
      this.nextState.volume = sample?.volume || 64;
      this.nextState.volumeDelta = 0;
    }

    if (cmd.note == "off") {
      note = "off";
      period = kC2Spd;
      trigger = true;
    } else if (cmd.note !== undefined) {
      note = cmd.note;
      let middleCFreq = sample?.middleCFreq || kC2Spd;
      period = (kC2Spd * kNotePeriods[note]) / middleCFreq;
      trigger = cmd.effect?.number != Effect.NotePortamento;
    }

    if (trigger) {
      this.nextState.note = note;
      this.nextState.period = period;
      this.nextState.sample = sample;
    }

    if (cmd.volume !== undefined) {
      this.nextState.volume = cmd.volume;
      this.nextState.volumeDelta = 0;
    }

    if (cmd.effect && cmd.effect.number != 0) {
      this.effectInfo.currentEffect = cmd.effect.number;
      switch (cmd.effect.number) {
        case Effect.Speed:
          this.player.speed = cmd.effect.info;
          break;
        case Effect.Jump:
          this.player.jumpToOrder(cmd.effect.info);
          break;
        case Effect.Break:
          let row =
            ((cmd.effect.info & 0xf0) >> 4) * 10 + (cmd.effect.info & 0x0f);
          this.player.breakPattern(row);
          break;
        case Effect.Slide:
          if (cmd.effect.info) this.effectInfo.slideSpeed = cmd.effect.info;
          this.doEffectSlide();
          break;
        case Effect.PitchDown:
          if (cmd.effect.info)
            this.effectInfo.portamentoSpeed = cmd.effect.info;
          this.doEffectPitchDown();
          break;
        case Effect.PitchUp:
          if (cmd.effect.info)
            this.effectInfo.portamentoSpeed = cmd.effect.info;
          this.doEffectPitchUp();
          break;
        case Effect.NotePortamento:
          if (cmd.note !== undefined && cmd.note !== "off") {
            this.effectInfo.periodToPortamento = period;
            this.nextState.period = undefined;
          }
          if (cmd.effect.info)
            this.effectInfo.portamentoSpeed = cmd.effect.info;
          break;
        case Effect.Vibrato:
          if (cmd.effect.info & 0xf0) {
            this.effectInfo.vibrato = cmd.effect.info;
          } else if (cmd.effect.info & 0x0f) {
            this.effectInfo.vibrato &= 0xf0;
            this.effectInfo.vibrato |= cmd.effect.info & 0x0f;
          }
          this.doEffectVibrato();
          break;
        case Effect.Tremor:
          this.effectInfo.tremor = cmd.effect.info;
          this.doEffectTremor();
          break;
        case Effect.Arpeggio:
          if (cmd.effect.info) this.effectInfo.arpeggio = cmd.effect.info;
          break;
        case Effect.VibratoSlide:
          if (cmd.effect.info) this.effectInfo.slideSpeed = cmd.effect.info;
          break;
        case Effect.PortaSlide:
          if (cmd.effect.info) this.effectInfo.slideSpeed = cmd.effect.info;
          break;
        case Effect.Offset:
          this.doEffectOffset(cmd.effect.info);
          break;
        case Effect.Retrig:
          if (cmd.effect.info) this.effectInfo.retrig = cmd.effect.info;
          break;
        case Effect.Tremolo:
          if (cmd.effect.info) this.effectInfo.tremolo = cmd.effect.info;
          break;
        case Effect.SMulti:
          this.effectInfo.currentSubeffect = (cmd.effect.info & 0xf0) >> 4;
          let subinfo = cmd.effect.info & 0x0f;
          switch (this.effectInfo.currentSubeffect) {
            case Subeffect.NoteDelay:
              this.effectInfo.noteDelay = subinfo;
              this.effectInfo.stateChange = this.nextState;
              this.nextState = EmptyNextState();
              break;
            default:
              console.log(
                `Unknown subeffect: ${this.effectInfo.currentSubeffect
                  .toString()
                  .toUpperCase()}`
              );
          }
          break;
        case Effect.Tempo:
          this.player.tempo = cmd.effect.info;
          break;
        case Effect.FineVibrato:
          if (cmd.effect.info) this.effectInfo.vibrato = cmd.effect.info;
          this.doEffectVibrato(true);
          break;
        case Effect.Volume:
          this.player.volume = Math.max(Math.min(cmd.effect.info / 64), 1);
          break;
        default:
          console.log(
            `Unknown effect: ${String.fromCharCode(64 + cmd.effect.number)} (${
              cmd.effect.number
            })`
          );
      }
    }

    this.applyNextState();
  }

  updateEffects() {
    switch (this.effectInfo.currentEffect) {
      case undefined:
        break;
      case Effect.Slide:
        this.doEffectSlide();
        break;
      case Effect.PitchDown:
        this.doEffectPitchDown();
        break;
      case Effect.PitchUp:
        this.doEffectPitchUp();
        break;
      case Effect.NotePortamento:
        this.doEffectNotePortamento();
        break;
      case Effect.Vibrato:
        this.doEffectVibrato();
        break;
      case Effect.Tremor:
        this.doEffectTremor();
        break;
      case Effect.Arpeggio:
        this.doEffectArpeggio();
        break;
      case Effect.VibratoSlide:
        this.doEffectVibratoSlide();
        break;
      case Effect.PortaSlide:
        this.doEffectPortaSlide();
        break;
      case Effect.Retrig:
        this.doEffectRetrig();
        break;
      case Effect.Tremolo:
        this.doEffectTremolo();
        break;
      case Effect.SMulti:
        switch (this.effectInfo.currentSubeffect) {
          case Subeffect.NoteDelay:
            this.doSubeffectNoteDelay();
            break;
        }
        break;
      case Effect.FineVibrato:
        this.doEffectVibrato(true);
        break;
    }
    this.applyNextState();
  }

  private applyNextState() {
    if (this.nextState.sample !== undefined) {
      this.state.sample = this.nextState.sample;
      if (this.sound) this.sound.stop();
      this.sound = this.makeNewSound(this.state.sample);
      this.sound.connect(this.gain);
      this.sound.start(0, this.nextState.offset || 0);
    }

    if (this.nextState.vibratoPosition !== undefined) {
      this.state.vibratoPosition = this.nextState.vibratoPosition;
    }

    if (this.nextState.tremorPosition !== undefined) {
      this.state.tremorPosition = this.nextState.tremorPosition;
    }

    if (this.nextState.note == "off") {
      this.state.note = "off";
      this.state.period = kC2Spd;
      if (this.sound) {
        this.sound.stop();
        this.sound = undefined;
      }
    } else if (
      this.nextState.period !== undefined ||
      this.nextState.periodDelta != this.state.periodDelta
    ) {
      if (this.nextState.note !== undefined)
        this.state.note = this.nextState.note;
      if (this.nextState.period !== undefined)
        this.state.period = this.nextState.period;
      this.state.periodDelta = this.nextState.periodDelta;
      if (this.sound) {
        this.sound.playbackRate.value =
          kSysFrequency /
          (this.state.sample!.buffer.sampleRate *
            (this.state.period + this.state.periodDelta));
      }
    }

    if (
      this.nextState.volume !== undefined ||
      this.state.volumeDelta != this.nextState.volumeDelta
    ) {
      if (this.nextState.volume !== undefined)
        this.state.volume = this.nextState.volume;
      this.state.volumeDelta = this.nextState.volumeDelta;
      this.gain.gain.value = Math.max(
        0,
        Math.min(this.state.volume + this.state.volumeDelta, 1)
      );
    }

    this.nextState = EmptyNextState();
  }

  private makeNewSound(sample: Sample): AudioBufferSourceNode {
    let sound = this.ctx!.createBufferSource();
    sound.buffer = sample.buffer;
    if (sample.looped) {
      sound.loop = true;
      sound.loopStart = sample.loopBegin / sample.middleCFreq;
      sound.loopEnd = sample.loopEnd / sample.middleCFreq;
    }
    return sound;
  }

  private doEffectSlide() {
    let state = ApplyStateChange(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.slideSpeed;
    let gain = Math.round(state.volume * 64);
    if (tick == 0) {
      if ((param & 0x0f) == 0x0f) {
        gain += (param & 0xf0) >> 4;
      } else if ((param & 0xf0) == 0xf0) {
        gain -= param & 0x0f;
      }
    }
    if (tick > 0 || this.fastVolumeSlide) {
      if ((param & 0x0f) == 0) {
        gain += (param & 0xf0) >> 4;
      } else if ((param & 0xf0) == 0) {
        gain -= param & 0x0f;
      }
    }
    gain = Math.max(0, Math.min(64, gain));
    this.nextState.volume = gain / 64;
    this.nextState.volumeDelta = 0;
  }

  private doEffectPitchDown() {
    let state = ApplyStateChange(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.portamentoSpeed;
    let period = state.period;
    if (tick == 0) {
      if ((param & 0xf0) == 0xf0) {
        period += (param & 0x0f) * 4;
      } else if ((param & 0xf0) == 0xe0) {
        period += param & 0x0f;
      }
    } else {
      if (param < 0xe0) {
        period += param * 4;
      }
    }
    period = Math.min(kNotePeriods[0], period);
    this.nextState.period = period;
  }

  private doEffectPitchUp() {
    let state = ApplyStateChange(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.portamentoSpeed;
    let period = state.period;
    if (tick == 0) {
      if ((param & 0xf0) == 0xf0) {
        period -= (param & 0x0f) * 4;
      } else if ((param & 0xf0) == 0xe0) {
        period -= param & 0x0f;
      }
    } else {
      if (param < 0xe0) {
        period -= param * 4;
      }
    }
    period = Math.max(kNotePeriods[kNotePeriods.length - 1], period);
    this.nextState.period = period;
  }

  private doEffectNotePortamento() {
    let state = ApplyStateChange(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.portamentoSpeed;
    let target = this.effectInfo.periodToPortamento;
    let period = state.period;
    if (tick > 0) {
      if (target > period) {
        period = Math.min(target, period + param * 4);
      } else if (target < period) {
        period = Math.max(target, period - param * 4);
      }
    }
    this.nextState.period = period;
  }

  private doEffectVibrato(fine?: boolean) {
    let state = ApplyStateChange(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.vibrato;
    let speed = (param & 0xf0) >> 4;
    let depth = param & 0x0f;
    let position = state.vibratoPosition;
    let delta = Math.floor(
      (kVibratoWave[position >= 0 ? position : 32 + position] * depth) / 128
    );
    if (state.vibratoPosition < 0) delta *= -1;
    if (tick > 0) {
      position += speed;
      if (position > 31) position -= 64;
    }
    this.nextState.vibratoPosition = position;
    this.nextState.periodDelta = fine ? delta : delta * 4;
  }

  private doEffectTremor() {
    let state = ApplyStateChange(this.state, this.nextState);
    let ticksOn = ((this.effectInfo.tremor & 0xf0) >> 4) + 1;
    let ticksOff = (this.effectInfo.tremor & 0x0f) + 1;
    let position = state.tremorPosition % (ticksOn + ticksOff);
    this.nextState.volumeDelta = position < ticksOn ? 0 : -1;
    this.nextState.tremorPosition = position + 1;
  }

  private doEffectArpeggio() {
    let state = ApplyStateChange(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.arpeggio;
    let semitone = [(param & 0xf0) >> 4, param & 0x0f];
    let note = tick % 3;
    if (note == 0) {
      this.nextState.periodDelta = 0;
    } else if (state.note != "off") {
      let index = state.note + semitone[note - 1];
      index = Math.max(0, Math.min(kNotePeriods.length - 1, index));
      this.nextState.periodDelta = kNotePeriods[index] - state.period;
    }
  }

  private doEffectVibratoSlide() {
    this.doEffectVibrato();
    this.doEffectSlide();
  }

  private doEffectPortaSlide() {
    this.doEffectNotePortamento();
    this.doEffectSlide();
  }

  private doEffectOffset(param: number) {
    let state = ApplyStateChange(this.state, this.nextState);
    let skip = param * 0x100;
    this.nextState.offset = state.sample ? skip / state.sample?.middleCFreq : 0;
  }

  private doEffectRetrig() {
    let tick = this.player.tick;
    let param = this.effectInfo.retrig;
    let slide = (param & 0xf0) >> 4;
    let ticks = param & 0x0f;
    if (ticks % tick != 0) return;
    this.nextState.period = this.state.period;
    this.nextState.sample = this.state.sample;
    let gain = Math.round(this.state.volume * 64);
    const slide_amounts = [
      0,
      -1,
      -2,
      -4,
      -8,
      -16,
      2 / 3,
      1 / 2,
      0,
      1,
      2,
      4,
      8,
      16,
      3 / 2,
      2,
    ];
    let amount = slide_amounts[slide];
    gain += amount;
    gain = Math.max(0, Math.min(64, gain));
    this.nextState.volume = gain / 64;
    this.nextState.volumeDelta = 0;
  }

  private doEffectTremolo() {
    let state = ApplyStateChange(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.tremolo;
    let speed = (param & 0xf0) >> 4;
    let depth = param & 0x0f;
    let position = state.tremoloPosition;
    let delta = Math.floor(
      (kVibratoWave[position >= 0 ? position : 32 + position] * depth) / 64
    );
    if (state.tremoloPosition < 0) delta *= -1;
    if (tick > 0) {
      position += speed;
      if (position > 31) position -= 64;
    }
    this.nextState.tremoloPosition = position;
    this.nextState.volumeDelta = delta / 64;
  }

  private doSubeffectNoteDelay() {
    let tick = this.player.tick;
    let param = this.effectInfo.noteDelay;
    if (tick == param && this.effectInfo.stateChange) {
      this.nextState = this.effectInfo.stateChange;
    }
  }
}

class EffectInfo {
  currentEffect?: number;
  currentSubeffect?: number;
  slideSpeed: number = 0;
  portamentoSpeed: number = 0;
  periodToPortamento: number = 0;
  vibrato: number = 0;
  tremor: number = 0;
  arpeggio: number = 0;
  noteDelay: number = 0;
  stateChange?: NextState;
  retrig: number = 0;
  tremolo: number = 0;
}

type Sample = {
  buffer: AudioBuffer;
  middleCFreq: number;
  volume: number;
  looped: boolean;
  loopBegin: number;
  loopEnd: number;
};

function sampleFromInstrument(
  ctx: BaseAudioContext,
  instrument: Instrument
): Sample {
  let buffer = ctx.createBuffer(
    1,
    instrument.sample.length,
    instrument.middleCFreq
  );
  buffer.copyToChannel(instrument.sample, 0);
  return {
    buffer,
    middleCFreq: instrument.middleCFreq,
    volume: instrument.volume,
    looped: instrument.looped,
    loopBegin: instrument.loopBegin,
    loopEnd: instrument.loopEnd,
  };
}

type ChannelState = {
  sample: Sample | undefined;
  note: number | "off";
  period: number;
  volume: number;
  offset: number;
  vibratoPosition: number;
  tremorPosition: number;
  tremoloPosition: number;
  periodDelta: number;
  volumeDelta: number;
};

function NewChannelState(): ChannelState {
  return {
    sample: undefined,
    note: 48,
    period: kC2Spd,
    volume: 0,
    offset: 0,
    vibratoPosition: 0,
    tremorPosition: 0,
    tremoloPosition: 0,
    periodDelta: 0,
    volumeDelta: 0,
  };
}

type NextState = Partial<ChannelState> & {
  periodDelta: number;
  volumeDelta: number;
};

function EmptyNextState(): NextState {
  return {
    volumeDelta: 0,
    periodDelta: 0,
  };
}

function ApplyStateChange(c: ChannelState, n: NextState): ChannelState {
  return {
    sample: n.sample === undefined ? c.sample : n.sample,
    note: n.note === undefined ? c.note : n.note,
    period: n.period === undefined ? c.period : n.period,
    volume: n.volume === undefined ? c.volume : n.volume,
    offset: n.offset === undefined ? c.offset : n.offset,
    vibratoPosition:
      n.vibratoPosition === undefined ? c.vibratoPosition : n.vibratoPosition,
    tremorPosition:
      n.tremorPosition === undefined ? c.tremorPosition : n.tremorPosition,
    tremoloPosition:
      n.tremoloPosition === undefined ? c.tremoloPosition : n.tremoloPosition,
    periodDelta: n.periodDelta,
    volumeDelta: n.volumeDelta,
  };
}
