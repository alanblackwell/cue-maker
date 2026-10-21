// Time is kept internally as float seconds of video time (0 = first frame of the
// proxy). Frame rates are rational ({num, den}) so 23.976 is exactly 24000/1001.
// Timecode is only a display/entry format, offset by the sequence's start timecode.

export const FRAME_RATES = [
  { id: '23.976', num: 24000, den: 1001, df: false, label: '23.976' },
  { id: '24', num: 24, den: 1, df: false, label: '24' },
  { id: '25', num: 25, den: 1, df: false, label: '25' },
  { id: '29.97', num: 30000, den: 1001, df: false, label: '29.97 NDF' },
  { id: '29.97df', num: 30000, den: 1001, df: true, label: '29.97 DF' },
  { id: '30', num: 30, den: 1, df: false, label: '30' },
  { id: '50', num: 50, den: 1, df: false, label: '50' },
  { id: '59.94', num: 60000, den: 1001, df: false, label: '59.94 NDF' },
  { id: '59.94df', num: 60000, den: 1001, df: true, label: '59.94 DF' },
  { id: '60', num: 60, den: 1, df: false, label: '60' },
];

export const nominalFps = rate => Math.round(rate.num / rate.den);

export function secondsToFrames(seconds, rate) {
  return Math.floor((seconds * rate.num) / rate.den + 1e-6);
}

export function framesToSeconds(frames, rate) {
  return (frames * rate.den) / rate.num;
}

export function snapToFrame(seconds, rate) {
  return framesToSeconds(Math.round((seconds * rate.num) / rate.den), rate);
}

const pad2 = n => String(n).padStart(2, '0');

export function framesToTimecode(frames, rate, dropFrame = false) {
  const nom = nominalFps(rate);
  const negative = frames < 0;
  let f = Math.abs(frames);
  if (dropFrame) {
    // Standard drop-frame: skip frame numbers 0 and 1 (0-3 at 59.94) at the start
    // of every minute except every tenth minute.
    const drop = nom >= 60 ? 4 : 2;
    const per10Min = nom * 600 - drop * 9;
    const perMin = nom * 60 - drop;
    const d = Math.floor(f / per10Min);
    const m = f % per10Min;
    f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
  }
  const ff = f % nom;
  const ss = Math.floor(f / nom) % 60;
  const mm = Math.floor(f / (nom * 60)) % 60;
  const hh = Math.floor(f / (nom * 3600)) % 24;
  return `${negative ? '-' : ''}${pad2(hh)}:${pad2(mm)}:${pad2(ss)}${dropFrame ? ';' : ':'}${pad2(ff)}`;
}

export function timecodeToFrames(text, rate, dropFrame = false) {
  const m = /^\s*(\d{1,2})[:;.](\d{2})[:;.](\d{2})[:;.](\d{2})\s*$/.exec(text);
  if (!m) throw new Error(`"${text}" is not a timecode (HH:MM:SS:FF)`);
  const [hh, mm, ss, ff] = m.slice(1).map(Number);
  const nom = nominalFps(rate);
  if (mm > 59 || ss > 59 || ff >= nom) throw new Error(`"${text}" is out of range at ${nom} fps`);
  let frames = (hh * 3600 + mm * 60 + ss) * nom + ff;
  if (dropFrame) {
    const drop = nom >= 60 ? 4 : 2;
    const totalMinutes = hh * 60 + mm;
    frames -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frames;
}

export function secondsToTimecode(seconds, rate, dropFrame = false) {
  return framesToTimecode(secondsToFrames(seconds, rate), rate, dropFrame);
}

export function timecodeToSeconds(text, rate, dropFrame = false) {
  return framesToSeconds(timecodeToFrames(text, rate, dropFrame), rate);
}
