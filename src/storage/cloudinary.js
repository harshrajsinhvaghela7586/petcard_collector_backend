import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary storage. Photos get an unguessable random id, so a link only works for someone who was given it
 * (admin page and the person's own page). Thumbnails are made by Cloudinary on the fly.
 */
export function cloudinaryStorage(cfg) {
  if (cfg.url) cloudinary.config({ secure: true });
  else cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret, secure: true });
  if (!cfg.url && !(cfg.cloudName && cfg.apiKey && cfg.apiSecret)) {
    throw new Error("Cloudinary is not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET");
  }
  return {
    driver: "cloudinary",
    put(buffer) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "petcard-collect", public_id: crypto.randomBytes(16).toString("hex"), resource_type: "image", overwrite: false },
          (err, res) => (err ? reject(err) : resolve({ publicId: res.public_id, url: res.secure_url }))
        );
        stream.end(buffer);
      });
    },
    async remove(publicId) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
    },
    async read(photo) {
      const res = await fetch(photo.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`could not download photo (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    thumbUrl: (photo) => photo.url.replace("/upload/", "/upload/c_limit,w_480,q_auto/"),
  };
}
