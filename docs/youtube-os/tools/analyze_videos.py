#!/usr/bin/env python3
"""動画パフォーマンス分析スクリプト。

templates/video-performance.csv の形式の CSV を読み、
- 各動画のパフォーマンス指数（チャンネル中央値との比較）
- 勝ち動画・弱い動画の判定と診断
- 属性（カテゴリ・構成型・タイトル型・サムネ型・フック型）別の勝ちパターン
を Markdown で出力する。標準ライブラリのみ使用。

使い方:
    python3 analyze_videos.py ../templates/video-performance.csv
    python3 analyze_videos.py data.csv -o report.md
"""

import argparse
import csv
import math
import os
import statistics
import sys

# 長尺：指標ごとの重み（合計 1.0）
LONG_WEIGHTS = {
    "views28": 0.35,
    "apv": 0.20,
    "ctr": 0.15,
    "subs_per_1k": 0.20,
    "eng_per_1k": 0.10,
}
# Shorts：CTR がないため、視聴率（スワイプされなかった割合）を使う
SHORT_WEIGHTS = {
    "views28": 0.35,
    "viewed_rate": 0.25,
    "apv": 0.15,
    "subs_per_1k": 0.15,
    "eng_per_1k": 0.10,
}
WINNER_INDEX = 1.30
WEAK_INDEX = 0.75
ATTRIBUTES = ["カテゴリ", "構成型", "タイトル型", "サムネ型", "フック型"]
MIN_SAMPLES = 3


def num(row, key):
    value = (row.get(key) or "").strip().replace(",", "")
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def derive(row):
    views28 = num(row, "視聴回数(28日)")
    m = {
        "views28": views28,
        "ctr": num(row, "CTR(%)(7日)"),
        "apv": num(row, "平均再生率(%)"),
        "ret30": num(row, "30秒維持率(%)"),
        "viewed_rate": num(row, "Shorts視聴率(%)"),
        "end_ctr": num(row, "終了画面CTR(%)"),
        "search": num(row, "検索(%)"),
        "browse": num(row, "ブラウジング(%)"),
        "suggested": num(row, "関連動画(%)"),
        "subs_per_1k": None,
        "eng_per_1k": None,
        "rpm": None,
    }
    if views28:
        subs = num(row, "登録者増(28日)")
        likes = num(row, "高評価(28日)") or 0
        comments = num(row, "コメント(28日)") or 0
        shares = num(row, "共有(28日)") or 0
        revenue = num(row, "推定収益(円)(28日)")
        if subs is not None:
            m["subs_per_1k"] = subs / views28 * 1000
        # コメント・共有は高評価より強い関与とみなして重みを付ける
        m["eng_per_1k"] = (likes + comments * 2 + shares * 3) / views28 * 1000
        if revenue:
            m["rpm"] = revenue / views28 * 1000
    return m


def medians(videos, keys):
    out = {}
    for k in keys:
        vals = [v["m"][k] for v in videos if v["m"][k] is not None]
        out[k] = statistics.median(vals) if vals else None
    return out


def performance_index(m, med, weights):
    """中央値との比の加重幾何平均。1.0 = チャンネルの標準的な動画。"""
    total_w = 0.0
    log_sum = 0.0
    ratios = {}
    for k, w in weights.items():
        if m[k] is None or not med.get(k):
            continue
        ratio = max(m[k], 1e-6) / med[k]
        ratios[k] = ratio
        log_sum += w * math.log(ratio)
        total_w += w
    if total_w == 0:
        return None, ratios
    return math.exp(log_sum / total_w), ratios


