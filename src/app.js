import express from "express";
import "express-async-errors"; // express 4 would otherwise hang on errors thrown inside async handlers
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { ApiError } from "./errors.js";
import { makeAuth } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";

export function createApp({ config, repo, storage, rateLimiting = true }) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin(origin, cb) {
        // no Origin header = curl / server-side; browsers must come from the configured frontend(s)
        if (!origin || config.corsOrigins.includes(origin.replace(/\/+$/, ""))) return cb(null, true);
        cb(null, false);
      },
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: "50kb" }));

  const limit = (windowMs, max, message, extra = {}) =>
    rateLimiting ? rateLimit({ windowMs, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: message, code: "RATE_LIMITED" }, ...extra }) : (_q, _s, n) => n();
  const limiters = {
    start: limit(15 * 60_000, 40, "Too many attempts. Please wait a few minutes."),
    upload: limit(15 * 60_000, 200, "Too many uploads. Please wait a few minutes."),
    login: limit(15 * 60_000, 10, "Too many login attempts. Please wait 15 minutes.", { skipSuccessfulRequests: true }),
  };
  const auth = makeAuth(config);

  app.get("/health", (_req, res) => res.json({ ok: true }));
  if (storage.driver === "disk") app.use("/files", express.static(storage.root, { index: false, maxAge: "1d" }));

  app.use("/api/admin", adminRoutes({ repo, storage, auth, config, limiters }));
  app.use("/api", publicRoutes({ repo, storage, auth, config, limiters }));

  app.use((_req, _res, next) => next(new ApiError(404, "Not found.", "NOT_FOUND")));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    if (err instanceof multer.MulterError) {
      return err.code === "LIMIT_FILE_SIZE"
        ? res.status(413).json({ error: "That photo is too large (max 12 MB).", code: "TOO_LARGE" })
        : res.status(400).json({ error: "Upload problem. Please try again.", code: "UPLOAD_ERROR" });
    }
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Bad request.", code: "BAD_JSON" });
    console.error("unhandled error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again.", code: "SERVER_ERROR" });
  });
  return app;
}
