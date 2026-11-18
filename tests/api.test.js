import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import AdmZip from "adm-zip";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { memoryRepo } from "../src/repo/memory.js";
import { diskStorage } from "../src/storage/disk.js";
import { OTHER, BREEDS } from "../src/breeds.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-test-"));
const config = loadConfig({
  JWT_SECRET: "t".repeat(40), ADMIN_EMAIL: "Admin@PetCard.in", ADMIN_PASSWORD: "test-admin-password", STORAGE_DRIVER: "disk",
  UPLOAD_DIR: dir, PORT: "4999", PART2_DELAY_DAYS: "7", CORS_ORIGIN: "http://localhost:3000",
});
const repo = memoryRepo();
const storage = diskStorage({ dir, publicUrl: "http://127.0.0.1" });
const app = createApp({ config, repo, storage, rateLimiting: false });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
storage.thumbUrl = (p) => p.url; // photo urls point at the test server below
const origPut = storage.put.bind(storage);
storage.put = async (b) => { const r = await origPut(b); return { ...r, url: `${base}/files/${r.publicId}` }; };

const call = async (method, url, { token, json, form, headers } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json ? JSON.stringify(json) : form,
  });
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, body: ct.includes("json") ? await res.json() : null, res };
};
const img = (w = 800, h = 600, color = { r: 200, g: 120, b: 60 }) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
const photoForm = async (buf, extra = {}) => {
  const f = new FormData();
  f.append("photo", new Blob([buf ?? (await img())], { type: "image/jpeg" }), "p.jpg");
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};
const start = (name, mobile) => call("POST", "/api/start", { json: { name, mobile } });
const addPet = (token, species = "dog", breed = "Beagle", breedNote) => call("POST", "/api/pets", { token, json: { species, breed, breedNote } });
const upload = async (token, petId, part, slot, buf, extra) => call("PUT", `/api/pets/${petId}/photos/${part}/${slot}`, { token, form: await photoForm(buf, extra) });
async function fillPart1(token, petId) { let r; for (let s = 0; s < 4; s++) r = await upload(token, petId, 1, s); return r; }
async function adminToken() { return (await call("POST", "/api/admin/login", { json: { email: "admin@petcard.in", password: "test-admin-password" } })).body.token; }

test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("config: breeds list is the full list and 'Other' exists", async () => {
  const c = (await call("GET", "/api/config")).body;
  assert.ok(c.breeds.dog.length > 80 && c.breeds.cat.length > 35 && c.breeds.rabbit.length > 30);
  for (const b of ["Hungarian Vizsla", "Border Collie", "Japanese Akita", "Indian Pariah (Desi)"]) assert.ok(c.breeds.dog.includes(b), b);
  for (const s of ["dog", "cat", "rabbit"]) assert.equal(c.breeds[s].at(-1), OTHER);
  assert.equal(c.part2DelayDays, 7);
  assert.equal(c.parts[1].length, 4);
});

test("start: validates, creates once, and the same mobile comes back to the same person", async () => {
  assert.equal((await start("A", "9876543210")).status, 400);
  assert.equal((await start("Asha Rao", "12345")).body.code, "BAD_MOBILE");
  assert.equal((await start("Asha Rao", "5876543210")).status, 400); // must start 6-9
  const a = await start("Asha Rao", "+91 98765-43210");
  assert.equal(a.status, 200);
  assert.equal(a.body.contributor.mobile, "9876543210");
  const again = await start("someone else", "09876543210");
  assert.equal(again.body.contributor.id, a.body.contributor.id);
  assert.equal(again.body.contributor.name, "Asha Rao");
});

