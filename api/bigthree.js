const { DateTime } = require("luxon");
const tzlookup = require("tz-lookup");
const Astronomy = require("astronomy-engine");

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

// Mean obliquity (degrees) – simple & stable
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

// GMST in degrees using Astronomy-Engine sidereal time
function gmstDeg(dateUtc) {
  const t = Astronomy.MakeTime(dateUtc);
  const stHours = Astronomy.SiderealTime(t); // hours
  return norm360(stHours * 15);
}

// Ascendant longitude (degrees)
function ascendantLongitudeDeg(dateUtc, latDeg, lonDeg) {
  const theta = gmstDeg(dateUtc) + lonDeg; // east positive
  const eps = meanObliquityDeg(dateUtc);

  const thetaRad = (theta * Math.PI) / 180;
  const epsRad = (eps * Math.PI) / 180;
  const latRad = (latDeg * Math.PI) / 180;

  const y = Math.sin(thetaRad) * Math.cos(epsRad) - Math.tan(latRad) * Math.sin(epsRad);
  const x = Math.cos(thetaRad);
  const lam = Math.atan2(y, x);
  return norm360((lam * 180) / Math.PI);
}

module.exports = (req, res) => {
  try {
    // Healthcheck GET
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hint: "POST {date,time,lat,lon}" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    const body = req.body || {};
    const date = body.date;
    const time = body.time; // "HH:MM" ou null
    const lat = body.lat;
    const lon = body.lon;

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

    // Sun longitude
    const sunVec = Astronomy.GeoVector("Sun", t, true);
    const sunEcl = Astronomy.Ecliptic(sunVec);
    const sunSign = signFromLon(sunEcl.elon);

    let moonSign = null;
    let ascSign = null;

    // Only compute Moon + Asc if time provided
    if (hasTime) {
      const moonVec = Astronomy.GeoVector("Moon", t, true);
      const moonEcl = Astronomy.Ecliptic(moonVec);
      moonSign = signFromLon(moonEcl.elon);

      const ascLon = ascendantLongitudeDeg(utc, lat, lon);
      ascSign = signFromLon(ascLon);
    }

    return res.status(200).json({ tz, sunSign, moonSign, ascSign });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};
