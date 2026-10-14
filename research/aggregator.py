import json
import os
import pandas as pd

def process_rxhand(image_dir, label_file, output_jsonl, seen_paths=None):
    """
    Parses RxHand CSV annotations and appends unique records to output_jsonl.
    Prevents duplicate entries and ensures valid path formatting.
    """
    if seen_paths is None:
        seen_paths = set()

    if not os.path.exists(label_file):
        print(f"Warning: Label file not found: {label_file}")
        return 0

    df = pd.read_csv(label_file)
    df.columns = [c.strip() for c in df.columns]
    
    count = 0
    with open(output_jsonl, 'a', encoding='utf-8') as f:
        for _, row in df.iterrows():
            img_name = str(row['Images']).strip()
            text_val = str(row['Text']).strip()
            
            if not img_name.lower().endswith('.jpg'):
                img_name += '.jpg'
                
            file_path = os.path.join(image_dir, img_name).replace('\\', '/')
            
            if file_path in seen_paths:
                continue
                
            seen_paths.add(file_path)
            entry = {
                "file_name": file_path,
                "text": text_val
            }
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
            count += 1
            
    print(f"Successfully added {count} unique records from {label_file} -> {output_jsonl}")
    return count

if __name__ == "__main__":
    # Resolve data root directory
    if os.path.exists("data/raw/rxhand"):
        data_root = "data"

    elif os.path.exists("../ml_development/data/raw/rxhand"):
        data_root = "../ml_development/data"
    else:
        data_root = "data"

    os.makedirs(os.path.join(data_root, "processed"), exist_ok=True)
    
    train_metadata = os.path.join(data_root, "processed/master_train_metadata.jsonl").replace('\\', '/')
    test_metadata = os.path.join(data_root, "processed/master_test_metadata.jsonl").replace('\\', '/')
    master_train_alias = os.path.join(data_root, "processed/master_metadata.jsonl").replace('\\', '/') # For training scripts
    
    # Clean previous output files
    for file_path in [train_metadata, test_metadata, master_train_alias]:
        if os.path.exists(file_path):
            os.remove(file_path)
            
    print("--- 1. Processing Strict Training Set ---")
    train_seen = set()
    train_count = process_rxhand(f"{data_root}/raw/rxhand/Train_Set", f"{data_root}/raw/rxhand/Train_Label.csv", train_metadata, train_seen)
    
    # Also write to master_metadata.jsonl so train.py & train_refinement.py use strictly training data
    train_seen_alias = set()
    process_rxhand(f"{data_root}/raw/rxhand/Train_Set", f"{data_root}/raw/rxhand/Train_Label.csv", master_train_alias, train_seen_alias)

    
    print("\n--- 2. Processing Strict Held-Out Test Set (No Leakage) ---")
    test_seen = set()
    test_count = process_rxhand(f"{data_root}/raw/rxhand/Test_Set", f"{data_root}/raw/rxhand/Test_Label.csv", test_metadata, test_seen)
    
    print("\n" + "="*50)
    print("DATASET AGGREGATION & SPLIT SUMMARY:")
    print(f"  Training Split Records: {train_count} (Saved to {train_metadata} & {master_train_alias})")
    print(f"  Held-Out Test Records:  {test_count} (Saved to {test_metadata})")
    print("="*50)