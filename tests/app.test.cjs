const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

function harness() {
  const nodes = new Map();
  const frames = [];
  let ack;
  const port = {
    writable: { getWriter: () => ({
      async write(frame) {
        frames.push(Buffer.from(frame));
        ack = Buffer.from([0xaa, frame[1], 0, 6, 0, 0, 0, 0, 0x55]);
        ack.writeUInt16BE(crc16(ack.subarray(1, 6)), 6);
      },
      releaseLock() {},
    }) },
    readable: { getReader: () => ({
      async read() { return { value: ack, done: false }; },
      releaseLock() {},
    }) },
  };
  const context = vm.createContext({
    Uint8Array, TextEncoder, setTimeout, clearTimeout,
    navigator: {},
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', addEventListener() {} });
      return nodes.get(id);
    } },
  });
  vm.runInContext(source, context);
  context.testPort = port;
  vm.runInContext('port = testPort', context);
  return {
    frames,
    nodes,
    flash(image) {
      context.testImage = image;
      return vm.runInContext('firmware = testImage; flash()', context);
    },
  };
}

async function verifyTransfer(image) {
  const { flash, frames, nodes } = harness();
  await flash(image);
  const count = Math.ceil(image.length / 1024);
  assert.equal(frames.length, count + 4);
  assert.deepEqual(frames.map(frame => frame[1]), [0x0a, 2, 4, ...Array(count).fill(3), 0x45]);
  for (const frame of frames) {
    assert.equal(frame[0], 0xaa);
    assert.equal(frame.at(-1), 0x55);
    assert.equal(frame.readUInt16BE(4), frame.length - 9);
    assert.equal(frame.readUInt16BE(frame.length - 3), crc16(frame.subarray(1, -3)));
  }
  assert.deepEqual(frames[0].subarray(6, -3), Buffer.from('BOOTLOADER_V3'));
  assert.deepEqual(frames[1].subarray(6, -3), image.subarray(992, 1024));
  assert.equal(frames[2].readUInt16BE(6), count - 1);
  const blocks = frames.slice(3, -1);
  blocks.forEach((frame, index) => {
    assert.equal(frame.readUInt16BE(2), index);
    assert.equal(frame.readUInt16BE(4), 1024);
  });
  const transferred = Buffer.concat(blocks.map(frame => frame.subarray(6, -3)));
  assert.deepEqual(transferred.subarray(0, image.length), image);
  assert.deepEqual(transferred.subarray(image.length), Buffer.alloc(count * 1024 - image.length, 0xff));
  assert.equal(nodes.get('progress').value, 100);
  assert.match(nodes.get('progress-label').textContent, /^Flash complete/);
}

for (const size of [1024, 1025, 385824]) {
  test(`transfers all ${size} bytes with full blocks, correct count, sequence, CRC and EOF padding`, async () => {
    const image = Buffer.alloc(size);
    for (let i = 0; i < size; i++) image[i] = i % 251;
    await verifyTransfer(image);
  });
}

test('existing aligned backup firmware is transferred unchanged', async () => {
  await verifyTransfer(readFileSync(join(__dirname, '..', 'rt950pro_flash_backup_restore.btf')));
});

for (const size of [0, 1023, 1024 * 65536 + 1]) {
  test(`rejects invalid image length ${size} before any serial writes`, async () => {
    const { flash, frames } = harness();
    await assert.rejects(flash({ length: size }), /Expected a .btf image between/);
    assert.equal(frames.length, 0);
  });
}

// Optional real firmware fixture stays outside the repository.
if (process.env.RT950_FIRMWARE_FIXTURE) {
  test('transfers the supplied external firmware fixture without losing bytes', async () => {
    await verifyTransfer(readFileSync(process.env.RT950_FIRMWARE_FIXTURE));
  });
}