def diagnose(v):
    """長尺の弱点を、CTR と平均再生率の組み合わせで診断する。"""
    r = v["ratios"]
    m = v["m"]
    notes = []
    ctr_r, apv_r = r.get("ctr"), r.get("apv")
    if ctr_r is not None and apv_r is not None:
        if ctr_r < 0.85 and apv_r >= 0.95:
            notes.append("CTR低×維持率良好 → 中身は良い。サムネ・タイトルを差し替える")
        elif ctr_r >= 1.0 and apv_r < 0.85:
            notes.append("CTR高×維持率低 → 約束と中身がズレている。冒頭の約束回収を見直し、タイトルを内容に合わせる")
        elif ctr_r < 0.85 and apv_r < 0.85:
            notes.append("CTR低×維持率低 → 企画そのものが弱い。同じ型を続けない。テーマが良ければ別の角度でリメイク")
    if m["ret30"] is not None and v["med"].get("ret30") and m["ret30"] < v["med"]["ret30"] - 5:
        notes.append("30秒維持率が中央値より5pt以上低い → オープニング（フックと約束）を改善")
    if r.get("subs_per_1k") is not None and r["subs_per_1k"] < 0.7:
        notes.append("登録率が低い → 中盤CTAの位置、チャンネルの約束の伝え方を見直す")
    if m["end_ctr"] is not None and v["med"].get("end_ctr") and m["end_ctr"] < v["med"]["end_ctr"] * 0.7:
        notes.append("終了画面CTRが低い → 最後に次の動画を見る理由を言っているか確認")
    return notes or ["明確な弱点なし。全体的に少しずつ弱い → テーマの需要を確認"]


def main_source(m):
    sources = {"検索": m["search"], "ブラウジング": m["browse"], "関連動画": m["suggested"]}
    sources = {k: v for k, v in sources.items() if v is not None}
    if not sources:
        return "-"
    k = max(sources, key=sources.get)
    return f"{k} {sources[k]:.0f}%"


def fmt(x, digits=1, suffix=""):
    return "-" if x is None else f"{x:.{digits}f}{suffix}"


