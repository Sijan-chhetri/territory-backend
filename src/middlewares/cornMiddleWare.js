export const verifyCronSecret = (req, res, next) => {
  const secret = req.get("x-cron-secret");

  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET is not configured");

    return res.status(500).json({
      success: false,
      message: "Cron secret not configured",
    });
  }

  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  next();
};