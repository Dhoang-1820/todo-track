#!/usr/bin/env python3
"""Validate the authored question bank and build data/questions.json.

Authoring format (bank/d1.json ... bank/d4*.json): a JSON list of objects
  s: skill code, q: question stem, o: options (correct ones listed first),
  a: indexes of the correct options, e: explanation, r: source key (bank/sources.json)

The build shuffles options deterministically, assigns ids and spreads each
domain evenly over 10 mock tests.
"""
import glob, hashlib, json, os, random, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCKS = 10

SKILLS = {
    "D1": [("acr", "Build, store, version, and manage images with Azure Container Registry"),
           ("acrt", "Build and run images with ACR Tasks"),
           ("app", "Deploy containers to App Service (environment variables and secrets)"),
           ("aca", "Deploy to Azure Container Apps (environments and revisions)"),
           ("keda", "Event-driven scaling with KEDA in Container Apps"),
           ("aks", "Deploy and manage applications on AKS with manifest files"),
           ("mon", "Monitor and troubleshoot AKS and Container Apps")],
    "D2": [("cconn", "Connect to Cosmos DB for NoSQL with the SDK and run queries"),
           ("cidx", "Optimize Cosmos DB queries and RUs (indexing, consistency)"),
           ("cvec", "Store embeddings and run vector search in Cosmos DB"),
           ("cfeed", "Implement a Cosmos DB change feed processor"),
           ("pconn", "Connect and query Azure Database for PostgreSQL with SDKs"),
           ("pschema", "Model PostgreSQL schemas and choose data types"),
           ("pidx", "PostgreSQL indexing strategies and pgvector overhead"),
           ("pcomp", "Configure PostgreSQL compute, memory, and storage for vectors"),
           ("pvec", "PostgreSQL vector search and RAG with metadata filters"),
           ("ppool", "PostgreSQL connection optimization"),
           ("rcache", "Azure Managed Redis caching, expiration, and invalidation"),
           ("rvec", "Vector indexing and similarity search in Azure Managed Redis")],
    "D3": [("sb", "Azure Service Bus queues, topics, subscriptions, and dead-lettering"),
           ("eg", "Azure Event Grid filters, custom events, and retries"),
           ("fn", "Azure Functions triggers and bindings (serverless APIs)"),
           ("fdep", "Configure and deploy function apps")],
    "D4": [("kv", "Secure secrets with Azure Key Vault (rotation and retrieval)"),
           ("appc", "Azure App Configuration"),
           ("otel", "Trace distributed systems with OpenTelemetry"),
           ("kql", "Write KQL queries to analyze logs and metrics")],
}
SKILL_DOMAIN = {code: d for d, lst in SKILLS.items() for code, _ in lst}
SKILL_NAME = {code: name for lst in SKILLS.values() for code, name in lst}
SKILL_ORDER = {code: i for lst in SKILLS.values() for i, (code, _) in enumerate(lst)}
TARGET = {"D1": 90, "D2": 120, "D3": 100, "D4": 90}
# Most course questions are added to the mocks. D2 is capped so mocks stay inside the exam's 25-30% weight;
# the rest are practice-only (no mock).
COURSE_MOCK_CAP = {"D2": 25}


def fail(msg):
    print("ERROR:", msg)
    sys.exit(1)


