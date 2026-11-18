import sharp from "sharp";
import { ApiError } from "./errors.js";

const MIN_SIDE = 300;
const MAX_SIDE = 1600;

function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") return "heic";
  return null;
}

/**
 * Real image check (not the client's claimed type), upright, max 1600 px, re-encoded as JPEG.
 * Re-encoding drops all metadata, so GPS location and device info never reach storage.
 */
export async function normalizePhoto(buffer) {
  const kind = sniff(buffer);
  if (kind === "heic") throw new ApiError(415, "This photo format is not supported. Please choose a JPEG or PNG photo.", "BAD_IMAGE");
  if (!kind) throw new ApiError(400, "That file is not a photo. Please choose a JPEG, PNG or WebP image.", "BAD_IMAGE");
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (Math.min(info.width, info.height) < MIN_SIDE) {
      throw new ApiError(422, `This photo is too small. Please use a photo at least ${MIN_SIDE} pixels wide.`, "IMAGE_TOO_SMALL");
    }
    return { buffer: data, width: info.width, height: info.height, bytes: data.length };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "This photo could not be read. Please try another one.", "BAD_IMAGE");
  }
}
