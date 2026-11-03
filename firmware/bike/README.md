# Triumph bike box

Wiring, the 16-pin plug, and the parts list are in [docs/hardware/bike-link-wiring.md](../../docs/hardware/bike-link-wiring.md). Power and the radio limit are in [docs/hardware/bike-link-build.md](../../docs/hardware/bike-link-build.md).

Set `BOX_ID` in `bike_link.ino` to this box's sticker. The radio stays out of the build until `radio.h` in this folder contains `#define BIKE_LINK_RADIO 1`.

Fault reads are service 03, then service 19 subfunction 02 (report DTC by status mask) on the bitrate that answered. The byte layout matches SAE J2012 in `lib/bikeLink/saeJ2012.ts`. The sketch does not clear codes.

Bench pass marks, in this order:

1. Regulator about 3.7 V before the XIAO is connected.
2. Sleep current at the fuse under 50 µA.
3. 12.6 V on the bench appears in the BLE JSON within 0.1 V.
4. CAN terminator absent. Resistance between pins 6 and 14 on the bike unchanged after the sleeping box is plugged in.
5. The bike starts and idles with the cable connected.
