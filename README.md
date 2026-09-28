# RT-950 Pro Web Flasher

A browser-only firmware flasher for the Radtel RT-950 Pro handheld transceiver. It reproduces the framed bootloader protocol observed in `serial-communication-log.txt` to write `.btf` firmware images through Web Serial.

## Use

1. Serve this directory from **localhost or HTTPS** (Web Serial requires a secure context), for example: `python3 -m http.server 8000`.
2. Open the site in a current Chromium-based browser (Chrome or Edge).
3. Put the radio into bootloader/programming mode and connect its programming cable.
4. Select the `.btf` file, choose **Connect serial device**, then choose **Flash firmware**.
5. Keep the radio powered and connected until the application reports completion.

The flasher opens the selected serial port at 115200 8N1 with flow control disabled and validates an acknowledgement and CRC after every command. The observed protocol and firmware layout are documented in [PROTOCOL.md](PROTOCOL.md).

> **Warning:** Flashing firmware can render a radio unusable if the wrong image is selected or power is interrupted. Confirm that the firmware is intended for your exact device before proceeding.
