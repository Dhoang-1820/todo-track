import json,sys
f=sys.argv[1]
for i,q in enumerate(json.load(open(f))):
    if q.get('t') in ('order','yesno'): continue
    L=[len(o) for o in q['o']]; c=max(L[a] for a in q['a']); others=[l for k,l in enumerate(L) if k not in q['a']]
    if c>=max(others)*float(sys.argv[2] if len(sys.argv)>2 else 1):
        print(f"#{i} {q['q'][:110]}")
        for k,o in enumerate(q['o']): print(f"  {'*' if k in q['a'] else ' '}{k} [{len(o)}] {o}")
