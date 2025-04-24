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

export type Note =
  | { off: true }
  | { off: false; number: number; instrument: number };

export type Effect = {
  number: number;
  info: number;
};

export type Command = {
  channel: number;
  note?: Note;
  volume?: number;
  effect?: Effect;
};

export type Row = Command[];

export type Pattern = Row[];

export type Song = {
  name: string;
  volume: number;
  speed: number;
  tempo: number;
  channels: Map<number, Channel>;
  instruments: Instrument[];
  orders: number[];
  patterns: Pattern[];
};
