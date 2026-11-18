import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/** Local-folder storage for development/tests (no Cloudinary keys needed). Files are served by the app under /files. */
export function diskStorage({ dir, publicUrl }) {
  const root = path.resolve(dir);
  const file = (id) => path.join(root, path.basename(id)); // basename: an id can never escape the folder
  return {
    driver: "disk",
    root,
    async put(buffer) {
      await fs.mkdir(root, { recursive: true });
      const id = `${crypto.randomBytes(16).toString("hex")}.jpg`;
      await fs.writeFile(file(id), buffer);
      return { publicId: id, url: `${publicUrl}/files/${id}` };
    },
    async remove(publicId) {
      await fs.rm(file(publicId), { force: true });
    },
    async read(photo) {
      return fs.readFile(file(photo.publicId));
    },
    thumbUrl: (photo) => photo.url,
  };
}
