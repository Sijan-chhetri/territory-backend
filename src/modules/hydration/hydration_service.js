// services/hydration_service.js
//
// Server-side hydration guidance for completed activities.
// Uses WeatherAPI only from the backend so the API key is never shipped
// inside the Flutter application.

const WEATHER_API_BASE_URL = 'https://api.weatherapi.com/v1';

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundToNearest50(value) {
  return Math.round(value / 50) * 50;
}

function deriveAverageSpeedKph({ averageSpeed, averagePace }) {
  const speed = toFiniteNumber(averageSpeed);

  if (speed !== null && speed > 0) {
    return speed;
  }

  // The DURO client stores pace as minutes per kilometre.
  const paceMinutesPerKm = toFiniteNumber(averagePace);

  if (paceMinutesPerKm !== null && paceMinutesPerKm > 0) {
    return 60 / paceMinutesPerKm;
  }

  return null;
}

function getIntensityMultiplier({ activityMode, averageSpeedKph }) {
  const mode = String(activityMode || '').trim().toUpperCase();

  let multiplier = 1;

  if (mode === 'RUN') multiplier += 0.12;
  if (mode === 'CYCLE') multiplier += 0.08;
  if (mode === 'WALK') multiplier += 0.02;

  if (averageSpeedKph !== null) {
    if (mode === 'RUN') {
      if (averageSpeedKph >= 14) multiplier += 0.18;
      else if (averageSpeedKph >= 11) multiplier += 0.10;
      else if (averageSpeedKph >= 8) multiplier += 0.05;
    } else if (mode === 'CYCLE') {
      if (averageSpeedKph >= 28) multiplier += 0.16;
      else if (averageSpeedKph >= 20) multiplier += 0.09;
      else if (averageSpeedKph >= 14) multiplier += 0.04;
    } else if (mode === 'WALK') {
      if (averageSpeedKph >= 7) multiplier += 0.10;
      else if (averageSpeedKph >= 5.5) multiplier += 0.05;
    }
  }

  return multiplier;
}

function getWeatherMultiplier(weather) {
  if (!weather) return 1;

  const feelsLikeC =
    toFiniteNumber(weather.feelsLikeC) ??
    toFiniteNumber(weather.temperatureC) ??
    20;

  const humidity = toFiniteNumber(weather.humidity) ?? 50;

  let multiplier = 1;

  if (feelsLikeC >= 38) multiplier += 0.45;
  else if (feelsLikeC >= 33) multiplier += 0.32;
  else if (feelsLikeC >= 28) multiplier += 0.20;
  else if (feelsLikeC >= 24) multiplier += 0.10;
  else if (feelsLikeC <= 8) multiplier -= 0.08;

  if (humidity >= 85) multiplier += 0.18;
  else if (humidity >= 70) multiplier += 0.10;
  else if (humidity >= 60) multiplier += 0.05;

  return clamp(multiplier, 0.85, 1.7);
}

function buildWarningLevel({
  durationSec,
  weather,
  intensityMultiplier,
  recommendedUpperMl,
}) {
  let score = 0;

  const feelsLikeC =
    toFiniteNumber(weather?.feelsLikeC) ??
    toFiniteNumber(weather?.temperatureC);

  const humidity = toFiniteNumber(weather?.humidity);
  const uv = toFiniteNumber(weather?.uv);

  if (durationSec >= 3600) score += 1;
  if (durationSec >= 5400) score += 1;

  if (feelsLikeC !== null && feelsLikeC >= 28) score += 1;
  if (feelsLikeC !== null && feelsLikeC >= 35) score += 1;

  if (humidity !== null && humidity >= 70) score += 1;
  if (uv !== null && uv >= 8) score += 1;

  if (intensityMultiplier >= 1.22) score += 1;
  if (recommendedUpperMl >= 1000) score += 1;

  if (score >= 5) return 'HIGH';
  if (score >= 2) return 'MODERATE';
  return 'LOW';
}