def analyze_group(videos, weights, label, is_long):
    lines = []
    if not videos:
        return lines
    keys = list(weights) + ["ret30", "end_ctr", "rpm"]
    med = medians(videos, keys)
    for v in videos:
        v["med"] = med
        v["index"], v["ratios"] = performance_index(v["m"], med, weights)
    scored = [v for v in videos if v["index"] is not None]
    scored.sort(key=lambda v: v["index"], reverse=True)

    n = len(scored)
    top_cut = max(1, round(n * 0.2))
    for i, v in enumerate(scored):
        if v["index"] >= WINNER_INDEX or (n >= 5 and i < top_cut and v["index"] > 1.0):
            v["label"] = "勝ち"
        elif v["index"] <= WEAK_INDEX or (n >= 5 and i >= n - top_cut and v["index"] < 1.0):
            v["label"] = "弱い"
        else:
            v["label"] = "標準"

    lines.append(f"## {label}（{n}本）\n")
    lines.append("### チャンネルの中央値（比較の基準）\n")
    if is_long:
        lines.append(
            f"視聴回数(28日) {fmt(med['views28'], 0)} / CTR {fmt(med['ctr'], 1, '%')} / "
            f"平均再生率 {fmt(med['apv'], 1, '%')} / 30秒維持率 {fmt(med['ret30'], 1, '%')} / "
            f"登録者増/1,000回 {fmt(med['subs_per_1k'], 1)} / エンゲージメント/1,000回 {fmt(med['eng_per_1k'], 1)}\n"
        )
    else:
        lines.append(
            f"視聴回数(28日) {fmt(med['views28'], 0)} / 視聴率 {fmt(med['viewed_rate'], 1, '%')} / "
            f"平均再生率 {fmt(med['apv'], 1, '%')} / 登録者増/1,000回 {fmt(med['subs_per_1k'], 2)}\n"
        )

    lines.append("### 動画ランキング（パフォーマンス指数順）\n")
    if is_long:
        lines.append("| 順位 | 判定 | 指数 | 動画 | 視聴(28日) | CTR | 平均再生率 | 30秒維持 | 登録/1k | 主な流入 |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|")
    else:
        lines.append("| 順位 | 判定 | 指数 | 動画 | 視聴(28日) | 視聴率 | 平均再生率 | 登録/1k |")
        lines.append("|---|---|---|---|---|---|---|---|")
    for i, v in enumerate(scored, 1):
        m = v["m"]
        title = f"{v['id']} {v['title']}"
        if is_long:
            lines.append(
                f"| {i} | {v['label']} | {v['index']:.2f} | {title} | {fmt(m['views28'], 0)} | "
                f"{fmt(m['ctr'], 1, '%')} | {fmt(m['apv'], 0, '%')} | {fmt(m['ret30'], 0, '%')} | "
                f"{fmt(m['subs_per_1k'], 1)} | {main_source(m)} |"
            )
        else:
            lines.append(
                f"| {i} | {v['label']} | {v['index']:.2f} | {title} | {fmt(m['views28'], 0)} | "
                f"{fmt(m['viewed_rate'], 0, '%')} | {fmt(m['apv'], 0, '%')} | {fmt(m['subs_per_1k'], 2)} |"
            )
    lines.append("")

    weak = [v for v in scored if v["label"] == "弱い"]
    if is_long and weak:
        lines.append("### 弱い動画の診断と改善案\n")
        for v in weak:
            lines.append(f"- **{v['id']} {v['title']}**（指数 {v['index']:.2f}）")
            for note in diagnose(v):
                lines.append(f"  - {note}")
        lines.append("")

    lines.append("### 属性別の勝ちパターン\n")
    lines.append(f"各属性の値ごとに、パフォーマンス指数の中央値を比較します。{MIN_SAMPLES}本未満は参考値です。\n")
    for attr in ATTRIBUTES:
        groups = {}
        for v in scored:
            key = (v["row"].get(attr) or "").strip()
            if key and key != "-":
                groups.setdefault(key, []).append(v["index"])
        if len(groups) < 2:
            continue
        lines.append(f"**{attr}**\n")
        lines.append("| 値 | 本数 | 指数の中央値 | 評価 |")
        lines.append("|---|---|---|---|")
        for key, vals in sorted(groups.items(), key=lambda kv: statistics.median(kv[1]), reverse=True):
            mi = statistics.median(vals)
            if len(vals) < MIN_SAMPLES:
                verdict = "参考（本数不足）"
            elif mi >= 1.2:
                verdict = "勝ちパターン候補 → 優先して増やす"
            elif mi <= 0.85:
                verdict = "弱い → 減らすか改善"
            else:
                verdict = "標準"
            lines.append(f"| {key} | {len(vals)} | {mi:.2f} | {verdict} |")
        lines.append("")
    return lines


def main():
    parser = argparse.ArgumentParser(description="YouTube 動画パフォーマンス分析")
    parser.add_argument("csv_path", help="video-performance.csv 形式の CSV")
    parser.add_argument("-o", "--output", help="出力する Markdown ファイル（省略時は標準出力）")
    args = parser.parse_args()

    with open(args.csv_path, encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("動画ID") or "").strip()]
    if not rows:
        sys.exit("データ行がありません。")

    videos = [
        {"id": r["動画ID"], "title": r.get("タイトル", ""), "fmt": (r.get("形式") or "L").strip().upper(),
         "row": r, "m": derive(r)}
        for r in rows
    ]
    longs = [v for v in videos if v["fmt"] != "S"]
    shorts = [v for v in videos if v["fmt"] == "S"]

    out = ["# 動画パフォーマンス分析レポート\n",
           "パフォーマンス指数：チャンネル中央値との比の加重幾何平均（1.00＝標準、"
           f"{WINNER_INDEX}以上＝勝ち、{WEAK_INDEX}以下＝弱い。本数が5本以上の場合は上位・下位20%も判定に使用）。\n"]
    out += analyze_group(longs, LONG_WEIGHTS, "長尺", True)
    out += analyze_group(shorts, SHORT_WEIGHTS, "Shorts", False)
    if len(longs) < 8:
        out.append("> 注意：長尺が8本未満のため、中央値と勝ちパターンの判定は不安定です。傾向の参考にとどめてください。\n")

    report = "\n".join(out)
    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(report)
    else:
        print(report)


if __name__ == "__main__":
    main()
