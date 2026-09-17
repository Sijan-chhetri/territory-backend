// services/s3.js

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import crypto from "crypto";

const s3 = new S3Client({
  region: process.env.AWS_REGION,

  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucketName =
  process.env.AWS_S3_BUCKET_NAME;

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

export const uploadClanImageToS3 = async (
  file
) => {
  if (!file) {
    return null;
  }

  const extension = getExtension(
    file.mimetype
  );

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

  let imageUrl;

  if (process.env.AWS_PUBLIC_BASE_URL) {
    const baseUrl =
      process.env.AWS_PUBLIC_BASE_URL.replace(
        /\/$/,
        ""
      );

    imageUrl = `${baseUrl}/${key}`;
  } else {
    imageUrl =
      `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }

  return {
    key,
    url: imageUrl,
  };
};

export const deleteClanImageFromS3 = async (
  key
) => {
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
  } catch (error) {
    console.error(
      "DELETE_CLAN_IMAGE_S3_ERROR:",
      error
    );
  }
};