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

export type Command = {
  channel: number;
  note?: number;
  instrument?: number;
  volume?: number;
  effect?: number;
  info?: number;
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