test("pets: breed must be from the list; Other needs the breed typed; limit per person", async () => {
  const { body: { token } } = await start("Pet Maker", "9000000001");
  assert.equal((await addPet(token, "horse", "x")).body.code, "BAD_SPECIES");
  assert.equal((await addPet(token, "dog", "Not A Breed")).body.code, "BAD_BREED");
  assert.equal((await addPet(token, "cat", "Beagle")).body.code, "BAD_BREED"); // a dog breed on a cat
  assert.equal((await addPet(token, "dog", OTHER, "")).body.code, "BAD_BREED_NOTE");
  const other = await addPet(token, "dog", OTHER, "  Labra-doodle ");
  assert.equal(other.status, 201);
  assert.equal(other.body.pet.breedNote, "Labra-doodle");
  assert.equal((await addPet(token, "rabbit", "Dutch", "ignored")).body.pet.breedNote, ""); // note only kept for Other
  for (let i = 0; i < 4; i++) assert.equal((await addPet(token)).status, 201);
  assert.equal((await addPet(token)).body.code, "TOO_MANY_PETS");
});

test("a pet without photos can be corrected or removed; one with photos cannot", async () => {
  const { body: { token } } = await start("Editor", "9000000002");
  const p = (await addPet(token, "dog", "Beagle")).body.pet;
  assert.equal((await call("PATCH", `/api/pets/${p.id}`, { token, json: { species: "cat", breed: "Persian" } })).body.pet.breed, "Persian");
  await upload(token, p.id, 1, 0);
  assert.equal((await call("PATCH", `/api/pets/${p.id}`, { token, json: { species: "cat", breed: "Persian" } })).body.code, "HAS_PHOTOS");
  assert.equal((await call("DELETE", `/api/pets/${p.id}`, { token })).status, 409);
  const q = (await addPet(token)).body.pet;
  assert.equal((await call("DELETE", `/api/pets/${q.id}`, { token })).status, 200);
});

test("Part 1: 4 photos complete it, photos are served, and Part 2 unlocks exactly 7 days later", async () => {
  const { body: { token } } = await start("Photographer", "9000000003");
  const pet = (await addPet(token, "dog", "Border Collie")).body.pet;
  assert.equal(pet.part2State, "needs_part1");
  let r = await upload(token, pet.id, 1, 0, undefined, { takenAt: "2026-11-01T10:00:00Z" });
  assert.equal(r.status, 200);
  assert.equal(r.body.pet.part1Count, 1);
  assert.equal(r.body.pet.part2State, "needs_part1");
  const served = await fetch(r.body.pet.part1[0].url);
  assert.equal(served.status, 200);
  assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).format, "jpeg");
  r = await fillPart1(token, pet.id);
  assert.equal(r.body.pet.part1Count, 4);
  assert.equal(r.body.pet.part2State, "locked");
  const unlockAt = new Date(r.body.pet.part2UnlockAt).getTime();
  assert.ok(Math.abs(unlockAt - (Date.now() + 7 * 86400000)) < 60_000, "unlock is about 7 days from now");
});

test("Part 2 is refused while locked (and before Part 1), and opens after the admin unlocks it", async () => {
  const { body: { token } } = await start("Locked", "9000000004");
  const pet = (await addPet(token, "cat", "Persian")).body.pet;
  let r = await upload(token, pet.id, 2, 0);
  assert.deepEqual([r.status, r.body.code, r.body.part2State], [403, "PART2_LOCKED", "needs_part1"]);
  await fillPart1(token, pet.id);
  r = await upload(token, pet.id, 2, 0);
  assert.deepEqual([r.status, r.body.part2State], [403, "locked"]);
  assert.ok(r.body.part2UnlockAt);
  const admin = await adminToken();
  const un = await call("POST", `/api/admin/pets/${pet.id}/unlock`, { token: admin });
  assert.equal(un.body.pet.part2State, "open");
  r = await upload(token, pet.id, 2, 0);
  assert.equal(r.status, 200);
  assert.equal(r.body.pet.part2Count, 1);
});

