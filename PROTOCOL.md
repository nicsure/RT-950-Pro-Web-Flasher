# RT-950 Pro bootloader protocol

The supplied capture identifies a small framed bootloader protocol rather than a standard XMODEM/YMODEM transfer. The serial port is opened as **115200 baud, 8 data bits, no parity, one stop bit, no flow control**.

## Frame format

All frames are binary and have this form:

```text
AA | command | 00 | sequence | payload length (big-endian uint16) | payload | CRC-16 | 55
```

* `AA` and `55` are start/end sentinels.
* Commands are one-byte values with a constant zero high byte in the capture.
* The sequence is `0` for setup/final commands and is the zero-based 1024-byte block number for firmware blocks.
* CRC is **CRC-16/XMODEM** (polynomial `0x1021`, initial value `0x0000`, no reflection, no final XOR), calculated from `command` through the end of the payload—excluding `AA`, CRC, and `55`—and written big-endian.
* The radio acknowledges each command using the same command, sequence `06`, a zero payload length, and a valid CRC. Captured acknowledgements can be physically split across reads, so the flasher buffers serial reads into complete frames.

The first captured request (`BOOTLOADER_V3`) has CRC `0x4034`, which validates these CRC parameters.

## Flash sequence

For a `9216`-byte image, the capture performs the following sequence:

1. Command `0A`: payload ASCII `BOOTLOADER_V3`.
2. Command `02`: 32-byte image identity header from offset `992` (`0x3E0`) of the `.btf` image.
3. Command `04`: big-endian uint16 of the final block index (`8` for nine 1024-byte blocks).
4. Command `03`: nine firmware blocks, each exactly 1024 bytes, sequenced `0` through `8`.
5. Command `45`: no payload; instructs the device to finish/restart.

Every step waits for the acknowledgement before continuing. `app.js` implements these observed semantics and rejects files that cannot be represented by the one-byte block sequence.
