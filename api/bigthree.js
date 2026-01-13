const { DateTime } = require("luxon");
const tzlookup = require("tz-lookup");
const Astronomy = require("astronomy-engine");

const SIGNS_FR = [
  "Bélier", "Taureau", "Gémeaux", "Cancer", "Lion", "Vierge",
  "Balance", "Scorpion", "Sagittaire", "Capricorne", "Verseau", "Poissons"
];
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.monologueworld.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function signFromLon(lonDeg) {
  const lon = ((lonDeg % 360) + 360) % 360;
  return SIGNS_FR[Math.floor(lon / 30)];
}
function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }

function meanObliquityDeg(dateUtc) {
  const t = Astronomy.MakeTime(dateUtc);
  const jd = t.ut;
  const T = (jd - 2451545.0) / 36525.0;
  const epsArcsec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
  return epsArcsec / 3600.0;
}
function gmstDeg(dateUtc) {
  const t = Astronomy.MakeTime(dateUtc);
  const stHours = Astronomy.SiderealTime(t);
  return norm360(stHours * 15);
}
function ascendantLongitudeDeg(dateUtc, latDeg, lonDeg) {
  const rad = Math.PI / 180;

  // LST (Local Sidereal Time) en degrés
  const lstDeg = norm360(gmstDeg(dateUtc) + lonDeg);

  // Obliquité de l’écliptique
  const epsDeg = meanObliquityDeg(dateUtc);

  const L = lstDeg * rad;
  const φ = latDeg * rad;
  const ε = epsDeg * rad;

  // Formule robuste (quadrants OK)
  // λAsc = atan2( cos(LST), -(sin(LST)*cosε + tanφ*sinε) )
  const λ = Math.atan2(
    Math.cos(L),
    -(Math.sin(L) * Math.cos(ε) + Math.tan(φ) * Math.sin(ε))
  );

  return norm360((λ * 180) / Math.PI);
}


// Géocodage simple via Nominatim (texte -> lat/lon)
async function geocodePlace(place) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(place);

  const r = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Monologueworld-quiz/1.0"
    }
  });

  const data = await r.json();
  if (!Array.isArray(data) || !data[0]) throw new Error("Géocodage impossible. Essaie 'Ville, Pays'.");
  return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
}

module.exports = async (req, res) => {
    setCors(res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hint: "POST {date,time,place} ou {date,time,lat,lon}" });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const body = req.body || {};
    const date = body.date;
    const time = body.time; // "HH:MM" ou null/"" si inconnue
    let lat = body.lat;
    let lon = body.lon;
    const place = body.place; // texte "Paris, France"

    if (!date) return res.status(400).json({ error: "Missing date" });

    // Si pas de lat/lon, on tente place
    if ((typeof lat !== "number" || typeof lon !== "number") && typeof place === "string" && place.trim()) {
      const geo = await geocodePlace(place.trim());
      lat = geo.lat;
      lon = geo.lon;
    }

    if (typeof lat !== "number" || typeof lon !== "number") {
      return res.status(400).json({ error: "Missing lat/lon or place" });
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
    const t = Astronomy.MakeTime(utc);

    // Soleil
    const sunVec = Astronomy.GeoVector("Sun", t, true);
    const sunEcl = Astronomy.Ecliptic(sunVec);
    const sunSign = signFromLon(sunEcl.elon);

    let moonSign = null;
    let ascSign = null;

    // Lune + Asc seulement si heure fournie
    if (hasTime) {
      const moonVec = Astronomy.GeoVector("Moon", t, true);
      const moonEcl = Astronomy.Ecliptic(moonVec);
      moonSign = signFromLon(moonEcl.elon);

      const ascLon = ascendantLongitudeDeg(utc, lat, lon);
      ascSign = signFromLon(ascLon);
    }

    return res.status(200).json({ tz, lat, lon, sunSign, moonSign, ascSign });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};



