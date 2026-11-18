import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { ApiError } from "./errors.js";

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
/** Constant-time comparison (no timing leak of how many characters matched). */
export const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

export function makeAuth(config) {
  const sign = (payload, expiresIn) => jwt.sign(payload, config.jwtSecret, { algorithm: "HS256", expiresIn });
  const verify = (token, role) => {
    try {
      const p = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
      return p.role === role ? p : null;
    } catch {
      return null;
    }
  };
  const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  return {
    signFriend: (contributorId) => sign({ role: "friend", sub: String(contributorId) }, "60d"),
    signAdmin: () => sign({ role: "admin" }, "12h"),
    signExport: (opts) => sign({ role: "export", ...opts }, "2m"),
    verifyExport: (t) => verify(t, "export"),
    friend(req, _res, next) {
      const p = verify(bearer(req), "friend");
      if (!p) return next(new ApiError(401, "Please enter your details again.", "UNAUTHENTICATED"));
      req.contributorId = p.sub;
      next();
    },
    admin(req, _res, next) {
      if (!verify(bearer(req), "admin")) return next(new ApiError(401, "Admin login required.", "UNAUTHENTICATED"));
      next();
    },
  };
}
