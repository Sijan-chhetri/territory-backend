import prisma from "../../config/prisma.js";
import { refreshShoeStats } from "./shoe.service.js";
import {
  uploadShoeImageToS3,
  deleteShoeImageFromS3,
  getShoeImageKeyFromUrl,
} from "../../config/s3.js";

const fail = (res, error) => {
  console.error("SHOE_API_ERROR:", error);

  const status = error.status || 500;

  let message = error.message || "Something went wrong. Please try again.";

  if (status === 500) {
    message = "We couldn't complete your request right now. Please try again.";
  }

  return res.status(status).json({
    success: false,
    message,
  });
};

const bad = (message, field = null) => {
  const error = new Error(message);
  error.status = 400;
  error.field = field;
  throw error;
};

const notFound = () => {
  const error = new Error(
    "We couldn't find this shoe. It may have been removed.",
  );
  error.status = 404;
  throw error;
};

const finiteNonnegative = (value, key) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    const messages = {
      initialKm: "Please enter a valid starting distance (0 km or more).",
      targetKm: "Please enter a valid mileage goal (0 km or more).",
    };

    bad(messages[key] || "Please enter a valid distance.", key);
  }

  return number;
};

const validatePurchasePrice = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const price = String(value).trim();

  if (
    !/^\d+(\.\d{1,2})?$/.test(price) ||
    !Number.isFinite(Number(price)) ||
    Number(price) > 9999999999.99
  ) {
    bad(
      "Please enter a valid shoe price (0 or more, up to 2 decimal places).",
      "purchasePrice",
    );
  }

  return Number(price).toFixed(2);
};

const validateCurrency = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) {
    bad("Please select a valid currency.", "currency");
  }

  const currency = value.trim().toUpperCase();

  const supportedCurrencies = [
    "NPR",
    "USD",
    "AUD",
    "INR",
    "EUR",
    "GBP",
    "CAD",
    "JPY",
    "AED",
    "SGD",
    "CHF",
    "NZD",
  ];

  if (!supportedCurrencies.includes(currency)) {
    bad("This currency is not supported yet.", "currency");
  }

  return currency;
};

const validatePurchaseDetails = (price, currency) => {
  if ((price === null) !== (currency === null)) {
    bad(
      "Please provide both shoe price and currency, or leave both empty.",
      "purchasePrice",
    );
  }
};

const getOwned = async (userId, id) => {
  const shoe = await prisma.runningShoe.findFirst({ where: { id, userId } });
  if (!shoe) notFound();
  return shoe;
};
const ensureUser = (req) => {
  const userId = owner(req);
  if (!userId) {
    const e = new Error("Unauthorized");
    e.status = 401;
    throw e;
  }
  return userId;
};
const owner = (req) => req.user?.id;
const serialize = (shoe) => {
  const lifetimeKm = (shoe.initialKm ?? 0) + (shoe.totalKm ?? 0);

  const purchasePrice =
    shoe.purchasePrice == null ? null : Number(shoe.purchasePrice);

  const costPerKm =
    purchasePrice !== null && lifetimeKm > 0
      ? Number((purchasePrice / lifetimeKm).toFixed(2))
      : null;

  return {
    ...shoe,
    purchasePrice:
      shoe.purchasePrice == null ? null : shoe.purchasePrice.toString(),
    currency: shoe.currency ?? null,
    lifetimeKm,
    costPerKm,
  };
};