function buildMessages({
  level,
  weather,
  durationSec,
  recommendedLowerMl,
  recommendedUpperMl,
  weatherAvailable,
}) {
  const messages = [];

  messages.push(
    `Drink approximately ${recommendedLowerMl}-${recommendedUpperMl} mL gradually after this activity, reduced by any fluid you already drank during it.`,
  );

  if (level === 'HIGH') {
    messages.push(
      'High hydration stress detected. Move to a cooler place, sip fluids gradually, and consider an electrolyte drink.',
    );
  } else if (level === 'MODERATE') {
    messages.push(
      'Moderate hydration stress detected. Rehydrate gradually and continue monitoring thirst and urine colour.',
    );
  } else {
    messages.push(
      'Hydration stress appears low. Drink according to thirst and avoid forcing excessive fluid.',
    );
  }

  const feelsLikeC =
    toFiniteNumber(weather?.feelsLikeC) ??
    toFiniteNumber(weather?.temperatureC);

  const humidity = toFiniteNumber(weather?.humidity);

  if (feelsLikeC !== null && feelsLikeC >= 30) {
    messages.push(
      `The recorded feels-like temperature was ${Math.round(feelsLikeC)}°C, which increases fluid needs.`,
    );
  }

  if (humidity !== null && humidity >= 70) {
    messages.push(
      `Humidity was ${Math.round(humidity)}%, so sweat may have cooled the body less effectively.`,
    );
  }

  if (durationSec >= 3600 || level === 'HIGH') {
    messages.push(
      'For longer or very sweaty activities, include sodium through normal food or an appropriate electrolyte drink.',
    );
  }

  if (!weatherAvailable) {
    messages.push(
      'Weather data was unavailable, so this estimate uses body weight, duration, mode, and pace or speed only.',
    );
  }

  messages.push(
    'Seek urgent medical help for confusion, fainting, severe weakness, persistent vomiting, or inability to drink.',
  );

  return messages;
}