def main():
    sources = json.load(open(os.path.join(ROOT, "bank", "sources.json")))
    cases = json.load(open(os.path.join(ROOT, "bank", "cases.json"))) if os.path.exists(os.path.join(ROOT, "bank", "cases.json")) else {}
    raw = []
    files = sorted(glob.glob(os.path.join(ROOT, "bank", "d*.json"))) + sorted(glob.glob(os.path.join(ROOT, "bank", "course_*.json")))
    for path in files:
        course = os.path.basename(path).startswith("course_")
        try:
            items = json.load(open(path))
        except json.JSONDecodeError as exc:
            fail(f"{path}: {exc}")
        for i, item in enumerate(items):
            where = f"{os.path.basename(path)}[{i}]"
            kind = item.get("t", "choice")
            if kind not in ("choice", "order", "yesno"):
                fail(f"{where}: unknown type {kind}")
            for key in ("s", "q", "o", "e", "r") + (("a",) if kind != "order" else ()):
                if key not in item:
                    fail(f"{where}: missing '{key}'")
            if item["s"] not in SKILL_DOMAIN:
                fail(f"{where}: unknown skill {item['s']}")
            if item["r"] not in sources:
                fail(f"{where}: unknown source {item['r']}")
            if "c" in item and item["c"] not in cases:
                fail(f"{where}: unknown case {item['c']}")
            opts = item["o"]
            lo, hi = (2, 5) if kind == "yesno" else (3, 6)
            if not lo <= len(opts) <= hi:
                fail(f"{where}: needs {lo}-{hi} options")
            if len(set(o.strip().lower() for o in opts)) != len(opts):
                fail(f"{where}: duplicate options")
            if kind == "order":
                item["a"] = list(range(len(opts)))
            ans = item["a"]
            if any(a < 0 or a >= len(opts) for a in ans) or len(set(ans)) != len(ans):
                fail(f"{where}: bad answer indexes {ans}")
            if kind == "choice" and not ans:
                fail(f"{where}: no answer")
            if kind == "choice" and len(ans) > 1 and "choose" not in item["q"].lower():
                fail(f"{where}: multi-answer question must say 'Choose two/three'")
            if re.search(r"\b(option|answer|choice)s? [a-f]\b(?![a-z])", item["e"], re.I):
                fail(f"{where}: explanation refers to option letters (options are shuffled)")
            item["_kind"], item["_course"] = kind, course
            raw.append(item)

    stems = Counter(x["q"].strip().lower() for x in raw)
    dupes = [s for s, c in stems.items() if c > 1]
    if dupes:
        fail(f"duplicate stems: {dupes[:3]}")

    by_domain = defaultdict(list)
    for item in raw:
        by_domain[SKILL_DOMAIN[item["s"]]].append(item)

    out, letter_count = [], Counter()
    case_mock = {c: (n * 3) % MOCKS + 1 for n, c in enumerate(sorted(cases))}
    for domain in ("D1", "D2", "D3", "D4"):
        items = by_domain[domain]
        items.sort(key=lambda x: (x["_course"], SKILL_ORDER[x["s"]]))  # original bank first: its ids and mocks never move
        per_skill, n_bank, n_course = Counter(), 0, 0
        k_course = 0
        n_plain = Counter(SKILL_DOMAIN[x["s"]] for x in items if x["_course"] and "c" not in x)
        n_case = Counter(SKILL_DOMAIN[x["s"]] for x in items if x["_course"] and "c" in x)
        for item in items:
            per_skill[item["s"]] += 1
            qid = f"{domain}-{item['s']}-{per_skill[item['s']]:02d}"
            kind = item["_kind"]
            if item["_course"]:
                cap = COURSE_MOCK_CAP.get(domain)
                if "c" in item:
                    mock = case_mock[item["c"]]
                elif cap is not None and (k_course * (cap - n_case[domain])) // n_plain[domain] == ((k_course + 1) * (cap - n_case[domain])) // n_plain[domain]:
                    mock = None  # spread practice-only questions evenly across skills
                    k_course += 1
                else:
                    k_course += 1
                    mock = (n_course % MOCKS) + 1
                    n_course += 1
            else:
                mock = (n_bank % MOCKS) + 1
                n_bank += 1
            letters = "ABCDEF"
            if kind == "yesno":
                options = [{"key": letters[n], "text": t} for n, t in enumerate(item["o"])]
                correct = ["Y" if n in item["a"] else "N" for n in range(len(item["o"]))]
                qtype = "yesno"
            else:
                seed = int(hashlib.sha256(qid.encode()).hexdigest(), 16)
                order = list(range(len(item["o"])))
                random.Random(seed).shuffle(order)
                options = [{"key": letters[n], "text": item["o"][idx]} for n, idx in enumerate(order)]
                if kind == "order":
                    correct = [letters[order.index(a)] for a in range(len(item["o"]))]
                    qtype = "order"
                else:
                    correct = sorted(letters[order.index(a)] for a in item["a"])
                    letter_count.update(correct)
                    qtype = "multi" if len(item["a"]) > 1 else "single"
            title, url = sources[item["r"]]
            row = {
                "id": qid, "domain": domain, "skill": item["s"], "skill_name": SKILL_NAME[item["s"]],
                "mock": mock, "type": qtype,
                "stem": item["q"].strip(), "options": options, "correct": correct,
                "explanation": item["e"].strip(), "source_title": title, "source_url": url,
            }
            if "c" in item:
                row["case_title"], row["case_text"] = cases[item["c"]]["title"], cases[item["c"]]["text"]
            out.append(row)

    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "questions.json"), "w") as fh:
        json.dump({"version": hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest()[:12],
                   "count": len(out), "questions": out}, fh, ensure_ascii=False, indent=0)

    print(f"Built {len(out)} questions")
    for d in ("D1", "D2", "D3", "D4"):
        skills = Counter(x["s"] for x in by_domain[d])
        print(f"  {d}: {len(by_domain[d])}/{TARGET[d]}  " + ", ".join(f"{k}={v}" for k, v in skills.items()))
    mocks = Counter((x["mock"], x["domain"]) for x in out if x["mock"])
    inm = Counter(x["domain"] for x in out if x["mock"]); tot = sum(inm.values())
    print("  mock weights:", {d: f"{inm[d]} ({inm[d] * 100 / tot:.1f}%)" for d in sorted(inm)}, " practice-only:", sum(1 for x in out if not x["mock"]))
    print("  per mock:", {m: sum(v for (mm, _), v in mocks.items() if mm == m) for m in range(1, MOCKS + 1)})
    print("  correct letters:", dict(sorted(letter_count.items())))
    print("  types:", dict(Counter(x["type"] for x in out)), " case-study questions:", sum(1 for x in out if x.get("case_text")))


if __name__ == "__main__":
    main()
