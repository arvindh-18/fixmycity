import { motion, useReducedMotion, useTransform, type MotionValue } from "motion/react";

/* The hero street: three layers that slide at different speeds as you scroll,
   and one pin that drops onto the pothole when the page loads. */

const W = 1600;
const H = 600;
const GROUND = 520;

// Deterministic pseudo-random so the skyline is the same on every render.
const rnd = (n: number) => {
  const x = Math.sin(n * 999.7) * 10000;
  return x - Math.floor(x);
};

const far = (() => {
  const out: { x: number; w: number; h: number }[] = [];
  let x = -20;
  let i = 1;
  while (x < W) {
    const w = 50 + rnd(i) * 70;
    const right = x > 840;
    const h = right ? 120 + rnd(i + 50) * 190 : 50 + rnd(i + 50) * 80;
    if (!(x > 1120 && x < 1470)) out.push({ x, w, h }); // leave room for the dome building
    x += w + 6;
    i++;
  }
  return out;
})();

const mid = (() => {
  const out: { x: number; w: number; h: number; floors: number }[] = [];
  let x = 10;
  let i = 3;
  while (x < W) {
    const w = 90 + rnd(i) * 80;
    const floors = x < 700 ? 2 + Math.floor(rnd(i + 9) * 2) : 2 + Math.floor(rnd(i + 9) * 3);
    out.push({ x, w, h: floors * 38 + 20, floors });
    x += w + 26 + rnd(i + 4) * 60;
    i++;
  }
  return out;
})();

const svgProps = {
  viewBox: `0 0 ${W} ${H}`,
  preserveAspectRatio: "xMidYMax slice",
  className: "absolute inset-0 h-full w-full",
  "aria-hidden": true,
} as const;

export function StreetScene({ progress }: { progress: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const yFar = useTransform(progress, [0, 1], [0, reduce ? 0 : 190]);
  const yMid = useTransform(progress, [0, 1], [0, reduce ? 0 : 95]);

  return (
    <div className="absolute inset-x-0 bottom-0 h-[46%] sm:h-[52%] overflow-hidden">
      {/* Far skyline */}
      <motion.svg {...svgProps} style={{ y: yFar }}>
        <g fill="#D6DEE1">
          {far.map((b, i) => (
            <rect key={i} x={b.x} y={GROUND - b.h} width={b.w} height={b.h + 80} rx={2} />
          ))}
          {/* A civic building with a dome */}
          <rect x={1140} y={GROUND - 120} width={320} height={200} />
          <rect x={1250} y={GROUND - 175} width={100} height={60} />
          <path d={`M1250 ${GROUND - 175} a50 50 0 0 1 100 0z`} />
          <rect x={1297} y={GROUND - 245} width={6} height={30} />
          <rect x={1160} y={GROUND - 150} width={40} height={30} />
          <rect x={1400} y={GROUND - 150} width={40} height={30} />
        </g>
        <g fill="#E4EAEC">
          {[1160, 1190, 1220, 1380, 1410].map((x) => (
            <rect key={x} x={x} y={GROUND - 100} width={10} height={60} />
          ))}
        </g>
      </motion.svg>

      {/* Mid street: shops, trees */}
      <motion.svg {...svgProps} style={{ y: yMid }}>
        {mid.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={GROUND - b.h} width={b.w} height={b.h + 40} fill="#B4C1C7" rx={3} />
            {Array.from({ length: b.floors - 1 }).map((_, f) =>
              Array.from({ length: Math.floor((b.w - 16) / 30) }).map((_, c) => (
                <rect
                  key={`${f}-${c}`}
                  x={b.x + 14 + c * 30}
                  y={GROUND - b.h + 16 + f * 38}
                  width={16}
                  height={20}
                  rx={2}
                  fill={rnd(i * 31 + f * 7 + c) > 0.8 ? "#F3DE94" : "#D3DCE0"}
                />
              )),
            )}
            {/* shop shutter + awning on the ground floor */}
            <rect x={b.x + 10} y={GROUND - 34} width={b.w - 20} height={34} fill="#9FAEB5" />
            <path d={`M${b.x + 4} ${GROUND - 40}h${b.w - 8}l-8 10H${b.x + 12}z`} fill={i % 3 === 0 ? "#2B5BA8" : "#7F9198"} opacity={0.85} />
          </g>
        ))}
        {[260, 690, 1500].map((x, i) => (
          <g key={x} fill="#8FA597">
            <rect x={x - 4} y={GROUND - 70} width={8} height={70} fill="#7B8C86" />
            <circle cx={x} cy={GROUND - 100} r={38 + i * 4} />
            <circle cx={x - 30} cy={GROUND - 78} r={26} />
            <circle cx={x + 32} cy={GROUND - 80} r={28} />
          </g>
        ))}
      </motion.svg>

      {/* Front: footpath, road, the pothole and the pin */}
      <svg {...svgProps}>
        <rect x={0} y={GROUND - 14} width={W} height={26} fill="#CBD2CF" />
        {Array.from({ length: 40 }).map((_, i) => (
          <rect key={i} x={i * 42} y={GROUND - 14} width={1.5} height={26} fill="#B6BEBA" />
        ))}
        <rect x={0} y={GROUND + 12} width={W} height={7} fill="#8E9A9F" />
        <rect x={0} y={GROUND + 19} width={W} height={H - GROUND} fill="#2E383D" />
        {Array.from({ length: 16 }).map((_, i) => (
          <rect key={i} x={i * 110 + 20} y={GROUND + 52} width={62} height={6} rx={1} fill="#F2C230" />
        ))}

        {/* Streetlight that's out */}
        <g>
          <rect x={872} y={GROUND - 210} width={7} height={198} fill="#4C5961" />
          <path d={`M875 ${GROUND - 208}q0 -18 30 -18h22`} stroke="#4C5961" strokeWidth={6} fill="none" />
          <rect x={918} y={GROUND - 232} width={34} height={12} rx={4} fill="#4C5961" />
        </g>

        {/* Pothole */}
        <ellipse cx={1040} cy={GROUND + 60} rx={52} ry={11} fill="#4A565C" />
        <ellipse cx={1042} cy={GROUND + 61} rx={42} ry={7.5} fill="#192024" />

        <motion.ellipse
          cx={1040}
          cy={GROUND + 60}
          rx={26}
          ry={5}
          fill="#000"
          opacity={0.25}
          initial={reduce ? false : { scale: 0.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.25 }}
          transition={{ delay: 0.55, duration: 0.5 }}
          style={{ transformOrigin: "1040px 580px" }}
        />
        <motion.g
          initial={reduce ? false : { y: -320, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35, type: "spring", stiffness: 210, damping: 13 }}
        >
          <path
            d="M1040 576c0 0-30-30-30-52a30 30 0 0 1 60 0c0 22-30 52-30 52z"
            transform="translate(0 -6)"
            fill="#2B5BA8"
            stroke="#fff"
            strokeWidth={4}
          />
          <circle cx={1040} cy={518} r={11} fill="#F2C230" />
        </motion.g>
      </svg>
    </div>
  );
}
