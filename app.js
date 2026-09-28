const BAUD_RATE = 115200;
const BLOCK_SIZE = 1024;
const IMAGE_HEADER_OFFSET = 992;
const IMAGE_HEADER_SIZE = 32;
const ACK_SEQUENCE = 0x06;
const START = 0xaa;
const END = 0x55;

const command = { identify: 0x0a, imageHeader: 0x02, blockCount: 0x04, block: 0x03, finish: 0x45 };
const elements = Object.fromEntries(['firmware-file', 'file-details', 'connect-button', 'disconnect-button', 'connection-status', 'flash-button', 'progress', 'progress-label', 'activity-log', 'clear-log-button'].map((id) => [id, document.getElementById(id)]));

let port;
let firmware;
let busy = false;
let pendingBytes = new Uint8Array();

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  elements['activity-log'].textContent += `\n[${timestamp}] ${message}`;
  elements['activity-log'].scrollTop = elements['activity-log'].scrollHeight;
}

function crc16Xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function makeFrame(commandId, sequence, payload = new Uint8Array()) {
  if (payload.length > 0xffff) throw new Error('Frame payload is too large.');
  const frame = new Uint8Array(6 + payload.length + 3);
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffff) throw new Error('Frame sequence is out of range.');
  frame.set([START, commandId, sequence >> 8, sequence & 0xff, payload.length >> 8, payload.length & 0xff]);
  frame.set(payload, 6);
  const crc = crc16Xmodem(frame.subarray(1, 6 + payload.length));
  frame[6 + payload.length] = crc >> 8;
  frame[7 + payload.length] = crc & 0xff;
  frame[8 + payload.length] = END;
  return frame;
}

function concat(left, right) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left); result.set(right, left.length);
  return result;
}

async function readExactly(length, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (pendingBytes.length < length) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${length} response bytes.`);
    const reader = port.readable.getReader();
    let timeout;
    try {
      const read = reader.read();
      const timeoutPromise = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Timed out waiting for the radio response.')), remaining); });
      const { value, done } = await Promise.race([read, timeoutPromise]);
      if (done) throw new Error('Serial connection closed by the radio.');
      if (value) pendingBytes = concat(pendingBytes, value);
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
  const result = pendingBytes.slice(0, length);
  pendingBytes = pendingBytes.slice(length);
  return result;
}

async function expectAck(commandId) {
  const response = await readExactly(9);
  if (response[0] !== START || response[8] !== END) throw new Error('Radio returned a malformed response frame.');
  const length = (response[4] << 8) | response[5];
  if (length !== 0 || response[1] !== commandId || response[2] !== 0 || response[3] !== ACK_SEQUENCE) throw new Error(`Radio rejected command 0x${commandId.toString(16).padStart(2, '0')}.`);
  const expectedCrc = crc16Xmodem(response.subarray(1, 6));
  const actualCrc = (response[6] << 8) | response[7];
  if (expectedCrc !== actualCrc) throw new Error('Radio response failed its CRC check.');
}

async function sendCommand(commandId, sequence, payload) {
  const writer = port.writable.getWriter();
  try { await writer.write(makeFrame(commandId, sequence, payload)); } finally { writer.releaseLock(); }
  await expectAck(commandId);
}

function updateControls() {
  elements['connect-button'].disabled = Boolean(port) || busy;
  elements['disconnect-button'].disabled = !port || busy;
  elements['flash-button'].disabled = !port || !firmware || busy;
}

async function disconnect() {
  if (!port) return;
  try { await port.close(); } catch (error) { log(`Disconnect warning: ${error.message}`); }
  port = undefined; pendingBytes = new Uint8Array();
  elements['connection-status'].textContent = 'Not connected.';
  updateControls();
}

async function flash() {
  if (!firmware || !port) return;
  if (firmware.length === 0 || firmware.length % BLOCK_SIZE !== 0 || firmware.length / BLOCK_SIZE > 0x10000 || firmware.length < IMAGE_HEADER_OFFSET + IMAGE_HEADER_SIZE) {
    throw new Error(`Expected a non-empty .btf image in ${BLOCK_SIZE}-byte blocks (at least ${IMAGE_HEADER_OFFSET + IMAGE_HEADER_SIZE} bytes).`);
  }
  busy = true; updateControls(); pendingBytes = new Uint8Array();
  const blocks = firmware.length / BLOCK_SIZE;
  try {
    log('Starting RT-950 bootloader session.');
    await sendCommand(command.identify, 0, new TextEncoder().encode('BOOTLOADER_V3'));
    await sendCommand(command.imageHeader, 0, firmware.slice(IMAGE_HEADER_OFFSET, IMAGE_HEADER_OFFSET + IMAGE_HEADER_SIZE));
    await sendCommand(command.blockCount, 0, new Uint8Array([(blocks - 1) >> 8, (blocks - 1) & 0xff]));
    for (let index = 0; index < blocks; index += 1) {
      await sendCommand(command.block, index, firmware.slice(index * BLOCK_SIZE, (index + 1) * BLOCK_SIZE));
      const percent = Math.round(((index + 1) / blocks) * 100);
      elements.progress.value = percent;
      elements['progress-label'].textContent = `Writing block ${index + 1} of ${blocks} (${percent}%).`;
    }
    await sendCommand(command.finish, 0, new Uint8Array());
    elements['progress-label'].textContent = 'Flash complete. The radio is restarting into the new firmware.';
    log('Flash complete; finish command acknowledged.');
  } finally { busy = false; updateControls(); }
}

elements['firmware-file'].addEventListener('change', async ({ target }) => {
  const [file] = target.files;
  firmware = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
  elements['file-details'].textContent = file ? `${file.name} — ${firmware.length.toLocaleString()} bytes (${Math.ceil(firmware.length / BLOCK_SIZE)} blocks)` : 'No firmware selected.';
  elements.progress.value = 0; elements['progress-label'].textContent = file ? 'Ready to flash after connecting the radio.' : 'Waiting for a firmware file and radio.';
  updateControls();
});

elements['connect-button'].addEventListener('click', async () => {
  try {
    if (!('serial' in navigator)) throw new Error('Web Serial is unavailable. Use a current Chromium-based browser over HTTPS or localhost.');
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    pendingBytes = new Uint8Array(); elements['connection-status'].textContent = `Connected at ${BAUD_RATE} baud.`; log('Serial device connected.'); updateControls();
  } catch (error) { port = undefined; elements['connection-status'].textContent = `Connection failed: ${error.message}`; log(`Connection failed: ${error.message}`); updateControls(); }
});
elements['disconnect-button'].addEventListener('click', disconnect);
elements['flash-button'].addEventListener('click', async () => { try { await flash(); } catch (error) { elements['progress-label'].textContent = `Flash failed: ${error.message}`; log(`Flash failed: ${error.message}`); } });
elements['clear-log-button'].addEventListener('click', () => { elements['activity-log'].textContent = 'Ready.'; });
navigator.serial?.addEventListener('disconnect', (event) => { if (event.target === port) disconnect(); });
updateControls();
