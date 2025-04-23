import { Channel, Command, Instrument, Song } from "./song";

export class Player {
  constructor(private song: Song) {
    this.tempo = song.tempo;
    this.songSpeed = song.speed;
    this.order = 0;
    this.row = 0;
    this.currentTick = this.songSpeed;
    this.jump = false;
    this.break = false;
    this.running = false;
    this.millisPerTick = 2500 / song.tempo;
    this.millisPlayed = 0;
    this.channels = new Map();
    this.samples = [];
    this.cues = new Map();
  }

  private tempo: number;
  private songSpeed: number;
  private order: number;
  private row: number;
  private currentTick: number;
  private jump: boolean;
  private break: boolean;
  private running: boolean;
  private millisPerTick: number;
  private millisPlayed: number;
  private ctx?: AudioContext;
  private channels: Map<number, ChannelPlayer>;
  private samples: Sample[];
  private cues: Map<string, ((p: Player) => void)[]>;

  play() {
    this.init();
    this.updateTimings();
    this.running = true;
    this.doFrame();
  }

  stop() {
    this.running = false;
    this.channels.forEach((c) => c.stop());
  }

  async waitForCue(order: number, row: number): Promise<Player> {
    let { promise, resolve } = Promise.withResolvers<Player>();
    let key = order + "," + row;
    let cueList = this.cues.get(key);
    if (cueList === undefined) {
      cueList = [];
      this.cues.set(key, cueList);
    }
    cueList.push(resolve);
    return promise;
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

  get msPerTick(): number {
    return this.millisPerTick;
  }

  get speed(): number {
    return this.songSpeed;
  }
  set speed(speed: number) {
    this.songSpeed = speed;
    this.updateTimings();
  }

  private init() {
    if (this.ctx) return;
    let ctx = new AudioContext();
    this.ctx = ctx;
    this.song.channels.forEach((channel, num) =>
      this.channels.set(num, new ChannelPlayer(ctx, this, channel))
    );
    this.song.instruments.forEach((instrument) =>
      this.samples.push(sampleFromInstrument(ctx, instrument))
    );
  }

  private updateTimings() {
    this.millisPerTick = 2500 / this.tempo;
  }

  private doFrame() {
    while (this.ctx!.currentTime * 1000 > this.millisPlayed) {
      this.doTick();
      this.millisPlayed += this.millisPerTick;
    }
    if (this.running) requestAnimationFrame(() => this.doFrame());
  }

  private doTick() {
    if (!this.running) return;

    this.currentTick++;
    if (this.currentTick < this.songSpeed) {
      this.updateEffects();
      return;
    }
    let cues = this.cues.get(this.order + "," + this.row);
    if (cues) cues.forEach((c) => c(this));
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

enum Effect {
  Speed = 1,
  Jump = 2,
  Break = 3,
  Slide = 4,
  PitchDown = 5,
  PitchUp = 6,
  NotePortamento = 7,
  Vibrato = 8,
  Arpeggio = 10,
  VibratoSlide = 11,
  Offset = 15,
  Retrig = 17,
  SMulti = 19,
}

enum Subeffect {
  NoteDelay = 0x0d,
}

const kVibratoWave = [
  0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253, 255,
  253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24,
];

const kNotePeriods = [
  27392, 25856, 24384, 23040, 21696, 20480, 19328, 18240, 17216, 16256, 15360,
  14496, 13696, 12928, 12192, 11520, 10848, 10240, 9664, 9120, 8608, 8128, 7680,
  7248, 6848, 6464, 6096, 5760, 5424, 5120, 4832, 4560, 4304, 4064, 3840, 3624,
  3424, 3232, 3048, 2880, 2712, 2560, 2416, 2280, 2152, 2032, 1920, 1812, 1712,
  1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 906, 856, 808, 762,
  720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320,
  302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135,
  127, 120, 113, 107, 101, 95, 90, 85, 80, 75, 71, 67, 63, 60, 56,
];

function FromToPeriod(playbackRate: number) {
  return 1712 / playbackRate;
}

function FindPeriod(period: number) {
  let min = 0;
  let max = kNotePeriods.length;
  while (min < max) {
    let mid = Math.floor((min + max) / 2);
    let seen = kNotePeriods[mid];
    if (period == seen) return mid;
    if (period > seen) {
      max = mid;
    } else {
      min = mid + 1;
    }
  }
  return min;
}

class ChannelPlayer {
  constructor(
    private ctx: AudioContext,
    private player: Player,
    channel: Channel
  ) {
    this.gain = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.effectInfo = new EffectInfo();
    this.state = InitialChannelState();
    this.nextState = EmptyChannelState();

    this.gain.gain.value = 1;
    this.panner.pan.value = channel.pan;
    this.gain.connect(this.panner);
    this.panner.connect(this.ctx.destination);
  }

  private gain: GainNode;
  private panner: StereoPannerNode;
  private sound?: AudioBufferSourceNode;
  private effectInfo: EffectInfo;
  private state: ChannelState;
  private nextState: ChannelState;

  stop() {
    if (!this.sound) return;
    this.sound.stop();
    this.sound = undefined;
  }

  doRow() {
    this.effectInfo.currentEffect = undefined;
  }

  doCommand(cmd: Command) {
    if (cmd.instrument) {
      let sample = this.player.getSample(cmd.instrument - 1);
      this.nextState.sample = sample;
      this.nextState.volume = sample.volume;
    }

    if (cmd.volume !== undefined) {
      this.nextState.volume = cmd.volume;
    }

    if (cmd.note !== undefined) {
      this.nextState;
      if (cmd.note >= kNotePeriods.length) {
        this.nextState.period = 0;
      } else {
        this.nextState.period = kNotePeriods[cmd.note];
      }
    }

    this.effectInfo.currentEffect = cmd.effect;
    switch (cmd.effect) {
      case undefined:
        break;
      case Effect.Speed:
        this.player.speed = cmd.info!;
        break;
      case Effect.Jump:
        this.player.jumpToOrder(cmd.info!);
        break;
      case Effect.Break:
        let row = ((cmd.info! & 0xf0) >> 4) * 10 + (cmd.info! & 0x0f);
        this.player.breakPattern(row);
        break;
      case Effect.Slide:
        if (cmd.info) this.effectInfo.slideSpeed = cmd.info;
        this.doEffectSlide();
        break;
      case Effect.PitchDown:
        if (cmd.info) this.effectInfo.portamentoSpeed = cmd.info;
        this.doEffectPitchDown();
        break;
      case Effect.PitchUp:
        if (cmd.info) this.effectInfo.portamentoSpeed = cmd.info;
        this.doEffectPitchUp();
        break;
      case Effect.NotePortamento:
        if (this.nextState.period !== undefined) {
          this.effectInfo.periodToPortamento = this.nextState.period;
          this.nextState.period = undefined;
        }
        if (cmd.info) this.effectInfo.portamentoSpeed = cmd.info;
        this.doEffectNotePortamento();
        break;
      case Effect.Vibrato:
        if (cmd.info) this.effectInfo.vibrato = cmd.info;
        this.doEffectVibrato();
        break;
      case Effect.Arpeggio:
        if (cmd.info) this.effectInfo.arpeggio = cmd.info;
        break;
      case Effect.VibratoSlide:
        if (cmd.info) this.effectInfo.slideSpeed = cmd.info;
        break;
      case Effect.Offset:
        this.doEffectOffset(cmd.info || 0);
        break;
      case Effect.Retrig:
        if (cmd.info) this.effectInfo.retrig = cmd.info;
        break;
      case Effect.SMulti:
        this.effectInfo.currentSubeffect = (cmd.info! & 0xf0) >> 4;
        let subinfo = cmd.info! & 0x0f;
        switch (this.effectInfo.currentSubeffect) {
          case Subeffect.NoteDelay:
            this.effectInfo.noteDelay = subinfo;
            this.effectInfo.delayedState = this.nextState;
            this.nextState = EmptyChannelState();
            break;
          default:
            throw `Unknown subeffect: ${this.effectInfo.currentSubeffect
              .toString()
              .toUpperCase()}`;
        }
      default:
        throw `Unknown effect: ${String.fromCharCode(64 + cmd.effect)} (${
          cmd.effect
        })`;
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
      case Effect.Arpeggio:
        this.doEffectArpeggio();
        break;
      case Effect.VibratoSlide:
        this.doEffectVibratoSlide();
        break;
      case Effect.Retrig:
        this.doEffectRetrig();
        break;
      case Effect.SMulti:
        switch (this.effectInfo.currentSubeffect) {
          case Subeffect.NoteDelay:
            this.doSubeffectNoteDelay();
            break;
          // Fallthrough
        }
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

    if (this.nextState.period == 0) {
      if (this.sound) {
        this.sound.stop();
        this.sound = undefined;
      }
    } else if (this.nextState.period !== undefined) {
      this.state.period = this.nextState.period;
      this.state.periodDelta = this.nextState.periodDelta;
      if (this.sound) {
        this.sound.playbackRate.value = FromToPeriod(
          this.state.period + this.state.periodDelta
        );
      }
    } else if (this.nextState.periodDelta != this.state.periodDelta) {
      this.state.periodDelta = this.nextState.periodDelta;
      if (this.sound) {
        this.sound.playbackRate.value = FromToPeriod(this.state.periodDelta);
      }
    }

    if (this.nextState.volume !== undefined) {
      this.state.volume = this.nextState.volume;
      this.gain.gain.value = this.state.volume;
    }

    this.nextState = EmptyChannelState();
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
    let state = MergeChannelStates(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.slideSpeed;
    let gain = Math.round((state.volume || 0) * 64);
    if (tick == 0) {
      if ((param & 0x0f) == 0x0f) {
        gain += (param & 0xf0) >> 4;
      } else if ((param & 0xf0) == 0xf0) {
        gain -= param & 0x0f;
      }
    } else {
      if ((param & 0x0f) == 0) {
        gain += (param & 0xf0) >> 4;
      } else if ((param & 0xf0) == 0) {
        gain -= param & 0x0f;
      }
    }
    gain = Math.max(0, Math.min(64, gain));
    this.nextState.volume = gain / 64;
  }

  private doEffectPitchDown() {
    let state = MergeChannelStates(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.portamentoSpeed!;
    let period = state.period || 0;
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
    let state = MergeChannelStates(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.portamentoSpeed!;
    let period = state.period || 0;
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
    let state = MergeChannelStates(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.portamentoSpeed!;
    let target = this.effectInfo.periodToPortamento;
    let period = state.period || 0;
    if (tick > 0) {
      if (target > period) {
        period = Math.min(target, period + param * 4);
      } else if (target < period) {
        period = Math.max(target, period - param * 4);
      }
    }
    this.nextState.period = period;
  }

  private doEffectVibrato() {
    let state = MergeChannelStates(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.vibrato;
    let speed = (param & 0xf0) >> 4;
    let depth = param & 0x0f;
    let position = state.vibratoPosition || 0;
    let delta = Math.floor(
      (kVibratoWave[position >= 0 ? position : 32 + position] * depth) / 128
    );
    if (position < 0) delta *= -1;
    if (tick > 0) {
      position += speed;
      if (position > 31) position -= 64;
    }
    this.nextState.vibratoPosition = position;
    this.nextState.periodDelta = delta * 4;
  }

  private doEffectArpeggio() {
    let state = MergeChannelStates(this.state, this.nextState);
    let tick = this.player.tick;
    let param = this.effectInfo.arpeggio;
    let semitone = [(param & 0xf0) >> 4, param & 0x0f];
    let note = tick % 3;
    if (note == 0) {
      this.nextState.periodDelta = 0;
    } else {
      let index = FindPeriod(state.period || 0);
      index += semitone[note - 1];
      index = Math.max(0, Math.min(kNotePeriods.length - 1, index));
      this.nextState.periodDelta = kNotePeriods[index] - (state.period || 0);
    }
  }

  private doEffectVibratoSlide() {
    this.doEffectVibrato();
    this.doEffectSlide();
  }

  private doEffectOffset(param: number) {
    let state = MergeChannelStates(this.state, this.nextState);
    let skip = param * 0x100;
    this.nextState.offset = skip / (state.sample?.middleCFreq || 1);
  }

  private doEffectRetrig() {
    let tick = this.player.tick;
    let param = this.effectInfo.retrig;
    let slide = (param & 0xf0) >> 4;
    let ticks = param & 0x0f;
    if ((ticks % tick) != 0) return;
    this.nextState.period = this.state.period;
    this.nextState.sample = this.state.sample;
    let gain = Math.round((this.state.volume || 0) * 64);
    const slide_amounts = [0, -1, -2, -4, -8, -16, 2 / 3, 1 / 2, 0, 1, 2, 4, 8, 16, 3 / 2, 2];
    let amount = slide_amounts[slide];
    gain += amount;
    gain = Math.max(0, Math.min(64, gain));
    this.nextState.volume = gain / 64;
  }

  private doSubeffectNoteDelay() {
    let tick = this.player.tick;
    let param = this.effectInfo.noteDelay;
    if (tick == param && this.effectInfo.delayedState) {
      this.nextState = this.effectInfo.delayedState;
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
  arpeggio: number = 0;
  noteDelay: number = 0;
  delayedState?: ChannelState;
  retrig: number = 0;
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
  ctx: AudioContext,
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
  sample?: Sample;
  period?: number;
  volume?: number;
  offset?: number;
  vibratoPosition?: number;
  periodDelta: number;
};

function EmptyChannelState(): ChannelState {
  return { periodDelta: 0 };
}

function InitialChannelState(): ChannelState {
  return {
    period: 1712,
    volume: 0,
    offset: 0,
    vibratoPosition: 0,
    periodDelta: 0,
  };
}

function MergeChannelStates(a: ChannelState, b: ChannelState): ChannelState {
  return {
    sample: b.sample === undefined ? a.sample : b.sample,
    period: b.period === undefined ? a.period : b.period,
    volume: b.volume === undefined ? a.volume : b.volume,
    offset: b.offset === undefined ? a.offset : b.offset,
    vibratoPosition:
      b.vibratoPosition === undefined ? a.vibratoPosition : b.vibratoPosition,
    periodDelta: b.periodDelta,
  };
}