export async function createShoe(req, res) {
  let uploadedImage = null;

  try {
    const userId = ensureUser(req);

    const {
      brand,
      model,
      color = "#e8ff63",
      inUseSince = null,
      initialKm = null,
      targetKm = null,
      purchasePrice = null,
      currency = null,
      isDefault = false,
    } = req.body ?? {};

    // Validate shoe brand
    if (typeof brand !== "string" || !brand.trim()) {
      bad("Please enter your shoe brand.", "brand");
    }

    if (brand.trim().length > 100) {
      bad("Shoe brand is too long. Please shorten it.", "brand");
    }

    // Validate shoe model
    if (typeof model !== "string" || !model.trim()) {
      bad("Please enter your shoe model.", "model");
    }

    if (model.trim().length > 100) {
      bad("Shoe model is too long. Please shorten it.", "model");
    }

    // Validate default shoe
    if (![true, false, "true", "false"].includes(isDefault)) {
      bad("Please choose a valid default shoe option.", "isDefault");
    }

    if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      bad("Please choose a valid shoe color.", "color");
    }

    const defaultFlag = isDefault === true || isDefault === "true";

    // Validate numeric inputs BEFORE uploading the image
    const parsedInitialKm = finiteNonnegative(initialKm, "initialKm");

    const parsedTargetKm = finiteNonnegative(targetKm, "targetKm");

    const parsedPurchasePrice = validatePurchasePrice(purchasePrice);
    const parsedCurrency = validateCurrency(currency);

    validatePurchaseDetails(parsedPurchasePrice, parsedCurrency);

    const parsedInUseSince =
      inUseSince === null || inUseSince === "" ? null : new Date(inUseSince);

    if (parsedInUseSince !== null && Number.isNaN(parsedInUseSince.getTime())) {
      bad(
        "Please choose a valid date for when you started using this shoe.",
        "inUseSince",
      );
    }

    if (parsedInUseSince !== null && parsedInUseSince.getTime() > Date.now()) {
      bad("The start date can't be in the future.", "inUseSince");
    }

    // Upload optional image to S3
    if (req.file) {
      uploadedImage = await uploadShoeImageToS3(req.file);
    }

    const data = {
      userId,
      brand: brand.trim(),
      model: model.trim(),
      photoUrl: uploadedImage?.url ?? null,
      color: color.toUpperCase(),
      inUseSince: parsedInUseSince,
      initialKm: parsedInitialKm,
      targetKm: parsedTargetKm,
      purchasePrice: parsedPurchasePrice,
      currency: parsedCurrency,
    };

    const shoe = await prisma.$transaction(
      async (tx) => {
        // Lock user's row to serialize default-shoe selection
        await tx.$queryRaw`
        SELECT id
        FROM users
        WHERE id = ${userId}
        FOR UPDATE
      `;

        const count = await tx.runningShoe.count({
          where: { userId },
        });

        const makeDefault = defaultFlag || count === 0;

        if (makeDefault) {
          await tx.runningShoe.updateMany({
            where: {
              userId,
              isDefault: true,
            },
            data: {
              isDefault: false,
            },
          });
        }

        return tx.runningShoe.create({
          data: {
            ...data,
            isDefault: makeDefault,
          },
        });
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    return res.status(201).json({
      success: true,
      message: "Your shoe has been added!",
      shoe: serialize(shoe),
    });
  } catch (error) {
    // If database creation fails, clean up the newly uploaded S3 image
    if (uploadedImage?.key) {
      try {
        await deleteShoeImageFromS3(uploadedImage.key);
      } catch (cleanupError) {
        console.error("SHOE_IMAGE_CLEANUP_ERROR:", cleanupError);
      }
    }

    return fail(res, error);
  }
}

export async function listShoes(req, res) {
  try {
    const userId = ensureUser(req);
    const shoes = await prisma.runningShoe.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return res.json({ success: true, shoes: shoes.map(serialize) });
  } catch (e) {
    return fail(res, e);
  }
}

export async function getShoe(req, res) {
  try {
    const userId = ensureUser(req);
    const shoe = await getOwned(userId, req.params.id);
    return res.json({ success: true, shoe: serialize(shoe) });
  } catch (e) {
    return fail(res, e);
  }
}

export async function updateShoe(req, res) {
  try {
    const userId = ensureUser(req);
    const shoe = await getOwned(userId, req.params.id);
    const input = req.body ?? {};
    const data = {};

    if (Object.hasOwn(input, "color")) {
      if (
        typeof input.color !== "string" ||
        !/^#[0-9A-Fa-f]{6}$/.test(input.color)
      ) {
        bad("Please choose a valid shoe color.", "color");
      }

      data.color = input.color.toUpperCase();
    }

    for (const key of ["brand", "model"]) {
      if (Object.hasOwn(input, key)) {
        const value = input[key];

        if (typeof value !== "string" || !value.trim()) {
          bad(
            key === "brand"
              ? "Please enter your shoe brand."
              : "Please enter your shoe model.",
            key,
          );
        }

        if (value.trim().length > 100) {
          bad(
            key === "brand"
              ? "Shoe brand is too long. Please shorten it."
              : "Shoe model is too long. Please shorten it.",
            key,
          );
        }

        data[key] = value.trim();
      }
    }
    for (const k of ["initialKm", "targetKm"]) {
      if (Object.hasOwn(input, k)) {
        data[k] = finiteNonnegative(input[k], k);
      }
    }

    // Update optional shoe purchase details.
    if (
      Object.hasOwn(input, "purchasePrice") ||
      Object.hasOwn(input, "currency")
    ) {
      const parsedPurchasePrice = Object.hasOwn(input, "purchasePrice")
        ? validatePurchasePrice(input.purchasePrice)
        : shoe.purchasePrice == null
          ? null
          : shoe.purchasePrice.toString();

      const parsedCurrency = Object.hasOwn(input, "currency")
        ? validateCurrency(input.currency)
        : (shoe.currency ?? null);

      validatePurchaseDetails(parsedPurchasePrice, parsedCurrency);

      data.purchasePrice = parsedPurchasePrice;
      data.currency = parsedCurrency;
    }

    // ======================================================
    // UPDATE SHOE IN USE SINCE DATE
    // ======================================================

    if (Object.hasOwn(input, "inUseSince")) {
      const value = input.inUseSince;

      const parsed = value === null || value === "" ? null : new Date(value);

      if (parsed !== null && Number.isNaN(parsed.getTime())) {
        bad("Please choose a valid start date.", "inUseSince");
      }

      if (parsed !== null && parsed.getTime() > Date.now()) {
        bad("The start date can't be in the future.", "inUseSince");
      }

      data.inUseSince = parsed;
    }

    // Counters, status, and default status cannot be edited here.
    if (!Object.keys(data).length && !req.file) {
      bad("Please make at least one change before saving.");
    }

    let uploadedImage = null;

    try {
      // Upload the new photo before updating the shoe.
      if (req.file) {
        uploadedImage = await uploadShoeImageToS3(req.file);
        data.photoUrl = uploadedImage.url;
      }

      // Restrict the update to this authenticated user's shoe.
      const result = await prisma.runningShoe.updateMany({
        where: {
          id: req.params.id,
          userId,
        },
        data,
      });

      if (result.count === 0) {
        notFound();
      }

      const updatedShoe = await getOwned(userId, req.params.id);

      // Remove previous image only after the database update succeeds.
      if (uploadedImage && shoe.photoUrl) {
        const oldKey = getShoeImageKeyFromUrl(shoe.photoUrl);

        if (oldKey) {
          try {
            await deleteShoeImageFromS3(oldKey);
          } catch (cleanupError) {
            console.error("OLD_SHOE_IMAGE_DELETE_ERROR:", cleanupError);
          }
        }
      }

      return res.json({
        success: true,
        message: "Your shoe details have been updated!",
        shoe: serialize(updatedShoe),
      });
    } catch (error) {
      // Remove newly uploaded image if database update fails.
      if (uploadedImage?.key) {
        try {
          await deleteShoeImageFromS3(uploadedImage.key);
        } catch (cleanupError) {
          console.error("SHOE_IMAGE_CLEANUP_ERROR:", cleanupError);
        }
      }

      throw error;
    }
  } catch (e) {
    return fail(res, e);
  }
}

export async function setDefaultShoe(req, res) {
  try {
    const userId = ensureUser(req);
    const shoe = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        const found = await tx.runningShoe.findFirst({
          where: { id: req.params.id, userId, status: "ACTIVE" },
        });
        if (!found) notFound();
        await tx.runningShoe.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
        return tx.runningShoe.update({
          where: { id: found.id },
          data: { isDefault: true },
        });
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );
    return res.json({
      success: true,
      message: "This is now your default shoe.",
      shoe: serialize(shoe),
    });
  } catch (e) {
    return fail(res, e);
  }
}

