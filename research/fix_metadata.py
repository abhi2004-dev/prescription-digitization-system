import json
import os

metadata_path = "data/processed/master_metadata.jsonl"
temp_path = "data/processed/master_metadata_fixed.jsonl"

print("Scanning for broken image links...")
valid_count = 0
broken_count = 0

with open(metadata_path, 'r') as f_in, open(temp_path, 'w') as f_out:
    for line in f_in:
        data = json.loads(line)
        # Check if the image file actually exists on your G: drive
        if os.path.exists(data['file_name']):
            f_out.write(json.dumps(data) + "\n")
            valid_count += 1
        else:
            broken_count += 1

# Replace the old file with the fixed one
os.replace(temp_path, metadata_path)

print(f"Cleanup Complete!")
print(f"✅ Valid images kept: {valid_count}")
print(f"❌ Broken links removed: {broken_count}")