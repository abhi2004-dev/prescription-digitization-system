import os
import random
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# PATH CONFIGURATION
FONT_DIR = "fonts"
if os.path.exists("data/raw") or not os.path.exists("../ml_development/data"):
    data_root = "data"
else:
    data_root = "../ml_development/data"

OUTPUT_DIR = f"{data_root}/raw/synthetic_refinement"
TRAIN_METADATA_PATH = f"{data_root}/processed/master_train_metadata.jsonl"
MASTER_METADATA_PATH = f"{data_root}/processed/master_metadata.jsonl"
VOCAB_FILE = "medical_terms.txt"

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(f"{data_root}/processed", exist_ok=True)


# 1. Load Vocabulary and Structured Phrase Templates
if os.path.exists(VOCAB_FILE):
    with open(VOCAB_FILE, "r", encoding="utf-8") as f:
        vocab = [line.strip() for line in f.readlines() if len(line.strip()) > 1]
else:
    vocab = ["Amoxicillin", "Paracetamol", "Metformin", "Pantocid 40", "500mg", "1-0-1", "Tab", "Cap", "once daily"]

forms = ["Tab", "Tablet", "Cap", "Capsule", "Syp", "Syrup", "Inj", "Oint", "Drops", "Susp"]
drugs_sample = [v for v in vocab if not any(v.startswith(f) for f in ["once", "twice", "every", "before", "after", "for", "Tab", "Cap", "1-", "0-", "5mg", "10mg", "500mg"])]
strengths_sample = ["5mg", "10mg", "20mg", "25mg", "40mg", "50mg", "100mg", "250mg", "500mg", "650mg", "1g", "5ml"]
regimens_sample = ["1-0-1", "1-1-1", "1-0-0", "0-0-1", "OD", "BD", "TDS", "HS", "SOS", "once daily", "twice daily", "after meals", "before food", "for 5 days", "for 7 days"]

def generate_sample_text():
    """Generates a mixture of single words, drug+strength pairs, and full clinical prescription lines."""
    mode = random.random()
    if mode < 0.25 and drugs_sample:
        # Single medication or brand
        return random.choice(drugs_sample)
    elif mode < 0.55 and drugs_sample:
        # Formulation + Drug + Strength (e.g. Tab Amoxicillin 500mg)
        f = random.choice(forms) if random.random() > 0.3 else ""
        d = random.choice(drugs_sample)
        s = random.choice(strengths_sample) if random.random() > 0.3 else ""
        return f"{f} {d} {s}".strip()
    elif mode < 0.85 and drugs_sample:
        # Full Line: Drug + Strength + Regimen (e.g. Augmentin 625 1-0-1 x 5 days)
        d = random.choice(drugs_sample)
        s = random.choice(strengths_sample) if random.random() > 0.4 else ""
        r = random.choice(regimens_sample)
        return f"{d} {s} {r}".strip()
    else:
        # Random item from medical_terms.txt
        return random.choice(vocab)

def get_font_paths():
    """Discovers available TrueType fonts from local directory and system fonts."""
    candidate_fonts = []
    
    # 1. Local font directory
    if os.path.exists(FONT_DIR):
        for f in os.listdir(FONT_DIR):
            if f.lower().endswith(('.ttf', '.otf')) and "variable" not in f.lower():
                candidate_fonts.append(os.path.join(FONT_DIR, f))
                
    # 2. Windows system fonts fallback
    win_fonts = r"C:\Windows\Fonts"
    if os.path.exists(win_fonts):
        system_targets = ["arial.ttf", "calibri.ttf", "comic.ttf", "segoesc.ttf", "segoepr.ttf", 
                          "times.ttf", "georgia.ttf", "tahoma.ttf", "verdana.ttf", "trebuc.ttf"]
        for st in system_targets:
            full_p = os.path.join(win_fonts, st)
            if os.path.exists(full_p):
                candidate_fonts.append(full_p)
                
    return candidate_fonts

AVAILABLE_FONTS = get_font_paths()

