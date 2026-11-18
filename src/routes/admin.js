import express from "express";
import archiver from "archiver";
import { ApiError } from "../errors.js";
import { safeEqual } from "../auth.js";
import { SPECIES } from "../breeds.js";
import { buildRows, queryPets, queryUsers, buildSummary, adminPetDetail, planExport, manifestCsv, EXPORT_README, PET_STATUSES } from "../services/admin.js";

export function adminRoutes({ repo, storage, auth, config, limiters }) {
  const r = express.Router();

  r.post("/login", limiters.login, (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    // both comparisons always run: the reply never reveals which one was wrong
    const ok = Number(safeEqual(email, config.adminEmail)) & Number(safeEqual(password, config.adminPassword));
    if (!ok) throw new ApiError(401, "Wrong email or password.", "BAD_LOGIN");
    res.json({ token: auth.signAdmin(), email: config.adminEmail });
  });

  /* The ZIP is downloaded by the browser (a plain link can't send headers), so it uses a 2-minute single-purpose token. */
  r.get("/export.zip", async (req, res) => {
    const payload = auth.verifyExport(String(req.query.token ?? ""));
    if (!payload) throw new ApiError(401, "This download link expired. Click Download again.", "BAD_EXPORT_TOKEN");
    const now = new Date();
    const [pets, contributors] = await Promise.all([repo.listPets(), repo.listContributors()]);
    const entries = planExport({ pets, contributors, onlyComplete: payload.onlyComplete !== false, config, now });
    if (!entries.length) throw new ApiError(404, payload.onlyComplete !== false ? "No pet has all 8 photos yet." : "No photos yet.", "NOTHING_TO_EXPORT");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="petcard_identity_eval_${now.toISOString().slice(0, 10)}.zip"`);
    const archive = archiver("zip", { zlib: { level: 1 } }); // JPEGs do not compress further
    archive.on("error", () => res.destroy());
    archive.pipe(res);
    const missing = [];
    for (const e of entries) {
      for (const f of e.files) {
        try {
          archive.append(await storage.read(f.photo), { name: f.path });
        } catch (err) {
          missing.push(`${f.path}  (${err.message})`);
        }
      }
    }
    archive.append(manifestCsv(entries), { name: "manifest.csv" });
    archive.append(EXPORT_README, { name: "README.txt" });
    if (missing.length) archive.append(`These photos could not be downloaded and are NOT in the ZIP:\n${missing.join("\n")}\n`, { name: "MISSING_FILES.txt" });
    await archive.finalize();
  });

  r.use(auth.admin);

  const load = async () => {
    const [pets, contributors] = await Promise.all([repo.listPets(), repo.listContributors()]);
    const rows = buildRows({ pets, contributors, storage, config, now: new Date() });
    return { pets, contributors, rows };
  };
  const clean = (q) => ({
    ...q,
    species: SPECIES.includes(q.species) ? q.species : "",
    status: PET_STATUSES.includes(q.status) || ["no_pets", "has_incomplete", "all_complete"].includes(q.status) ? q.status : "",
    search: String(q.search ?? "").slice(0, 80),
  });

  r.get("/summary", async (_req, res) => {
    const { contributors, rows } = await load();
    res.json(buildSummary({ contributors, rows, config }));
  });

  r.get("/pets", async (req, res) => {
    const { rows } = await load();
    res.json(queryPets(rows, clean(req.query)));
  });

  r.get("/users", async (req, res) => {
    const { contributors, rows } = await load();
    res.json(queryUsers(contributors, rows, clean(req.query)));
  });

  r.get("/pets/:id", async (req, res) => {
    const pet = await repo.getPet(req.params.id);
    if (!pet) throw new ApiError(404, "Pet not found.", "NOT_FOUND");
    const owner = (await repo.getContributor(pet.contributorId)) || { id: pet.contributorId, name: "(unknown)", mobile: "" };
    res.json({ pet: adminPetDetail({ pet, owner, storage, config, now: new Date() }) });
  });

  r.post("/pets/:id/unlock", async (req, res) => {
    const pet = await repo.getPet(req.params.id);
    if (!pet) throw new ApiError(404, "Pet not found.", "NOT_FOUND");
    await repo.updatePet(pet.id, { adminUnlocked: true });
    const owner = await repo.getContributor(pet.contributorId);
    res.json({ pet: adminPetDetail({ pet: await repo.getPet(pet.id), owner, storage, config, now: new Date() }) });
  });

  r.post("/export-link", (req, res) => {
    const onlyComplete = req.body?.onlyComplete !== false;
    res.json({ path: `/api/admin/export.zip?token=${encodeURIComponent(auth.signExport({ onlyComplete }))}`, expiresInSeconds: 120 });
  });

  return r;
}
