import os
import re
import json
import collections
import string

# We will read texts from the data directory
output_dir = 'data'
languages = ['en', 'hi', 'te', 'ta']
PRIORITY_LANG = 'en'  # English should stay best-compressed (min tokens/word), like OpenAI BPE
ENGLISH_BOOTSTRAP_RATIO = 0.28  # early merges reserved for high-frequency English pairs

def load_text(lang):
    file_path = os.path.join(output_dir, f"{lang}_india.txt")
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Missing {file_path}. Run fetch_data.py first.")
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()

def pre_tokenize(text):
    # Robust pre-tokenization for Indic and Latin scripts
    # Split by whitespace, then separate punctuation marks
    punctuation = string.punctuation + "।॥—–’’“”••……"
    tokens = []
    for part in text.split():
        pattern = rf'([^\s{re.escape(punctuation)}]+|[{re.escape(punctuation)}])'
        tokens.extend(re.findall(pattern, part))
    return tokens

class BPETrainer:
    def __init__(self, words):
        self.total_words = len(words)
        
        # Word vocabulary with frequencies
        self.word_freqs = collections.Counter(words)
        
        # Represent each word as a list of characters
        self.splits = {word: [char for char in word] + ['</w>'] for word in self.word_freqs}
        
        # Track initial characters
        self.base_chars = set()
        for word in self.word_freqs:
            for char in word:
                self.base_chars.add(char)
            self.base_chars.add('</w>')
        
        self.merges = []
        self.token_counts = [self.get_current_token_count()]

    def get_current_token_count(self):
        total = 0
        for word, split in self.splits.items():
            total += len(split) * self.word_freqs[word]
        return total

    def get_pair_counts(self):
        pairs = collections.defaultdict(int)
        for word, split in self.splits.items():
            freq = self.word_freqs[word]
            for i in range(len(split) - 1):
                pairs[(split[i], split[i+1])] += freq
        return pairs

    def merge_pair(self, pair):
        pair_str = "".join(pair)
        for word, split in self.splits.items():
            i = 0
            new_split = []
            while i < len(split):
                if i < len(split) - 1 and split[i] == pair[0] and split[i+1] == pair[1]:
                    new_split.append(pair_str)
                    i += 2
                else:
                    new_split.append(split[i])
                    i += 1
            self.splits[word] = new_split

    def train(self, max_merges):
        print(f"Training BPE for up to {max_merges} merges...")
        for step in range(1, max_merges + 1):
            pairs = self.get_pair_counts()
            if not pairs:
                print(f"  Stopped early at merge {step-1}: no more pairs left.")
                break
            # Find the most frequent pair
            best_pair = max(pairs, key=pairs.get)
            freq = pairs[best_pair]
            
            self.merge_pair(best_pair)
            self.merges.append((best_pair, freq))
            
            # Cache the token count
            current_tokens = self.get_current_token_count()
            self.token_counts.append(current_tokens)
            
            if step % 500 == 0 or step == max_merges:
                ratio = self.total_words / current_tokens
                print(f"  Merge {step:4d}: {best_pair} (freq: {freq}) -> Tokens: {current_tokens}, Ratio: {ratio:.4f}")