def add_paper_artifacts_and_lighting(cv_img):
    """Applies non-uniform lighting gradients, ruled lines, and texture noise."""
    h, w = cv_img.shape[:2]
    
    # 1. Ruled background lines (simulation of notebook / prescription pads)
    if random.random() > 0.4:
        line_y = random.randint(int(h * 0.7), int(h * 0.95))
        line_color = random.choice([(210, 220, 235), (200, 210, 220), (220, 200, 200)]) # faint blue/grey
        cv2.line(cv_img, (0, line_y), (w, line_y + random.randint(-2, 2)), line_color, thickness=random.choice([1, 2]))
        
    # 2. Non-uniform illumination gradient (shadows across the slip)
    if random.random() > 0.3:
        gradient = np.linspace(random.uniform(0.85, 1.0), random.uniform(0.95, 1.05), w)
        gradient = np.tile(gradient, (h, 1))
        for c in range(3):
            cv_img[:, :, c] = np.clip(cv_img[:, :, c] * gradient, 0, 255).astype(np.uint8)
            
    # 3. Paper grain / Gaussian sensor noise
    if random.random() > 0.4:
        noise = np.random.normal(0, random.uniform(1.5, 4.0), (h, w, 3)).astype(np.float32)
        noisy_img = np.clip(cv_img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
        return noisy_img

    return cv_img

def generate_augmented_image(text, idx):
    """Renders synthetic handwriting image with realistic pen, paper, and affine distortions."""
    # 1. Random paper tint background (off-white, cream, pale blue-tint)
    bg_base = random.choice([
        (random.randint(245, 255), random.randint(245, 255), random.randint(240, 252)), # Off-white
        (random.randint(240, 250), random.randint(242, 252), random.randint(230, 245)), # Pale cream
        (random.randint(238, 248), random.randint(242, 252), random.randint(248, 255)), # Pale blue tint
    ])
    
    canvas_w = random.randint(520, 680)
    canvas_h = random.randint(90, 130)
    img = Image.new('RGB', (canvas_w, canvas_h), color=bg_base)
    draw = ImageDraw.Draw(img)
    
    # 2. Select font & size
    font_size = random.randint(34, 48)
    if AVAILABLE_FONTS:
        font_path = random.choice(AVAILABLE_FONTS)
        try:
            font = ImageFont.truetype(font_path, font_size)
        except Exception:
            font = ImageFont.load_default()
    else:
        font = ImageFont.load_default()
        
    # 3. Realistic Ink Colors (Ballpoint Blue, Fountain Blue-Black, Gel Black, Faint Grey)
    ink_color = random.choice([
        (random.randint(10, 30), random.randint(10, 30), random.randint(20, 40)),      # Black gel
        (random.randint(25, 55), random.randint(50, 85), random.randint(120, 170)),    # Classic Ballpoint Blue
        (random.randint(15, 40), random.randint(30, 60), random.randint(90, 140)),     # Dark Blue-Black
        (random.randint(65, 95), random.randint(65, 95), random.randint(70, 100)),     # Faint ballpoint grey
    ])
    
    # 4. Text Placement
    x_pos = random.randint(15, 45)
    y_pos = random.randint(15, 35)
    draw.text((x_pos, y_pos), text, font=font, fill=ink_color)
    
    # 5. Affine Rotation & Slight Shear
    rot_angle = random.uniform(-3.5, 3.5)
    img = img.rotate(rot_angle, resample=Image.BICUBIC, fillcolor=bg_base)
    
    # 6. Optical Blur (simulates camera focal depth and natural pen anti-aliasing)
    if random.random() > 0.3:
        blur_radius = random.uniform(0.15, 0.55)
        img = img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
        
    # 7. Convert to OpenCV for Paper Texture and Illumination Enhancements
    cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    cv_img = add_paper_artifacts_and_lighting(cv_img)
    
    # 8. Save
    save_filename = f"synth_v2_{idx}.jpg"
    save_path = os.path.join(OUTPUT_DIR, save_filename).replace("\\", "/")
    cv2.imwrite(save_path, cv_img)
    
    return save_path

def main():
    num_samples = 1500
    print(f"--- Generating {num_samples} Augmented Synthetic Prescription Samples ---")
    
    new_entries = []
    for i in range(num_samples):
        text_sample = generate_sample_text()
        img_path = generate_augmented_image(text_sample, i)
        new_entries.append({"file_name": img_path, "text": text_sample})
        
        if (i + 1) % 300 == 0 or i == num_samples - 1:
            print(f"  Processed [{i+1}/{num_samples}] images...")
            
    # Append strictly to training metadata files (never touching held-out test split)
    for meta_target in [TRAIN_METADATA_PATH, MASTER_METADATA_PATH]:
        with open(meta_target, "a", encoding="utf-8") as f:
            for entry in new_entries:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                
    print("\n" + "="*60)
    print(f"[OK] Generated {num_samples} augmented synthetic images in '{OUTPUT_DIR}'.")
    print(f"[OK] Appended records to '{TRAIN_METADATA_PATH}' and '{MASTER_METADATA_PATH}'.")
    print("="*60)

if __name__ == "__main__":
    main()