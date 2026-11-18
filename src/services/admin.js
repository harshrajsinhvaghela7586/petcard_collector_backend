import { OTHER, TARGETS, SPECIES } from "../breeds.js";
import { PARTS } from "../slots.js";
import { petProgress, photoView } from "./petView.js";

/*
 * Everything the admin screens need. The data set is small (a few dozen people / pets), so rows are built in memory
 * and filtered, sorted and paged here; that keeps the Mongo repository trivial and this logic fully testable.
 */

export const breedLabel = (pet) => (pet.breed === OTHER ? (pet.breedNote ? `Other: ${pet.breedNote}` : "Other") : pet.breed);

export function buildRows({ pets, contributors, storage, config, now }) {
  const byId = new Map(contributors.map((c) => [c.id, c]));
  return pets.map((pet) => {
    const owner = byId.get(pet.contributorId) || { id: pet.contributorId, name: "(unknown)", mobile: "" };
    const progress = petProgress(pet, config, now);
    const thumbs = (part) => pet.photos.filter((p) => p.part === part).sort((a, b) => a.slot - b.slot).map((p) => ({ slot: p.slot, thumbUrl: storage.thumbUrl(p) }));
    return {
      id: pet.id,
      species: pet.species,
      breed: pet.breed,
      breedNote: pet.breedNote,
      breedLabel: breedLabel(pet),
      owner: { id: owner.id, name: owner.name, mobile: owner.mobile },
      createdAt: pet.createdAt,
      adminUnlocked: pet.adminUnlocked,
      part1Thumbs: thumbs(1),
      part2Thumbs: thumbs(2),
      ...progress,
    };
  });
}

const norm = (s) => String(s ?? "").toLowerCase();
const digits = (s) => String(s ?? "").replace(/\D/g, "");

function matchesSearch(haystackParts, mobile, search) {
  const q = norm(search).trim();
  if (!q) return true;
  // a number typed with or without "+91 ..." matches any part of the mobile number
  const stripped = q.replace(/^\+\s*91[\s-]*/, "");
  const qd = digits(stripped);
  if (qd.length >= 3 && /^[\d\s-]+$/.test(stripped) && mobile.includes(qd)) return true;
  return haystackParts.some((h) => norm(h).includes(q));
}

export const PET_STATUSES = ["p1_incomplete", "p2_locked", "p2_open", "complete"];

function statusMatches(row, status) {
  switch (status) {
    case "p1_incomplete": return !row.part1Complete;
    case "p2_locked": return row.part1Complete && row.part2State === "locked";
    case "p2_open": return row.part1Complete && row.part2State === "open";
    case "complete": return row.complete;
    default: return true;
  }
}

const SORTS = {
  newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  owner: (a, b) => a.owner.name.localeCompare(b.owner.name),
  breed: (a, b) => a.breedLabel.localeCompare(b.breedLabel),
  progress: (a, b) => b.part1Count + b.part2Count - (a.part1Count + a.part2Count),
};

export function paginate(items, page, limit) {
  const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / l));
  const p = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);
  return { items: items.slice((p - 1) * l, p * l), page: p, pages, total, limit: l };
}

export function queryPets(rows, q = {}) {
  const out = rows
    .filter((r) => !q.species || r.species === q.species)
    .filter((r) => !q.breed || r.breed === q.breed)
    .filter((r) => statusMatches(r, q.status))
    .filter((r) => matchesSearch([r.owner.name, r.breed, r.breedNote, r.species, r.id], r.owner.mobile, q.search))
    .sort(SORTS[q.sort] || SORTS.newest);
  return paginate(out, q.page, q.limit);
}

export function queryUsers(contributors, rows, q = {}) {
  const users = contributors.map((c) => {
    const pets = rows.filter((r) => r.owner.id === c.id);
    return {
      id: c.id,
      name: c.name,
      mobile: c.mobile,
      joinedAt: c.createdAt,
      petCount: pets.length,
      part1Done: pets.filter((p) => p.part1Complete).length,
      part2Done: pets.filter((p) => p.complete).length,
      allComplete: pets.length > 0 && pets.every((p) => p.complete),
      pets: pets.map((p) => ({ id: p.id, species: p.species, breedLabel: p.breedLabel, part1Count: p.part1Count, part2Count: p.part2Count, part2State: p.part2State, part2UnlockAt: p.part2UnlockAt, complete: p.complete })),
    };
  });
  const sorters = { newest: (a, b) => new Date(b.joinedAt) - new Date(a.joinedAt), oldest: (a, b) => new Date(a.joinedAt) - new Date(b.joinedAt), name: (a, b) => a.name.localeCompare(b.name) };
  const out = users
    .filter((u) => (q.species ? u.pets.some((p) => p.species === q.species) : true))
    .filter((u) => {
      if (q.status === "no_pets") return u.petCount === 0;
      if (q.status === "has_incomplete") return u.pets.some((p) => !p.complete);
      if (q.status === "all_complete") return u.allComplete;
      return true;
    })
    .filter((u) => matchesSearch([u.name, ...u.pets.map((p) => p.breedLabel), ...u.pets.map((p) => p.species)], u.mobile, q.search))
    .sort(sorters[q.sort] || sorters.newest);
  return paginate(out, q.page, q.limit);
}

