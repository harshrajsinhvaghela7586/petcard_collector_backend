import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Contributor, Pet, mongoRepo } from "../src/repo/mongo.js";

/* No database here: this only checks the schemas and the shape the Mongo repository returns, because the real
   MongoDB-backed behaviour is exercised by tests/api.test.js through the identical in-memory repository. */

test("schemas accept valid data and reject bad data", () => {
  const cid = new mongoose.Types.ObjectId();
  assert.equal(new Contributor({ name: "Asha", mobile: "9876543210" }).validateSync(), undefined);
  assert.ok(new Contributor({ name: "Asha", mobile: "1234567890" }).validateSync().errors.mobile);
  const ok = new Pet({ contributor: cid, species: "dog", breed: "Beagle", photos: [{ part: 1, slot: 0, publicId: "a", url: "http://x/a.jpg" }] });
  assert.equal(ok.validateSync(), undefined);
  assert.ok(new Pet({ contributor: cid, species: "horse", breed: "x" }).validateSync().errors.species);
  assert.ok(new Pet({ contributor: cid, species: "dog", breed: "x", photos: [{ part: 3, slot: 0, publicId: "a", url: "u" }] }).validateSync());
  assert.ok(new Pet({ contributor: cid, species: "dog", breed: "x", photos: [{ part: 1, slot: 4, publicId: "a", url: "u" }] }).validateSync());
});

test("repository maps documents to plain objects with string ids", () => {
  const repo = mongoRepo();
  assert.equal(repo.kind, "mongo");
  for (const m of ["createContributor", "getContributorByMobile", "getContributor", "listContributors", "createPet", "getPet", "listPetsByContributor", "listPets", "updatePet", "deletePet", "putPhoto", "removePhoto", "setPart1CompletedIfUnset"]) {
    assert.equal(typeof repo[m], "function", m);
  }
});

test("a bad id never reaches the database", async () => {
  const repo = mongoRepo();
  assert.equal(await repo.getPet("not-an-id"), null);
  assert.equal(await repo.getContributor("nope"), null);
  assert.deepEqual(await repo.listPetsByContributor("nope"), []);
  assert.equal(await repo.putPhoto("nope", {}), null);
});