export async function retireShoe(req, res) {
  try {
    const userId = ensureUser(req);
    await getOwned(userId, req.params.id);
    const shoe = await prisma.runningShoe.update({
      where: { id: req.params.id },
      data: { status: "RETIRED", isDefault: false },
    });
    return res.json({
      success: true,
      message: "Your shoe has been retired. Its activity history is saved.",
      shoe: serialize(shoe),
    });
  } catch (e) {
    return fail(res, e);
  }
}

export async function activateShoe(req, res) {
  try {
    const userId = ensureUser(req);
    await getOwned(userId, req.params.id);
    const shoe = await prisma.runningShoe.update({
      where: { id: req.params.id },
      data: { status: "ACTIVE" },
    });
    return res.json({
      success: true,
      message: "Your shoe is active again!",
      shoe: serialize(shoe),
    });
  } catch (e) {
    return fail(res, e);
  }
}

export async function getShoeActivities(req, res) {
  try {
    const userId = ensureUser(req);
    await getOwned(userId, req.params.id);
    const take = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const activities = await prisma.activity.findMany({
      where: { userId, shoeId: req.params.id },
      select: {
        id: true,
        mode: true,
        distanceKm: true,
        durationSec: true,
        startedAt: true,
        endedAt: true,
      },
      orderBy: { startedAt: "desc" },
      take,
    });
    return res.json({ success: true, activities });
  } catch (e) {
    return fail(res, e);
  }
}

export async function reconcileShoes(req, res) {
  try {
    const userId = ensureUser(req);
    const shoes = await prisma.runningShoe.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const s of shoes) await refreshShoeStats(s.id);
    return res.json({ success: true, message: "Shoe statistics recalculated" });
  } catch (e) {
    return fail(res, e);
  }
}
