const NAND_SIZE = 4 * 1024 * 1024;
const BLOCK_SIZE = 4096;
const SIGNATURE = 0xaa;
const command = { changeBaud: 0x70, readBlock: 0x10, writeBlock: 0x20, finalize: 0x48, reboot: 0x50 };
const elements = Object.fromEntries([
  'baud-rate', 'connect-button', 'disconnect-button', 'connection-status',
  'backup-button', 'backup-file', 'file-details', 'restore-button',
  'progress', 'progress-label', 'activity-log', 'clear-log-button',
].map((id) => [id, document.getElementById(id)]));

let port;
let reader;
let readTask;
let rxBuffer = new Uint8Array();
let readWaiter;
let busy = false;
let backupData;

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  elements['activity-log'].textContent += `\n[${timestamp}] ${message}`;
  elements['activity-log'].scrollTop = elements['activity-log'].scrollHeight;
}

function concat(left, right) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function startReader() {
  if (!port?.readable) throw new Error('Serial device is not readable.');
  reader = port.readable.getReader();
  readTask = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        rxBuffer = concat(rxBuffer, value);
        if (readWaiter && rxBuffer.length >= readWaiter.length) {
          const waiter = readWaiter;
          readWaiter = undefined;
          clearTimeout(waiter.timer);
          const result = rxBuffer.slice(0, waiter.length);
          rxBuffer = rxBuffer.slice(waiter.length);
          waiter.resolve(result);
        }
      }
    } catch (error) {
      if (port) failWaiter(error);
    } finally {
      try { reader.releaseLock(); } catch {}
      reader = undefined;
    }
  })();
}

function failWaiter(error) {
  if (!readWaiter) return;
  const waiter = readWaiter;
  readWaiter = undefined;
  clearTimeout(waiter.timer);
  waiter.reject(error);
}

function readExactly(length, timeoutMs = 5000) {
  if (rxBuffer.length >= length) {
    const result = rxBuffer.slice(0, length);
    rxBuffer = rxBuffer.slice(length);
    return Promise.resolve(result);
  }
  if (readWaiter) return Promise.reject(new Error('Internal protocol error: overlapping serial reads.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readWaiter = undefined;
      reject(new Error(`Timed out waiting for ${length} response bytes.`));
    }, timeoutMs);
    readWaiter = { length, resolve, reject, timer };
  });
}

async function stopReader() {
  if (!reader) return;
  const currentReader = reader;
  const currentTask = readTask;
  try { await currentReader.cancel(); } catch {}
  try { await currentTask; } catch {}
  reader = undefined;
}

function expectAck(response, commandId) {
  if (response.length !== 2 || response[0] !== SIGNATURE || response[1] !== commandId) {
    throw new Error(`Unexpected radio response; expected acknowledgement for 0x${commandId.toString(16).padStart(2, '0')}.`);
  }
}

function checksum(bytes) {
  let total = 0;
  for (const byte of bytes) total = (total + byte) & 0xff;
  return total;
}

function addressBytes(address) {
  return new Uint8Array([address & 0xff, (address >>> 8) & 0xff, (address >>> 16) & 0xff, (address >>> 24) & 0xff]);
}

async function writeBytes(bytes) {
  const writer = port.writable.getWriter();
  try { await writer.write(bytes); } finally { writer.releaseLock(); }
}

async function reopenSerial(baudRate) {
  await stopReader();
  if (port.readable) await port.close();
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  rxBuffer = new Uint8Array();
  startReader();
}

async function sendBaudChange(baudRate) {
  const packet = new Uint8Array(6);
  packet[0] = SIGNATURE;
  packet[1] = command.changeBaud;
  new DataView(packet.buffer).setUint32(2, baudRate, true);
  await writeBytes(packet);

  // The protocol sends one acknowledgement at 38,400, then repeats it at the selected speed after 100 ms.
  expectAck(await readExactly(2, 3000), command.changeBaud);
  if (baudRate === 38400) {
    expectAck(await readExactly(2, 3000), command.changeBaud);
  } else {
    await reopenSerial(baudRate);
    expectAck(await readExactly(2, 3000), command.changeBaud);
  }
}

async function beginTransferSession() {
  const baudRate = Number(elements['baud-rate'].value);
  // The radio falls back to 38,400 after idle time, so synchronize the host speed before every transfer.
  await reopenSerial(38400);
  await sendBaudChange(baudRate);
  elements['connection-status'].textContent = `Connected; transfer session at ${baudRate.toLocaleString()} baud.`;
  log(`Transfer session baud rate set to ${baudRate.toLocaleString()} baud.`);
}

function updateControls() {
  elements['connect-button'].disabled = Boolean(port) || busy;
  elements['disconnect-button'].disabled = !port || busy;
  elements['backup-button'].disabled = !port || busy;
  elements['restore-button'].disabled = !port || !backupData || busy;
  elements['baud-rate'].disabled = Boolean(port) || busy;
}

async function disconnect() {
  if (!port) return;
  const oldPort = port;
  failWaiter(new Error('Serial connection closed.'));
  await stopReader();
  try { await oldPort.close(); } catch (error) { log(`Disconnect warning: ${error.message}`); }
  port = undefined;
  rxBuffer = new Uint8Array();
  elements['connection-status'].textContent = 'Not connected.';
  updateControls();
}