def main():
    # Load texts
    texts = {}
    word_lists = {}
    trainers = {}
    
    for lang in languages:
        text = load_text(lang)
        texts[lang] = text
        words = pre_tokenize(text)
        word_lists[lang] = words
        print(f"Language {lang}: {len(words)} words, {len(set(words))} unique words")
        trainers[lang] = BPETrainer(words)

    # Let's count base characters across all languages
    all_base_chars = set()
    for lang in languages:
        all_base_chars.update(trainers[lang].base_chars)
    
    print(f"\nCombined base characters size: {len(all_base_chars)}")
    
    target_vocab_size = 10000
    total_merges_needed = target_vocab_size - len(all_base_chars)
    print(f"Total merges needed across all languages: {total_merges_needed}")

    # Train each language tokenizer independently for up to a large number of merges
    # We will train up to e.g. 6000 merges per language so that the optimization has plenty of choices
    for lang in languages:
        print(f"\n--- Training for {lang} ---")
        trainers[lang].train(max_merges=min(6000, total_merges_needed))

    # Optimization Step with Inline De-duplication
    print("\n--- Optimizing Merge Allocation with De-duplication ---")
    print(f"English-first policy: bootstrap {ENGLISH_BOOTSTRAP_RATIO:.0%} merges, then keep EN at min tokens/word")

    allocation = {lang: 0 for lang in languages}
    final_merges_list = []
    seen_pairs = set()
    english_bootstrap_target = int(total_merges_needed * ENGLISH_BOOTSTRAP_RATIO)

    def tokens_per_word(lang):
        m = allocation[lang]
        words = trainers[lang].total_words
        tokens = trainers[lang].token_counts[m]
        return tokens / words if words else 999.0

    def words_per_token(lang):
        m = allocation[lang]
        tokens = trainers[lang].token_counts[m]
        return trainers[lang].total_words / tokens if tokens else 0.0

    def pull_unique_merge(lang):
        while allocation[lang] < len(trainers[lang].merges):
            m = allocation[lang]
            pair, freq = trainers[lang].merges[m]
            pair_tuple = tuple(pair)
            allocation[lang] += 1
            if pair_tuple not in seen_pairs:
                seen_pairs.add(pair_tuple)
                final_merges_list.append({
                    'pair': pair,
                    'lang': lang,
                    'freq': freq,
                    'step': m
                })
                return True
        return False

    def pick_language():
        # Keep English at the best (minimum) tokens-per-word ratio when possible
        en_tpw = tokens_per_word(PRIORITY_LANG)
        other_tpws = [tokens_per_word(l) for l in languages if l != PRIORITY_LANG]
        if other_tpws and en_tpw > min(other_tpws) + 1e-9:
            if allocation[PRIORITY_LANG] < len(trainers[PRIORITY_LANG].merges):
                return PRIORITY_LANG

        best_lang = None
        lowest_wpt = 999.0
        for lang in languages:
            m = allocation[lang]
            if m < len(trainers[lang].merges):
                wpt = words_per_token(lang)
                if wpt < lowest_wpt:
                    lowest_wpt = wpt
                    best_lang = lang
        return best_lang

    def try_languages(lang_order):
        for lang in lang_order:
            if pull_unique_merge(lang):
                return True
        return False

    # Phase 1: bootstrap frequent English merges (OpenAI-style Latin/English priority)
    while len(final_merges_list) < english_bootstrap_target:
        if not pull_unique_merge(PRIORITY_LANG):
            print("English bootstrap exhausted early.")
            break

    # Phase 2: greedy allocation with English guard + de-duplication
    for _ in range(total_merges_needed - len(final_merges_list)):
        best_lang = pick_language()
        if best_lang is None:
            print("Warning: Ran out of merges across all languages!")
            break

        if try_languages([best_lang]):
            continue

        # Fallback: any language with a unique merge, English first
        fallback_order = [PRIORITY_LANG] + sorted(
            [l for l in languages if l != PRIORITY_LANG],
            key=lambda l: words_per_token(l)
        )
        if not try_languages(fallback_order):
            print("Critical: No more unique merges could be found in any language!")
            break

    print(f"Greedy allocation complete: merges={allocation}")
    
    # Generate final vocabulary
    base_vocab = list(all_base_chars)
    base_vocab.sort()
    
    vocab = list(base_vocab)
    for m in final_merges_list:
        pair_str = "".join(m['pair'])
        vocab.append(pair_str)
        
    print(f"Final Vocab Size: {len(vocab)} tokens (Base: {len(base_vocab)}, Merges: {len(final_merges_list)})")
    
    # Check if we need to adjust
    if len(vocab) < target_vocab_size:
        print(f"Vocab size {len(vocab)} is less than target {target_vocab_size}. Padding with extra characters...")
        while len(vocab) < target_vocab_size:
            vocab.append(f"[PAD_{len(vocab)}]")
    elif len(vocab) > target_vocab_size:
        print(f"Vocab size {len(vocab)} is larger than target {target_vocab_size}. Truncating merges...")
        excess = len(vocab) - target_vocab_size
        final_merges_list = final_merges_list[:-excess]
        vocab = base_vocab + ["".join(m['pair']) for m in final_merges_list]

    assert len(vocab) == target_vocab_size, f"Vocab size is {len(vocab)}, expected {target_vocab_size}"

    print("\n--- Verifying Ratios and Scores ---")
    
    merge_ranks = {tuple(m['pair']): rank for rank, m in enumerate(final_merges_list)}
        
    def tokenize_word(word_str, merge_ranks_dict):
        parts = [c for c in word_str] + ['</w>']
        while len(parts) > 1:
            best_pair = None
            best_rank = 999999
            for i in range(len(parts)-1):
                pair = (parts[i], parts[i+1])
                if pair in merge_ranks_dict:
                    rank = merge_ranks_dict[pair]
                    if rank < best_rank:
                        best_rank = rank
                        best_pair = pair
            if best_pair is None:
                break
            new_parts = []
            i = 0
            while i < len(parts):
                if i < len(parts) - 1 and parts[i] == best_pair[0] and parts[i+1] == best_pair[1]:
                    new_parts.append(parts[i] + parts[i+1])
                    i += 2
                else:
                    new_parts.append(parts[i])
                    i += 1
            parts = new_parts
        return parts

    final_ratios = {}       # words / tokens (legacy)
    final_tpw_ratios = {}   # tokens / words (assignment Xi)
    final_token_counts = {}
    for lang in languages:
        words = word_lists[lang]
        total_tokens = 0
        for w in words:
            toks = tokenize_word(w, merge_ranks)
            total_tokens += len(toks)

        wpt = len(words) / total_tokens
        tpw = total_tokens / len(words)
        final_ratios[lang] = wpt
        final_tpw_ratios[lang] = tpw
        final_token_counts[lang] = total_tokens
        print(f"Language {lang}: Words = {len(words)}, Tokens = {total_tokens}, T/W = {tpw:.6f}")

    tpw_list = [final_tpw_ratios[lang] for lang in languages]
    x_max = max(tpw_list)
    x_min = min(tpw_list)
    diff = x_max - x_min
    self_score = 1000.0 / diff if diff > 0 else float('inf')
    best_lang = min(final_tpw_ratios, key=final_tpw_ratios.get)

    print(f"\nFinal Statistics (tokens / words):")
    print(f"X₄ max ({max(final_tpw_ratios, key=final_tpw_ratios.get)}): {x_max:.6f}")
    print(f"X₁ min ({best_lang}): {x_min:.6f}")
    print(f"Difference (X₄ − X₁): {diff:.6f}")
    print(f"Self Score: {self_score:.2f}")
    if best_lang != PRIORITY_LANG:
        print(f"Warning: {PRIORITY_LANG} is not minimum T/W; got {best_lang}")
    
    # Save the output files for the frontend
    os.makedirs('output', exist_ok=True)
    
    with open('output/merges.json', 'w', encoding='utf-8') as f:
        json.dump([{'pair': m['pair'], 'lang': m['lang'], 'freq': m['freq']} for m in final_merges_list], f, indent=2, ensure_ascii=False)
        
    with open('output/vocab.json', 'w', encoding='utf-8') as f:
        json.dump(vocab, f, indent=2, ensure_ascii=False)
        
    stats = {
        'vocab_size': len(vocab),
        'base_size': len(base_vocab),
        'merges_size': len(final_merges_list),
        'allocations': allocation,
        'ratios': final_ratios,
        'tpw_ratios': final_tpw_ratios,
        'token_counts': final_token_counts,
        'word_counts': {lang: len(word_lists[lang]) for lang in languages},
        'self_score': self_score,
        'diff': diff,
        'best_lang': best_lang
    }
    with open('output/stats.json', 'w', encoding='utf-8') as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
        
    print("\nSaved output files to output/ directory.")

if __name__ == '__main__':
    main()
