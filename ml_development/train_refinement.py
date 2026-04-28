import os
import torch
from PIL import Image
from datasets import load_dataset
from transformers import TrOCRProcessor, VisionEncoderDecoderModel, TrainingArguments, Trainer

def main():
    # 1. PATHS
    # We load the weights you saved yesterday
    model_input_path = "./data/best_model" 
    processed_data_path = "data/processed/master_metadata.jsonl"
    checkpoint_dir = "./data/checkpoints_refinement"
    
    print(f"--- STARTING STAGE 2: SURGICAL REFINEMENT ---")

    # 2. LOAD MODEL & PROCESSOR
    processor = TrOCRProcessor.from_pretrained(model_input_path)
    model = VisionEncoderDecoderModel.from_pretrained(model_input_path).to("cuda")

    # 3. DATA PREP
    def transform(examples):
        pixel_values = []
        for path in examples["file_name"]:
            img = Image.open(path).convert("RGB")
            pixel_values.append(processor(img, return_tensors="pt").pixel_values)
        
        labels = processor.tokenizer(examples["text"], padding="max_length", max_length=64, truncation=True).input_ids
        # Map pad tokens to -100 so they are ignored by the loss function
        labels = [[(l if l != processor.tokenizer.pad_token_id else -100) for l in label] for label in labels]
        
        return {"pixel_values": torch.cat(pixel_values), "labels": torch.tensor(labels)}

    # This dataset now contains the original 5k images + your 1k new ones
    dataset = load_dataset("json", data_files={"train": processed_data_path})["train"]
    train_dataset = dataset.with_transform(transform)

    # 4. REFINEMENT SETTINGS (The "Nudge" Strategy)
    training_args = TrainingArguments(
        output_dir=checkpoint_dir,
        per_device_train_batch_size=2,   # Good for RTX 3060 12GB
        gradient_accumulation_steps=4,   # Effective batch size of 8
        num_train_epochs=3,              # Just 3 passes to integrate new data
        learning_rate=8e-6,              # 10x smaller than Stage 1 to preserve learning
        weight_decay=0.01,
        fp16=True,                       # Mixed precision for speed
        save_total_limit=1,
        gradient_checkpointing=True,
        logging_steps=10,
        save_strategy="epoch",
        remove_unused_columns=False
    )

    # 5. TRAINER
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset
    )
    
    print("Training started... teaching the model Aspirin, dosages, and instructions.")
    trainer.train() 
    
    # 6. SAVE FINAL VERSION
    final_output_path = "./data/best_model_v2_final"
    print(f"Refinement complete! Saving model to {final_output_path}")
    trainer.save_model(final_output_path)
    processor.save_pretrained(final_output_path)

if __name__ == "__main__":
    main()