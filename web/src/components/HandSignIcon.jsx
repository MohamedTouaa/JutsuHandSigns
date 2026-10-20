import { useState } from "react";

// Original schematic diagrams of the 12 canonical two-handed seals — drawn
// from scratch, not traced from any reference image. The specific finger
// positions are guided by plain-language descriptions of how each sign is
// physically formed (which fingers extend, which clasp, which hand sits on
// top) — factual information about hand posture, not copied artwork.
const SKIN = "#e8c9a0";
const SKIN_DARK = "#c9a874";
const INK = "#2a1d12";

function Fist({ transform }) {
  return (
    <g transform={transform}>
      <ellipse cx="0" cy="0" rx="17" ry="20" fill={SKIN} stroke={INK} strokeWidth="2" />
      <path d="M-10,-16 L10,-16" stroke={INK} strokeWidth="1.5" />
      <path d="M-13,-6 L13,-6" stroke={INK} strokeWidth="1.5" />
      <path d="M-13,4 L13,4" stroke={INK} strokeWidth="1.5" />
      <rect x="-9" y="16" width="18" height="18" rx="6" fill={SKIN_DARK} stroke={INK} strokeWidth="2" />
    </g>
  );
}

// Fist with two fingers extended straight up (used for Rat: index + middle up).
function TwoFingerFist({ transform }) {
  return (
    <g transform={transform}>
      <path d="M-7,-28 L-7,-2 M3,-28 L3,-2" stroke={SKIN} strokeWidth="7" strokeLinecap="round" />
      <path d="M-7,-28 L-7,-2 M3,-28 L3,-2" stroke={INK} strokeWidth="1" strokeLinecap="round" fill="none" />
      <ellipse cx="-2" cy="4" rx="17" ry="18" fill={SKIN} stroke={INK} strokeWidth="2" />
      <rect x="-11" y="20" width="18" height="18" rx="6" fill={SKIN_DARK} stroke={INK} strokeWidth="2" />
    </g>
  );
}

// Hand wrapped around something (fingers curling over), used where one hand
// grips/encloses the other.
function WrapHand({ transform }) {
  return (
    <g transform={transform}>
      <path d="M-18,-4 Q-20,6 -10,12 Q4,18 16,10 Q20,4 16,-4"
            fill={SKIN_DARK} stroke={INK} strokeWidth="2" />
      <path d="M-13,0 Q-10,8 -2,10 M0,2 Q4,10 12,8" stroke={INK} strokeWidth="1.3" fill="none" />
    </g>
  );
}

function FlatHand({ transform }) {
  return (
    <g transform={transform}>
      <rect x="-14" y="-34" width="28" height="34" rx="8" fill={SKIN} stroke={INK} strokeWidth="2" />
      <path d="M-9,-34 L-9,-44 M-3,-34 L-3,-47 M3,-34 L3,-47 M9,-34 L9,-44"
            stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
      <rect x="-9" y="2" width="18" height="18" rx="6" fill={SKIN_DARK} stroke={INK} strokeWidth="2" />
    </g>
  );
}

// "L"-shape: thumb + index extended, other fingers curled (a finger-gun).
function LHand({ transform }) {
  return (
    <g transform={transform}>
      <ellipse cx="0" cy="10" rx="13" ry="14" fill={SKIN} stroke={INK} strokeWidth="2" />
      <path d="M-4,10 L-4,-16" stroke={SKIN} strokeWidth="7" strokeLinecap="round" />
      <path d="M-4,10 L-4,-16" stroke={INK} strokeWidth="1" fill="none" />
      <path d="M10,6 L24,2" stroke={SKIN} strokeWidth="6" strokeLinecap="round" />
      <path d="M10,6 L24,2" stroke={INK} strokeWidth="1" fill="none" />
      <rect x="-9" y="22" width="18" height="16" rx="6" fill={SKIN_DARK} stroke={INK} strokeWidth="2" />
    </g>
  );
}

function PrayerHand({ transform, bent }) {
  return (
    <g transform={transform}>
      <path
        d={bent
          ? "M-13,-30 Q0,-40 13,-30 L13,10 Q0,18 -13,10 Z"
          : "M-11,-34 L11,-34 L13,10 Q0,16 -13,10 Z"}
        fill={SKIN} stroke={INK} strokeWidth="2"
      />
      <path d="M-7,-30 L-7,-5 M0,-32 L0,-2 M7,-30 L7,-5" stroke={INK} strokeWidth="1.2" />
    </g>
  );
}

