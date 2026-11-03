# Bike link environment

How the pieces at Toronto Moto fit together. The build of one box is in [bike-link-build.md](bike-link-build.md). This file is the plan for the places, the order to stand them up, and what each one is allowed to do.

The shop is OTOMOTO TORONTO MOTO INC., 99 River Street, Toronto. The first bikes are Triumphs that still have the regular 16-pin OBD socket under the seat. Customer texts stay on the Wix Inbox thread. Nothing in this environment sends an SMS.

## The places

| Place | What sits there | Power and network | What it is for |
| --- | --- | --- | --- |
| Triumph, under the seat | One bike box, sticker `TM-BL-` plus four digits | Fused wire at the battery. Bluetooth first. A 915 MHz radio only after the sleep test. | Wake on the key, read kilometres, fault codes, and resting voltage. Sleep under 50 µA. |
| Phone or shop tablet | Nothing to install | The phone's own Bluetooth | The first handoff. Staff read the text and type it into the motorcycle page. |
| Shop window, 99 River Street | One Wi-Fi box | Wall power and the building Wi-Fi. The antenna is inside the radio, so the box sits in a window that faces the bikes. | Hears every radio-equipped Triumph in the lot. Stamps the reading as Shop, `99 River Street`. |
| Client's home | One Wi-Fi box, same parts | Wall power and that home's Wi-Fi. Same window rule. | Hears that client's bike in the driveway or the yard. Stamps the reading as Home. |
| Cafe, storage, or another partner | One Wi-Fi box, same parts | Wall power and that building's Wi-Fi. | Hears a bike parked there. Stamps the reading as Partner and the place name. |
| Shop app | Already on the motorcycle page | The live site | Stores the reading, compares the service interval, and writes the sentence to tell the client. The sentence stays on the page. |

One Wi-Fi box serves every bike that can reach that window. A bike does not get its own Wi-Fi box. The bike does not join Wi-Fi.

## What each piece decides

The bike box stores the measurement and the time. It does not decide that a service is due, and it does not know whether it is at the shop, at home, or at a partner.

The Wi-Fi box adds the place. Shop, Home, or Partner is configured in that box, not sent by the bike.

The shop app decides. Service due, battery low or flat, fault codes, and the sentence for the client all come from the reading plus the interval already on the motorcycle. Staff use **Needs a call** on the motorcycles list, then text the client on the existing Wix thread if a call is warranted.

## Order

Build one stage until it has caught a real reading before buying the next.

1. **One Triumph in the bay.** Bluetooth only. Pass the sleep test at the fuse, under 50 µA, key off, USB unplugged. Read the text on a phone and type it into that motorcycle. The page already does this. About $110 to $150 CAD for the bike box.
2. **The shop window.** Add the radio to that bike, and build one Wi-Fi box for a window at 99 River Street. About $25 to $40 CAD for the bike radio and $80 to $120 CAD for the window box. The first environment, one Triumph plus the shop window, is about $220 to $310 CAD in parts with tax. Until the app accepts a post, the window box prints the reading on USB and staff still type it in.
3. **The app learns the box.** Store `TM-BL-` and the four digits on the motorcycle. Let the window box post the JSON already written in the build guide. The reading then lands on the right page without retyping. The sentence is still not sent.
4. **More Triumphs.** Each extra bike is about $70 to $90 CAD, plus $25 to $40 CAD if it gets a radio and should be heard from the lot. They share the shop window. Five radio-equipped Triumphs and that one window are about $600 to $830 CAD.
5. **One home, then a partner.** Same Wi-Fi box, about $80 to $120 CAD per place. Put one in only where a bike actually parks within sight of that window. A metal door or a basement can still stop the radio. This is driveway and lot range, not a net across Toronto.

## Leave these out

- A cellular modem, a SIM card, and any monthly radio bill.
- Satellite.
- Bike-to-bike relay, rooftop coverage, and a mesh across the city.
- Wi-Fi on the motorcycle itself.
- A Wi-Fi box per bike.
- The red 6-pin on newer Triumphs, and the 2006–2012 triples that speak K-line on the same 16-pin shape.
- Customer SMS. Wix Inbox keeps that thread.
- Clearing fault codes, and any service decision made inside the box.

Prices are supplier ranges from 2 November 2026, in Canadian dollars, tax included, for a one-off build. They are not a quote.

The implementation order for the app, the bike sketch, and the window-box sketch is `docs/superpowers/plans/2026-11-02-bike-link-environment.md`. That file is the brief to hand to another developer. The hardware documents win if a task disagrees with them.
