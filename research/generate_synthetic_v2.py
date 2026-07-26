import os
import random
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# PATHS
FONT_DIR = "fonts"
OUTPUT_DIR = "data/raw/synthetic_refinement"
METADATA_PATH = "data/processed/master_metadata.jsonl"
VOCAB_FILE = "medical_terms.txt"

os.makedirs(OUTPUT_DIR, exist_ok=True)

with open(VOCAB_FILE, "r") as f:
    vocab = [line.strip() for line in f.readlines() if len(line.strip()) > 1]

def generate_diverse_image(text, i):
    # Random off-white background
    bg_color = (random.randint(240, 255), random.randint(240, 255), random.randint(230, 250))
    img = Image.new('RGB', (random.randint(480, 520), 120), color=bg_color)
    draw = ImageDraw.Draw(img)
    
    # Pick font
    font_files = [f for f in os.listdir(FONT_DIR) if f.endswith('.ttf') and "Variable" not in f]
    font_path = os.path.join(FONT_DIR, random.choice(font_files))
    
    # Random size and ink (Black/Blue/Grey)
    font = ImageFont.truetype(font_path, random.randint(38, 54))
    ink = random.choice([(15, 15, 20), (40, 60, 130), (80, 80, 80)]) 
    
    # Random placement
    draw.text((random.randint(15, 70), random.randint(20, 45)), text, font=font, fill=ink)
    
    # Distortions
    img = img.rotate(random.uniform(-3, 3), resample=Image.BICUBIC, fillcolor=bg_color)
    if random.random() > 0.5:
        img = img.filter(ImageFilter.GaussianBlur(radius=random.uniform(0.2, 0.6)))
    
    save_path = os.path.join(OUTPUT_DIR, f"synth_v2_{i}.jpg")
    img.save(save_path)
    return save_path

print("Generating 1500 diverse samples...")
new_entries = []
for i in range(1500):
    word = random.choice(vocab)
    path = generate_diverse_image(word, i)
    new_entries.append({"file_name": path.replace("\\", "/"), "text": word})

with open(METADATA_PATH, "a") as f:
    for entry in new_entries:
        f.write(json.dumps(entry) + "\n")

print("Done! Folder updated with diverse images.")