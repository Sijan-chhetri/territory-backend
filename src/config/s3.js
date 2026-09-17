// src/config/s3.js

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import crypto from "crypto";
import path from "path";

// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

const endpoint = process.env.S3_ENDPOINT;
const region =
  process.env.S3_REGION || "us-east-1";

const accessKey =
  process.env.S3_ACCESS_KEY;

const secretKey =
  process.env.S3_SECRET_KEY;

const bucketName =
  process.env.S3_BUCKET_NAME;

// ======================================================
// VALIDATE CONFIG
// ======================================================

console.log("S3 CONFIG CHECK:", {
  endpoint,
  region,
  bucketName,
  accessKeyExists: !!accessKey,
  secretKeyExists: !!secretKey,
});

if (!endpoint) {
  throw new Error(
    "Missing S3_ENDPOINT environment variable"
  );
}

if (!bucketName) {
  throw new Error(
    "Missing S3_BUCKET_NAME environment variable"
  );
}

if (!accessKey) {
  throw new Error(
    "Missing S3_ACCESS_KEY environment variable"
  );
}

if (!secretKey) {
  throw new Error(
    "Missing S3_SECRET_KEY environment variable"
  );
}

// ======================================================
// S3 CLIENT
// ======================================================

const s3 = new S3Client({
  endpoint,

  region,

  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  },

  // Required by many S3-compatible providers
  forcePathStyle: true,
});

// ======================================================
// FILE HELPERS
// ======================================================

const getExtension = (file) => {
  // First try MIME type
  switch (file.mimetype) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    case "image/heic":
      return "heic";

    case "image/heif":
      return "heif";
  }

  // Flutter may send application/octet-stream.
  // In that case use the original filename.
  const extension = path
    .extname(file.originalname || "")
    .replace(".", "")
    .toLowerCase();

  const allowedExtensions = [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "heic",
    "heif",
  ];

  if (allowedExtensions.includes(extension)) {
    return extension;
  }

  return "jpg";
};

const getContentType = (file, extension) => {
  // If Flutter sent a real image MIME type,
  // use it directly.
  if (
    file.mimetype &&
    file.mimetype.startsWith("image/")
  ) {
    return file.mimetype;
  }

  // Flutter currently appears to send
  // application/octet-stream, so infer it.
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";

    case "png":
      return "image/png";

    case "webp":
      return "image/webp";

    case "heic":
      return "image/heic";

    case "heif":
      return "image/heif";

    default:
      return "image/jpeg";
  }
};

// ======================================================
// UPLOAD CLAN IMAGE
// ======================================================

export const uploadClanImageToS3 =
  async (file) => {
    if (!file) {
      return null;
    }

    const extension =
      getExtension(file);

    const contentType =
      getContentType(
        file,
        extension
      );

    const key =
      `clans/images/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    console.log("S3 UPLOAD:", {
      bucket: bucketName,
      key,
      originalName: file.originalname,
      incomingMimeType: file.mimetype,
      storedContentType: contentType,
      size: file.size,
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
      })
    );

    const cleanEndpoint =
      endpoint.replace(/\/$/, "");

    const imageUrl =
      `${cleanEndpoint}/${bucketName}/${key}`;

    console.log(
      "CLAN_IMAGE_UPLOADED:",
      imageUrl
    );

    return {
      key,
      url: imageUrl,
    };
  };

// ======================================================
// DELETE CLAN IMAGE
// ======================================================

export const deleteClanImageFromS3 =
  async (key) => {
    if (!key) {
      return;
    }

    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );

      console.log(
        "CLAN_IMAGE_DELETED:",
        key
      );
    } catch (error) {
      console.error(
        "DELETE_CLAN_IMAGE_ERROR:",
        error
      );
    }
  };