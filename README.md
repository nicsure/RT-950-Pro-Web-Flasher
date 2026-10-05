# RT-950 Pro Web Flasher

A browser-only firmware flasher for the Radtel RT-950 Pro handheld transceiver. It reproduces the framed bootloader protocol observed in `serial-communication-log.txt` to write `.btf` firmware images through Web Serial.

## Host Locally
1. Serve this directory from **localhost or HTTPS** (Web Serial requires a secure context), for example: `python3 -m http.server 8000`.
2. Open the local site in a current Chromium-based browser (Chrome or Edge). for example: `https://localhost:8000/`

## Or Run via the Web Directly
1. Click this GitHub Pages link
   https://nicsure.github.io/RT-950-Pro-Web-Flasher/

## NAND Backup and Restore
Open [`nand-backup.html`](nand-backup.html) to back up or restore exactly 4 MiB using the firmware serial protocol's 4,096-byte packets. The app starts each connection at 38,400 baud, sends the selected baud-rate command, and waits for acknowledgements before enabling transfers. Restore writes every block, sends Finalize Write, then reboots the radio.

## Flash Firmware File
1. Put the radio into bootloader/programming mode and connect its programming cable.  
   To do this, power the radio on while holding the bottom two side buttons.  
   The screen of the radio should display "Update"
2. Select the `.btf` file, choose **Connect serial device**, then choose **Flash firmware**.
3. Keep the radio powered and connected until the application reports completion.

The flasher opens the selected serial port at 115200 8N1 with flow control disabled and validates an acknowledgement and CRC after every command. The observed protocol and firmware layout are documented in [PROTOCOL.md](PROTOCOL.md).

> **Warning:** Flashing firmware can render a radio unusable if the wrong image is selected or power is interrupted. Confirm that the firmware is intended for your exact device before proceeding.
