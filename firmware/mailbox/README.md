# Window box

One sketch for the shop, a home, and a partner stop. The place is the `SOURCE` and `PLACE_NAME` pair at the top of `mailbox.ino`. The ESP32-S3 and RYLR998 wiring is in [docs/hardware/bike-link-wiring.md](../../docs/hardware/bike-link-wiring.md).

Copy `secrets.example.h` to `secrets.h` and fill in the building Wi-Fi, the shop origin with no path, and the ingest secret. `secrets.h` is not committed.

| Place                        | `source`   | `placeName`                            |
| ---------------------------- | ---------- | -------------------------------------- |
| Shop window, 99 River Street | `shop_bay` | `99 River Street`                      |
| Client home                  | `home`     | empty, or a short label                |
| Cafe or storage              | `partner`  | the place name, 80 characters or fewer |

The box stamps that pair onto the bike packet, drops `clockSet`, and POSTs to `/api/bike-link/readings` on the origin in `secrets.h`. The USB serial print of that body stays on, so the bay can type a reading if the post does not land. HTTP 401 is printed once and not retried.
