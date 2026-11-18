import { SLOTS_PER_PART } from "../slots.js";

const DAY = 86400000;

/** Counts + the state of Part 2 (the "scan" photos, opened N days after Part 1 is complete or by the admin). */
export function petProgress(pet, config, now = new Date()) {
  const count = (part) => pet.photos.filter((p) => p.part === part).length;
  const part1Count = count(1);
  const part2Count = count(2);
  const unlockAt = pet.part1CompletedAt ? new Date(new Date(pet.part1CompletedAt).getTime() + config.part2DelayDays * DAY) : null;
  let part2State;
  if (!pet.part1CompletedAt) part2State = "needs_part1";
  else if (part2Count >= SLOTS_PER_PART) part2State = "complete";
  else if (pet.adminUnlocked || now >= unlockAt) part2State = "open";
  else part2State = "locked";
  return {
    part1Count,
    part2Count,
    part1Complete: part1Count >= SLOTS_PER_PART,
    complete: part1Count >= SLOTS_PER_PART && part2Count >= SLOTS_PER_PART,
    part2State,
    part2UnlockAt: unlockAt ? unlockAt.toISOString() : null,
  };
}

const photoView = (storage, p) => ({ slot: p.slot, url: p.url, thumbUrl: storage.thumbUrl(p), uploadedAt: p.uploadedAt, takenAt: p.takenAt });

/** What the person who owns the pet sees. */
export function friendPetView(storage, pet, config) {
  return {
    id: pet.id,
    species: pet.species,
    breed: pet.breed,
    breedNote: pet.breedNote,
    createdAt: pet.createdAt,
    canEdit: pet.photos.length === 0,
    part1: pet.photos.filter((p) => p.part === 1).sort((a, b) => a.slot - b.slot).map((p) => photoView(storage, p)),
    part2: pet.photos.filter((p) => p.part === 2).sort((a, b) => a.slot - b.slot).map((p) => photoView(storage, p)),
    ...petProgress(pet, config),
  };
}

export { photoView };
