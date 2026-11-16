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


def fail(msg):
    print("ERROR:", msg)
    sys.exit(1)


def main():
    sources = json.load(open(os.path.join(ROOT, "bank", "sources.json")))
    raw = []
    for path in sorted(glob.glob(os.path.join(ROOT, "bank", "d*.json"))):
        try:
            items = json.load(open(path))
        except json.JSONDecodeError as exc:
            fail(f"{path}: {exc}")
        for i, item in enumerate(items):
            where = f"{os.path.basename(path)}[{i}]"
            for key in ("s", "q", "o", "a", "e", "r"):
                if key not in item:
                    fail(f"{where}: missing '{key}'")
            if item["s"] not in SKILL_DOMAIN:
                fail(f"{where}: unknown skill {item['s']}")
            if item["r"] not in sources:
                fail(f"{where}: unknown source {item['r']}")
            opts, ans = item["o"], item["a"]
            if not 3 <= len(opts) <= 6:
                fail(f"{where}: needs 3-6 options")
            if len(set(o.strip().lower() for o in opts)) != len(opts):
                fail(f"{where}: duplicate options")
            if not ans or any(a < 0 or a >= len(opts) for a in ans) or len(set(ans)) != len(ans):
                fail(f"{where}: bad answer indexes {ans}")
            if len(ans) > 1 and "choose" not in item["q"].lower():
                fail(f"{where}: multi-answer question must say 'Choose two/three'")
            if re.search(r"\b(option|answer|choice)s? [a-f]\b(?![a-z])", item["e"], re.I):
                fail(f"{where}: explanation refers to option letters (options are shuffled)")
            raw.append(item)

    stems = Counter(x["q"].strip().lower() for x in raw)
    dupes = [s for s, c in stems.items() if c > 1]
    if dupes:
        fail(f"duplicate stems: {dupes[:3]}")

    by_domain = defaultdict(list)
    for item in raw:
        by_domain[SKILL_DOMAIN[item["s"]]].append(item)

    out, letter_count = [], Counter()
    for domain in ("D1", "D2", "D3", "D4"):
        items = by_domain[domain]
        if len(items) % MOCKS:
            print(f"WARNING: {domain} has {len(items)} questions (not a multiple of {MOCKS})")
        items.sort(key=lambda x: SKILL_ORDER[x["s"]])
        per_skill = Counter()
        for i, item in enumerate(items):
            per_skill[item["s"]] += 1
            qid = f"{domain}-{item['s']}-{per_skill[item['s']]:02d}"
            seed = int(hashlib.sha256(qid.encode()).hexdigest(), 16)
            order = list(range(len(item["o"])))
            random.Random(seed).shuffle(order)
            letters = "ABCDEF"
            options = [{"key": letters[n], "text": item["o"][idx]} for n, idx in enumerate(order)]
            correct = sorted(letters[order.index(a)] for a in item["a"])
            letter_count.update(correct)
            title, url = sources[item["r"]]
            out.append({
                "id": qid, "domain": domain, "skill": item["s"], "skill_name": SKILL_NAME[item["s"]],
                "mock": (i % MOCKS) + 1, "type": "multi" if len(item["a"]) > 1 else "single",
                "stem": item["q"].strip(), "options": options, "correct": correct,
                "explanation": item["e"].strip(), "source_title": title, "source_url": url,
            })

    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "questions.json"), "w") as fh:
        json.dump({"version": hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest()[:12],
                   "count": len(out), "questions": out}, fh, ensure_ascii=False, indent=0)

    print(f"Built {len(out)} questions")
    for d in ("D1", "D2", "D3", "D4"):
        skills = Counter(x["s"] for x in by_domain[d])
        print(f"  {d}: {len(by_domain[d])}/{TARGET[d]}  " + ", ".join(f"{k}={v}" for k, v in skills.items()))
    mocks = Counter((x["mock"], x["domain"]) for x in out)
    print("  per mock:", {m: sum(v for (mm, _), v in mocks.items() if mm == m) for m in range(1, MOCKS + 1)})
    print("  correct letters:", dict(sorted(letter_count.items())))
    print("  multi-answer:", sum(1 for x in out if x["type"] == "multi"))


if __name__ == "__main__":
    main()
