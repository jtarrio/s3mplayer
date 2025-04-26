export type Song = {
  name: string;
  format: Format;
  flags: Flags;
  volume: number;
  speed: number;
  tempo: number;
  channels: Map<number, Channel>;
  instruments: Instrument[];
  orders: number[];
  patterns: Pattern[];
};

export type Format = "S3M";

export type Flags = {
  fastVolumeSlide: boolean;
}

export type Channel = {
  name: string;
  /** 0 = left, 7 = middle, 15 = right */
  pan: number;
};

export type Instrument = {
  name: string;
  volume: number;
  looped: boolean;
  loopBegin: number;
  loopEnd: number;
  middleCFreq: number;
  sample: Float32Array;
};

export type Pattern = Row[];

export type Row = Command[];

export type Command = {
  channel: number;
  note?: Note;
  volume?: number;
  effect?: Effect;
};

export type Note =
  | { off: true }
  | { off: false; number: number; instrument: number };

export type Effect = {
  number: number;
  info: number;
};
