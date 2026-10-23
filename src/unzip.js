// Just enough of a .zip reader to pull one file out of an archive. Mail
// programs zip a .fcpxmld bundle before sending it, so the export can arrive
// as a .zip. Handles stored and deflated entries (all Finder's Compress makes),
// using the browser's own DecompressionStream; no ZIP64, no encryption.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

// Lists the archive's entries: [{ name, method, compressedSize, size, offset }].
export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error('this zip is too large to read here');

  const names = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error('damaged zip archive');
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    entries.push({
      name: names.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function readZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.offset;
  if (view.getUint32(p, true) !== LOCAL) throw new Error('damaged zip archive');
  if (entry.flags & 1) throw new Error(`"${entry.name}" is encrypted`);
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error(`"${entry.name}" uses an unsupported compression method`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Finds Final Cut's XML in a zip: Info.fcpxml in a .fcpxmld bundle if there is
// one, else any .fcpxml or .xml. Skips the __MACOSX resource-fork copies that
// Finder adds. Returns a File, or null if there's no XML inside.
export async function fcpxmlInZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base = name => name.split('/').pop();
  const candidates = zipEntries(bytes).filter(
    e => !e.name.startsWith('__MACOSX/') && !base(e.name).startsWith('._') && /\.(fcpxml|xml)$/i.test(e.name),
  );
  const entry = candidates.find(e => base(e.name) === 'Info.fcpxml') ?? candidates[0];
  if (!entry) return null;
  // Named after the zip too, so messages show what the user dropped.
  return new File([await readZipEntry(bytes, entry)], `${file.name} › ${base(entry.name)}`, { type: 'text/xml' });
}
