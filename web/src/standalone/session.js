// In-browser port of backend/game/session.py + jutsu_catalog.py: picks the
// hand-sign sequence for a skill (canon sequences from jutsu.csv, otherwise
// a deterministic one hashed from the skill name — same as the backend) and
// runs the hold / grace / scoring rules frame by frame.
import jutsuCsv from "./data/jutsu.csv?raw";
import { CANONICAL_SIGNS, LABELS } from "./signs";

const HOLD_TIME = 0.5; // seconds a sign must be held to count
const GRACE = 0.6; // seconds the sign can drop out before the hold resets
const TIME_LIMIT = 120; // soft cap so a stuck session still finishes
const CAST_DURATION = 2.5; // seconds the (legacy) cast lasts
const SEQUENCE_LENGTH = 4;
const MAX_CANON_LENGTH = 6;

const JP_TO_EN = Object.fromEntries(LABELS.map((l) => [l.jp, l.en]));

// { lowercased English jutsu name: [English sign names] }, shortest wins.
const CANON = (() => {
  const canon = new Map();
  for (const line of jutsuCsv.replace(/^﻿/, "").split(/\r?\n/)) {
    const row = line.split(",");
    const name = (row[3] ?? "").trim();
    if (!name) continue;
    const signs = row.slice(4).filter(Boolean).map((jp) => JP_TO_EN[jp]);
    if (signs.some((s) => s === undefined)) continue;
    const key = name.toLowerCase();
    if (!canon.has(key) || signs.length < canon.get(key).length) canon.set(key, signs);
  }
  return canon;
})();

export async function sequenceFor(skill) {
  const key = skill.trim().toLowerCase();
  for (const [name, signs] of CANON) {
    if (signs.length > MAX_CANON_LENGTH) continue;
    if (name.includes(key) || key.includes(name)) return signs;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...digest.slice(0, SEQUENCE_LENGTH)].map((b) => CANONICAL_SIGNS[b % CANONICAL_SIGNS.length]);
}

export class JutsuSession {
  constructor(sequence) {
    this.sequence = sequence;
    this.stage = "play";
    this.idx = 0;
    this.hold = 0;
    this.misses = 0;
    const now = performance.now() / 1000;
    this.lastSeen = now;
    this.startTime = now;
    this.lastT = now;
    this.castStart = null;
    this.power = null;
    this.rating = null;
  }

  _finishPlay(now) {
    const elapsed = now - this.startTime;
    const power = Math.max(0.25, Math.min(1, 1 - this.misses * 0.08 - Math.max(0, (elapsed - 8) / 40)));
    this.power = power;
    this.rating = power >= 0.85 ? "PERFECT!" : power >= 0.6 ? "CLEAN" : "TRAINED HARD";
    this.stage = "cast";
    this.castStart = now;
  }

  // detection: { en, ... } or null. Returns the same state dict the backend sends.
  step(detection) {
    const now = performance.now() / 1000;
    const dt = Math.max(0, Math.min(0.1, now - this.lastT));
    this.lastT = now;

    if (this.stage === "play") {
      const target = this.sequence[this.idx];
      if (detection) {
        this.lastSeen = now;
        if (detection.en === target) {
          this.hold += dt;
        } else {
          this.hold = Math.max(0, this.hold - dt * 2);
          if (this.hold === 0) this.misses += 1;
        }
        if (this.hold >= HOLD_TIME) {
          this.idx += 1;
          this.hold = 0;
          if (this.idx >= this.sequence.length) this._finishPlay(now);
        }
      } else if (now - this.lastSeen > GRACE) {
        this.hold = 0;
      }
      if (now - this.startTime > TIME_LIMIT && this.stage === "play") this._finishPlay(now);
    } else if (this.stage === "cast" && now - this.castStart > CAST_DURATION) {
      this.stage = "done";
    }

    const state = {
      stage: this.stage,
      sequence: this.sequence,
      idx: Math.min(this.idx, this.sequence.length),
      total: this.sequence.length,
      misses: this.misses,
    };
    if (this.stage === "play") {
      state.target_sign = this.sequence[this.idx];
      state.hold_progress = Math.round(Math.min(1, this.hold / HOLD_TIME) * 100) / 100;
      state.detected_sign = detection ? detection.en : null;
    } else {
      state.power = Math.round(this.power * 100) / 100;
      state.rating = this.rating;
    }
    return state;
  }
}
