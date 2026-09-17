// middleware/clanImageUpload.js

import multer from "multer";

const storage = multer.memoryStorage();

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

const fileFilter = (
  req,
  file,
  callback
) => {
  if (
    !allowedMimeTypes.includes(
      file.mimetype
    )
  ) {
    return callback(
      new Error(
        "Only JPG, PNG, WEBP and HEIC images are allowed"
      ),
      false
    );
  }

  callback(null, true);
};

export const uploadClanImage = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },

  fileFilter,
});