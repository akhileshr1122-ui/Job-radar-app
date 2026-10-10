"""Shared helpers: HTTP session, text cleanup, location classification, job ids."""
import hashlib
import html
import re
import time
from datetime import datetime, timezone

import requests

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 JobRadar/1.0"

_session = None


def session():
    global _session
    if _session is None:
        s = requests.Session()
        s.headers.update({"User-Agent": UA, "Accept": "application/json, text/xml;q=0.9, */*;q=0.5"})
        _session = s
    return _session


def get(url, params=None, headers=None, timeout=25, retries=2):
    """GET with small retry; returns Response or None."""
    for attempt in range(retries + 1):
        try:
            r = session().get(url, params=params, headers=headers, timeout=timeout)
            if r.status_code == 429 and attempt < retries:
                time.sleep(3 * (attempt + 1))
                continue
            return r
        except requests.RequestException:
            if attempt < retries:
                time.sleep(2)
    return None


def post(url, json_body=None, headers=None, timeout=25):
    try:
        return session().post(url, json=json_body, headers=headers, timeout=timeout)
    except requests.RequestException:
        return None


_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t\r\f\v]+")


def strip_html(s):
    if not s:
        return ""
    s = html.unescape(s)
    s = re.sub(r"(?i)<\s*(br|/p|/li|/h\d|/div)\s*/?>", "\n", s)
    s = re.sub(r"(?i)<\s*li[^>]*>", "\n• ", s)
    s = _TAG.sub(" ", s)
    s = html.unescape(s)
    s = _WS.sub(" ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s)
    return s.strip()


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def job_id(*parts):
    return hashlib.sha1("|".join(norm(p) for p in parts).encode()).hexdigest()[:16]


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def to_iso(value):
    """Accept epoch seconds/ms, ISO strings, RFC822; return ISO or ''."""
    if value in (None, ""):
        return ""
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
            v = float(value)
            if v > 1e12:
                v /= 1000
            return datetime.fromtimestamp(v, timezone.utc).replace(microsecond=0).isoformat()
        s = str(value).strip()
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return d.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        except ValueError:
            pass
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(s).astimezone(timezone.utc).replace(microsecond=0).isoformat()
    except Exception:
        return ""


def age_days(iso):
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(iso)
        return (datetime.now(timezone.utc) - d).total_seconds() / 86400
    except ValueError:
        return None


CA_PROVINCES = ["ontario", "quebec", "québec", "british columbia", "alberta", "manitoba", "saskatchewan", "nova scotia",
                "new brunswick", "newfoundland", "prince edward island", "yukon", "nunavut", "northwest territories"]
CA_ABBR = ["on", "qc", "bc", "ab", "mb", "sk", "ns", "nb", "nl", "pe", "yt", "nu", "nt"]
CA_CITIES = ["toronto", "vancouver", "montreal", "montréal", "calgary", "ottawa", "edmonton", "mississauga", "winnipeg",
             "brampton", "hamilton", "kitchener", "waterloo", "markham", "vaughan", "halifax", "victoria", "scarborough",
             "oakville", "burlington", "richmond hill", "london, on", "guelph", "laval", "surrey", "burnaby", "regina", "saskatoon"]
US_STATES = ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
             "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
             "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
             "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
             "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
             "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming"]
US_ABBR = ["al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me",
           "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa",
           "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc"]


AU_WORDS = ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "hobart", "darwin", "gold coast",
            "new south wales", "queensland", "tasmania", "western australia", "south australia", "northern territory",
            "australian capital territory", "newcastle, nsw", "parramatta", "geelong", "wollongong"]
AU_ABBR = ["nsw", "vic", "qld", "act", "tas"]
IN_WORDS = ["india", "bengaluru", "bangalore", "mumbai", "new delhi", "delhi", "hyderabad, telangana", "hyderabad, india", "telangana",
            "chennai", "pune", "kolkata", "gurgaon", "gurugram", "noida", "ahmedabad", "kochi", "jaipur", "karnataka", "maharashtra",
            "tamil nadu", "kerala", "haryana", "uttar pradesh", "west bengal", "gujarat", "andhra pradesh", "chandigarh", "indore",
            "coimbatore", "visakhapatnam", "trivandrum", "thiruvananthapuram", "bhubaneswar", "lucknow", "nagpur", "mysuru", "mysore"]


