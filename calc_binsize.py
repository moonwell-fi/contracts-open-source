#!/usr/bin/python3
import json

EIP170LIMIT = 2**14 +2**13

with open(".build/contracts.json") as jsondata1:
    data=json.loads(jsondata1.read())
biglines=[]
lines=[]
for k in data["contracts"]:
    binlen=int(len(data["contracts"][k]["bin"])/2)
    long,short = k.split(":")
    v=f"{binlen:05d} {binlen//1024:02d} K   {short} "
    if binlen>EIP170LIMIT:
        biglines.append(v)
    else:
        lines.append(v)
if (biglines):
    print("TOO BIG CONTRACTS")
    for line in reversed(sorted(biglines)):
        print(line)
    print("===================")
print("Contracts smaller than EIP-170 says ", EIP170LIMIT)
for line in reversed(sorted(lines)):
    print(line)
