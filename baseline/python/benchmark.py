"""
P1 Deliverable: Benchmark Comparison Tool.
Executes both the Naive Keyword Filter and the TRUSTLENS Detector Engine
over dataset/messages.csv to produce evaluation proof for presentation slides.
"""
import pandas as pd
from dumb_filter import dumb_classify
from detector import analyze_message

def run_head_to_head(csv_path: str = "dataset/messages.csv"):
    df = pd.read_csv(csv_path)
    total = len(df)
    
    dumb_correct = 0
    dumb_fp = 0
    
    trustlens_correct = 0
    trustlens_fp = 0
    trustlens_fn = 0

    for _, row in df.iterrows():
        actual = str(row["label"])
        msg = str(row["message"])
        chan = str(row["channel"])
        lang = str(row["language"])
        snd = str(row["sender"])
        org = str(row["claimed_org"])

        # 1. Dumb Baseline evaluation
        d_pred = dumb_classify(msg)
        if d_pred == actual:
            dumb_correct += 1
        elif d_pred == "Phishing" and actual == "Benign":
            dumb_fp += 1

        # 2. TRUSTLENS Engine evaluation
        res = analyze_message(msg, chan, lang, snd, org)
        t_pred = "Phishing" if res["risk"] in ["High", "Medium"] else "Benign"
        
        if t_pred == actual:
            trustlens_correct += 1
        elif t_pred == "Phishing" and actual == "Benign":
            trustlens_fp += 1
        elif t_pred == "Benign" and actual == "Phishing":
            trustlens_fn += 1

    dumb_acc = (dumb_correct / total) * 100
    trust_acc = (trustlens_correct / total) * 100

    print("\n" + "=" * 55)
    print("       HEAD-TO-HEAD BENCHMARK METRICS FOR SLIDES")
    print("=" * 55)
    print(f"Dataset Size:                {total} messages (60% Scam / 40% Benign)")
    print("-" * 55)
    print(f"Naive Keyword Filter Accuracy: {dumb_acc:.1f}%")
    print(f"  └─ False Alarms (FP):        {dumb_fp} innocent messages flagged")
    print("-" * 55)
    print(f"TRUSTLENS Engine Accuracy:     {trust_acc:.1f}%")
    print(f"  └─ False Alarms (FP):        {trustlens_fp}")
    print(f"  └─ Missed Scams (FN):        {trustlens_fn}")
    print("=" * 55)
    print("Ready to paste into Slide 5 of your pitch deck!\n")

if __name__ == "__main__":
    run_head_to_head()