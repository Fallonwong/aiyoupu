#!/usr/bin/env node
// Build the distributable ZIP from the manifest file list, so the package and
// the recorded hashes can never describe different snapshots. Run
// build-manifest.mjs first: this refuses to package a stale manifest.
//
// Usage:
//   node scripts/build-release.mjs [--out DIR] [--force]
//
// Writes aiyoupu-<version>.zip and aiyoupu-<version>.sha256 beside it. The
// archive root is the folder name users drop into their Agent skill directory.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {sha256} from './audio.mjs';
import {isMain} from './entry.mjs';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return {time, day};
}

const STORE = 0;
const DEFLATE = 8;

/** Write a deterministic ZIP: fixed timestamps, sorted input, no extra fields. */
function writeZip(entries, file, stamp) {
  const {time, day} = dosTime(stamp);
  const local = [];
  const central = [];
  let offset = 0;
  for (const {name, data} of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, {level: 9});
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? STORE : DEFLATE;
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names, so CJK paths extract correctly
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(day, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(day, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += head.length + nameBuf.length + body.length;
  }
  const localBuf = Buffer.concat(local);
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  end.writeUInt16LE(0, 20);
  fs.writeFileSync(file, Buffer.concat([localBuf, centralBuf, end]));
  return {entries: entries.length, deflated: entries.length};
}

export function buildRelease({root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), outDir = null, force = false} = {}) {
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version;
  if (!version) throw new Error('manifest.json has no version');
  const folder = 'aiyoupu';
  // build-manifest.mjs excludes manifest.json from its own record (it would
  // be self-referential), so the package must add it back explicitly. The
  // installed copy needs it to describe what it shipped.
  const rels = [...Object.keys(manifest.files ?? {}), 'manifest.json'];
  if (!rels.length) throw new Error('manifest.json has no files; run build-manifest.mjs first');
  // Refuse to package a manifest that no longer matches the working tree: a
  // release must describe the exact bytes it ships.
  const stale = [];
  const entries = [];
  for (const rel of [...rels].sort()) {
    const full = path.join(root, rel);
    if (!fs.statSync(full, {throwIfNoEntry: false})?.isFile()) { stale.push(rel + ' (missing)'); continue; }
    const data = fs.readFileSync(full);
    const recorded = manifest.files[rel];
    if (recorded?.sha256 && recorded.sha256 !== sha256(data)) stale.push(rel + ' (hash mismatch)');
    if (recorded?.bytes !== undefined && recorded.bytes !== data.length) stale.push(rel + ' (size mismatch)');
    entries.push({name: folder + '/' + rel.split(path.sep).join('/'), data});
  }
  if (stale.length) {
    throw new Error('Manifest does not match the working tree. Run build-manifest.mjs first.\n' + stale.slice(0, 12).join('\n'));
  }
  const target = path.resolve(outDir ?? path.join(root, 'dist'));
  fs.mkdirSync(target, {recursive: true});
  const zipName = 'aiyoupu-' + version + '.zip';
  const zipPath = path.join(target, zipName);
  if (fs.existsSync(zipPath) && !force) throw new Error('Output exists: ' + zipPath + ' (use --force)');
  // A fixed stamp keeps the archive byte-identical across rebuilds.
  const stamp = new Date('2026-11-13T00:00:00Z');
  writeZip(entries, zipPath, stamp);
  const bytes = fs.readFileSync(zipPath);
  const digest = sha256(bytes);
  const shaName = 'aiyoupu-' + version + '.sha256';
  fs.writeFileSync(path.join(target, shaName), digest + '  ' + zipName + '\n');
  return {status: 'release_built', version, folder, files: entries.length, zip: zipPath, bytes: bytes.length, sha256: digest, shaFile: path.join(target, shaName)};
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  try {
    console.log(JSON.stringify(buildRelease({outDir: get('--out'), force: args.includes('--force')}), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
