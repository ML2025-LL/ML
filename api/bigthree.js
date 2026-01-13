import tzlookup from "tz-lookup";
import { DateTime } from "luxon";
import Astronomy from "astronomy-engine";

const SIGNS_FR = [
  "Bélier", "Taureau", "Gémeaux", "Cancer", "Lion", "Vierge",
  "Balance", "Scorpion", "Sagittaire", "Capricorne", "Verseau", "Poissons"
];

function signFromLon(lonDeg) {
  const lon = ((lonDeg % 360) + 360) % 360;
  return SIGNS_FR[Math.floor(lon / 30)];
}

// Normalize angle to 0..360
function norm360(x) {
  x = x % 360;
  return x < 0 ? x + 360 : x;
}

// Greenwich Mean Sidereal Time (degrees)
// Uses Astronomy.Engine's SiderealTime
function gmstDegrees(dateUtc) {
  const t = Astronomy.MakeTime(dateUtc);
  const stHours = Astronomy.SiderealTime(t); // hours
  return norm360(stHours * 15); // 15 deg per hour
}

// Mean obliquity (degrees) - good approximation
function meanObliquityDeg(dateUtc) {
  // Meeus approx using centuries from J2000
  const t = Astronomy.MakeTime(dateUtc);
  const jd = t.ut; // UT days relative? In astronomy-engine, Time has .ut = Julian date
  const T = (jd - 2451545.0) / 36525.0;
  const epsArcsec =
    84381.448
    - 46.8150 * T
    - 0.00059 * T * T
    + 0.001813 * T * T * T;
  return epsArcsec / 3600.0;
}

// Calculate Ascendant ecliptic longitude (degrees)
// Formula from standard spherical astronomy
function ascendantLongitudeDeg(dateUtc, latDeg, lonDeg) {
  const theta = gmstDegrees(dateUtc) + lonDeg; // local sidereal time in degrees (east +)
  const eps = meanObliquityDeg(dateUtc);

  const thetaRad = (theta * Math.PI) / 180;
  const epsRad = (eps * Math.PI) / 180;
  const latRad = (latDeg * Math.PI) / 180;

  // Ascendant:
  // λ = atan2( sin(θ) * cos(ε) - tan(φ) * sin(ε), cos(θ) )
  const y = Math.sin(thetaRad) * Math.cos(epsRad) - Math.tan(latRad) * Math.sin(epsRad);
  const x = Math.cos(thetaRad);
  const lam = Math.atan2(y, x); // radians
  return norm360((lam * 180) / Math.PI);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const { date, time, lat, lon } = req.body || {};

    if (!date || typeof lat !== "number" || typeof lon !== "number") {
      return res.status(400).json({ error: "Missing date/lat/lon" });
    }

    const tz = tzlookup(lat, lon);

    const hasTime = typeof time === "string" && time.includes(":");
    const [hh, mm] = hasTime ? time.split(":").map(Number) : [12, 0];

    const local = DateTime.fromISO(
      `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      { zone: tz }
    );
    if (!local.isValid) return res.status(400).json({ error: "Invalid date/time" });

    const utc = local.toUTC().toJSDate();

    // Sun & Moon ecliptic longitude
    const t = Astronomy.MakeTime(utc);

    const sunVec = Astronomy.GeoVector("Sun", t, true);
    const sunEcl = Astronomy.Ecliptic(sunVec); // has elon
    const sunSign = signFromLon(sunEcl.elon);

    let moonSign = null;
    let ascSign = null;

    if (hasTime) {
      const moonVec = Astronomy.GeoVector("Moon", t, true);
      const moonEcl = Astronomy.Ecliptic(moonVec);
      moonSign = signFromLon(moonEcl.elon);

      const ascLon = ascendantLongitudeDeg(utc, lat, lon);
      ascSign = signFromLon(ascLon);
    }

    return res.status(200).json({ tz, sunSign, moonSign, ascSign });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