_AU_RX = re.compile(r"\b(" + "|".join(map(re.escape, AU_WORDS)) + r")\b")
_IN_RX = re.compile(r"\b(" + "|".join(map(re.escape, IN_WORDS)) + r")\b")


def classify_location(location, remote_flag=False, extra_text=""):
    """Return (country, remote): CA, US, AU, IN, NA (remote N. America / anywhere), OTHER or UNKNOWN."""
    loc = (location or "").lower()
    blob = f"{loc} {extra_text[:400].lower()}"
    remote = bool(remote_flag) or bool(re.search(r"\bremote\b|work from home|wfh|anywhere|distributed", loc))
    tokens = set(re.findall(r"[a-z]+", loc))
    if _AU_RX.search(loc) or re.search(r",\s*(" + "|".join(AU_ABBR) + r")\b", loc) or tokens & {"aus"}:
        return "AU", remote
    if _IN_RX.search(loc) or tokens & {"ind"} or re.fullmatch(r"\s*hyderabad\s*", loc):
        return "IN", remote
    if "canada" in loc or any(p in loc for p in CA_PROVINCES) or any(c in loc for c in CA_CITIES) \
            or re.search(r",\s*(" + "|".join(CA_ABBR) + r")\b", loc):
        return "CA", remote
    if re.search(r"\b(usa|united states|u\.s\.)\b", loc) or any(s in loc for s in US_STATES) \
            or re.search(r",\s*(" + "|".join(US_ABBR) + r")\b", loc) or "us" in tokens:
        if remote and re.search(r"canada|north america|americas", blob):
            return "NA", remote
        return "US", remote
    if remote:
        if re.search(r"north america|americas|anywhere|worldwide|global|earth", loc):
            return "NA", remote
        rest = re.sub(r"\b(remote|work from home|wfh|distributed|hybrid)\b|[^a-z]+", "", loc)
        if rest:  # names specific countries/regions, none of them Canada or the US
            return "OTHER", remote
        if re.search(r"canada|north america|anywhere|worldwide", blob):
            return "NA", remote
        return "UNKNOWN", remote
    if not loc.strip():
        return "UNKNOWN", remote
    return "OTHER", remote


# ---------------------------------------------------------------- geocoding for "within X km of" searches

import math  # noqa: E402

_geo_cache = {}
_geo_budget = {"left": 150}


def load_geocache(cache):
    _geo_cache.clear()
    _geo_cache.update(cache)


def geocache():
    return _geo_cache


def geocode(text):
    """(lat, lon) for a place name, using OpenStreetMap Nominatim (cached; at most ~150 new lookups per run)."""
    key = re.sub(r"\s+", " ", (text or "").lower()).strip(" ,")
    key = re.sub(r"\b(remote|hybrid|on-site|onsite)\b[ –-]*", "", key).strip(" ,–-")
    if not key or len(key) < 3:
        return None
    if key in _geo_cache:
        v = _geo_cache[key]
        return tuple(v) if v else None
    if _geo_budget["left"] <= 0:
        return None
    _geo_budget["left"] -= 1
    time.sleep(1.1)  # Nominatim usage policy: max 1 request per second
    try:
        r = session().get("https://nominatim.openstreetmap.org/search", params={"q": key, "format": "json", "limit": 1},
                          headers={"User-Agent": "JobRadar/1.0 (personal job search; github.com)"}, timeout=20)
        d = r.json() if r.status_code == 200 else []
    except Exception:
        return None
    v = [float(d[0]["lat"]), float(d[0]["lon"])] if d else None
    _geo_cache[key] = v
    return tuple(v) if v else None


def km_between(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def safe_url(u):
    """Only plain web links are kept; anything else (javascript:, data:, file:...) becomes empty."""
    u = str(u or "").strip()
    return u if re.match(r"(?i)^https?://[^\s]+$", u) else ""
