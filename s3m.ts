import { Channel, Effect, Instrument, Note, Pattern, Row, Song } from "./song";

export function ParseS3M(s3m: Uint8Array): Song {
  const data = new Data(s3m);
  let mark1 = data.byte(0x1c);
  let type = data.byte(0x1d);
  let ffi = data.word(0x2a);
  let mark2 = data.ascii(0x2c, 4);
  if (mark1 != 0x1a || type != 16 || ffi != 2 || mark2 != "SCRM") {
    throw "Not an S3M file";
  }
  let name = data.asciiz(0, 28);
  let numOrders = data.word(0x20);
  let numInstruments = data.word(0x22);
  let numPatterns = data.word(0x24);
  let globalVolume = data.byte(0x30);
  let speed = data.byte(0x31);
  let tempo = data.byte(0x32);
  let masterVolume = data.byte(0x33);
  let defaultPan = data.byte(0x35);

  let channels: Map<number, Channel> = new Map();
  for (let i = 0; i < 32; ++i) {
    let pan = data.byte(0x40 + i);
    if (pan > 15) continue;
    let name = pan <= 7 ? "L" + (pan + 1) : "R" + (pan - 7);
    channels.set(i, { name, pan: pan <= 7 ? -0.8 : 0.8 });
  }

  let orders: number[] = [];
  for (let i = 0; i < numOrders; ++i) {
    let order = data.byte(0x60 + i);
    if (order == 254) continue;
    if (order == 255) break;
    orders.push(order);
  }

  let instruments: Instrument[] = [];
  for (let i = 0; i < numInstruments; ++i) {
    let parapointer = data.word(0x60 + numOrders + i * 2);
    let instrument = ParseInstrument(data, parapointer * 16);
    if (instrument !== undefined) {
      instruments.push(instrument);
    }
  }

  let patterns: Pattern[] = [];
  for (let i = 0; i < numPatterns; ++i) {
    let parapointer = data.word(0x60 + numOrders + (numInstruments + i) * 2);
    let pattern = ParsePattern(data, parapointer * 16, channels);
    patterns.push(pattern);
  }

  if (defaultPan == 252) {
    for (let [num, chan] of channels) {
      let pan =
        data.byte(0x60 + numOrders + (numInstruments + numPatterns) * 2 + num) &
        0x0f;
      chan.pan = pan / 7.5 - 1;
    }
  }
  if ((masterVolume & 0x80) == 0) {
    channels.forEach((chn) => (chn.pan = 0));
  }

  return {
    name,
    volume: globalVolume / 64,
    speed,
    tempo,
    channels,
    instruments,
    orders,
    patterns,
  };
}

function ParsePattern(
  data: Data,
  offset: number,
  channels: Map<number, Channel>
): Pattern {
  let length = data.word(offset);
  let pattern: Pattern = [];
  let row: Row = [];
  for (let i = 2; i < length; ++i) {
    let c = data.byte(offset + i);
    if (c == 0) {
      pattern.push(row);
      row = [];
      continue;
    }
    let channel = c & 0x1f;
    let note: Note | undefined;
    let volume: number | undefined;
    let effect: Effect | undefined;
    if (c & 0x20) {
      let n = data.byte(offset + i + 1);
      if (n == 254) {
        note = { off: true };
      } else if (n != 255) {
        note = {
          off: false,
          number: ((n & 0xf0) >> 4) * 12 + (n & 0x0f),
          instrument: data.byte(offset + i + 2),
        };
      }
      i += 2;
    }
    if (c & 0x40) {
      volume = data.byte(offset + i + 1) / 64;
      ++i;
    }
    if (c & 0x80) {
      effect = {
        number: data.byte(offset + i + 1),
        info: data.byte(offset + i + 2),
      };
      i += 2;
    }
    if (!channels.has(channel)) continue;
    row.push({ channel, note, volume, effect });
  }
  if (row.length != 0) {
    pattern.push(row);
  }
  return pattern;
}

function ParseInstrument(data: Data, offset: number): Instrument | undefined {
  let type = data.byte(0 + offset);
  let packed = data.byte(0x1e + offset);
  let mark = data.ascii(0x4c + offset, 4);
  let ptr = (data.byte(0x0d + offset) << 16) + data.word(0x0e + offset);
  let length = data.word(0x10 + offset);
  let loopBegin = data.word(0x14 + offset);
  let loopEnd = data.word(0x18 + offset);
  let volume = data.word(0x1c + offset);
  let flags = data.byte(0x1f + offset);
  if (flags & 6) {
    throw "Unsupported sample type";
  }
  let middleCFreq = data.word(0x20 + offset);
  let name = data.asciiz(0x30 + offset, 28);
  let sample = new Float32Array(1);
  if (type == 1) {
    let byte_sample = data.byteArray(ptr * 16, length);
    sample = new Float32Array(byte_sample.length);
    for (let i = 0; i < byte_sample.length; ++i) {
      sample[i] = byte_sample[i] / 127.5 - 1;
    }
  } else if (type == 0) {
    // do nothing
  } else if (packed || mark != "SCRS") {
    throw "Not a supported instrument";
  }

  return {
    name,
    volume: volume / 64,
    looped: !!(flags & 1),
    loopBegin,
    loopEnd,
    middleCFreq,
    sample,
  };
}

class Data {
  constructor(private data: Uint8Array) {}

  byte(offset: number): number {
    return this.data[offset];
  }

  word(offset: number): number {
    return this.data[offset] + (this.data[offset + 1] << 8);
  }

  dword(offset: number): number {
    return (
      this.data[offset] +
      (this.data[offset + 1] << 8) +
      (this.data[offset + 2] << 16) +
      (this.data[offset + 3] << 24)
    );
  }

  ascii(offset: number, length: number) {
    let str = "";
    for (let i = 0; i < length; ++i) {
      str += String.fromCodePoint(this.data[i + offset]);
    }
    return str;
  }

  asciiz(offset: number, length: number) {
    let str = "";
    for (let i = 0; i < length; ++i) {
      let c = this.data[i + offset];
      if (c == 0) return str;
      str += String.fromCodePoint(c);
    }
    return str;
  }

  byteArray(offset: number, length: number): Uint8Array {
    return this.data.slice(offset, offset + length);
  }
}