async function transferBlock(commandId, address, data) {
  const isRead = commandId === command.readBlock;
  const packet = new Uint8Array(isRead ? 6 : 2 + 4 + data.length + 1);
  packet[0] = SIGNATURE;
  packet[1] = commandId;
  packet.set(addressBytes(address), 2);
  if (!isRead) {
    packet.set(data, 6);
    packet[packet.length - 1] = checksum(data);
  }
  await writeBytes(packet);
  if (isRead) {
    const response = await readExactly(2 + 4 + BLOCK_SIZE + 1, 10000);
    if (response[0] !== SIGNATURE || response[1] !== command.readBlock) throw new Error(`Invalid read response at address 0x${address.toString(16)}.`);
    const view = new DataView(response.buffer, response.byteOffset, response.byteLength);
    if (view.getUint32(2, true) !== address) throw new Error(`Radio returned the wrong address for block 0x${address.toString(16)}.`);
    const block = response.slice(6, 6 + BLOCK_SIZE);
    if (checksum(block) !== response[response.length - 1]) throw new Error(`Checksum mismatch at address 0x${address.toString(16)}.`);
    return block;
  }
  expectAck(await readExactly(2, 10000), command.writeBlock);
}

function updateProgress(index, total, operation) {
  const percent = Math.round((index / total) * 100);
  elements.progress.value = percent;
  elements['progress-label'].textContent = `${operation}: block ${index.toLocaleString()} of ${total.toLocaleString()} (${percent}%).`;
}

async function backup() {
  if (!port || busy) return;
  busy = true;
  updateControls();
  elements.progress.value = 0;
  rxBuffer = new Uint8Array();
  const data = new Uint8Array(NAND_SIZE);
  const blocks = NAND_SIZE / BLOCK_SIZE;
  try {
    log(`Starting ${NAND_SIZE.toLocaleString()}-byte NAND backup using 4 KiB read packets.`);
    elements['connection-status'].textContent = 'Starting transfer session at 38,400 baud…';
    await beginTransferSession();
    for (let index = 0; index < blocks; index += 1) {
      const address = index * BLOCK_SIZE;
      data.set(await transferBlock(command.readBlock, address), address);
      updateProgress(index + 1, blocks, 'Reading');
    }
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rt-950-pro-nand-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`;
    link.click();
    URL.revokeObjectURL(url);
    elements['progress-label'].textContent = 'Backup complete. The 4 MiB file has been downloaded.';
    log('Backup complete and downloaded.');
  } finally {
    busy = false;
    updateControls();
  }
}

async function restore() {
  if (!port || !backupData || busy) return;
  if (!window.confirm('This writes all 4 MiB of the selected file to NAND, finalizes the flash, and reboots the radio. Continue?')) return;
  busy = true;
  updateControls();
  elements.progress.value = 0;
  rxBuffer = new Uint8Array();
  const blocks = NAND_SIZE / BLOCK_SIZE;
  try {
    log(`Starting ${NAND_SIZE.toLocaleString()}-byte NAND restore using 4 KiB write packets.`);
    elements['connection-status'].textContent = 'Starting transfer session at 38,400 baud…';
    await beginTransferSession();
    for (let index = 0; index < blocks; index += 1) {
      const address = index * BLOCK_SIZE;
      const block = backupData.slice(address, address + BLOCK_SIZE);
      await transferBlock(command.writeBlock, address, block);
      updateProgress(index + 1, blocks, 'Writing');
    }
    await writeBytes(new Uint8Array([SIGNATURE, command.finalize]));
    expectAck(await readExactly(2, 10000), command.finalize);
    log('All data written and flash finalize acknowledged.');
    await writeBytes(new Uint8Array([SIGNATURE, command.reboot]));
    elements.progress.value = 100;
    elements['progress-label'].textContent = 'Restore complete. Reboot command sent; the radio is restarting.';
    log('Reboot command sent.');
  } finally {
    busy = false;
    updateControls();
  }
}

elements['backup-file'].addEventListener('change', async ({ target }) => {
  const [file] = target.files;
  backupData = undefined;
  if (file) {
    if (file.size !== NAND_SIZE) {
      elements['file-details'].textContent = `Invalid size: ${file.size.toLocaleString()} bytes. Select exactly 4,194,304 bytes.`;
    } else {
      backupData = new Uint8Array(await file.arrayBuffer());
      elements['file-details'].textContent = `${file.name} — ${backupData.length.toLocaleString()} bytes. Ready to restore.`;
    }
  } else {
    elements['file-details'].textContent = 'No backup selected.';
  }
  updateControls();
});

elements['connect-button'].addEventListener('click', async () => {
  try {
    if (!('serial' in navigator)) throw new Error('Web Serial is unavailable. Use a current Chromium-based browser over HTTPS or localhost.');
    elements['connection-status'].textContent = 'Select the serial device to connect…';
    port = await navigator.serial.requestPort();
    elements['connection-status'].textContent = 'Opening serial device at 38,400 baud…';
    await port.open({ baudRate: 38400, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    rxBuffer = new Uint8Array();
    startReader();
    elements['connection-status'].textContent = 'Connected at 38,400 baud. Ready to transfer.';
    log('Serial device connected at 38,400 baud. Baud negotiation will run when a transfer starts.');
    updateControls();
  } catch (error) {
    elements['connection-status'].textContent = `Connection failed: ${error.message}`;
    log(`Connection failed: ${error.message}`);
    if (port) await disconnect();
  }
});

elements['disconnect-button'].addEventListener('click', disconnect);
elements['backup-button'].addEventListener('click', async () => {
  try { await backup(); } catch (error) {
    elements['progress-label'].textContent = `Backup failed: ${error.message}`;
    log(`Backup failed: ${error.message}`);
  }
});
elements['restore-button'].addEventListener('click', async () => {
  try { await restore(); } catch (error) {
    elements['progress-label'].textContent = `Restore failed: ${error.message}`;
    log(`Restore failed: ${error.message}`);
  }
});
elements['clear-log-button'].addEventListener('click', () => { elements['activity-log'].textContent = 'Ready.'; });
navigator.serial?.addEventListener('disconnect', (event) => { if (event.target === port) disconnect(); });
updateControls();
