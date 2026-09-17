import multer from "multer";
import path from "path";

const storage = multer.memoryStorage();

const allowedMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

const allowedExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
];

const fileFilter = (
  req,
  file,
  callback
) => {
  console.log(
    "CLAN_IMAGE_UPLOAD:",
    {
      filename: file.originalname,
      mimetype: file.mimetype,
    }
  );

  const extension = path
    .extname(file.originalname)
    .toLowerCase();

  const validMime =
    allowedMimeTypes.includes(
      file.mimetype
    );

  const validExtension =
    allowedExtensions.includes(
      extension
    );

  /**
   * Some mobile clients send valid
   * images as application/octet-stream.
   *
   * In that case allow it only when the
   * file extension is an accepted image.
   */
  const isOctetStreamImage =
    file.mimetype ===
      "application/octet-stream" &&
    validExtension;

  if (
    (!validMime ||
      !validExtension) &&
    !isOctetStreamImage
  ) {
    return callback(
      new Error(
        "Only JPG, JPEG, PNG, WEBP, HEIC and HEIF images are allowed"
      )
    );
  }

  callback(null, true);
};

export const uploadClanImage =
  multer({
    storage,

    limits: {
      fileSize:
        5 * 1024 * 1024,
    },

    fileFilter,
  });