import sys
import re
import os

def resolve_imports(file, imports, n = 0):
    source = open(file, "r").read()
    file_imports = re.findall("import \"(.*?)\";", source)
    file_imports = [os.path.realpath(os.path.join(os.path.dirname(file), imported_file)) for imported_file in file_imports]

    print("  " * n, file.replace(os.getcwd(), "."), sep="")
    for file in file_imports:
        resolve_imports(file, imports, n + 1)

        if file not in imports:
            imports.append(file)

def export_sources(files):
    combined_file = open("build/source.sol", "w")

    for file in files:
        source = open(file, "r").read()
        source = re.sub("import \"(.*?)\";\n", "", source)

        combined_file.write(f"/**\n * File: {os.path.basename(file)}\n */\n\n")
        combined_file.write(source)
        combined_file.write("\n\n")

    combined_file.close()

def main():
    contract_name = sys.argv[1]
    print(f"Using contract {contract_name}\n")

    print(f"Resolving {contract_name} contract import tree...\n")

    contract_path = os.path.realpath(os.path.join(os.getcwd(), contract_name))

    imports = []
    resolve_imports(contract_path, imports)
    imports.append(contract_path)

    print("\nImport order:\n")
    print("\n".join([f"{(i + 1):>3}. {file.replace(os.getcwd(), '.')}" for i, file in enumerate(imports)]))

    print(f"\nExporting combined source code for {contract_name} to build/source.sol")
    export_sources(imports)

    print("\n\nDONE!")

if __name__ == "__main__":
    main()
