const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// Open-Meteo is free (no API key, no rate limit for personal use), unlike a
// paid weather API — matches Vestro's "avoid new paid services" constraint.
const TIMEOUT_MS = 10000;

export type WeatherDescriptionKey =
  | 'weather.clear'
  | 'weather.mostlyClear'
  | 'weather.fog'
  | 'weather.drizzle'
  | 'weather.rain'
  | 'weather.snow'
  | 'weather.rainShowers'
  | 'weather.snowShowers'
  | 'weather.thunderstorm';

export type CurrentWeather = {
  temperature: number;
  /** Translation key — resolve with t() at render time so it follows the UI language. */
  descriptionKey: WeatherDescriptionKey;
};

// WMO weather codes, as returned by Open-Meteo's `weather_code` field.
// https://open-meteo.com/en/docs
function describeWeatherCode(code: number): WeatherDescriptionKey {
  if (code === 0) return 'weather.clear';
  if (code <= 3) return 'weather.mostlyClear';
  if (code === 45 || code === 48) return 'weather.fog';
  if (code >= 51 && code <= 57) return 'weather.drizzle';
  if (code >= 61 && code <= 67) return 'weather.rain';
  if (code >= 71 && code <= 77) return 'weather.snow';
  if (code >= 80 && code <= 82) return 'weather.rainShowers';
  if (code >= 85 && code <= 86) return 'weather.snowShowers';
  if (code >= 95) return 'weather.thunderstorm';
  return 'weather.mostlyClear';
}

export async function fetchCurrentWeather(
  latitude: number,
  longitude: number
): Promise<CurrentWeather | null> {
  const tag = '[weather]';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${WEATHER_ENDPOINT}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`${tag} HTTP ${response.status}`);
      return null;
    }

    const json = await response.json();
    const temperature = json?.current?.temperature_2m;
    const weatherCode = json?.current?.weather_code;

    if (typeof temperature !== 'number' || typeof weatherCode !== 'number') {
      console.warn(`${tag} réponse inattendue`, json);
      return null;
    }

    return { temperature, descriptionKey: describeWeatherCode(weatherCode) };
  } catch (error) {
    console.warn(`${tag} échec de la récupération météo`, error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
