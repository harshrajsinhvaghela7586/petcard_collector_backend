import express from "express";
import multer from "multer";
import { ApiError } from "../errors.js";
import { BREEDS, OTHER, SPECIES, breedOptions } from "../breeds.js";
import { PARTS, isPart, isSlot } from "../slots.js";
import { normalizePhoto } from "../image.js";
import { friendPetView, petProgress } from "../services/petView.js";

export function normalizeMobile(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) throw new ApiError(400, "Enter a valid 10-digit mobile number.", "BAD_MOBILE");
  return d;
}

function cleanName(v) {
  const n = String(v ?? "").replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 60) throw new ApiError(400, "Enter your name (2 to 60 characters).", "BAD_NAME");
  return n;
}

function cleanPetFields(body) {
  const species = String(body?.species ?? "");
  if (!SPECIES.includes(species)) throw new ApiError(400, "Choose dog, cat or rabbit.", "BAD_SPECIES");
  const breed = String(body?.breed ?? "");
  if (!breedOptions(species).includes(breed)) throw new ApiError(400, "Choose a breed from the list, or choose Other and type it.", "BAD_BREED");
  let breedNote = "";
  if (breed === OTHER) {
    breedNote = String(body?.breedNote ?? "").replace(/\s+/g, " ").trim();
    if (breedNote.length < 2 || breedNote.length > 60) throw new ApiError(400, "Please type the breed (2 to 60 characters), or write \"mixed\" if you are not sure.", "BAD_BREED_NOTE");
  }
  return { species, breed, breedNote };
}

function cleanTakenAt(v) {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getTime() > Date.now() + 86400000) return null;
  return d;
}

export function publicRoutes({ repo, storage, auth, config, limiters }) {
  const r = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 5 } });

  r.get("/config", (_req, res) => {
    res.json({
      species: SPECIES,
      breeds: Object.fromEntries(SPECIES.map((s) => [s, breedOptions(s)])),
      other: OTHER,
      part2DelayDays: config.part2DelayDays,
      maxPets: config.maxPetsPerPerson,
      parts: { 1: PARTS[1].map(({ slot, label, hint }) => ({ slot, label, hint })), 2: PARTS[2].map(({ slot, label, hint }) => ({ slot, label, hint })) },
    });
  });

  const view = (pet) => friendPetView(storage, pet, config);
  const myPets = async (cid) => (await repo.listPetsByContributor(cid)).map(view);

  /* Enter name + mobile: creates the person the first time, brings them back to their pets afterwards. */
  r.post("/start", limiters.start, async (req, res) => {
    const name = cleanName(req.body?.name);
    const mobile = normalizeMobile(req.body?.mobile);
    const contributor = (await repo.getContributorByMobile(mobile)) || (await repo.createContributor({ name, mobile }));
    res.json({
      token: auth.signFriend(contributor.id),
      contributor: { id: contributor.id, name: contributor.name, mobile: contributor.mobile },
      pets: await myPets(contributor.id),
      returning: contributor.name !== name || undefined,
    });
  });

  r.use(auth.friend);

  r.get("/me", async (req, res) => {
    const contributor = await repo.getContributor(req.contributorId);
    if (!contributor) throw new ApiError(401, "Please enter your details again.", "UNAUTHENTICATED");
    res.json({ contributor: { id: contributor.id, name: contributor.name, mobile: contributor.mobile }, pets: await myPets(contributor.id) });
  });

  async function ownedPet(req) {
    const pet = await repo.getPet(req.params.id);
    if (!pet || pet.contributorId !== String(req.contributorId)) throw new ApiError(404, "Pet not found.", "NOT_FOUND");
    return pet;
  }

  r.post("/pets", async (req, res) => {
    const fields = cleanPetFields(req.body);
    const mine = await repo.listPetsByContributor(req.contributorId);
    if (mine.length >= config.maxPetsPerPerson) throw new ApiError(409, `You can add up to ${config.maxPetsPerPerson} pets.`, "TOO_MANY_PETS");
    const pet = await repo.createPet({ contributorId: req.contributorId, ...fields });
    res.status(201).json({ pet: view(pet) });
  });

  r.patch("/pets/:id", async (req, res) => {
    const pet = await ownedPet(req);
    if (pet.photos.length) throw new ApiError(409, "Remove this pet's photos first to change its breed.", "HAS_PHOTOS");
    res.json({ pet: view(await repo.updatePet(pet.id, cleanPetFields(req.body))) });
  });

  r.delete("/pets/:id", async (req, res) => {
    const pet = await ownedPet(req);
    if (pet.photos.length) throw new ApiError(409, "A pet that has photos cannot be removed here. Please contact the PetCard team.", "HAS_PHOTOS");
    await repo.deletePet(pet.id);
    res.json({ ok: true });
  });

  function parseSlot(req) {
    const part = Number(req.params.part);
    const slot = Number(req.params.slot);
    if (!isPart(part) || !isSlot(slot)) throw new ApiError(400, "Unknown photo slot.", "BAD_SLOT");
    return { part, slot };
  }

  r.put("/pets/:id/photos/:part/:slot", limiters.upload, upload.single("photo"), async (req, res) => {
    const { part, slot } = parseSlot(req);
    const pet = await ownedPet(req);
    if (part === 2) {
      const prog = petProgress(pet, config);
      if (prog.part2State === "needs_part1" || prog.part2State === "locked") {
        throw new ApiError(403, prog.part2State === "needs_part1" ? "Finish the 4 photos in Part 1 first." : "Scan photos open later.", "PART2_LOCKED", { part2State: prog.part2State, part2UnlockAt: prog.part2UnlockAt });
      }
    }
    if (!req.file) throw new ApiError(400, "Choose a photo first.", "NO_FILE");
    const img = await normalizePhoto(req.file.buffer);
    const stored = await storage.put(img.buffer);
    const result = await repo.putPhoto(pet.id, {
      part, slot, publicId: stored.publicId, url: stored.url, width: img.width, height: img.height, bytes: img.bytes,
      takenAt: cleanTakenAt(req.body?.takenAt), uploadedAt: new Date(),
    });
    if (!result) {
      storage.remove(stored.publicId).catch(() => {});
      throw new ApiError(404, "Pet not found.", "NOT_FOUND");
    }
    if (result.replaced) storage.remove(result.replaced.publicId).catch(() => {});
    let updated = result.pet;
    if (part === 1 && updated.photos.filter((p) => p.part === 1).length >= 4) updated = await repo.setPart1CompletedIfUnset(pet.id, new Date());
    res.json({ pet: view(updated) });
  });

  r.delete("/pets/:id/photos/:part/:slot", async (req, res) => {
    const { part, slot } = parseSlot(req);
    const pet = await ownedPet(req);
    const result = await repo.removePhoto(pet.id, part, slot);
    if (result?.removed) storage.remove(result.removed.publicId).catch(() => {});
    res.json({ pet: view(result?.pet ?? pet) });
  });

  return r;
}
