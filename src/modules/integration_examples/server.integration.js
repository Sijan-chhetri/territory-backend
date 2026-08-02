// In your main Express server file, mount this BEFORE a catch-all 404 route.

import deepLinkRoutes from "../integration_examples/deepLink.routes.js";
// IMPORTANT: mount at the domain root, not under /api.
app.use("/", deepLinkRoutes);

// Keep your API routes after/before it as appropriate:
// app.use("/api", apiRoutes);
