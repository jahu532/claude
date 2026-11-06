# Claude Game

A 3D parkour platformer that runs in the browser, built with [three.js](https://threejs.org/) (0.160.0, bundled locally). A floating course in a blue and black night sky, with a randomly generated Minecraft-style world far below.

## Run it

```
./run.sh
```

This starts a local server on port 8000 and opens http://localhost:8000. You need Python 3. The game uses ES modules, so opening `index.html` directly from disk will not work.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look (click the page to capture the mouse) |
| Space | Jump, press again in the air to double jump |
| Shift | Sprint |
| E | Dash (one dash per jump in the air) |
| Space against a wall | Wall jump |
| W / S on a ladder | Climb (Space hops off) |
| Esc | Pause |
| R | Restart the level |
| M | Back to the menu |
| Enter | Next level |
| U (in the menu) | Unlock all levels |

## Features

- Double jump, sprint, dash, wall slide and wall jump, ladders
- Lives (5 to start, +1 per 10 coins), checkpoints, coins
- Special platforms: moving, ice, bouncy, crumbling, rotating
- Hazards: spikes, patrolling cubes (stomp or dash into them), falling into the world below
- Power-ups: speed, jump boost, triple jump, shield
- Animated blocky character (idle, run, jump, fall, landing squash, dash, ladder, wall slide)
- Pixel-art platform textures drawn in code, no image files
- Menu with level select, best times and unlocked levels saved in the browser
- "New random world below" button in the menu

## Files

| File | Purpose |
|---|---|
| `game.js` | Game logic, physics, levels, character, UI |
| `world.js` | Voxel world below the course |
| `textures.js` | Platform textures |
| `index.html` | Page shell and styling |
| `three.module.js` | three.js |
| `run.sh` | Local server launcher |

## Status

Work in progress. Two test levels exist ("The Basics" and "Feature Park"). Twenty randomized levels, from 25 to 75 platforms, are planned once the features are finished.
