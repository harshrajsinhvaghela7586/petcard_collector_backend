import { diskStorage } from "./disk.js";
import { cloudinaryStorage } from "./cloudinary.js";

export const makeStorage = (config) =>
  config.storageDriver === "disk"
    ? diskStorage({ dir: config.uploadDir, publicUrl: config.publicUrl })
    : cloudinaryStorage(config.cloudinary);
