import { TARGETS } from "./breeds.js";

/** Reads and validates env. Nothing secret has a default: a missing secret stops the server instead of running open. */
export function loadConfig(e = process.env) {
  const must = (k) => {
    if (!e[k]) throw new Error(`${k} is required (see .env.example)`);
    return e[k];
  };
  const int = (k, d, min, max) => {
    const n = e[k] === undefined || e[k] === "" ? d : Number(e[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${k} must be an integer between ${min} and ${max}`);
    return n;
  };
  const jwtSecret = must("JWT_SECRET");
  if (jwtSecret.length < 24) throw new Error("JWT_SECRET must be at least 24 characters");
  const storageDriver = (e.STORAGE_DRIVER || "cloudinary").toLowerCase();
  if (!["cloudinary", "disk"].includes(storageDriver)) throw new Error("STORAGE_DRIVER must be cloudinary or disk");
  const port = int("PORT", 4000, 1, 65535);
  return {
    nodeEnv: e.NODE_ENV || "development",
    port,
    mongoUri: e.MONGODB_URI || "",
    jwtSecret,
    adminEmail: must("ADMIN_EMAIL").trim().toLowerCase(),
    adminPassword: must("ADMIN_PASSWORD"),
    corsOrigins: (e.CORS_ORIGIN || "http://localhost:3000").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
    storageDriver,
    cloudinary: { cloudName: e.CLOUDINARY_CLOUD_NAME || "", apiKey: e.CLOUDINARY_API_KEY || "", apiSecret: e.CLOUDINARY_API_SECRET || "", url: e.CLOUDINARY_URL || "" },
    uploadDir: e.UPLOAD_DIR || "./uploads",
    publicUrl: (e.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    part2DelayDays: int("PART2_DELAY_DAYS", 7, 0, 60),
    maxPetsPerPerson: int("MAX_PETS_PER_PERSON", 6, 1, 20),
    targets: TARGETS,
  };
}
