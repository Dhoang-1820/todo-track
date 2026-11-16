"""Apply option rewrites: tools/patches/*.json = {"bank/<file>.json": {"<index>": [options...]}}.
Correct answers keep their index positions, so only wording changes."""
import json,glob,sys
for pf in sorted(glob.glob('tools/patches/*.json')):
    for f,edits in json.load(open(pf)).items():
        qs=json.load(open(f))
        for i,opts in edits.items():
            q=qs[int(i)]
            assert len(opts)==len(q['o']), (f,i)
            q['o']=opts
        json.dump(qs,open(f,'w'),indent=0,ensure_ascii=False)
print("applied")
