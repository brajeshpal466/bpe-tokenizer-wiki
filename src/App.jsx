import React, { useState, useEffect, useMemo } from 'react';

// --- BPE tokenization helpers ---
function preTokenize(text) {
  if (!text) return [];
  const punct = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~।॥—–\u2018\u2019\u201C\u201D\u2022\u2026';
  const re = new RegExp(`([^\\s${punct.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]+|[${punct.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}])`, 'g');
  const tokens = [];
  for (const part of text.trim().split(/\s+/)) {
    if (!part) continue;
    const m = part.match(re);
    if (m) tokens.push(...m);
  }
  return tokens;
}

function tokenizeWord(word, mergeRanks) {
  let parts = [...word].concat(['</w>']);
  while (parts.length > 1) {
    let best = null, bestR = 1e9;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i] + '\0' + parts[i+1];
      if (k in mergeRanks && mergeRanks[k] < bestR) { bestR = mergeRanks[k]; best = i; }
    }
    if (best === null) break;
    const merged = parts[best] + parts[best+1];
    parts = [...parts.slice(0, best), merged, ...parts.slice(best+2)];
  }
  return parts;
}

// --- Language meta ---
const LANGS = [
  { id: 'en', name: 'English', native: 'English',    script: 'Latin',      color: '#fbbf24', icon: '🔤' },
  { id: 'hi', name: 'Hindi',   native: 'हिंदी',       script: 'Devanagari', color: '#a855f7', icon: '🕉️' },
  { id: 'te', name: 'Telugu',  native: 'తెలుగు',      script: 'Telugu',     color: '#14f0c5', icon: '✦' },
  { id: 'ta', name: 'Tamil',   native: 'தமிழ்',      script: 'Tamil',      color: '#60a5fa', icon: '◈' },
];

function fmt(n) { return n.toLocaleString(); }

