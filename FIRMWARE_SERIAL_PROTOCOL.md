# Serial Protocol Overview

Communication between **HOST** and **RADIO** is performed over a USB serial programming cable specifically designed for the RT-880. The default communication speed is **38,400 baud**, but this can be changed dynamically using a command packet (see below).

All communication uses a **synchronous packet-based protocol**, with the exception of **Remote Mode**, which uses its own asynchronous protocol. The serial protocol is used to control link speed and to read from or write to the radio’s flash storage.

---

## Packet Structure

All packets begin with:

- **Signature byte:** `0xAA`
- **Command ID byte**

Any following data is command-specific.

- All multi-byte values are **little endian**

---

## Change Baud Rate

Changes the active serial baud rate.

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x70` – Command ID (Change Baud) |
| 4 | New baud rate (32-bit unsigned) |

### Radio → Host (Acknowledgement)

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x70` – Command ID |

The radio first replies **at the original baud rate**, then sends the same acknowledgement again **100 ms later at the new baud rate**.

### Notes

- The radio defaults to **38,400 baud**
- This command must be sent at **38,400 baud**
- After **5 seconds of no serial activity**, the radio automatically falls back to 38,400 baud
- If higher speeds are required, this command must be sent during initialization

---

## Storage Read and Write

These commands allow the host to access the radio’s flash storage. Sequential reads and writes are supported. Due to flash constraints, operations are performed in either **128-byte** or **4096-byte** blocks.

---

## Read Storage (128 Bytes)

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x30` – Command ID (Read 128 bytes) |
| 4 | Storage address (32-bit unsigned) |

### Radio → Host

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x30` – Command ID |
| 4 | Storage address |
| 128 | Storage data |
| 1 | Additive checksum of storage data |

---

## Write Storage (128 Bytes)

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x40` – Command ID (Write 128 bytes) |
| 4 | Storage address |
| 128 | Storage data |
| 1 | Additive checksum of storage data |

### Radio → Host

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x40` – Command ID |

---

## Read Storage (4096 Bytes)

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x10` – Command ID (Read 4096 bytes) |
| 4 | Storage address |

### Radio → Host

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x10` – Command ID |
| 4 | Storage address |
| 4096 | Storage data |
| 1 | Additive checksum of the 4-byte storage address and storage data |

---

## Write Storage (4096 Bytes)

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x20` – Command ID (Write 4096 bytes) |
| 4 | Storage address |
| 4096 | Storage data |
| 1 | Additive checksum of the 4-byte storage address and storage data |

### Radio → Host

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x20` – Command ID |

---


For the 4096-byte read and write commands, the checksum is the low 8 bits of the sum of all four address bytes and all 4096 data bytes. The signature and command bytes are not included.

## Finalize Write

Commits all previously written data to flash storage. This should be called after you've sent all write packets for the operation.

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x48` – Command ID (Finalize Write) |

The radio acknowledges with the same packet.

---

## Reboot Radio

Reboots the radio. Required after writing storage and finalizing so changes take effect.  
This command is **not acknowledged**.

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x50` – Command ID (Reboot) |

---

## Send Smart List

Requests the contents of the radio’s **Smart Scan frequency memory**.

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x55` – Command ID (Send Smart List) |

### Radio → Host

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x55` – Command ID |
| 4 | Frequency (32-bit unsigned, 10 Hz units) |
| 2 | Heat / activity score (16-bit unsigned) |
| — | _Frequency + Heat repeated 50 times_ |

---

## Start Remote

Starts a Remote Mode session. A baud-rate change is typically performed before issuing this command.  
This command is **not acknowledged**.

See: [Technical Data → Remote Protocol](https://github.com/nicsure/RMS880/wiki/Remote-Protocol)

### Host → Radio

| Data Bytes | Element |
|-----------:|---------|
| 1 | `0xAA` – Signature |
| 1 | `0x51` – Command ID (Begin Remote Session) |
