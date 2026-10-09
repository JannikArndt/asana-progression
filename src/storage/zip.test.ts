import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32Blob, crc32Update, createZip, readZip, ZipError } from './zip';

const text = (s: string) => new Blob([s]);

async function bytes(b: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await b.arrayBuffer());
}

/** Validates an archive with Python's zipfile (CRC of every entry), the reference implementation. */
function pythonTest(zip: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'a.zip');
  writeFileSync(file, zip);
  const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint("\\n".join(z.namelist()))', file]);
  return out.toString().trim().split('\n');
}

describe('crc32', () => {
  it('matches the standard check value', async () => {
    expect(crc32Update(0, new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(await crc32Blob(text('123456789'))).toBe(0xcbf43926);
    expect(await crc32Blob(new Blob([]))).toBe(0);
  });

  it('is incremental', () => {
    const e = new TextEncoder();
    expect(crc32Update(crc32Update(0, e.encode('12345')), e.encode('6789'))).toBe(0xcbf43926);
  });
});

describe('zip', () => {
  const inputs = () => [
    { name: 'backup.json', data: text('{"a":1}'), modified: new Date(2026, 9, 9, 12, 30, 10) },
    { name: 'assets/x.jpg', data: new Blob([new Uint8Array([0, 1, 2, 255])]) },
    { name: 'empty.bin', data: new Blob([]) },
    { name: 'ümlaut.txt', data: text('ä') },
  ];

  it('round-trips STORE entries', async () => {
    const zip = await createZip(inputs());
    const entries = await readZip(zip);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['backup.json', 7],
      ['assets/x.jpg', 4],
      ['empty.bin', 0],
      ['ümlaut.txt', 2],
    ]);
    expect(await (await entries[0]!.data()).text()).toBe('{"a":1}');
    expect([...(await bytes(await entries[1]!.data()))]).toEqual([0, 1, 2, 255]);
    expect(entries[1]!.crc32).toBe(await crc32Blob(await entries[1]!.data()));
  });

  it('writes archives that Python accepts, plain and ZIP64', async () => {
    for (const forceZip64 of [false, true]) {
      const zip = await createZip(inputs(), { forceZip64 });
      expect(pythonTest(await bytes(zip))).toEqual(['backup.json', 'assets/x.jpg', 'empty.bin', 'ümlaut.txt']);
      const back = await readZip(zip);
      expect(await (await back[3]!.data()).text()).toBe('ä');
    }
  });

  it('reads archives written by Python', async () => {
    const out = execFileSync('python3', [
      '-I',
      '-c',
      'import io,sys,zipfile\nb=io.BytesIO()\nz=zipfile.ZipFile(b,"w",zipfile.ZIP_STORED)\nz.writestr("a.txt","hello")\nz.writestr("d/b.bin",bytes(range(10)))\nz.comment=b"c"\nz.close()\nsys.stdout.buffer.write(b.getvalue())',
    ]);
    const entries = await readZip(new Blob([new Uint8Array(out)]));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'd/b.bin']);
    expect(await (await entries[0]!.data()).text()).toBe('hello');
  });

  it('reports progress over all bytes', async () => {
    const seen: Array<[number, number]> = [];
    await createZip(inputs(), { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen.at(-1)).toEqual([13, 13]);
  });

  it('rejects duplicates, garbage, compressed and truncated archives', async () => {
    await expect(createZip([inputs()[0]!, inputs()[0]!])).rejects.toThrow(/Duplicate/);
    await expect(readZip(text('short'))).rejects.toThrow(ZipError);
    await expect(readZip(new Blob([new Uint8Array(100)]))).rejects.toThrow(/no end of central directory/);

    const deflated = execFileSync('python3', [
      '-I',
      '-c',
      'import io,sys,zipfile\nb=io.BytesIO()\nz=zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED)\nz.writestr("a.txt","hello"*100)\nz.close()\nsys.stdout.buffer.write(b.getvalue())',
    ]);
    await expect(readZip(new Blob([new Uint8Array(deflated)]))).rejects.toThrow(/compressed/);

    const zip = await bytes(await createZip(inputs()));
    // Damaged central directory signature.
    const cd = zip.slice();
    const cdAt = new DataView(cd.buffer).getUint32(cd.length - 6, true);
    cd[cdAt] = 0;
    await expect(readZip(new Blob([cd]))).rejects.toThrow(/Corrupt central directory/);
    // Damaged local header.
    const lh = zip.slice();
    lh[0] = 0;
    const entries = await readZip(new Blob([lh]));
    await expect(entries[0]!.data()).rejects.toThrow(/Corrupt local header/);
    // Central directory points past the end.
    const cut = zip.slice();
    new DataView(cut.buffer).setUint32(cut.length - 6, cut.length, true);
    await expect(readZip(new Blob([cut]))).rejects.toThrow(/Unexpected end/);
  });

  it('rejects encrypted entries and a missing ZIP64 locator', async () => {
    const zip = await bytes(await createZip([inputs()[0]!]));
    const dv = new DataView(zip.buffer);
    const cdAt = dv.getUint32(zip.length - 6, true);
    const enc = zip.slice();
    new DataView(enc.buffer).setUint16(cdAt + 8, 0x0801, true);
    await expect(readZip(new Blob([enc]))).rejects.toThrow(/encrypted/);
    const z64 = zip.slice();
    new DataView(z64.buffer).setUint16(z64.length - 12, 0xffff, true);
    await expect(readZip(new Blob([z64]))).rejects.toThrow(/ZIP64 locator/);

    const forced = await bytes(await createZip([inputs()[0]!], { forceZip64: true }));
    // Locator found, but the ZIP64 end record it points to is damaged.
    const locAt = forced.length - 22 - 20;
    const e64At = new DataView(forced.buffer).getUint32(locAt + 8, true);
    forced[e64At] = 0;
    await expect(readZip(new Blob([forced]))).rejects.toThrow(/ZIP64 end of central directory/);
  });

  it('detects an entry cut short', async () => {
    const zip = await bytes(await createZip([{ name: 'a', data: text('hello world') }]));
    // Point the entry's local header offset so far that its data would run past the end.
    const dv = new DataView(zip.buffer);
    const cdAt = dv.getUint32(zip.length - 6, true);
    dv.setUint32(cdAt + 24, 1000, true);
    dv.setUint32(cdAt + 20, 1000, true);
    const [e] = await readZip(new Blob([zip]));
    await expect(e!.data()).rejects.toThrow(/truncated/);
  });
});
