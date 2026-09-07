# Date every image in the public meal-images bucket against the prompt era it was written under.
#
# PRELAUNCH 2b has said "~1,400 cached images predate the prompt fixes" since it was written, with
# no way to tell WHICH — so the item could never be worked, only worried about. It turns out the
# storage list endpoint returns created_at and the bucket is public, so the whole library dates
# itself with the anon key: no service-role access, no HEAD requests, no cost.
#
# Reads trending_meals too (anon can SELECT it) to separate images Discover is actually SERVING
# from ones sitting in the bucket unreferenced. That distinction is the entire point: most of the
# oldest images are dead weight, and the ones worth paying to regenerate are far fewer than 1,400.
#
# LIMIT worth knowing: "live" here means live in DISCOVER. Images for generated (pantry) meals are
# keyed in image_cache, which is service-role only, so this cannot see them. An image marked not
# live is not proof nobody is served it — only that Discover is not.
#
#   python3 scripts/date-image-library.py
#
import json, os, re, subprocess, urllib.request

REF = "fdafjnkqqtpsjtddbfdz"
BUCKET = "meal-images"
anon = ""
for line in open('.env'):
    if line.startswith('EXPO_PUBLIC_SUPABASE_ANON_KEY='):
        anon = line.split('=', 1)[1].strip().strip('"\'')

def post(path, body):
    req = urllib.request.Request(
        f"https://{REF}.supabase.co{path}",
        data=json.dumps(body).encode(),
        headers={"apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req))

def get(path):
    req = urllib.request.Request(
        f"https://{REF}.supabase.co{path}",
        headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
    )
    return json.load(urllib.request.urlopen(req))

# ── every object in the public image bucket, with the date it was written ──
rows, offset = [], 0
while True:
    page = post(f"/storage/v1/object/list/{BUCKET}",
                {"prefix": "", "limit": 100, "offset": offset,
                 "sortBy": {"column": "created_at", "order": "asc"}})
    if not page: break
    rows += [r for r in page if r.get("created_at")]
    if len(page) < 100: break
    offset += 100

# ── which of them Discover is actually serving ──
live = set()
try:
    for m in get("/rest/v1/trending_meals?select=image&limit=2000"):
        u = m.get("image") or ""
        if f"/{BUCKET}/" in u:
            live.add(u.rsplit("/", 1)[-1].split("?")[0])
except Exception as e:
    print("trending_meals unreadable:", e)

# Prompt-affecting deploys, newest first. An image is "stale" relative to the newest era it predates.
ERAS = [
    ("2026-09-05 17:30", "soaked cereal + real negative prompt (fc11bed/690af89)"),
    ("2026-09-05 03:00", "flavourings stripped before description (0c1e9cc→48af2dd)"),
    ("2026-05-28 07:57", "ingredient coverage tightened (4e6a2fa)"),
    ("2026-05-19 21:26", "incorporated ingredients made invisible (a8ca8d4)"),
    ("2026-05-18 08:40", "ingredient-faithful prompt (21b9636)"),
    ("2026-05-14 07:33", "two-stage Gemini→Flux pipeline (559f059)"),
]

def era_of(created):
    for cutoff, label in ERAS:
        if created >= cutoff.replace(" ", "T"): return label
    return "pre two-stage pipeline — description written by nothing current"

buckets = {}
for r in rows:
    label = era_of(r["created_at"][:16])
    buckets.setdefault(label, []).append(r)

print(f"{len(rows)} images in {BUCKET}, {len(live)} of them referenced by trending_meals\n")
order = ["current: " + ERAS[0][1]] + [l for _, l in ERAS[1:]] + ["pre two-stage pipeline — description written by nothing current"]
seen = set()
for _, label in ERAS:
    b = buckets.get(label, [])
    seen.add(label)
    n_live = sum(1 for r in b if r["name"] in live)
    tag = "CURRENT" if label == ERAS[0][1] else "stale"
    print(f"[{tag:7}] {len(b):5} images  ({n_live} live in Discover)  — newest prompt era they saw: {label}")
oldest = buckets.get("pre two-stage pipeline — description written by nothing current", [])
n_live = sum(1 for r in oldest if r["name"] in live)
print(f"[stale  ] {len(oldest):5} images  ({n_live} live in Discover)  — predate the two-stage pipeline entirely")

with open(os.path.join(os.path.dirname(__file__), "stale-images.csv"), "w") as f:
    f.write("created_at,live_in_discover,era,name\n")
    for r in sorted(rows, key=lambda r: r["created_at"]):
        f.write(f'{r["created_at"]},{r["name"] in live},"{era_of(r["created_at"][:16])}",{r["name"]}\n')
print(f'\nfull list -> {os.path.join(os.path.dirname(__file__), "stale-images.csv")}')
