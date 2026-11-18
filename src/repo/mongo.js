import mongoose from "mongoose";

const { Schema } = mongoose;

const photoSchema = new Schema(
  {
    part: { type: Number, enum: [1, 2], required: true },
    slot: { type: Number, min: 0, max: 3, required: true },
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    width: Number,
    height: Number,
    bytes: Number,
    takenAt: { type: Date, default: null }, // when the phone says the photo was taken (read in the browser)
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const contributorSchema = new Schema({
  name: { type: String, required: true, maxlength: 80 },
  mobile: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
  createdAt: { type: Date, default: Date.now },
});

const petSchema = new Schema({
  contributor: { type: Schema.Types.ObjectId, ref: "Contributor", required: true, index: true },
  species: { type: String, enum: ["dog", "cat", "rabbit"], required: true },
  breed: { type: String, required: true, maxlength: 80 },
  breedNote: { type: String, default: "", maxlength: 80 },
  photos: { type: [photoSchema], default: [] },
  part1CompletedAt: { type: Date, default: null },
  adminUnlocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export const Contributor = mongoose.models.CollectContributor || mongoose.model("CollectContributor", contributorSchema, "contributors");
export const Pet = mongoose.models.CollectPet || mongoose.model("CollectPet", petSchema, "pets");

const plainPhoto = (p) => ({ part: p.part, slot: p.slot, publicId: p.publicId, url: p.url, width: p.width, height: p.height, bytes: p.bytes, takenAt: p.takenAt, uploadedAt: p.uploadedAt });
const contributor = (d) => d && { id: String(d._id), name: d.name, mobile: d.mobile, createdAt: d.createdAt };
const pet = (d) =>
  d && {
    id: String(d._id),
    contributorId: String(d.contributor),
    species: d.species,
    breed: d.breed,
    breedNote: d.breedNote || "",
    photos: (d.photos || []).map(plainPhoto),
    part1CompletedAt: d.part1CompletedAt || null,
    adminUnlocked: Boolean(d.adminUnlocked),
    createdAt: d.createdAt,
  };
const validId = (id) => mongoose.isValidObjectId(id);

/* Deliberately plain CRUD: every filter / search / page / sort happens in services/admin.js on both repositories. */
export function mongoRepo() {
  return {
    kind: "mongo",
    async createContributor({ name, mobile }) {
      return contributor(await Contributor.create({ name, mobile }));
    },
    async getContributorByMobile(mobile) {
      return contributor(await Contributor.findOne({ mobile }).lean());
    },
    async getContributor(id) {
      return validId(id) ? contributor(await Contributor.findById(id).lean()) : null;
    },
    async listContributors() {
      return (await Contributor.find().sort({ createdAt: 1 }).lean()).map(contributor);
    },
    async createPet({ contributorId, species, breed, breedNote }) {
      return pet(await Pet.create({ contributor: contributorId, species, breed, breedNote: breedNote || "" }));
    },
    async getPet(id) {
      return validId(id) ? pet(await Pet.findById(id).lean()) : null;
    },
    async listPetsByContributor(cid) {
      return validId(cid) ? (await Pet.find({ contributor: cid }).sort({ createdAt: 1 }).lean()).map(pet) : [];
    },
    async listPets() {
      return (await Pet.find().sort({ createdAt: 1 }).lean()).map(pet);
    },
    async updatePet(id, patch) {
      return validId(id) ? pet(await Pet.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean()) : null;
    },
    async deletePet(id) {
      return validId(id) ? Boolean((await Pet.findByIdAndDelete(id)) ) : false;
    },
    async putPhoto(id, photo) {
      if (!validId(id)) return null;
      const before = await Pet.findById(id).lean();
      if (!before) return null;
      const replaced = (before.photos || []).find((x) => x.part === photo.part && x.slot === photo.slot) || null;
      await Pet.updateOne({ _id: id }, { $pull: { photos: { part: photo.part, slot: photo.slot } } });
      const after = await Pet.findByIdAndUpdate(id, { $push: { photos: photo } }, { new: true, runValidators: true }).lean();
      return { pet: pet(after), replaced: replaced && plainPhoto(replaced) };
    },
    async removePhoto(id, part, slot) {
      if (!validId(id)) return null;
      const before = await Pet.findById(id).lean();
      if (!before) return null;
      const removed = (before.photos || []).find((x) => x.part === part && x.slot === slot) || null;
      const after = await Pet.findByIdAndUpdate(id, { $pull: { photos: { part, slot } } }, { new: true }).lean();
      return { pet: pet(after), removed: removed && plainPhoto(removed) };
    },
    async setPart1CompletedIfUnset(id, at) {
      if (!validId(id)) return null;
      await Pet.updateOne({ _id: id, part1CompletedAt: null }, { $set: { part1CompletedAt: at } });
      return pet(await Pet.findById(id).lean());
    },
  };
}

export async function connectMongo(uri) {
  if (!uri) throw new Error("MONGODB_URI is required");
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
}
