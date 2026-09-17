// services/s3.js

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import crypto from "crypto";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,

  region:
    process.env.S3_REGION ||
    "us-east-1",

  credentials: {
    accessKeyId:
      process.env.S3_ACCESS_KEY,

    secretAccessKey:
      process.env.S3_SECRET_KEY,
  },

  // Usually needed for S3-compatible providers.
  forcePathStyle: true,
});

const bucketName =
  process.env.S3_BUCKET_NAME;

const getExtension = (mimeType) => {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    case "image/heic":
      return "heic";

    default:
      return "jpg";
  }
};

export const uploadClanImageToS3 =
  async (file) => {
    if (!file) return null;

    const extension =
      getExtension(file.mimetype);

    const key =
      `clans/images/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );

    const endpoint =
      process.env.S3_ENDPOINT.replace(
        /\/$/,
        ""
      );

    const imageUrl =
      `${endpoint}/${bucketName}/${key}`;

    return {
      key,
      url: imageUrl,
    };
  };

export const deleteClanImageFromS3 =
  async (key) => {
    if (!key) return;

    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );
    } catch (error) {
      console.error(
        "DELETE_CLAN_IMAGE_ERROR:",
        error
      );
    }
  };