test("Part 2 opens by itself once the 7 days have passed", async () => {
  const { body: { token } } = await start("Time Traveller", "9000000005");
  const pet = (await addPet(token, "rabbit", "Dutch")).body.pet;
  await fillPart1(token, pet.id);
  await repo.updatePet(pet.id, { part1CompletedAt: new Date(Date.now() - 8 * 86400000) });
  const r = await upload(token, pet.id, 2, 3);
  assert.equal(r.status, 200);
  assert.equal(r.body.pet.part2State, "open");
});

test("replace swaps the photo (old file deleted); remove empties the slot", async () => {
  const { body: { token } } = await start("Replacer", "9000000006");
  const pet = (await addPet(token)).body.pet;
  const first = (await upload(token, pet.id, 1, 1, await img(800, 600, { r: 255, g: 0, b: 0 }))).body.pet.part1[0].url;
  const oldFile = path.join(dir, path.basename(first));
  assert.ok(fs.existsSync(oldFile));
  const r = await upload(token, pet.id, 1, 1, await img(800, 600, { r: 0, g: 0, b: 255 }));
  assert.equal(r.body.pet.part1Count, 1);
  assert.notEqual(r.body.pet.part1[0].url, first);
  await new Promise((x) => setTimeout(x, 100));
  assert.equal(fs.existsSync(oldFile), false, "old photo removed from storage");
  const del = await call("DELETE", `/api/pets/${pet.id}/photos/1/1`, { token });
  assert.equal(del.body.pet.part1Count, 0);
});

test("bad uploads are refused with a clear reason", async () => {
  const { body: { token } } = await start("Bad Files", "9000000007");
  const pet = (await addPet(token)).body.pet;
  let r = await upload(token, pet.id, 1, 0, Buffer.from("this is not a photo at all, just text"));
  assert.deepEqual([r.status, r.body.code], [400, "BAD_IMAGE"]);
  r = await upload(token, pet.id, 1, 0, await img(120, 120));
  assert.deepEqual([r.status, r.body.code], [422, "IMAGE_TOO_SMALL"]);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(30)]);
  assert.equal((await upload(token, pet.id, 1, 0, heic)).status, 415);
  assert.equal((await call("PUT", `/api/pets/${pet.id}/photos/1/9`, { token, form: await photoForm() })).body.code, "BAD_SLOT");
  assert.equal((await call("PUT", `/api/pets/${pet.id}/photos/3/0`, { token, form: await photoForm() })).body.code, "BAD_SLOT");
  const huge = Buffer.concat([await img(), Buffer.alloc(13 * 1024 * 1024)]);
  assert.equal((await upload(token, pet.id, 1, 0, huge)).status, 413);
});

test("uploaded photos are re-encoded: location data and original size never reach storage", async () => {
  const { body: { token } } = await start("Privacy", "9000000008");
  const pet = (await addPet(token)).body.pet;
  const withGps = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#884422" } }).withExif({ IFD0: { Make: "SecretPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 58/1 0/1" } }).jpeg().toBuffer();
  assert.ok((await sharp(withGps).metadata()).exif, "test input has EXIF");
  const r = await upload(token, pet.id, 1, 0, withGps);
  const out = Buffer.from(await (await fetch(r.body.pet.part1[0].url)).arrayBuffer());
  const meta = await sharp(out).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(Math.max(meta.width, meta.height), 1600);
});

test("people can only touch their own pets; no token = 401", async () => {
  const a = (await start("Owner A", "9000000009")).body.token;
  const b = (await start("Owner B", "9000000010")).body.token;
  const pet = (await addPet(a)).body.pet;
  assert.equal((await upload(b, pet.id, 1, 0)).status, 404);
  assert.equal((await call("DELETE", `/api/pets/${pet.id}`, { token: b })).status, 404);
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("GET", "/api/me", { token: "garbage" })).status, 401);
  assert.equal((await call("GET", "/api/admin/summary", { token: a })).status, 401, "a friend token is not an admin token");
});