export default function App() {
  const [stats, setStats]   = useState(null);
  const [vocab, setVocab]   = useState([]);
  const [merges, setMerges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const [inputText, setInputText]   = useState('');
  const [activeLang, setActiveLang] = useState('en');

  const [search, setSearch]     = useState('');
  const [typeF,  setTypeF]      = useState('all');
  const [langF,  setLangF]      = useState('all');
  const [page,   setPage]       = useState(0);
  const PER_PAGE = 25;

  // load data
  useEffect(() => {
    Promise.all([
      fetch('/stats.json').then(r => r.json()),
      fetch('/vocab.json').then(r => r.json()),
      fetch('/merges.json').then(r => r.json()),
    ]).then(([s, v, m]) => {
      setStats(s); setVocab(v); setMerges(m);
      setLoading(false);
    }).catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  // load article text when language tab changes
  useEffect(() => {
    fetch(`/data/${activeLang}_india.txt`)
      .then(r => r.text())
      .then(t => setInputText(t.slice(0, 1500)))
      .catch(() => {});
  }, [activeLang]);

  // build merge lookup
  const mergeRanks = useMemo(() => {
    const r = {};
    merges.forEach((m, i) => { r[m.pair[0] + '\0' + m.pair[1]] = i; });
    return r;
  }, [merges]);

  const vocabIdMap = useMemo(() => {
    const m = {}; vocab.forEach((t, i) => { m[t] = i; });
    return m;
  }, [vocab]);

  // live tokenization
  const tokResult = useMemo(() => {
    if (!inputText || !merges.length) return { words: 0, tokens: 0, ratio: 0, spans: [] };
    const words = preTokenize(inputText);
    const spans = [];
    let total = 0;
    words.forEach(w => {
      const subs = tokenizeWord(w, mergeRanks);
      total += subs.length;
      subs.forEach(s => spans.push({ text: s, id: vocabIdMap[s] ?? -1 }));
    });
    return { words: words.length, tokens: total, ratio: words.length / total, spans };
  }, [inputText, mergeRanks, vocabIdMap, merges.length]);

  // vocab table
  const filteredVocab = useMemo(() => {
    if (!vocab.length || !stats) return [];
    return vocab.map((token, id) => {
      const isBase = id < stats.base_size;
      const mi = id - stats.base_size;
      const m = (!isBase && merges[mi]) ? merges[mi] : null;
      return { id, token, isBase, lang: m?.lang ?? 'base', freq: m?.freq ?? '-', pair: m?.pair ?? null };
    }).filter(item => {
      if (search) {
        const q = search.toLowerCase();
        if (!item.token.toLowerCase().includes(q) && !String(item.id).includes(q)) return false;
      }
      if (typeF === 'base' && !item.isBase) return false;
      if (typeF === 'merge' && item.isBase) return false;
      if (langF !== 'all') {
        if (langF === 'base' && !item.isBase) return false;
        if (langF !== 'base' && item.lang !== langF) return false;
      }
      return true;
    });
  }, [vocab, merges, stats, search, typeF, langF]);

  useEffect(() => setPage(0), [search, typeF, langF]);
  const pageCount = Math.ceil(filteredVocab.length / PER_PAGE);
  const pageItems = filteredVocab.slice(page * PER_PAGE, (page+1) * PER_PAGE);

  // --- Render ---
  if (loading) return (
    <div className="loading">
      <div className="spinner" />
      <span>Initializing tokenizer engine…</span>
    </div>
  );

  if (error) return (
    <div className="loading error">
      ⚠ Failed to load data: {error}
    </div>
  );

  const ratioVals = stats ? Object.values(stats.ratios) : [];
  const xMax = stats ? Math.max(...ratioVals) : 0;
  const xMin = stats ? Math.min(...ratioVals) : 0;
  const totalMerges = stats ? Object.values(stats.allocations).reduce((a,b)=>a+b,0) : 0;

  return (
    <div className="app">
      {/* ── HERO ───────────────────────────────── */}
      <div className="hero">
        <div className="tricolor" />
        <div className="hero-content">
          <h1>
            Multilingual BPE{' '}
            <span className="highlight">Tokenizer Lab</span>
          </h1>
          <p className="subtitle">
            Cross-script <em>10K vocabulary</em> trained on India's Wikipedia corpus
            across four languages — engineered to minimize ratio spread
            with <em>score = 1000 / (X_max − X_min)</em>.
          </p>
          <div className="hero-badges">
            {LANGS.map(l => (
              <span key={l.id} className="badge">
                <span className="dot" style={{ background: l.color }} />
                {l.icon} {l.native}
              </span>
            ))}
            <span className="badge">
              <span className="dot" style={{ background: '#a855f7' }} />
              ⚡ {fmt(stats?.vocab_size ?? 10000)} vocab
            </span>
          </div>
        </div>
      </div>

      <div className="container">

        {/* ── SCORE CARD — Centered ──────────────── */}
        <div className="score-card">
          <div className="score-main">
            <div className="score-label">⚡ Optimization Score</div>
            <div className="score-value">{stats?.self_score.toFixed(2)}</div>
            <div className="score-formula">
              <code>score = 1000 / (X_max − X_min)</code>
              {' '}→{' '}
              <code>1000 / {stats?.diff.toFixed(6)}</code>
            </div>
          </div>
          <div className="score-details">
            <div className="metric">
              <span className="metric-label">Total Vocabulary</span>
              <span className="metric-value highlight">{fmt(stats?.vocab_size)}</span>
              <span className="metric-lang">{stats?.base_size} base + {stats?.merges_size} merges</span>
            </div>
            <div className="metric">
              <span className="metric-label">Ratio Spread Δ</span>
              <span className="metric-value green">{stats?.diff.toFixed(6)}</span>
              <span className="metric-lang">
                max {xMax.toFixed(6)} · min {xMin.toFixed(6)}
              </span>
            </div>
          </div>
        </div>

        {/* ── LANGUAGE RATIOS ────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              📊 Cross-Language Compression Ratios
            </h2>
          </div>
          <div className="lang-grid">
            {LANGS.map(l => {
              const r = stats?.ratios[l.id] ?? 0;
              const barPct = Math.min(r * 100, 100);
              return (
                <div key={l.id} className={`lang-card ${l.id}`}>
                  <div className="lang-card-header">
                    <span className="lang-name">{l.icon} {l.native}</span>
                    <span className="lang-code">{l.script}</span>
                  </div>
                  <div className="ratio-label">Compression Ratio (X_{l.id === 'en' ? '1' : l.id === 'hi' ? '2' : l.id === 'te' ? '3' : '4'})</div>
                  <div className="ratio-value">{r.toFixed(6)}</div>
                  <div className="ratio-bar-track">
                    <div className="ratio-bar-fill" style={{ width: `${barPct}%` }} />
                  </div>
                  <div className="lang-stats">
                    <div className="lang-stat-row">
                      <span className="lbl">Corpus words</span>
                      <span className="val">{fmt(stats?.word_counts[l.id] ?? 0)}</span>
                    </div>
                    <div className="lang-stat-row">
                      <span className="lbl">Output tokens</span>
                      <span className="val">{fmt(stats?.token_counts[l.id] ?? 0)}</span>
                    </div>
                    <div className="lang-stat-row">
                      <span className="lbl">Merge budget</span>
                      <span className="val">{fmt(stats?.allocations[l.id] ?? 0)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Merge allocation bar */}
          <div style={{ marginTop: '1.75rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--neon-purple)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem', fontWeight: 600 }}>
              Merge Budget Distribution — {fmt(totalMerges)} total merges
            </div>
            <div className="alloc-bar-track">
              {LANGS.map(l => {
                const pct = totalMerges ? ((stats?.allocations[l.id] ?? 0) / totalMerges * 100) : 0;
                return (
                  <div key={l.id} className={`alloc-seg ${l.id}`} style={{ width: `${pct}%` }}>
                    {pct > 8 ? `${l.id.toUpperCase()} ${pct.toFixed(1)}%` : ''}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
              {LANGS.map(l => (
                <span key={l.id} style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: l.color, boxShadow: `0 0 4px ${l.color}` }} />
                  {l.native}: {fmt(stats?.allocations[l.id] ?? 0)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── LIVE TOKENIZER ────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">🧪 Interactive Tokenizer</h2>
            <div className="lang-tabs">
              {LANGS.map(l => (
                <button
                  key={l.id}
                  className={`lang-tab ${activeLang === l.id ? 'active' : ''}`}
                  onClick={() => setActiveLang(l.id)}
                >
                  {l.icon} {l.name}
                </button>
              ))}
            </div>
          </div>

          <div className="tokenizer-layout">
            <div className="input-wrap">
              <label>Source Text</label>
              <textarea
                className="tok-input"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="Type or paste text in English, Hindi, Telugu, or Tamil…"
              />
            </div>

            <div className="tok-stats">
              <div style={{ fontSize: '0.72rem', color: 'var(--neon-purple)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: '0.4rem' }}>
                ⚙ Analysis
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">Pre-tokens</span>
                <span className="tok-stat-value">{fmt(tokResult.words)}</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">BPE output</span>
                <span className="tok-stat-value orange">{fmt(tokResult.tokens)}</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">W/T ratio</span>
                <span className="tok-stat-value green">{tokResult.ratio.toFixed(5)}</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">Compression %</span>
                <span className="tok-stat-value">{tokResult.tokens > 0 ? ((1 - tokResult.ratio) * 100).toFixed(1) : 0}%</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">Known tokens</span>
                <span className="tok-stat-value">{tokResult.spans.filter(s => s.id >= 0).length}</span>
              </div>
            </div>
          </div>

          <div className="tok-output-wrap">
            <div className="tok-output-label">Token Stream Visualization</div>
            <div className="tok-output">
              {tokResult.spans.length === 0
                ? <span className="tok-empty">Paste text above to visualize BPE decomposition…</span>
                : tokResult.spans.map((s, i) => {
                    const display = s.text.endsWith('</w>') ? s.text.slice(0, -4) + ' ' : s.text;
                    return (
                      <span key={i} className={`tok c${i % 6}`}>
                        {display}
                        <span className="tok-tip">
                          「{s.text}」 ID:{s.id} · {s.id < (stats?.base_size ?? 0) ? 'base' : 'merge'}
                        </span>
                      </span>
                    );
                  })
              }
            </div>
          </div>
        </div>

        {/* ── VOCABULARY EXPLORER ───────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">🔍 Token Database</h2>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              {fmt(filteredVocab.length)} / {fmt(stats?.vocab_size ?? 0)} tokens
            </span>
          </div>

          <div className="explorer-filters">
            <div className="search-box">
              <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                placeholder="Filter tokens by text or ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label>Type</label>
              <select className="filter-sel" value={typeF} onChange={e => setTypeF(e.target.value)}>
                <option value="all">All</option>
                <option value="base">Base chars</option>
                <option value="merge">BPE merges</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Script</label>
              <select className="filter-sel" value={langF} onChange={e => setLangF(e.target.value)}>
                <option value="all">All scripts</option>
                <option value="base">Base vocab</option>
                <option value="en">Latin (EN)</option>
                <option value="hi">Devanagari (HI)</option>
                <option value="te">Telugu (TE)</option>
                <option value="ta">Tamil (TA)</option>
              </select>
            </div>
          </div>

          <div className="token-table-wrap">
            <table className="token-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>ID</th>
                  <th>Token</th>
                  <th style={{ width: 90 }}>Kind</th>
                  <th style={{ width: 160 }}>Script</th>
                  <th>Merge Parents</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(item => (
                  <tr key={item.id}>
                    <td className="token-id">{item.id}</td>
                    <td className="token-text">
                      {item.token === '\n' ? '↵' : item.token === ' ' ? '⎵' : item.token}
                    </td>
                    <td>
                      <span className={`token-type-badge ${item.isBase ? 'base' : 'merge'}`}>
                        {item.isBase ? 'BASE' : 'MERGE'}
                      </span>
                    </td>
                    <td>
                      {!item.isBase && (
                        <span className={`lang-dot ${item.lang}`} />
                      )}
                      {item.isBase
                        ? <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Unicode base</span>
                        : (LANGS.find(l => l.id === item.lang)?.script ?? item.lang)
                      }
                    </td>
                    <td className="token-parents">
                      {item.pair ? `「${item.pair[0]}」+ 「${item.pair[1]}」` : '—'}
                    </td>
                    <td className="token-freq" style={{ textAlign: 'right' }}>{item.freq}</td>
                  </tr>
                ))}
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                      No tokens match current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <span className="page-info">
                <em>{page * PER_PAGE + 1}–{Math.min((page+1)*PER_PAGE, filteredVocab.length)}</em> of <em>{fmt(filteredVocab.length)}</em>
              </span>
              <div className="page-btns">
                <button className="page-btn" onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}>‹ Back</button>
                <span style={{ padding: '0.4rem 0.75rem', color: 'var(--muted)', fontSize: '0.85rem', fontFamily: 'var(--mono)' }}>
                  {page+1}/{pageCount}
                </span>
                <button className="page-btn" onClick={() => setPage(p => Math.min(pageCount-1, p+1))} disabled={page === pageCount-1}>Next ›</button>
              </div>
            </div>
          )}
        </div>

        {/* ── METHODOLOGY ────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">📐 How It Works</h2>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            The optimization objective is <strong style={{ color: 'var(--text-bright)' }}>score = 1000 / (X_max − X_min)</strong> where
            X_i = Words_i / Tokens_i per language. The achieved score of{' '}
            <strong style={{ color: 'var(--neon-teal)' }}>{stats?.self_score.toFixed(2)}</strong> equalizes
            all four ratios to ≈ <strong style={{ color: 'var(--text-bright)' }}>0.711</strong>.
          </p>
          <div className="method-grid">
            <div className="method-card">
              <h4>① Script Independence</h4>
              <p>
                Each language uses a <strong>distinct Unicode block</strong> — Latin, Devanagari,
                Telugu, Tamil — with minimal overlap (only digits and punctuation).
                This natural partition enables independent merge allocation.
              </p>
            </div>
            <div className="method-card">
              <h4>② Per-Corpus BPE Curves</h4>
              <p>
                Individual BPE models are trained per language, recording the
                W/T ratio at each merge step. This produces a{' '}
                <strong>compression curve</strong> mapping merge count → ratio.
              </p>
            </div>
            <div className="method-card">
              <h4>③ Greedy Ratio Balancing</h4>
              <p>
                At each step, the language with the <strong>lowest current ratio</strong> receives the next merge.
                This iterative balancing converges all four ratios using exactly{' '}
                <code>{fmt(totalMerges)}</code> total merges.
              </p>
            </div>
            <div className="method-card">
              <h4>④ Cross-Script Deduplication</h4>
              <p>
                Shared characters (ASCII digits, punctuation) can create{' '}
                <strong>duplicate merge entries</strong>. We deduplicate by keeping only the
                earliest-ranked merge, preserving a clean 10K vocabulary.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ── FOOTER ───────────────────────────────── */}
      <footer>
        Multilingual BPE Tokenizer Lab · <span>{fmt(stats?.vocab_size ?? 0)}</span> tokens ·
        Score <span>{stats?.self_score.toFixed(2)}</span> · Built on Wikipedia India (EN / HI / TE / TA)
      </footer>
    </div>
  );
}
