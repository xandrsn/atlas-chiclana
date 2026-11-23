# ATLAS · Chiclana (web build)

A playable 3D map of Chiclana de la Frontera built from public data: drive a car, fly a helicopter or walk the real streets (about 205 km², real buildings, roads, trees, pools and the sea). This repo is the static web client. It runs with no server.

- Play: https://atlas-chiclana.vercel.app (deployed from this repo)
- Data (baked, tag `v1`): https://github.com/xandrsn/atlas-chiclana-data
- Generator (make your own map on your PC): https://github.com/xandrsn/atlas-generator

Made by [Charlie Andersen](https://charlieandersen.vercel.app).

## What is different from the local version

The local version runs with `npm start` (a small Node server). The web build keeps the same client and drops the server:

| Feature | Web build |
|---|---|
| Map data | Loaded from `raw.githubusercontent.com/xandrsn/atlas-chiclana-data/v1/data/` |
| Orthophoto (PNOA) | Loaded straight from the IGN WMTS (it sends `Access-Control-Allow-Origin: *`) |
| Terrain | The baked IGN MDT05 grid (`dem.bin`); the AWS terrarium fallback is only used if that file is missing |
| Street name in the HUD | Off (the Nominatim proxy needed the server and a 1 request/s policy) |
| Multiplayer | Off on the web (needs the WebSocket lobby on the local server). Works with `npm start` locally |
| Other maps (Madrid, Cádiz, Sevilla) | Not published |

Your own map: `npm run generate -- --lat 36.41 --lon -6.15 --radius 3 --name mymap` in https://github.com/xandrsn/atlas-generator.

## Run locally

Open `public/index.html` through any static file server, or deploy the repo as is (`vercel.json` serves `public/`). Three.js is loaded from jsDelivr at a pinned version (0.170.0).

## Credits and data sources

- Orthophoto PNOA © Instituto Geográfico Nacional, CC BY 4.0
- Buildings and addresses © Dirección General del Catastro, CC BY 4.0
- Terrain MDT05 © Instituto Geográfico Nacional / CNIG, CC BY 4.0
- Roads, limits, places and parks © OpenStreetMap contributors, ODbL
- Monuments: Wikidata (CC0)

Licence of this code: not yet chosen (all rights reserved until a licence is added).
