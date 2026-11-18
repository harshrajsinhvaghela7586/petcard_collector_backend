import crypto from "node:crypto";

/** In-memory repository: used by the tests and handy for a quick local demo (data is lost on restart). */
export function memoryRepo() {
  const contributors = new Map();
  const pets = new Map();
  const id = () => crypto.randomBytes(12).toString("hex");
  const copy = (o) => (o ? structuredClone(o) : null);

  return {
    kind: "memory",
    async createContributor({ name, mobile }) {
      const c = { id: id(), name, mobile, createdAt: new Date() };
      contributors.set(c.id, c);
      return copy(c);
    },
    async getContributorByMobile(mobile) {
      return copy([...contributors.values()].find((c) => c.mobile === mobile));
    },
    async getContributor(cid) {
      return copy(contributors.get(String(cid)));
    },
    async listContributors() {
      return [...contributors.values()].map(copy);
    },
    async createPet({ contributorId, species, breed, breedNote }) {
      const p = { id: id(), contributorId: String(contributorId), species, breed, breedNote: breedNote || "", photos: [], part1CompletedAt: null, adminUnlocked: false, createdAt: new Date() };
      pets.set(p.id, p);
      return copy(p);
    },
    async getPet(pid) {
      return copy(pets.get(String(pid)));
    },
    async listPetsByContributor(cid) {
      return [...pets.values()].filter((p) => p.contributorId === String(cid)).map(copy);
    },
    async listPets() {
      return [...pets.values()].map(copy);
    },
    async updatePet(pid, patch) {
      const p = pets.get(String(pid));
      if (!p) return null;
      Object.assign(p, patch);
      return copy(p);
    },
    async deletePet(pid) {
      return pets.delete(String(pid));
    },
    async putPhoto(pid, photo) {
      const p = pets.get(String(pid));
      if (!p) return null;
      const i = p.photos.findIndex((x) => x.part === photo.part && x.slot === photo.slot);
      const replaced = i >= 0 ? p.photos.splice(i, 1)[0] : null;
      p.photos.push(structuredClone(photo));
      return { pet: copy(p), replaced: copy(replaced) };
    },
    async removePhoto(pid, part, slot) {
      const p = pets.get(String(pid));
      if (!p) return null;
      const i = p.photos.findIndex((x) => x.part === part && x.slot === slot);
      const removed = i >= 0 ? p.photos.splice(i, 1)[0] : null;
      return { pet: copy(p), removed: copy(removed) };
    },
    async setPart1CompletedIfUnset(pid, at) {
      const p = pets.get(String(pid));
      if (p && !p.part1CompletedAt) p.part1CompletedAt = at;
      return copy(p);
    },
  };
}