const SIGNS = {
  // Left index+middle up, rest folded; right hand wraps around the two
  // standing fingers.
  Rat: (
    <>
      <TwoFingerFist transform="translate(28,34)" />
      <WrapHand transform="translate(34,18) rotate(100)" />
    </>
  ),
  // Fingers extended and crossed into an X, forearms horizontal.
  Ox: (
    <>
      <FlatHand transform="translate(32,46) rotate(28)" />
      <FlatHand transform="translate(32,46) rotate(-28) scale(-1,1)" />
    </>
  ),
  Tiger: (
    <>
      <PrayerHand transform="translate(22,50) rotate(-6)" bent />
      <PrayerHand transform="translate(42,50) scale(-1,1) rotate(-6)" bent />
    </>
  ),
  // Left hand "L" (thumb+index); right hand curled, pinky over left thumb.
  Hare: (
    <>
      <LHand transform="translate(24,36) rotate(-6)" />
      <Fist transform="translate(42,32) rotate(14)" />
    </>
  ),
  Dragon: (
    <>
      <Fist transform="translate(24,26) rotate(-20)" />
      <Fist transform="translate(40,42) rotate(160)" />
      <path d="M24,26 Q32,34 40,42" stroke={INK} strokeWidth="2" fill="none" />
    </>
  ),
  Snake: (
    <>
      <Fist transform="translate(24,28) rotate(10)" />
      <Fist transform="translate(40,28) rotate(-10)" />
      <path d="M22,44 Q32,54 42,44" stroke={INK} strokeWidth="2" fill="none" />
    </>
  ),
  // Index fingertips touching, other knuckles stacked, palms facing inward.
  Horse: (
    <>
      <FlatHand transform="translate(24,46) rotate(-10)" />
      <FlatHand transform="translate(40,46) scale(-1,1) rotate(-10) translate(-2,4)" />
      <path d="M26,14 L38,14" stroke={INK} strokeWidth="2" />
    </>
  ),
  // Index+middle up on each hand, right set a little lower than left.
  Ram: (
    <>
      <TwoFingerFist transform="translate(24,30) rotate(-4)" />
      <TwoFingerFist transform="translate(40,38) rotate(4) scale(-1,1)" />
    </>
  ),
  Monkey: (
    <>
      <Fist transform="translate(32,36)" />
      <WrapHand transform="translate(32,16) rotate(90)" />
    </>
  ),
  // Arch of middle+pinky, ring+index crossed, thumb tips touching.
  Bird: (
    <>
      <PrayerHand transform="translate(22,48) rotate(4)" />
      <PrayerHand transform="translate(42,48) scale(-1,1) rotate(4)" />
      <path d="M26,22 Q32,14 38,22" stroke={INK} strokeWidth="1.5" fill="none" />
    </>
  ),
  // Right fist, left open palm resting on top.
  Dog: (
    <>
      <Fist transform="translate(32,44)" />
      <FlatHand transform="translate(32,14) rotate(90) scale(0.9)" />
    </>
  ),
  // Partial fists, palms pressed together, forearms horizontal.
  Boar: (
    <>
      <Fist transform="translate(23,36) rotate(-16)" />
      <Fist transform="translate(41,36) rotate(16)" />
    </>
  ),
};

// If a photo exists at /hand-signs/<sign>.jpg (or .png), it's used instead
// of the SVG fallback — drop generated reference images there to upgrade
// every sign at once, no code changes needed.
function PhotoOrSvg({ sign, size, content }) {
  const [failed, setFailed] = useState(false);
  const base = `${import.meta.env.BASE_URL}hand-signs/${sign.toLowerCase()}`;

  if (!failed) {
    return (
      <img
        src={`${base}.jpg`}
        alt={sign}
        className="hand-sign-photo"
        style={{ width: size, height: size }}
        onError={(e) => {
          if (!e.currentTarget.dataset.triedPng) {
            e.currentTarget.dataset.triedPng = "1";
            e.currentTarget.src = `${base}.png`;
          } else {
            setFailed(true);
          }
        }}
      />
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="hand-sign-icon">
      {content}
    </svg>
  );
}

export default function HandSignIcon({ sign, size = 64 }) {
  const content = SIGNS[sign];
  if (!content) return null;
  return <PhotoOrSvg sign={sign} size={size} content={content} />;
}