export function buildSummary({ contributors, rows, config }) {
  const bySpecies = {};
  for (const s of SPECIES) {
    const mine = rows.filter((r) => r.species === s);
    bySpecies[s] = { target: TARGETS[s] ?? 0, total: mine.length, part1Complete: mine.filter((r) => r.part1Complete).length, complete: mine.filter((r) => r.complete).length };
  }
  const breeds = new Map();
  for (const r of rows) {
    const k = `${r.species}|${r.breedLabel}`;
    const e = breeds.get(k) || { species: r.species, breed: r.breedLabel, total: 0, complete: 0 };
    e.total += 1;
    if (r.complete) e.complete += 1;
    breeds.set(k, e);
  }
  return {
    contributors: contributors.length,
    pets: rows.length,
    part1Complete: rows.filter((r) => r.part1Complete).length,
    complete: rows.filter((r) => r.complete).length,
    photos: rows.reduce((n, r) => n + r.part1Count + r.part2Count, 0),
    part2DelayDays: config.part2DelayDays,
    bySpecies,
    breeds: [...breeds.values()].sort((a, b) => a.species.localeCompare(b.species) || b.total - a.total || a.breed.localeCompare(b.breed)),
  };
}

export function adminPetDetail({ pet, owner, storage, config, now }) {
  const [row] = buildRows({ pets: [pet], contributors: [owner], storage, config, now });
  const photos = (part) => pet.photos.filter((p) => p.part === part).sort((a, b) => a.slot - b.slot);
  const withLabel = (part) => PARTS[part].map((def) => {
    const p = photos(part).find((x) => x.slot === def.slot);
    return { slot: def.slot, label: def.label, photo: p ? photoView(storage, p) : null };
  });
  return { ...row, part1: withLabel(1), part2: withLabel(2), part1CompletedAt: pet.part1CompletedAt };
}

/* ---- export ---- */

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "unknown";
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Folder layout that scripts/eval_identity.py reads: identity_eval_<species>/<speciesNN>_<breed>/01_front.jpg ... 08_scan.jpg */
export function planExport({ pets, contributors, onlyComplete, config, now }) {
  const byId = new Map(contributors.map((c) => [c.id, c]));
  const counters = {};
  const entries = [];
  const sorted = [...pets].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const pet of sorted) {
    const prog = petProgress(pet, config, now);
    if (onlyComplete && !prog.complete) continue;
    if (!pet.photos.length) continue;
    counters[pet.species] = (counters[pet.species] || 0) + 1;
    const folder = `identity_eval_${pet.species}/${pet.species}${String(counters[pet.species]).padStart(2, "0")}_${slug(pet.breed === OTHER ? pet.breedNote : pet.breed)}`;
    const files = pet.photos
      .map((photo) => ({ photo, def: PARTS[photo.part].find((d) => d.slot === photo.slot) }))
      .filter((x) => x.def)
      .sort((a, b) => a.def.file.localeCompare(b.def.file))
      .map(({ photo, def }) => ({ photo, path: `${folder}/${def.file}.jpg` }));
    entries.push({ pet, owner: byId.get(pet.contributorId), folder, files, prog });
  }
  return entries;
}

export function manifestCsv(entries) {
  const head = ["folder", "owner_name", "owner_mobile", "species", "breed", "breed_note", "part1_photos", "part2_photos", "part1_completed_at", "photos_taken_at_range"];
  const rows = entries.map(({ pet, owner, folder, prog }) => {
    const taken = pet.photos.map((p) => p.takenAt).filter(Boolean).map((d) => new Date(d).getTime());
    const range = taken.length ? `${new Date(Math.min(...taken)).toISOString().slice(0, 10)} .. ${new Date(Math.max(...taken)).toISOString().slice(0, 10)}` : "";
    return [folder, owner?.name, owner?.mobile, pet.species, pet.breed, pet.breedNote, prog.part1Count, prog.part2Count, pet.part1CompletedAt ? new Date(pet.part1CompletedAt).toISOString() : "", range].map(csv).join(",");
  });
  return [head.map(csv).join(","), ...rows].join("\n") + "\n";
}

export const EXPORT_README = `PetCard photo-identity test set
=================================
identity_eval_dog / identity_eval_cat / identity_eval_rabbit
  one folder per pet, 8 photos each:
    01-04  registration photos (front, left, right, body)
    05-08  scan photos taken about a week later

Copy the folders into pet_biometric/data/ and run (inside pet_biometric/):
  python scripts/eval_identity.py --dir data/identity_eval_dog --k 4 --backend dinov2
  python scripts/eval_identity.py --dir data/identity_eval_dog --k 4 --backend clip
(then the same for cat and rabbit). manifest.csv lists whose pet each folder is.
`;