test("admin login: right credentials work (email not case-sensitive), wrong ones don't", async () => {
  assert.equal((await call("POST", "/api/admin/login", { json: { email: "admin@petcard.in", password: "nope" } })).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { json: { email: "other@petcard.in", password: "test-admin-password" } })).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { json: {} })).status, 401);
  const ok = await call("POST", "/api/admin/login", { json: { email: " ADMIN@petcard.in ", password: "test-admin-password" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal((await call("GET", "/api/admin/summary")).status, 401);
});

async function seedForAdmin() {
  const mk = async (name, mobile, pets) => {
    const token = (await start(name, mobile)).body.token;
    for (const [species, breed, note, p1, p2] of pets) {
      const pet = (await addPet(token, species, breed, note)).body.pet;
      for (let s = 0; s < p1; s++) await upload(token, pet.id, 1, s);
      if (p2) { await repo.updatePet(pet.id, { part1CompletedAt: new Date(Date.now() - 9 * 86400000) }); for (let s = 0; s < p2; s++) await upload(token, pet.id, 2, s); }
    }
  };
  await mk("Zoya Khan", "9111111111", [["dog", "Akita", "", 4, 4], ["cat", "Persian", "", 2, 0]]);
  await mk("Vikram Shah", "9222222222", [["dog", "Akita", "", 4, 0], ["rabbit", "Dutch", "", 0, 0]]);
  await mk("Meera Iyer", "9333333333", [["dog", OTHER, "Rottie mix", 4, 4]]);
  await mk("No Pets Nikhil", "9444444444", []);
}

test("admin: summary, pets (filter/search/sort/page), users", async () => {
  await seedForAdmin();
  const t = await adminToken();
  const sum = (await call("GET", "/api/admin/summary", { token: t })).body;
  assert.ok(sum.contributors >= 4 && sum.pets >= 5);
  assert.equal(sum.bySpecies.dog.target, 20);
  assert.ok(sum.breeds.some((b) => b.breed === "Other: Rottie mix"));

  const pets = (q) => call("GET", `/api/admin/pets?${q}`, { token: t }).then((r) => r.body);
  assert.equal((await pets("species=cat&search=zoya")).total, 1);
  assert.ok((await pets("status=complete")).items.every((r) => r.complete));
  assert.ok((await pets("status=p1_incomplete")).items.every((r) => !r.part1Complete));
  assert.ok((await pets("status=p2_open")).items.every((r) => r.part2State === "open"));
  assert.deepEqual((await pets("search=9222222222")).items.map((r) => r.owner.name), ["Vikram Shah", "Vikram Shah"]);
  assert.deepEqual((await pets("search=%2B91 92222")).items.length, 2, "partial mobile number with +91 spacing");
  assert.equal((await pets("search=rottie")).items[0].owner.name, "Meera Iyer");
  assert.equal((await pets("breed=Akita")).items.every((r) => r.breed === "Akita"), true);
  assert.equal((await pets("species=elephant")).total, (await pets("")).total, "unknown filter values are ignored");
  const p1 = await pets("limit=2&page=1&sort=owner");
  assert.equal(p1.items.length, 2);
  assert.ok(p1.pages >= 2);
  const sorted = (await pets("limit=100&sort=owner")).items.map((r) => r.owner.name);
  assert.deepEqual(sorted, [...sorted].sort((a, b) => a.localeCompare(b)));

  const users = (q) => call("GET", `/api/admin/users?${q}`, { token: t }).then((r) => r.body);
  const all = await users("limit=100");
  assert.ok(all.items.some((u) => u.name === "No Pets Nikhil" && u.petCount === 0));
  const noPets = (await users("status=no_pets&limit=100")).items;
  assert.ok(noPets.some((u) => u.name === "No Pets Nikhil") && noPets.every((u) => u.petCount === 0));
  assert.deepEqual((await users("status=all_complete")).items.map((u) => u.name), ["Meera Iyer"]);
  assert.ok((await users("search=persian")).items.some((u) => u.name === "Zoya Khan"));
  const zoya = all.items.find((u) => u.name === "Zoya Khan");
  assert.equal(zoya.petCount, 2);
  assert.equal(zoya.part2Done, 1);
});

test("admin: pet detail shows labelled slots with both parts", async () => {
  const t = await adminToken();
  const list = (await call("GET", "/api/admin/pets?status=complete&limit=1", { token: t })).body.items[0];
  const d = (await call("GET", `/api/admin/pets/${list.id}`, { token: t })).body.pet;
  assert.equal(d.part1.length, 4);
  assert.equal(d.part2.length, 4);
  assert.equal(d.part1[0].label, "Front face");
  assert.ok(d.part1.every((s) => s.photo?.url) && d.part2.every((s) => s.photo?.url));
  assert.equal((await call("GET", "/api/admin/pets/doesnotexist", { token: t })).status, 404);
});

test("export ZIP: expected folders/files, manifest, only complete pets by default; link token rules", async () => {
  const t = await adminToken();
  const link = (await call("POST", "/api/admin/export-link", { token: t, json: {} })).body;
  assert.match(link.path, /^\/api\/admin\/export\.zip\?token=/);
  const res = await fetch(base + link.path);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition"), /attachment; filename="petcard_identity_eval_\d{4}-\d{2}-\d{2}\.zip"/);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes("manifest.csv") && names.includes("README.txt"));
  const dogs = names.filter((n) => n.startsWith("identity_eval_dog/"));
  assert.ok(dogs.includes("identity_eval_dog/dog01_akita/01_front.jpg"));
  assert.ok(dogs.includes("identity_eval_dog/dog01_akita/08_scan.jpg"));
  assert.ok(dogs.includes("identity_eval_dog/dog02_rottie-mix/05_scan.jpg"), "Other breed uses the typed breed in the folder name");
  assert.equal(dogs.filter((n) => n.includes("dog01_akita/")).length, 8);
  assert.ok(!names.some((n) => n.startsWith("identity_eval_cat/")), "incomplete pets are left out by default");
  assert.ok(zip.getEntries().filter((e) => e.entryName.endsWith(".jpg")).every((e) => e.getData().length > 1000));
  const manifest = zip.readAsText("manifest.csv");
  assert.match(manifest, /Zoya Khan/);
  assert.match(manifest, /9111111111/);

  const all = new AdmZip(Buffer.from(await (await fetch(base + (await call("POST", "/api/admin/export-link", { token: t, json: { onlyComplete: false } })).body.path)).arrayBuffer()));
  assert.ok(all.getEntries().some((e) => e.entryName.startsWith("identity_eval_cat/")), "onlyComplete:false includes partial pets");

  assert.equal((await fetch(base + "/api/admin/export.zip")).status, 401);
  assert.equal((await fetch(base + `/api/admin/export.zip?token=${t}`)).status, 401, "an admin login token is not a download token");
  const exportToken = new URL(base + link.path).searchParams.get("token");
  assert.equal((await call("GET", "/api/admin/summary", { token: exportToken })).status, 401, "a download token opens nothing else");
});

test("CORS: only the configured frontend origin is allowed", async () => {
  const ok = await fetch(base + "/api/config", { headers: { Origin: "http://localhost:3000" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const bad = await fetch(base + "/api/config", { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("config refuses to start without secrets", () => {
  assert.throws(() => loadConfig({ JWT_SECRET: "short", ADMIN_EMAIL: "a@b.c", ADMIN_PASSWORD: "x" }), /24/);
  assert.throws(() => loadConfig({ JWT_SECRET: "t".repeat(30), ADMIN_EMAIL: "a@b.c" }), /ADMIN_PASSWORD/);
});

test("every breed in the list is unique per species", () => {
  for (const [s, list] of Object.entries(BREEDS)) assert.equal(new Set(list.map((b) => b.toLowerCase())).size, list.length, s);
});
