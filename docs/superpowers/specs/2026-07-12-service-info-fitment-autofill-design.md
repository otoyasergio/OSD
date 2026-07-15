# Service info fitment auto-fill

**Date:** 2026-07-12  
**Status:** Approved

## Goal

Auto-populate motorcycle service information fields from `fitment_vehicle` part/spec data.

## Behavior

- On motorcycle create, after empty service-info row is inserted
- On service-info load when all mapped fields are still blank
- Never overwrite non-empty staff values

## Mapping (fitment → service info)

| Service field | Fitment sources (priority) |
|---|---|
| oil_filter | oilFilterHF, oilFilterKN |
| oil_type | recommendedOil |
| air_filter | airFilterHFA, airFilterKN |
| spark_plugs | ngkPlug |
| front_brake_pads | brakePadFront, frontBrakePad |
| rear_brake_pads | brakePadRear, rearBrakePad |
| front_tire_size | frontTireSize |
| rear_tire_size | rearTireSize |
| chain | chain |
| battery | battery, lithiumBattery |

Vehicle match: same make (case-insensitive), year in range, model normalized (strip spaces/hyphens); prefer richest part+spec payload.
