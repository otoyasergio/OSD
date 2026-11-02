# Bike link hardware

A shop-built pair of boxes for Toronto Moto. The bike box remembers kilometers, resting battery voltage, and fault codes. It hands that reading to a phone or shop tablet over Bluetooth, or later to a mailbox over a short-range radio. The mailbox is a wall-powered listener on the building's Wi-Fi.

This is a build guide. It is not firmware, and it does not add an ingest API to the shop app. The app already stores a reading. The JSON in [The mailbox](#the-mailbox) is the body a mailbox would POST later, shaped so it can be checked with `parseBikeReading` in `lib/bikeLink/reading.ts`.

Build the Bluetooth box first. Leave the radio off until that box sleeps, reads a bike, and a person can copy the reading into the motorcycle page. The wiring picture and pin tables are in [bike-link-wiring.md](bike-link-wiring.md).

The shop is OTOMOTO TORONTO MOTO INC., 99 River Street, Toronto. These boxes go on motorcycles. A car OBD plug is the wrong connector. Customer texts stay on the existing Wix Inbox thread. Nothing in this build sends an SMS.

## The two devices

**Bike box.** Lives on one motorcycle, under the seat. It wakes when the key turns on, asks the bike for kilometers and fault codes, then goes back to sleep. After the bike has been sitting, it measures the resting battery voltage. It keeps that log until a phone is next to it, or until a mailbox answers.

**Mailbox.** Sits indoors at the shop, at the client's home, or later at a cafe or a storage building. It has wall power and the building's Wi-Fi. It uses the same radio as the bike box. When a reading arrives, it would hand the JSON below to the shop app. Until that route exists, it prints the JSON on a USB serial monitor so staff can type it in.

A phone or the shop tablet is the first handoff. The mailbox is the second. Bike-to-bike relay and coverage across Toronto are out of scope.

## Bike box

```text
battery + ---- fuse ---- diode ---- 3.7 V regulator ---- XIAO nRF52840 ---- Bluetooth
                 |                         |
                 |                         +-- switch ---- CAN controller and transceiver ---- red 6-pin
                 +-- divider, switched, into the XIAO ADC
red plug pin 4 -- transistor ---------------- ignition sense into the XIAO

optional later: same XIAO UART ---- 915 MHz radio
```

The diagnostic reader is CAN. The first cable is the red Euro 5 6-pin. K-line is not in this build. A cheap K-line chip such as the ST L9637 only turns the single wire into a logic level. It does not speak Honda, Yamaha, Suzuki, or Kawasaki diagnostic protocols, and the Euro 5 bikes this cable is for put legislated diagnostics on CAN (pins 2 and 5). Pin 6 stays empty.

Bluetooth is the Nordic radio on the Seeed XIAO nRF52840. Storage is that board's on-board flash. The log is small: one reading is under 100 bytes, and a winter of daily voltage checks is a few dozen kilobytes.

The 915 MHz radio is a socket on the first build, empty until the mailbox exists.

Power is a fused wire to the battery. The red diagnostic plug does not power the box.

## Parts

Prices move. The names below were still current manufacturer parts when this was written (November 2026). If a distributor is out, buy the spec in the last column. Do not substitute a "CAN bus module" that fails the spec.

### First prototype, Bluetooth only

| Part | Why this one | If you cannot get that exact part |
| --- | --- | --- |
| Seeed Studio XIAO nRF52840, SKU 102010448 | Small Bluetooth Low Energy board, on-board antenna, 2 MB flash for the log. Seeed rates deep sleep under 5 µA. Buy the plain board. The Sense adds a microphone and a motion chip you would have to power down. The Plus moves pads. This wiring matches SKU 102010448. | An nRF52840 module with a chip antenna and a documented sleep under 15 µA at 3.3 V. The Raytac MDBT50Q family is the spec. See [If the XIAO will not sleep](#if-the-xiao-will-not-sleep). |
| Texas Instruments TPS7A1601 | Adjustable regulator, 3 V to 60 V in, about 5 µA idle, 100 mA out. Motorcycle voltage, including a charging system near 14.5 V and a short spike, is inside that input range. Set it to 3.7 V and feed the XIAO battery pads. | Same family, still adjustable, 60 V, about 5 µA, at least 100 mA. A fixed 3.3 V regulator is the wrong voltage for these battery pads. |
| 210 kΩ and 100 kΩ, 1% | Set the regulator to about 3.70 V. See the wiring note. | 200 kΩ and 100 kΩ gives about 3.58 V, which is still a normal lithium-pad voltage. |
| 10 µF ceramic, X7R, two pieces, plus 0.1 µF | Input and output caps the TPS7A1601 datasheet asks for. | Same values, X7R or X5R, rated 25 V or more on the input cap. |
| 1N5822 | Through-hole Schottky. Sits after the fuse so the box cannot push voltage back up the battery wire. | Any 3 A, 40 V Schottky in a through-hole package. |
| P6KE18A | Through-hole spike clipper across the regulator input. Standoff is about 15.3 V, so a normal 14.5 V charging voltage leaves it alone. | A 600 W unidirectional TVS with about 15 V standoff. If this bike's charging voltage sits above 15 V, use a P6KE20A instead. |
| 1 A ATM (mini) blade fuse and an inline holder | The box draws well under 100 mA. The fuse protects the wire at the battery. | Any 1 A automotive mini fuse and a sealed inline holder. |
| 18 AWG red and black | Battery lead and main ground. Easy to buy, and a 1 A fuse opens long before this wire is the weak point. | 0.75 mm² or 1 mm² automotive wire. |
| Microchip MCP2515-I/P | DIP-18 CAN controller with an SPI port. The XIAO has no CAN controller. 2.7 V to 5.5 V, so it runs on the XIAO's 3.3 V output. Microchip still lists it in production. On 2 November 2026 Digi-Key showed none on the shelf and a restock dated 9 November 2026. | MCP2515 in SOIC if you can solder it. The spec is "SPI CAN controller, 3.3 V." |
| 16 MHz crystal and its two load capacitors | The MCP2515 needs a crystal. 16 MHz is the usual value for this chip. | The frequency printed in the firmware must match the crystal. A module that already has the crystal is fine if it meets the CAN-section rules below. |
| Texas Instruments SN65HVD230 (order SN65HVD230DR) | 3.3 V CAN transceiver. TI lists the DR reel as active. The older tube part SN65HVD230D is obsolete. Standby is still about 370 µA, which is too much to leave connected all winter, so the build removes its power instead of using standby. | SN65HVD231 if you find it. Its sleep current is nanoamps, and you still want the power switch. Do not buy a TJA1050 or MCP2551 board. Those are 5 V parts with no sleep pin, and they draw milliamps forever. |
| SOIC-8 to DIP adapter | So the transceiver can be soldered once and plugged in on the bench. | Solder the SOIC down if you are comfortable doing that. |
| AO3401A | Small P-channel MOSFET. Switches 3.3 V to the CAN chips. Gate rating is only ±12 V, so it stays on the 3.3 V rail. | Any P-channel MOSFET that is fully on at −2.5 V and is happy at 3.3 V. |
| 2N3904 (two) and 2N3906 (one) | Through-hole transistors for ignition sense and for switching the voltage divider. | Any small-signal NPN and PNP with a 40 V rating. |
| 100 kΩ (several), 12 kΩ 1%, 47 kΩ, 10 kΩ | Divider, bias, CAN reset pull-up. The 12 kΩ wants to be 1% because it sets the voltage reading. | Divider ratio 12 / 112. Keep that ratio if you change the values. |
| 3.3 V zener, 1N5226B or BZX55C3V3 | Clamps the ADC pin if the divider is on during a spike. | Any 3.3 V, 500 mW zener. |
| JST male plug MWTPB-06-1A-R, male terminals SMWTWS-A021T-064, seals A03WS-MWT-N | This is the tool side of the ISO 19689 connector. The bike already has the red female housing. Terminals fit 0.3–0.5 mm² (about 22–20 AWG). | A ready-made red Euro 5 OBD pigtail. Confirm every pin with a meter before trusting the seller's colors. |
| 22 AWG twisted pair, plus a ground and a sense wire | CAN H and CAN L, diagnostic ground, ignition sense. These wires are thinner than the battery lead on purpose. They do not carry the box's power. | An old Ethernet pair is fine for CAN H and CAN L. |
| Gasketed ABS box and a cable gland | Under-seat weather and wash water. Hammond 1591 series is the kind of box. The exact shell is not important. | Any small gasketed box that closes properly and accepts a gland. |
| Perfboard, solder, heat-shrink, zip ties | The thing you actually assemble. | |

A DIP socket is fine on the bench. On the bike, solder the MCP2515 or strap a socket so vibration cannot walk the chip out.

### Later mailbox radio

Buy this only after the Bluetooth box has passed the sleep-current test and a reading has been typed into the app.

| Part | Why this one | If you cannot get that exact part |
| --- | --- | --- |
| Reyax RYLR998, two pieces | UART LoRa module, 868/915 MHz, built-in antenna, AT commands. Reyax's 9 February 2026 datasheet: 2.3–3.6 V supply, sleep about 10 µA when told to sleep (`AT+MODE=1`), receive about 17.5 mA, 0 dBm transmit about 57 mA. One module goes in the bike box. One goes in the mailbox. | A 915 MHz LoRa module with a UART, a sleep mode under 20 µA, and a way to set power down to 0 dBm. Shop that spec. A 433 MHz hobby radio is the wrong band for this shop. |
| Espressif ESP32-S3-DevKitC-1 | Mailbox brain. Wi-Fi, USB, pins broken out. Espressif still lists this devkit, including the N8R8 variant. Wall power, so its idle current does not matter. | Any ESP32-S3 board with USB and a 3.3 V pin that can supply about 80 mA for the radio. |
| 5 V USB power adapter, 1 A | Mailbox power. A normal phone charger is enough. | The building's USB outlet, if it really is 5 V. |

The RYLR998 defaults to 915 MHz and to **22 dBm**. Change the power before the first transmission. See [The radio limit](#the-radio-limit).

## Connector

The first cable mates with the red 6-pin diagnostic connector in ISO 19689:2016. JST calls their version the MWT series and says it is that connector. The bike side is the female housing. The box side is the male plug, part MWTPB-06-1A-R.

ISO 19689's contact jobs:

| Pin | ISO 19689 job | What this cable does |
| --- | --- | --- |
| 1 | Left to the motorcycle maker | Leave open |
| 2 | CAN H when the bike uses ISO 15765-4 CAN | CAN H |
| 3 | Ground | Signal ground |
| 4 | Battery positive, and the standard allows it to be either always-on or ignition-switched | Sense only. A 100 kΩ resistor into a transistor. This pin does not power the box. |
| 5 | CAN L when the bike uses ISO 15765-4 CAN | CAN L |
| 6 | K-line when the bike uses ISO 9141-2 or ISO 14230-4 | Leave open |

The standard also says pins 2, 5, and 6 can be used for something else when the bike does not use those protocols. A public Suzuki Burgman AN650 sheet matches the table above and marks pin 4 as ignition-switched, with pin 6 empty. Treat that as one worked example. On the bike in front of you, find ground and the key-switched pin with a meter before you finish the crimps. The [wiring file](bike-link-wiring.md) has the check.

Many Euro 5 bikes grew this red plug because European rules required a common diagnostic connector. A Canadian bike of the same model may or may not have it. Look under the seat before you build the cable.

Pin 4 is a bad place to steal power. The standard explicitly allows the maker to switch it with the key. A lot of bikes do. A box powered only from that pin goes dead as soon as the rider parks, which is exactly when you wanted the resting voltage.

### Harley-Davidson and older plugs

One cable does not fit the floor.

Harley-Davidson does not use this red JST plug as a universal diagnostic connector. Fuel-injected bikes from the 2000s and early 2010s commonly have a 4-pin data link and a single-wire J1850 protocol, which is not CAN H and CAN L. Later Harley CAN bikes use a 6-pin data link. Harley's own dealer notes say 2021 and later models connect through a red data-link connector with their TechLink 3 tool. The pin count and which cavities are filled changed more than once; there is no single Harley pinout to print here. Do not force the Euro 5 plug into a Harley. A Harley lead is a later cable, checked against that bike's wiring diagram. The fused battery wire is the same idea. The plastic on the end is not.

Older Honda 4-pin, Yamaha, Kawasaki, and Suzuki SDS plugs, and the round BMW diagnostic plug, are brand-specific. They are often K-line or a private protocol. They are not this build.

## Power

### Where the fuse sits

Put a 1 A mini fuse in an inline holder on the red 18 AWG wire, within 15 cm of the battery positive post. The fuse is at the battery, so a rubbed wire between the battery and the box opens the fuse instead of heating the harness. Run the black 18 AWG wire to the battery negative post. A painted frame bolt is a bad ground.

The diagnostic plug's ground (pin 3) still connects to the box, as the CAN reference. It is a signal wire, 22 AWG. It is not the power ground.

### The diagnostic connector often has no constant 12 V

Pin 4 may be ignition-switched. Plan on that. The box's always-on power is the fused battery wire. Pin 4 only tells the box that the key turned.

On the first install, measure pin 4 with the key off and the key on. If it stays at battery voltage with the key off, that bike left pin 4 permanently powered. Leave pin 4 open on that bike and move the sense wire to a circuit that really does follow the key (a tail-lamp feed or an ignition-switched fuse). The transistor circuit is the same.

### How the box tells ignition-on from parked

Key on: the sense transistor pulls a XIAO pin low. The box treats that as ignition-on after the pin has stayed low for a few seconds, so a bump does not count.

Key off: the pin goes high. The box reads CAN immediately, while the ECU is still awake, then turns the CAN chips off.

Parked: the sense pin stays high, the CAN switch stays off, and the box sleeps. A timer wakes it about once a day to measure voltage. It does not talk on CAN while parked. A transceiver left powered can acknowledge frames and keep an ECU awake, which is a good way to flatten a battery even when your own sleep current looks fine.

Voltage alone is a poor ignition detector. Key-on with the engine stopped looks a lot like parked. A charging voltage above about 13.4 V means the engine is running, and the box uses that only as a reason to throw away a voltage sample. It is not the key sense.

### Resting voltage

The number the app wants is the battery after the bike has been sitting, not the charging voltage. After key-off, the box waits 20 minutes, then connects the divider for a short sample. A reading taken while the engine is running (often 13.8 V to 14.8 V) is not stored as the battery voltage. If the box never gets a rested sample, it leaves the voltage blank.

The app's own bands, for a normal 12 V lead-acid battery, are 12.4 V and above healthy, 12.0 V up to 12.4 V low, and below 12.0 V flat. The box does not decide that. It stores one decimal. A lithium motorcycle battery rests higher than a lead-acid battery. Send the measured number anyway. Staff should read a lithium battery with that difference in mind.

The divider is 100 kΩ over 12 kΩ, switched by the 2N3906, so it draws nothing while parked. While it is measuring, it draws about 0.1 mA. Calibrate on the bench against a meter. The box should match the meter within 0.1 V at about 12.6 V.

### Sleep budget

Use a small sport-bike battery as the hard case: 8 amp-hours. A Toronto winter park can be 180 days.

50 microamps for 180 days is 50 µA × 24 × 180 = 216 mAh, about 3% of that 8 Ah battery. The battery's own self-discharge over a winter is larger than that. A box at 1 mA for the same 180 days is about 4.3 Ah, more than half of that battery, before the battery's own loss. That box stays on the bench.

| Piece, key off, box asleep | Current to budget |
| --- | --- |
| TPS7A1601 | 5 µA typical |
| 210 kΩ / 100 kΩ set resistors | about 12 µA |
| XIAO nRF52840 | Seeed says under 5 µA. Budget 15 µA until you measure the board you built. |
| CAN controller and transceiver | 0 µA when the AO3401A is off. Leakage should be under 1 µA. |
| Voltage divider | 0 µA when the 2N3906 is off |
| Ignition transistor | 0 µA with the key off |
| RYLR998, radio build only, and only after `AT+MODE=1` | 10 µA on Reyax's datasheet |

The pass mark is a measurement at the fuse: **under 50 µA**, key off, USB unplugged, CAN power off, one minute after the box went to sleep. Seeed's 5 µA figure is for their board on the battery pads with the chip actually asleep. Forum measurements of the same board also show 2–5 µA when that is done carefully, and hundreds of microamps or several milliamps when sleep is not really entered or extra parts are soldered on. The fuse measurement is the one that counts.

The regulator can supply 100 mA. A Bluetooth plus CAN reading is far under that. The radio at 0 dBm is about 57 mA on top of the XIAO, still under 100 mA. The module's default 22 dBm is about 140 mA for the radio alone and will drag this regulator down. That is another reason the radio stays at 0 dBm.

### If the XIAO will not sleep

Program and measure it before it ever sees a motorcycle. Power it only through the back battery pads, from the 3.7 V regulator, with USB disconnected. Seeed marks the 5 V pin as VBUS and the 3V3 pin as an output. Battery power on this board is a 3.7 V lithium pad, not 12 V and not 5 V.

If a finished box cannot get under 50 µA, the usual causes are: the chip is not actually in sleep, the CAN switch is on, the radio was left in receive, or the charge circuit on the XIAO is unhappy about a stiff 3.7 V feed. The fallback brain is an nRF52840 module powered at 3.3 V from a Texas Instruments TLV70433 (24 V in, about 3.4 µA idle, 150 mA). That path skips the XIAO battery charger. It is more soldering. Do not put a sleepy-looking box on a customer bike while the current is still unknown.

## What the firmware does

Behavior for whoever writes the firmware later. No code in this document.

**Sleep.** Most of the time the box is asleep with the clock running. CAN power is off. Bluetooth is off. If the radio is fitted, it has been told to sleep. The ignition pin can wake it. The clock can wake it.

**Key on.** Wait a few seconds so the ECU is up. Turn on CAN power. Try 500 kbit/s, then 250 kbit/s. Ask the way a normal OBD scan tool asks on CAN. The standard 11-bit broadcast request id is 7DF (ISO 15765-4). Read emission fault codes. Ask for the odometer. Spend only a few seconds on the bus. There is no single odometer identifier that works on every brand. If the bike does not answer the odometer, store a blank, not a zero. Turn CAN power off again until key-off.

**Key off.** Read the odometer and the fault codes once more, immediately, before the ECU goes to sleep. Then turn CAN power off. Twenty minutes later, measure resting voltage and append one reading: time, odometer or blank, volts or blank, and the codes. A reading the app can accept needs at least one of those three. A failed CAN read with no voltage yet stays in a local error note and is not handed off.

**Fault codes.** Store short codes the app already accepts, such as `P0335` or `C14`. Letters and digits, a dash allowed, 12 characters at most, and the code must contain a digit. Up to 20 codes. Drop anything that does not fit. Do not clear codes. Do not send a clear-DTC request. Do not invent an oil-life or service message. The shop app computes the service interval from the kilometers and the date. The box does not decide that oil is due.

**Odometer.** Whole number, 0 to 999999, in the unit already on that motorcycle in the app (kilometres or miles). The box does not convert. If the new number is lower than the last number this box stored, keep it in the local log flagged as rejected and do not hand it to the phone or the mailbox as a normal reading. A replaced cluster is a staff decision on the motorcycle page. Never send `0` to mean "I could not read it." Send an empty value.

**Clock.** Set the clock from the phone the first time someone connects. Until the clock is set, keep the sample on the box and mark `clockSet` false. Do not hand that sample to a mailbox. A handoff time more than about 5 minutes in the future will be rejected by the app's parser.

**Bluetooth handoff.** For a few minutes after a new reading, advertise the name on the sticker, `TM-BL-` plus four digits. A phone running Nordic's nRF Connect app can read one text field. The text is JSON, one object, or an array if several readings are still unsent:

```json
{
  "boxId": "TM-BL-0007",
  "odometer": "48210",
  "batteryVolts": "12.6",
  "faultCodes": "P0335 C14",
  "recordedAt": "2026-11-02T21:15:00Z",
  "clockSet": true
}
```

Empty odometer or empty voltage is `""`. Empty faults is `""`. `recordedAt` is when the bike measured it, in UTC. A second text field accepts a clock set, the same UTC shape. Staff type the values into the motorcycle page. They choose Shop, Home, or Partner stop in the form. The box does not know which of those it is.

**Parked days.** About once a day, wake, measure voltage, and sleep. Store a new reading when the voltage has moved by 0.1 V or more, or when seven days have passed. Leave the odometer blank on those rows unless you actually read it again. Do not power the CAN transceiver for this wake. Do not sit in Bluetooth advertising all day. A short advertising window after the daily sample is enough.

**Radio handoff, only after the mailbox exists.** Send the same JSON fields the Bluetooth text holds, as one ASCII packet under 240 bytes. Reyax's send limit is 240 bytes. Try a few times in the minutes after the ride. If nothing answers, try once on the daily wake, then stop. The mailbox answers with the same `recordedAt`. When the box hears that, it marks the row handed off. The radio then goes back to sleep. It does not beacon, and it does not listen for long. Receive current on this module is about 17.5 mA.

**What the box never does.** It does not compute a service due date. It does not text the client. It does not talk to Wix. It does not clear faults. It does not keep the ECU awake while the bike is parked.

## The mailbox

An ESP32-S3-DevKitC-1 on a USB adapter, joined to the building Wi-Fi. The RYLR998 sits on the devkit's 3.3 V pin and on a UART (cross TX and RX). The devkit is happiest if the radio is at 0 dBm (about 57 mA) rather than at the factory 22 dBm (about 140 mA).

Put the mailbox in a plastic box in a window that faces the bikes. At 99 River Street that is a window toward the place bikes actually park, not a metal electrical room and not a closed cabinet. The RYLR998 has a built-in antenna and no external antenna jack, so the whole mailbox has to be in the window. A roof mount needs a different 915 MHz module, one with an SMA or u.FL connector, and a 915 MHz outdoor antenna. This guide does not name that antenna. Do the window first.

Each mailbox is configured with the source and the place name it should stamp on every reading:

| Where it sits | `source` | `placeName` |
| --- | --- | --- |
| Shop, 99 River Street | `shop_bay` | `99 River Street` |
| Client's home | `home` | empty, or a short label |
| Cafe, storage, or another partner stop | `partner` | the place name, 80 characters or fewer |

The bike does not choose those two fields. The mailbox does, from that configuration. The bike chooses the measurement and the time.

### JSON the mailbox would POST

There is no ingest route yet. Do not invent one in the app as part of this build. When a route exists, each reading is one JSON object. The server looks up `boxId`, finds the motorcycle, and passes the other fields into `parseBikeReading`. `boxId` is not a parser field. `clockSet` stays on the bike and is not posted.

```json
{
  "boxId": "TM-BL-0007",
  "source": "home",
  "placeName": "",
  "odometer": "48210",
  "batteryVolts": "12.6",
  "faultCodes": "P0335 C14",
  "recordedAt": "2026-11-02T21:15:00Z"
}
```

The parser accepts these as strings:

- `source` is exactly `shop_bay`, `home`, or `partner`.
- `placeName` is trimmed. Empty becomes no place. Longer than 80 characters is rejected.
- `odometer` is a whole number from 0 to 999999, or `""` when it was not read. A value lower than the previous reading already stored for that motorcycle is rejected.
- `batteryVolts` is one decimal between 8.0 and 16.0, such as `12.6`, or `""`.
- `faultCodes` is zero or more codes separated by spaces, commas, or semicolons. Each code matches the shape above. More than 20 codes is rejected.
- At least one of odometer, voltage, or a fault code has to be present.
- `recordedAt` is when the bike measured it. UTC with a `Z`, as above, is accepted. A shop-local `2026-11-02T16:15` with no zone is read as America/Toronto. A time more than 5 minutes ahead of the server is rejected.

Until the route exists, the mailbox prints that same object on its USB serial port. Staff open the motorcycle and use **Record a reading**.

### The radio limit

Canada's low-power rule for a generic device in 902–928 MHz is ISED RSS-210, annex B.10. The fundamental emission must stay at or below **50 mV/m at 3 metres**, measured with a CISPR quasi-peak detector. Harmonics must stay at or below **0.5 mV/m at 3 metres**. A steady signal at 50 mV/m at 3 metres is about **0.75 mW e.i.r.p.** Older issues of RSS-210 printed that 0.75 mW figure beside the table. The current text states the field strength. The same section says the usual pulsed-operation rules do **not** apply in 902–928 MHz, so a short packet does not buy a higher power limit.

RSS-247 is a different document, for certified digital and frequency-hopping equipment. In 902–928 MHz it allows up to 1 W conducted and 4 W e.i.r.p. for digital transmission systems, and for frequency hopping with 50 or more channels. Fewer than 50 hop channels drops that to 0.25 W and 1 W e.i.r.p. Frequency hopping also has a dwell limit: under 250 kHz channel bandwidth, no more than 0.4 seconds on a channel in any 20 second period, and at least 50 channels. This LoRa setup is one 125 kHz channel. It is not that hopper, and it is narrower than the 500 kHz minimum RSS-247 sets for digital transmission systems. Those higher wattages are not permission for this box.

Reyax lists FCC, NCC, and CE for the RYLR998. CE, on Reyax's own sheet, means the power command stays at 14 dBm or less. An FCC module grant is not an ISED certificate, and it does not cover a shop-built box wired into a motorcycle. This document is not a certification.

Shop setting, stored on both modules: `AT+CRFOP=0` (0 dBm). Confirm with `AT+CRFOP?`. Set the band with `AT+BAND=915000000` if it is not already there. Reyax's guide recommends `AT+PARAMETER=9,7,1,12` on both ends. Factory defaults include network id 18 and address 0, which is a broadcast and is what every untouched module uses. Change the network id and give the mailbox address 1 and each bike its own address, using the address and network commands in the current Reyax AT guide. Write the numbers on the mailbox. After every bike-side transmission, send `AT+MODE=1` so the module drops to its 10 µA sleep.

At 0 dBm, with the built-in antenna, plan on the driveway, the yard, or the shop lot reaching a mailbox in a window. A metal door or a basement can still stop it. That is the range this build is for.

## Shop assembly

### Tools

Soldering iron, flux, solder, side cutters, wire strippers, heat-shrink, a multimeter that can read microamps, a current-limited 12 V bench supply, zip ties, dielectric grease, a drill for the cable gland, and a motorcycle charger in the bay before the first start. A small open-barrel crimper only if you are crimping the JST terminals yourself. Those 0.64 mm terminals are easy to ruin with pliers.

### Order of work

1. Build the regulator on the bench, including the 210 kΩ and 100 kΩ feedback resistors. Do not connect a bike, and do not connect the XIAO yet. Power it from the bench supply through the fuse and confirm about 3.7 V. Then connect the XIAO battery pads. Program the board over USB, then unplug USB.
2. Add the CAN section with the power switch. Confirm the switch is off when the XIAO pin is idle. Leave the 120 Ω jumper off. If you bought a transceiver board that has a terminator, remove it.
3. Power the whole box from the bench supply through the 1 A fuse. Key-sense wire grounded (parked). Confirm 3.3 V on the XIAO 3V3 pin. Put the firmware to sleep and measure current in series with the fuse. Under 50 µA is the pass. Over that, stop and fix it before a motorcycle is involved.
4. Feed the bench supply 12.6 V and read the BLE text. The voltage in the JSON should match the meter within 0.1 V.
5. Only then go to a bike. Disconnect the battery negative. Fit the fused red wire to battery positive, fuse at the post. Fit the black wire to battery negative. Leave CAN H and CAN L disconnected. Reconnect the negative.
6. The bike should start and idle. If it does not, remove the fuse and undo the new wires before you look any further.
7. Key off, measure current again at the fuse, box asleep. Still under 50 µA.
8. Meter on pin 4, key off and key on. Confirm it follows the key, or move the sense wire as described above.
9. Battery disconnected again. Crimp or plug CAN H, CAN L, and pin 3. No terminator in the box. Reconnect, and start the bike a second time. It should start and idle with no new warning that appeared the moment you plugged the cable in. If it misbehaves, unplug pins 2 and 5.
10. With the box unplugged and the bike off, measure resistance between CAN H and CAN L on the bike. You will often see about 60 Ω (two 120 Ω terminators). After you plug in the sleeping box, that reading should be unchanged. If it falls, the box is loading or terminating the bus. Unplug it.

### Pair the box to a motorcycle already in the app

The app has no field for a hardware id yet.

1. Stick `TM-BL-` and four digits on the box. The Bluetooth name is the same string.
2. Open that motorcycle in the shop app. The page has a **Bike link** section and **Record a reading**.
3. Stand next to the bike with a phone and nRF Connect. Read the JSON.
4. Type odometer, battery volts, fault codes, and the taken-at time into the form. Choose **Shop** while the bike is in the bay. Place name can be `99 River Street` or blank. The taken-at time is the time in the JSON, converted to Toronto local time, not "now" unless you really did just measure it.
5. Write the same box id on the work order or a tag for that motorcycle. When the mailbox exists, `boxId` in the JSON is how a future route will find this page. Until then, the person is the link.

## Safety and failure

**Fuse.** 1 A, at the battery, on the red wire. If the fuse is open, the box is off and the bike is unharmed by the box. Replace it once, after you know why it opened. A fuse that opens again means a short in the new wire or the box.

**No back-feeding the ECU.** The Schottky is in the power lead so the regulator cannot push voltage back to the battery. Pin 4 never gets 3.3 V or 5 V from the box; it only drives a transistor through 100 kΩ. CAN H and CAN L land only on the transceiver. The terminator is absent. The transceiver supply is off while the bike is parked. The firmware never sends a clear-codes command.

**Water and vibration.** Gasketed box, gland, drip loop, dielectric grease on the red plug, latch clicked. Strap the board down. Strain-relieve the wires inside the box. Under the seat, off the chain and out of the wheel spray. You should still be able to open the box. Do not pot it.

**Flat battery.** Pull the 1 A fuse. That removes the box. Charge the battery with a motorcycle charger. A normal jump of a tired battery is fine with the fuse in. If you are chasing a short, or the bike will not crank, pull the fuse first. After it starts, measure the box again in series with the fuse, key off, asleep. Under 50 µA means the box was not the main drain; look at the usual causes (an old battery, a tender that was never plugged in, accessories). A milliamp or more means the fuse stays out until the box is fixed. This box is not a battery tender. A bike that sits from November to April still wants a tender, or the battery taken off and charged indoors.

## Out of scope

- Satellite radio, and any monthly satellite fee.
- A cellular modem, a SIM card, and any monthly radio bill.
- Bike-to-bike mesh, and any design that tries to cover Toronto.
- Customer SMS. That stays on Wix Inbox, on the shop number already there.
- Reading service-interval or oil-life data the ECU does not share, and deciding inside the box that a service is due.
- K-line brand protocols, Harley cables, and the older Japanese and BMW plugs.
- A claim that this build is certified. The Bluetooth board and the Reyax module carry whatever grants their makers published. The finished motorcycle box does not inherit a Canadian certificate from this document.

## What is still uncertain

- Kilometers are the weak signal. Emission fault codes and a rested voltage are the reliable first readings. Odometer identifiers are per maker, and some clusters will not answer a standard OBD request at all. The firmware stores a blank when that happens.
- Whether a given bike in the shop even has the red ISO 19689 plug. Euro 5 is a European requirement. Confirm the connector before crimping a cable.
- ISO pins that the maker marked discretionary. The Burgman map is one bike. The meter check is part of the install.
- Harley pinouts by year. This guide deliberately does not give one.
- XIAO sleep current once the board is wired. Seeed's number and a few published measurements are a few microamps. The same board is easy to leave at hundreds of microamps. The fuse measurement is mandatory.
- The XIAO battery pads expect a lithium cell. A stiff 3.7 V regulator is the stand-in, with USB unplugged. If the on-board charger misbehaves, use the TLV70433 fallback and an nRF52840 module.
- TPS7A1601 is a small HVSSOP-8 with a metal pad underneath. It is the right electrical part and it is fiddly to solder. Flux, a magnifier, and a check for shorts. The spec, if the exact reel is gone: adjustable LDO, 60 V in, about 5 µA idle, 100 mA out.
- MCP2515-I/P was in production and thinly stocked when checked. Shop "MCP2515, SPI, DIP or SOIC" rather than a different CAN chip.
- No single off-the-shelf 3.3 V CAN module was confirmed that both exposes a shutdown pin and ships with the terminator removable. The DIP controller plus SN65HVD230 is the build for that reason. Reject 5 V TJA1050 modules.
- RYLR998's published grants are FCC, NCC, and CE. No ISED grant was found. Operating the radio in Canada, and especially leaving it at 22 dBm, is not cleared here.
- The mailbox HTTP route does not exist. The JSON is the contract for later.
- The app has no box-id field yet. Pairing is the sticker plus the motorcycle page.
