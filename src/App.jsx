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
  { id: 'en', name: 'English', native: 'English',    script: 'Latin',      color: '#FF9933' },
  { id: 'hi', name: 'Hindi',   native: 'हिंदी',       script: 'Devanagari', color: '#7c3aed' },
  { id: 'te', name: 'Telugu',  native: 'తెలుగు',      script: 'Telugu',     color: '#138808' },
  { id: 'ta', name: 'Tamil',   native: 'தமிழ்',      script: 'Tamil',      color: '#0ea5e9' },
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
      Loading BPE tokenizer data…
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
            India BPE Tokenizer —{' '}
            <span className="highlight">Multilingual</span>
          </h1>
          <p className="subtitle">
            A shared <em>10,000-token BPE vocabulary</em> trained on Wikipedia's India
            article in English, Hindi, Telugu &amp; Tamil — optimized to maximize the
            assignment score <em>1000 / (X_max − X_min)</em>.
          </p>
          <div className="hero-badges">
            {LANGS.map(l => (
              <span key={l.id} className="badge">
                <span className="dot" style={{ background: l.color }} />
                {l.native} ({l.script})
              </span>
            ))}
            <span className="badge">
              <span className="dot" style={{ background: '#888' }} />
              {fmt(stats?.vocab_size ?? 10000)} tokens
            </span>
          </div>
        </div>
      </div>

      <div className="container">

        {/* ── SCORE CARD ─────────────────────────── */}
        <div className="score-card">
          <div className="score-main">
            <div className="score-label">Assignment Self-Score</div>
            <div className="score-value">{stats?.self_score.toFixed(2)}</div>
            <div className="score-formula">
              Formula: <code>1000 / (X_max − X_min)</code>
              {' '}= <code>1000 / {stats?.diff.toFixed(6)}</code>
            </div>
          </div>
          <div className="score-details">
            <div className="metric">
              <span className="metric-label">Vocab Size</span>
              <span className="metric-value highlight">{fmt(stats?.vocab_size)}</span>
              <span className="metric-lang">{stats?.base_size} base chars + {stats?.merges_size} BPE merges</span>
            </div>
            <div className="metric">
              <span className="metric-label">Ratio Spread (X_max − X_min)</span>
              <span className="metric-value green">{stats?.diff.toFixed(6)}</span>
              <span className="metric-lang">
                X_max = {xMax.toFixed(6)} &nbsp;|&nbsp; X_min = {xMin.toFixed(6)}
              </span>
            </div>
          </div>
        </div>

        {/* ── LANGUAGE RATIOS ────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              Language Tokenization Ratios (Words / Tokens)
            </h2>
          </div>
          <div className="lang-grid">
            {LANGS.map(l => {
              const r = stats?.ratios[l.id] ?? 0;
              const barPct = Math.min(r * 100, 100);
              return (
                <div key={l.id} className={`lang-card ${l.id}`}>
                  <div className="lang-card-header">
                    <span className="lang-name">{l.native}</span>
                    <span className="lang-code">{l.id.toUpperCase()}</span>
                  </div>
                  <div className="ratio-label">Words / Tokens (X_{l.id === 'en' ? '1' : l.id === 'hi' ? '2' : l.id === 'te' ? '3' : '4'})</div>
                  <div className="ratio-value">{r.toFixed(6)}</div>
                  <div className="ratio-bar-track">
                    <div className="ratio-bar-fill" style={{ width: `${barPct}%` }} />
                  </div>
                  <div className="lang-stats">
                    <div className="lang-stat-row">
                      <span className="lbl">Words in corpus</span>
                      <span className="val">{fmt(stats?.word_counts[l.id] ?? 0)}</span>
                    </div>
                    <div className="lang-stat-row">
                      <span className="lbl">Tokens produced</span>
                      <span className="val">{fmt(stats?.token_counts[l.id] ?? 0)}</span>
                    </div>
                    <div className="lang-stat-row">
                      <span className="lbl">Merges allocated</span>
                      <span className="val">{fmt(stats?.allocations[l.id] ?? 0)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Merge allocation bar */}
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', fontWeight: 600 }}>
              BPE Merge Allocation across Languages ({fmt(totalMerges)} total)
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
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
              {LANGS.map(l => (
                <span key={l.id} style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: l.color, marginRight: 4 }} />
                  {l.native}: {fmt(stats?.allocations[l.id] ?? 0)} merges
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── LIVE TOKENIZER ────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Live BPE Tokenizer</h2>
            <div className="lang-tabs">
              {LANGS.map(l => (
                <button
                  key={l.id}
                  className={`lang-tab ${activeLang === l.id ? 'active' : ''}`}
                  onClick={() => setActiveLang(l.id)}
                >
                  {l.native}
                </button>
              ))}
            </div>
          </div>

          <div className="tokenizer-layout">
            <div className="input-wrap">
              <label>Input Text (edit freely)</label>
              <textarea
                className="tok-input"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="Type or paste text in any of the four languages…"
              />
            </div>

            <div className="tok-stats">
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '0.25rem' }}>
                Tokenization Stats
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">Words (pre-tokenized)</span>
                <span className="tok-stat-value">{fmt(tokResult.words)}</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">BPE Tokens</span>
                <span className="tok-stat-value orange">{fmt(tokResult.tokens)}</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">Ratio W/T</span>
                <span className="tok-stat-value green">{tokResult.ratio.toFixed(5)}</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">Compression</span>
                <span className="tok-stat-value">{tokResult.tokens > 0 ? ((1 - tokResult.ratio) * 100).toFixed(1) : 0}%</span>
              </div>
              <div className="tok-stat-row">
                <span className="tok-stat-label">Vocab hits</span>
                <span className="tok-stat-value">{tokResult.spans.filter(s => s.id >= 0).length}</span>
              </div>
            </div>
          </div>

          <div className="tok-output-wrap">
            <div className="tok-output-label">Token Visualization (hover for details)</div>
            <div className="tok-output">
              {tokResult.spans.length === 0
                ? <span className="tok-empty">Enter text above to see BPE tokenization…</span>
                : tokResult.spans.map((s, i) => {
                    const display = s.text.endsWith('</w>') ? s.text.slice(0, -4) + ' ' : s.text;
                    return (
                      <span key={i} className={`tok c${i % 6}`}>
                        {display}
                        <span className="tok-tip">
                          "{s.text}" · ID {s.id} · {s.id < (stats?.base_size ?? 0) ? 'base char' : 'merge'}
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
            <h2 className="panel-title">Vocabulary Explorer — All 10,000 Tokens</h2>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              {fmt(filteredVocab.length)} tokens shown
            </span>
          </div>

          <div className="explorer-filters">
            <div className="search-box">
              <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                placeholder="Search tokens…"
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
              <label>Language</label>
              <select className="filter-sel" value={langF} onChange={e => setLangF(e.target.value)}>
                <option value="all">All</option>
                <option value="base">Base vocab</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="te">Telugu</option>
                <option value="ta">Tamil</option>
              </select>
            </div>
          </div>

          <div className="token-table-wrap">
            <table className="token-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>ID</th>
                  <th>Token</th>
                  <th style={{ width: 90 }}>Type</th>
                  <th style={{ width: 160 }}>Language</th>
                  <th>BPE Parents</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Freq</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(item => (
                  <tr key={item.id}>
                    <td className="token-id">{item.id}</td>
                    <td className="token-text">
                      {item.token === '\n' ? '\\n' : item.token === ' ' ? '[space]' : item.token}
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
                        ? <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Base Vocab</span>
                        : (LANGS.find(l => l.id === item.lang)?.name ?? item.lang)
                      }
                    </td>
                    <td className="token-parents">
                      {item.pair ? `"${item.pair[0]}" + "${item.pair[1]}"` : '—'}
                    </td>
                    <td className="token-freq" style={{ textAlign: 'right' }}>{item.freq}</td>
                  </tr>
                ))}
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                      No tokens match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <span className="page-info">
                Showing <em>{page * PER_PAGE + 1}–{Math.min((page+1)*PER_PAGE, filteredVocab.length)}</em> of <em>{fmt(filteredVocab.length)}</em>
              </span>
              <div className="page-btns">
                <button className="page-btn" onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}>← Prev</button>
                <span style={{ padding: '0.4rem 0.75rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  {page+1} / {pageCount}
                </span>
                <button className="page-btn" onClick={() => setPage(p => Math.min(pageCount-1, p+1))} disabled={page === pageCount-1}>Next →</button>
              </div>
            </div>
          )}
        </div>

        {/* ── METHODOLOGY ────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Methodology &amp; Score Calculation</h2>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            The assignment score is <strong style={{ color: 'var(--text)' }}>1000 / (X_max − X_min)</strong> where
            X_i = Words_i / Tokens_i for each language. Our score is{' '}
            <strong style={{ color: 'var(--saffron)' }}>{stats?.self_score.toFixed(2)}</strong> — achieved by
            equalizing all four ratios to ≈ <strong style={{ color: 'var(--text)' }}>0.711</strong>.
          </p>
          <div className="method-grid">
            <div className="method-card">
              <h4>1 · Script Disjointness</h4>
              <p>
                English (Latin), Hindi (Devanagari), Telugu, and Tamil use{' '}
                <strong>entirely separate Unicode blocks</strong> (except digits/punctuation).
                This means BPE merge lists are naturally partitioned — we can tune per-language
                merge counts independently.
              </p>
            </div>
            <div className="method-card">
              <h4>2 · Per-Language BPE Training</h4>
              <p>
                We trained separate BPE tokenizers on each language corpus, recording the
                ratio W/T at every merge step. This gives us a{' '}
                <strong>ratio-vs-merges curve</strong> for each language.
              </p>
            </div>
            <div className="method-card">
              <h4>3 · Greedy Equalization</h4>
              <p>
                A greedy loop selects the language with the <strong>lowest current ratio</strong>{' '}
                and adds one more merge from it. This iteratively pulls all four ratios toward
                the same value using exactly <code>{fmt(totalMerges)}</code> total merges.
              </p>
            </div>
            <div className="method-card">
              <h4>4 · Inline De-duplication</h4>
              <p>
                Latin characters appear in all languages (numbers, punctuation). We{' '}
                <strong>de-duplicate shared merges</strong>, keeping only the earliest rank.
                This prevents tokenization corruption and ensures the 10 000-token vocabulary
                is exact.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ── FOOTER ───────────────────────────────── */}
      <footer>
        India Multilingual BPE Tokenizer · Vocab: <span>{fmt(stats?.vocab_size ?? 0)} tokens</span> ·
        Score: <span>{stats?.self_score.toFixed(2)}</span> · Wikipedia India pages (EN / HI / TE / TA)
      </footer>
    </div>
  );
}
