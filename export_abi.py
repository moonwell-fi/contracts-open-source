import sys
import os
import json

def export_abi(file):
    abi = json.dumps(json.loads(open(file, "r").read())["abi"])

    abi_file = open("build/abi.json", "w")
    abi_file.write(abi)
    abi_file.close()

def main():
    contract_name = sys.argv[1]
    contract_path = os.path.realpath(os.path.join(os.getcwd(), contract_name))

    export_abi(contract_path)
    print("ABI exported to build/abi.json")

if __name__ == "__main__":
    main()
