# RT-950 Pro Web Flasher

A browser-only firmware flasher for the Radtel RT-950 Pro handheld transceiver. It reproduces the framed bootloader protocol observed in `serial-communication-log.txt` to write `.btf` firmware images through Web Serial.

## Host Locally
1. Serve this directory from **localhost or HTTPS** (Web Serial requires a secure context), for example: `python3 -m http.server 8000`.
2. Open the local site in a current Chromium-based browser (Chrome or Edge). for example: `https://localhost:8000/`

## Or Run via the Web Directly
1. Click this GitHub Pages link
   https://nicsure.github.io/RT-950-Pro-Web-Flasher/
   
---

# NAND Backup and Restore

### Making a backup.

1. Use the above instructions to flash the backup and restore firmware .btf file  
2. Once flashed click here https://nicsure.github.io/RT-950-Pro-Web-Flasher/nand-backup.html to open the Storage Backup web application (or you can host it yourself using the same method as described above).
3. Turn on the radio if not already on. The display should show "Backup & Restore"
4. Select your BAUD rate, you may need to experiment to find the most stable speed, faster is better.
5. Click "Download 4 MiB backup" and wait for the process to complete.
6. Save the file and keep it safe.

### Restoring a backup

1. Use the above instructions to flash the backup and restore firmware .btf file
2. Once flashed click here https://nicsure.github.io/RT-950-Pro-Web-Flasher/nand-backup.html to open the Storage Backup web application
3. Turn on the radio if not already on. The display should show "Backup & Restore"
4. Select your BAUD rate
5. Click "Choose file" and browse to your backup image file.
6. Click "Restore selected backup" and wait for the process to complete.
7. Turn off the radio.
8. Follow the above instruction to flash the original factory firmware back onto the radio.


---

> **Warning:** Flashing firmware can render a radio unusable if the wrong image is selected or power is interrupted. Confirm that the firmware is intended for your exact device before proceeding.
