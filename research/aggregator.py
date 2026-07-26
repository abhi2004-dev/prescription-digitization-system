import json
import os
import pandas as pd

def process_rxhand(image_dir, label_file, output_jsonl):
    # Load the CSV
    df = pd.read_csv(label_file)
    
    # Standardize column names to remove any hidden spaces
    df.columns = [c.strip() for c in df.columns]
    
    count = 0
    with open(output_jsonl, 'a') as f:
        for _, row in df.iterrows():
            # Use 'Images' and 'Text' as identified by your terminal command
            img_name = str(row['Images'])
            
            # Add .jpg if the CSV doesn't include the extension
            if not img_name.lower().endswith('.jpg'):
                img_name += '.jpg'
                
            entry = {
                "file_name": os.path.join(image_dir, img_name),
                "text": str(row['Text'])
            }
            f.write(json.dumps(entry) + '\n')
            count += 1
            
    print(f"Successfully added {count} records from {label_file}")

if __name__ == "__main__":
    # Ensure the output directory exists
    os.makedirs("data/processed", exist_ok=True)
    
    master_file = "data/processed/master_metadata.jsonl"
    
    # Delete old file to start fresh
    if os.path.exists(master_file):
        os.remove(master_file)
    
    # Process Training Set
    process_rxhand("data/raw/rxhand/Train_Set", "data/raw/rxhand/Train_Label.csv", master_file)
    
    # Process Test Set
    process_rxhand("data/raw/rxhand/Test_Set", "data/raw/rxhand/Test_Label.csv", master_file)