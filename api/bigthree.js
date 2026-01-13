import { DateTime } from "luxon";

// CJS/ESM safe imports
import * as AstronomyNS from "astronomy-engine";
import tzlookupNS from "tz-lookup";

const Astronomy = AstronomyNS?.default ?? AstronomyNS;
const tzlookup = tzlookupNS?.default ?? tzlookupNS;

const SIGNS_FR = [
  "Bélier", "Taureau", "Gémeaux", "Cancer", "Lion", "Vierge",
  "Balance", "Scorpion", "Sagittaire", "Capricorne", "Verseau", "Poissons"
];

function signFromLon(lonDeg) {
  const lon = ((lonDeg % 360) + 360) % 360;
  return SIGNS_FR[Math.floor(lon / 30)];
}

function norm360(x) {
  x = x % 360;
  return x < 0 ? x + 360 : x;
}

function gmstDegrees(dateUtc) {
  const t = Astronomy.MakeTime(dateUtc);
  const stHours = Astronomy.SiderealTime(t); // hours
  return norm360(stHours * 15);
}

function meanObliquityDeg(dateUtc) {
  const t = Astronomy.MakeTime(dateUtc);
  const jd = t.ut;
  const T = (jd - 2451545.0) / 36525.0;
  const epsArcsec =
    84381.448
    - 46.8150 * T
    - 0.00059 * T * T
    + 0.001813 * T * T * T;
  return epsArcsec / 3600.0;
}

function ascendantLongitudeDeg(dateUtc, latDeg, lonDeg) {
  const theta = gmstDegrees(dateUtc) + lonDeg; // east positive
  const eps = meanObliquityDeg(dateUtc);

  const thetaRad = (theta * Math.PI) / 180;
  const epsRad = (eps * Math.PI) / 180;
  const latRad = (latDeg * Math.PI) / 180;

  const y = Math.sin(thetaRad) * Math.cos(epsRad) - Math.tan(latRad) * Math.sin(epsRad);
  const x = Math.cos(thetaRad);
  const lam = Math.atan2(y, x);
  return norm360((lam * 180) / Math.PI);
}

export default function handler(req, res) {
  try {
    // Petit endpoint de santé (ne doit jamais crash)
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hint: "Use POST with {date,time,lat,lon}" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

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

    if (!local.isValid) {
      return res.status(400).json({ error: "Invalid date/time" });
    }

    const utc = local.toUTC().toJSDate();
    const t = Astronomy.MakeTime(utc);

    // Sun
    const sunVec = Astronomy.GeoVector("Sun", t, true);
    const sunEcl = Astronomy.Ecliptic(sunVec);
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