export async function fetchActivityWeather({
  latitude,
  longitude,
}) {
  const apiKey = process.env.WEATHER_API_KEY;

  if (!apiKey) {
    throw new Error('WEATHER_API_KEY is not configured');
  }

  const lat = toFiniteNumber(latitude);
  const lng = toFiniteNumber(longitude);

  if (
    lat === null ||
    lng === null ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new Error('Valid latitude and longitude are required');
  }

  const url = new URL(`${WEATHER_API_BASE_URL}/current.json`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', `${lat},${lng}`);
  url.searchParams.set('aqi', 'no');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const apiMessage =
        data?.error?.message || `WeatherAPI request failed (${response.status})`;

      throw new Error(apiMessage);
    }

    const current = data?.current;
    const location = data?.location;

    if (!current) {
      throw new Error('WeatherAPI response did not contain current weather');
    }

    return {
      source: 'WEATHER_API_CURRENT',
      observedAt:
        current.last_updated || new Date().toISOString(),
      location: {
        name: location?.name ?? null,
        region: location?.region ?? null,
        country: location?.country ?? null,
        latitude: toFiniteNumber(location?.lat) ?? lat,
        longitude: toFiniteNumber(location?.lon) ?? lng,
      },
      temperatureC: toFiniteNumber(current.temp_c),
      feelsLikeC: toFiniteNumber(current.feelslike_c),
      heatIndexC: toFiniteNumber(current.heatindex_c),
      humidity: toFiniteNumber(current.humidity),
      windKph: toFiniteNumber(current.wind_kph),
      uv: toFiniteNumber(current.uv),
      condition: current.condition?.text ?? null,
      conditionCode: current.condition?.code ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function calculateHydrationRecommendation({
  userWeightKg,
  activityMode,
  durationSec,
  averageSpeed,
  averagePace,
  weather = null,
}) {
  const weightKg = toFiniteNumber(userWeightKg);
  const duration = toFiniteNumber(durationSec);

  if (weightKg === null || weightKg < 25 || weightKg > 300) {
    return {
      available: false,
      reason: 'A valid user weight between 25 and 300 kg is required.',
      warningLevel: 'UNKNOWN',
      messages: [
        'Hydration guidance could not be calculated because user weight is missing or invalid.',
      ],
      weather,
    };
  }

  if (duration === null || duration < 0) {
    return {
      available: false,
      reason: 'A valid activity duration is required.',
      warningLevel: 'UNKNOWN',
      messages: [
        'Hydration guidance could not be calculated because activity duration is invalid.',
      ],
      weather,
    };
  }

  const averageSpeedKph = deriveAverageSpeedKph({
    averageSpeed,
    averagePace,
  });

  const intensityMultiplier = getIntensityMultiplier({
    activityMode,
    averageSpeedKph,
  });

  const weatherMultiplier = getWeatherMultiplier(weather);

  // Practical app heuristic:
  // start around 5 mL/kg/hour, then adjust for activity intensity and weather.
  // The final rate is capped to avoid suggesting excessive intake.
  const estimatedRateMlPerHour = clamp(
    weightKg * 5 * intensityMultiplier * weatherMultiplier,
    200,
    800,
  );

  const durationHours = duration / 3600;
  const estimatedReplacementMl = Math.max(
    0,
    estimatedRateMlPerHour * durationHours,
  );

  const recommendedLowerMl = roundToNearest50(
    clamp(estimatedReplacementMl * 0.8, 0, 1400),
  );

  const recommendedUpperMl = roundToNearest50(
    clamp(estimatedReplacementMl * 1.2, 0, 1600),
  );

  const warningLevel = buildWarningLevel({
    durationSec: duration,
    weather,
    intensityMultiplier,
    recommendedUpperMl,
  });

  const electrolyteSuggested =
    duration >= 3600 ||
    warningLevel === 'HIGH' ||
    (toFiniteNumber(weather?.feelsLikeC) ?? 0) >= 30;

  return {
    available: true,
    warningLevel,
    title:
      warningLevel === 'HIGH'
        ? 'High hydration attention'
        : warningLevel === 'MODERATE'
          ? 'Hydration recommended'
          : 'Normal hydration reminder',
    recommendedFluidMl: {
      lower: recommendedLowerMl,
      upper: Math.max(recommendedLowerMl, recommendedUpperMl),
      timing: 'Gradually over the next 60-90 minutes',
      subtractFluidAlreadyConsumed: true,
    },
    electrolyteSuggested,
    calculation: {
      userWeightKg: weightKg,
      durationSec: Math.round(duration),
      activityMode: String(activityMode || '').toUpperCase() || null,
      averageSpeedKph:
        averageSpeedKph === null
          ? null
          : Number(averageSpeedKph.toFixed(2)),
      estimatedRateMlPerHour: Math.round(estimatedRateMlPerHour),
      intensityMultiplier: Number(intensityMultiplier.toFixed(2)),
      weatherMultiplier: Number(weatherMultiplier.toFixed(2)),
    },
    weather,
    messages: buildMessages({
      level: warningLevel,
      weather,
      durationSec: duration,
      recommendedLowerMl,
      recommendedUpperMl: Math.max(
        recommendedLowerMl,
        recommendedUpperMl,
      ),
      weatherAvailable: weather !== null,
    }),
    disclaimer:
      'This is a general fitness estimate, not a diagnosis or a substitute for personalised medical advice.',
  };
}

export async function getHydrationRecommendation(input) {
  let weather = null;
  let weatherError = null;

  try {
    weather = await fetchActivityWeather({
      latitude: input.latitude,
      longitude: input.longitude,
    });
  } catch (error) {
    weatherError =
      error instanceof Error ? error.message : String(error);
  }

  const recommendation = calculateHydrationRecommendation({
    ...input,
    weather,
  });

  return {
    ...recommendation,
    weatherAvailable: weather !== null,
    weatherError,
  };
}