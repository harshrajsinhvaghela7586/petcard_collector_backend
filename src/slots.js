/*
 * Part 1 = "registration" photos (4, taken now). Part 2 = "scan" photos (4, taken about a week later).
 * The file names below are what the export ZIP uses; eval_identity.py reads files in name order and treats the first
 * 4 as the registered photos, so 01-04 must stay the registration set and 05-08 the later scans.
 */
export const PARTS = {
  1: [
    { slot: 0, file: "01_front", label: "Front face", hint: "Looking at the camera, face fills the frame" },
    { slot: 1, file: "02_left", label: "Left side", hint: "Side view of the head and body" },
    { slot: 2, file: "03_right", label: "Right side", hint: "Other side, same distance" },
    { slot: 3, file: "04_body", label: "Full body", hint: "Whole pet visible, standing or sitting" },
  ],
  2: [0, 1, 2, 3].map((slot) => ({
    slot,
    file: `0${5 + slot}_scan`,
    label: `Scan photo ${slot + 1}`,
    hint: "Casual photo, a bit further away, different place or light",
  })),
};

export const SLOTS_PER_PART = 4;
export const isPart = (p) => p === 1 || p === 2;
export const isSlot = (s) => Number.isInteger(s) && s >= 0 && s < SLOTS_PER_PART;
