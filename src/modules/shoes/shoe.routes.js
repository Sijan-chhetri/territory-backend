import { Router } from "express";
import multer from "multer";

import {
  createShoe,
  listShoes,
  getShoe,
  updateShoe,
  setDefaultShoe,
  retireShoe,
  activateShoe,
  getShoeActivities,
  reconcileShoes,
} from "./shoe.controller.js";

// ======================================================
// SHOE IMAGE UPLOAD
// ======================================================

const uploadShoe = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ];

    if (!allowedTypes.includes(file.mimetype.toLowerCase())) {
      return cb(
        new Error("Please upload a JPG, JPEG, PNG, WebP, HEIC or HEIF image."),
      );
    }

    cb(null, true);
  },
});

const shoeUpload = (req, res, next) => {
  uploadShoe.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next();
  });
};

// ======================================================
// SHOE ROUTES
// ======================================================

export function createShoeRoutes(authMiddleware) {
  if (typeof authMiddleware !== "function") {
    throw new Error("Shoe routes require DURO auth middleware");
  }

  const router = Router();

  // All endpoints require authentication
  router.use(authMiddleware);

  // Create and list
  router.post("/", shoeUpload, createShoe);
  router.get("/", listShoes);

  // Recalculate statistics
  router.post("/reconcile", reconcileShoes);

  // Individual shoe
  router.get("/:id", getShoe);
  router.patch("/:id", shoeUpload, updateShoe);

  // Shoe status
  router.patch("/:id/default", setDefaultShoe);
  router.patch("/:id/retire", retireShoe);
  router.patch("/:id/activate", activateShoe);

  // Shoe history
  router.get("/:id/activities", getShoeActivities);

  return router;
}
