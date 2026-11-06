# Claude Game

A 3D parkour platformer that runs in the browser, built with [three.js](https://threejs.org/) (0.160.0, bundled locally). A floating course in a blue and black night sky, with a randomly generated Minecraft-style world far below.

## Setup

### What you need

- A modern desktop browser with WebGL: Chrome, Chromium, Firefox or Edge
- Python 3, only to serve the files locally (no install step, no npm)
- A mouse and keyboard. The game uses mouse look, so it is not made for touch screens or controllers.

The game loads its code as ES modules, so you cannot just double-click `index.html`. The browser blocks that. It has to be served over HTTP, which is what the steps below do.

### 1. Get the code

```
git clone https://github.com/jahu532/claude.git
cd claude/claude-game
```

The repository is private, so you need to be logged in to GitHub (for example with `gh auth login`) to clone it.

### 2. Start the game

**Linux / macOS**

```
./run.sh
```

If you get "permission denied", run `chmod +x run.sh` once and try again. `run.sh` starts a server on port 8000 and tries to open your browser with `xdg-open`. On macOS that command does not exist, so open http://localhost:8000 yourself.

**Windows (or any system, manually)**

```
python -m http.server 8000
```

Then open http://localhost:8000 in your browser. On Windows you may need to use `py -m http.server 8000` instead.

### 3. Stop it

Press `Ctrl+C` in the terminal where the server is running.

### Troubleshooting

| Problem | Fix |
|---|---|
| Black or blank page | Press F12 and look at the Console tab for red errors. Make sure you opened `http://localhost:8000`, not a `file://` address. |
| `Address already in use` | Something else is on port 8000, probably an earlier copy of the server. Stop it, or use another port: `python -m http.server 8080` and open http://localhost:8080. |
| Mouse look does not work | Click on the game once to capture the mouse. Esc releases it and pauses the game. |
| Choppy or slow | The terrain below the course is drawn from many blocks. Use a browser with hardware acceleration turned on and close other heavy tabs. |
| Progress is gone | Best times and unlocked levels are stored in the browser (localStorage). They reset if you clear site data or use a private window. |

## How to play

### The goal

Get from the start platform to the glowing cyan gem at the end of the course. Do not fall off. The world far below is deadly, and so is anything red or spiky.

### Starting

1. Open the game. You see the menu with the level list.
2. Click a level. Level 1 is open at the start and the others unlock as you finish them. Press `U` in the menu to unlock all of them.
3. Click the page to capture the mouse and start moving.

Your best time for each level is saved and shown on its card in the menu.

### Controls

| Key | Action |
|---|---|
| W A S D | Move (relative to the camera) |
| Mouse | Look around (click the page to capture the mouse) |
| Space | Jump, press again in the air to double jump |
| Shift | Sprint |
| E | Dash, one dash per jump in the air, short cooldown |
| Space against a wall | Wall jump (push into the wall while in the air, then press Space) |
| W / S on a ladder | Climb up / down (Space hops off) |
| Esc | Release the mouse and pause |
| R | Restart the level |
| M | Back to the menu |
| Enter | Next level (after winning) |
| U (in the menu) | Unlock all levels |

### Tips

- **Lives and checkpoints.** You start with 5 lives. Every 10 coins gives one more. When you fall or get hurt you come back at the last checkpoint flag you touched. At 0 lives it is game over.
- **Platform types.** Ice platforms are slippery. Bouncy ones launch you, and holding Space when you land makes the bounce higher. Crumbling ones shake and fall a moment after you step on them, then come back. Rotating bars carry you around. Moving platforms carry you along.
- **Enemies.** The patrolling red cubes can be squashed by jumping on them from above, or by dashing into them. Touching them any other way hurts. Spikes always hurt.
- **Power-ups.** Speed, jump boost, triple jump and shield. They last a limited time, shown in the top right. A shield absorbs one hit, but nothing saves you from falling.
- **Wall jumps.** Slide down a wall, press Space to kick off it, and steer away from it. Air control is reduced for a moment after the jump, so plan the direction before you press.
- **Longer gaps.** Sprint, then jump, then double jump, then dash in the air. The dash resets when you land.
- **Menu.** "New random world below" generates a different Minecraft-style landscape under the course. It is only decoration.

## Features

- Double jump, sprint, dash, wall slide and wall jump, ladders
- Lives, checkpoints, coins
- Special platforms: moving, ice, bouncy, crumbling, rotating
- Hazards: spikes, patrolling cubes, falling into the world below
- Power-ups: speed, jump boost, triple jump, shield
- Animated blocky character (idle, run, jump, fall, landing squash, dash, ladder, wall slide)
- Pixel-art platform textures drawn in code, no image files
- Menu with level select, best times and unlocked levels saved in the browser

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
