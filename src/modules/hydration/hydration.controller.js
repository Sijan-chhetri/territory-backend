// controllers/hydration_controller.js
//
// Change the Prisma import path to match your project.

import prisma from '../config/prisma.js';
import {
  getHydrationRecommendation,
} from './hydration_service.js';

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getRouteEndpoints(coordinates) {
  if (!Array.isArray(coordinates)) {
    return {
      start: null,
      end: null,
    };
  }

  const valid = coordinates
    .map((point) => ({
      lat: toFiniteNumber(point?.lat),
      lng: toFiniteNumber(point?.lng),
    }))
    .filter(
      (point) =>
        point.lat !== null &&
        point.lng !== null &&
        point.lat >= -90 &&
        point.lat <= 90 &&
        point.lng >= -180 &&
        point.lng <= 180,
    );

  return {
    start: valid.length > 0 ? valid[0] : null,
    end: valid.length > 0 ? valid[valid.length - 1] : null,
  };
}

export const getActivityHydrationRecommendation = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const {
      userWeightKg,
      activityMode,
      mode,
      durationSec,
      averageSpeed,
      avgSpeed,
      averagePace,
      avgPace,
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
      coordinates,
    } = req.body;

    /*
     * Prefer the profile weight stored by the server.
     *
     * This project previously used User.weight. If your Prisma field is
     * named weightKg instead, change `weight: true` and `user?.weight`.
     */
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        weight: true,
      },
    });

    const resolvedWeightKg =
      toFiniteNumber(user?.weight) ??
      toFiniteNumber(userWeightKg);

    const endpoints = getRouteEndpoints(coordinates);

    const resolvedStartLatitude =
      toFiniteNumber(startLatitude) ?? endpoints.start?.lat ?? null;

    const resolvedStartLongitude =
      toFiniteNumber(startLongitude) ?? endpoints.start?.lng ?? null;

    const resolvedEndLatitude =
      toFiniteNumber(endLatitude) ?? endpoints.end?.lat ?? null;

    const resolvedEndLongitude =
      toFiniteNumber(endLongitude) ?? endpoints.end?.lng ?? null;

    /*
     * Use the midpoint of the start and end points for the weather lookup.
     * If only one endpoint exists, use that endpoint.
     */
    const latitude =
      resolvedStartLatitude !== null && resolvedEndLatitude !== null
        ? (resolvedStartLatitude + resolvedEndLatitude) / 2
        : resolvedEndLatitude ?? resolvedStartLatitude;

    const longitude =
      resolvedStartLongitude !== null && resolvedEndLongitude !== null
        ? (resolvedStartLongitude + resolvedEndLongitude) / 2
        : resolvedEndLongitude ?? resolvedStartLongitude;

    const hydration = await getHydrationRecommendation({
      userWeightKg: resolvedWeightKg,
      activityMode: activityMode ?? mode,
      durationSec,
      averageSpeed: averageSpeed ?? avgSpeed,
      averagePace: averagePace ?? avgPace,
      latitude,
      longitude,
    });

    return res.status(200).json({
      success: true,
      hydration,
    });
  } catch (error) {
    console.error('HYDRATION_RECOMMENDATION ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Could not calculate hydration recommendation',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined,
    });
  }
};