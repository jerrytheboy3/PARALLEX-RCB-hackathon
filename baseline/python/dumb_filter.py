"""
P1 Baseline: Dumb Keyword Filter.
Demonstrates why simple keyword matching fails on legitimate alerts and complex scams.
"""
import pandas as pd

NAIVE_BAD_WORDS = [
    "urgent", "immediately", "block", "disconnected", 
    "otp", "password", "click", "pay", "verify", "bill",
    "cut", "turthu", "challan"
]

def dumb_classify(message: str) -> str:
    clean = str(message).lower()
    for word in NAIVE_BAD_WORDS:
        if word in clean:
            return "Phishing"
    return "Benign"

def evaluate_baseline(csv_path: str = "dataset/messages.csv"):
    df = pd.read_csv(csv_path)
    correct = 0
    false_positives = 0
    false_negatives = 0

    for _, row in df.iterrows():
        pred = dumb_classify(row["message"])
        actual = str(row["label"])

        if pred == actual:
            correct += 1
        elif pred == "Phishing" and actual == "Benign":
            false_positives += 1
        elif pred == "Benign" and actual == "Phishing":
            false_negatives += 1

    total = len(df)
    accuracy = (correct / total) * 100 if total else 0.0

    print("=" * 50)
    print("      NAIVE KEYWORD FILTER BENCHMARK (P1)")
    print("=" * 50)
    print(f"Total Evaluated:       {total}")
    print(f"Accuracy:              {accuracy:.1f}%")
    print(f"False Alarms (FP):     {false_positives} (Safe alerts blocked)")
    print(f"Missed Attacks (FN):   {false_negatives}")
    print("=" * 50)
    return accuracy, false_positives, false_negatives

if __name__ == "__main__":
    evaluate_baseline()