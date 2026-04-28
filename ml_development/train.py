import os
import torch
from PIL import Image
from datasets import load_dataset
from transformers import TrOCRProcessor, VisionEncoderDecoderModel, TrainingArguments, Trainer

def main():
    # 1. PATHS
    processed_data_path = "data/processed/master_metadata.jsonl"
    # New directory for Round 2 so we don't overwrite the old successful one yet
    checkpoint_dir = "./data/checkpoints_round2"
    # Load the best weights you saved yesterday
    model_input_path = "./data/best_model" 
    
    print(f"Starting Round 2. Loading weights from: {model_input_path}")

    # 2. LOAD (Load from LOCAL folder, not HuggingFace)
    # Using your fine-tuned model as the base for today
    processor = TrOCRProcessor.from_pretrained(model_input_path)
    model = VisionEncoderDecoderModel.from_pretrained(model_input_path).to("cuda")

    # Ensure config is set for your specific decoder
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.vocab_size = model.config.decoder.vocab_size

    # 3. DATA PREP
    def transform(examples):
        pixel_values = []
        for path in examples["file_name"]:
            # Standardizing image loading to RGB
            pixel_values.append(processor(Image.open(path).convert("RGB"), return_tensors="pt").pixel_values)
        
        labels = processor.tokenizer(examples["text"], padding="max_length", max_length=64, truncation=True).input_ids
        # -100 is the ignore index for PyTorch cross-entropy loss
        labels = [[(l if l != processor.tokenizer.pad_token_id else -100) for l in label] for label in labels]
        return {"pixel_values": torch.cat(pixel_values), "labels": torch.tensor(labels)}

    train_dataset = load_dataset("json", data_files={"train": processed_data_path})["train"].with_transform(transform)

    # 4. TRAINING ARGUMENTS (Optimized for Refinement)
    training_args = TrainingArguments(
        output_dir=checkpoint_dir,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=3,           # Lower epochs for Round 2 refinement
        learning_rate=1e-5,           # Lower learning rate (0.00001) to nudge the weights
        weight_decay=0.01,            # Regularization to prevent "Injection" bias
        fp16=True,
        save_total_limit=1,
        remove_unused_columns=False,
        gradient_checkpointing=True,
        logging_steps=5,              # More frequent logging to monitor loss
        save_strategy="epoch"
    )

    # 5. TRAIN
    trainer = Trainer(model=model, args=training_args, train_dataset=train_dataset)
    
    print("Beginning Stage 2 Fine-Tuning...")
    # Since we are starting with already fine-tuned weights, we don't 'resume' 
    # from a checkpoint file, we start 'fresh' training on the new weights.
    trainer.train() 
    
    # 6. SAVE FINAL ROUND 2 MODEL
    final_output_path = "./data/best_model_v2"
    print(f"Training Complete. Saving to {final_output_path}")
    trainer.save_model(final_output_path)
    processor.save_pretrained(final_output_path)

if __name__ == "__main__":
    main()