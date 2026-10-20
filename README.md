# Jutsu Hand Signs

A Naruto-inspired webcam game: choose your ninja and difficulty, then perform
real hand-sign sequences tracked with [MediaPipe](https://developers.google.com/mediapipe).
Complete the sequence and your jutsu erupts on your hand — a swirling
**Rasengan** or crackling **Chidori** — drawn with a pseudo-3D additive
particle engine in OpenCV.

## Run

```bash
pip install -r requirements.txt
python main.py
```

A webcam is required. Open your hand near the camera so the tracker locks on.

## Controls

| Key                | Action                          |
| ------------------ | ------------------------------- |
| `1` / `2`          | choose Naruto / Sasuke          |
| `1` / `2` / `3`    | choose Easy / Medium / Hard     |
| `Enter` / `Space`  | confirm selection               |
| `H`                | toggle hint pictograms (in game)|
| `V`                | toggle hand skeleton overlay    |
| `R`                | retry                           |
| `M`                | back to menu                    |
| `ESC` / `Q`        | quit                            |

## Signs

In-game display name -> pose you must make with **one hand**:

| Sign   | Pose                          |
| ------ | ----------------------------- |
| MONKEY | fist                          |
| TIGER  | open palm                     |
| OX     | index finger only             |
| RAM    | two fingers (index + middle)  |
| BIRD   | three fingers                 |
| HARE   | thumbs up                     |
| SNAKE  | pinky only ("hook")           |

Hold each sign for the difficulty's hold time while it's highlighted.
Hard mode hides the pose pictures — you only see sign names.

## Project layout

```
main.py              entry point / game loop
src/
  camera.py          webcam capture + mirroring
  hand_tracker.py    MediaPipe Hands wrapper (palm anchor, hand scale)
  signs.py           rule-based pose classifier from landmarks
  jutsus.py          characters, jutsu sequences, difficulties
  game.py            state machine + gameplay logic
  ui.py              menus, HUD, pose pictograms
  effects/
    engine.py        additive glow, perspective projection, particles
    rasengan.py      swirling 3D-ish chakra orb
    chidori.py       flickering lightning bolts + sparks
tools/
  selftest.py        headless checks (classifier, game flow, effects)
```

## Testing

```bash
python tools/selftest.py
```

Runs without a camera: classifies synthetic hand poses, plays a full jutsu
sequence through the game logic, and renders both effects into a dummy frame.
