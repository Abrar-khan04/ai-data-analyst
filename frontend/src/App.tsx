import { useCallback, useRef, useState } from 'react'
import axios from 'axios'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '' })

/* ── Types ─────────────────────────────────────────────────────────────────── */
type ChartPayload = {
  type: 'bar' | 'line' | 'pie'
  data: Record<string, string | number>[]
  xKey: string
  dataKeys: string[]
}

type HistoryEntry = {
  question: string
  insight: string | null
  chart: ChartPayload | null
  table: Record<string, unknown>[] | null
  usedLlm: boolean | null
}

/* ── Color palette ─────────────────────────────────────────────────────────── */
const COLORS = [
  '#7c3aed', '#a855f7', '#6366f1', '#34d399',
  '#22d3ee', '#f472b6', '#fb923c', '#facc15',
  '#818cf8', '#4ade80',
]

const TOOLTIP_STYLE = {
  background: 'rgba(18, 22, 34, 0.95)',
  border: '1px solid rgba(42, 49, 80, 0.8)',
  borderRadius: '10px',
  backdropFilter: 'blur(8px)',
  color: '#e8eaf0',
  fontSize: '0.85rem',
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function renderInsight(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="text-accent-light font-semibold">{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

/* ── Chart component ───────────────────────────────────────────────────────── */
function ChartBlock({ chart }: { chart: ChartPayload }) {
  const { type, data, xKey, dataKeys } = chart
  const dk = dataKeys[0] ?? 'value'

  if (!data?.length) return null

  if (type === 'pie') {
    return (
      <div className="mt-4 animate-fade-in-up">
        <ResponsiveContainer width="100%" height={340}>
          <PieChart>
            <Pie
              data={data}
              dataKey={dk}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              outerRadius={120}
              innerRadius={60}
              strokeWidth={2}
              stroke="rgba(6, 8, 13, 0.6)"
              label={({ name, percent }) =>
                `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
              }
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend
              wrapperStyle={{ fontSize: '0.8rem', color: '#8892b0' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (type === 'line') {
    return (
      <div className="mt-4 animate-fade-in-up">
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={data}>
            <defs>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,49,80,0.4)" />
            <XAxis dataKey={xKey} tick={{ fill: '#8892b0', fontSize: 12 }} />
            <YAxis tick={{ fill: '#8892b0', fontSize: 12 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Line
              type="monotone"
              dataKey={dk}
              stroke="url(#lineGrad)"
              strokeWidth={3}
              dot={{ r: 4, fill: '#7c3aed', stroke: '#7c3aed' }}
              activeDot={{ r: 6, fill: '#a78bfa' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Bar chart (default)
  return (
    <div className="mt-4 animate-fade-in-up">
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data}>
          <defs>
            <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#4c1d95" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,49,80,0.4)" />
          <XAxis dataKey={xKey} tick={{ fill: '#8892b0', fontSize: 12 }} />
          <YAxis tick={{ fill: '#8892b0', fontSize: 12 }} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(124,58,237,0.08)' }} />
          <Bar dataKey={dk} fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Suggestion chips ──────────────────────────────────────────────────────── */
const SUGGESTIONS = [
  { icon: '📈', text: 'Show monthly sales trend' },
  { icon: '🏆', text: 'Top 5 products by revenue' },
  { icon: '🌍', text: 'Which region has highest sales?' },
  { icon: '💰', text: 'Average order value' },
]

/* ── Main App ──────────────────────────────────────────────────────────────── */
export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const [rows, setRows] = useState(0)
  const [columns, setColumns] = useState<string[]>([])
  const [preview, setPreview] = useState<Record<string, unknown>[]>([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  /* Upload handler */
  const onFile = useCallback(async (file: File | null) => {
    if (!file) return
    setError(null)
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await api.post<{
        session_id: string
        filename: string
        rows: number
        columns: string[]
        preview: Record<string, unknown>[]
      }>('/api/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setSessionId(data.session_id)
      setFilename(data.filename)
      setRows(data.rows)
      setColumns(data.columns)
      setPreview(data.preview)
      setHistory([])
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && e.response?.data?.detail
          ? String(e.response.data.detail)
          : 'Upload failed'
      setError(msg)
    } finally {
      setUploading(false)
    }
  }, [])

  /* Query handler */
  const ask = useCallback(async (q?: string) => {
    const query = (q ?? question).trim()
    if (!sessionId || !query) return
    setLoading(true)
    setError(null)
    setQuestion('')
    try {
      const { data } = await api.post<{
        insight: string
        chart: ChartPayload | null
        table: Record<string, unknown>[] | null
        used_llm: boolean
      }>('/api/query', { session_id: sessionId, question: query })
      setHistory((prev) => [
        ...prev,
        {
          question: query,
          insight: data.insight,
          chart: data.chart,
          table: data.table,
          usedLlm: data.used_llm,
        },
      ])
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && e.response?.data?.detail
          ? String(e.response.data.detail)
          : 'Request failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [sessionId, question])

  /* Drag and drop */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) onFile(file)
    },
    [onFile],
  )

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-surface-900 relative overflow-hidden">
      {/* Background decorative orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden>
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-80 h-80 rounded-full bg-emerald/5 blur-3xl" />
        <div className="absolute bottom-20 left-1/4 w-64 h-64 rounded-full bg-accent/3 blur-3xl" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-32">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent to-emerald flex items-center justify-center text-2xl animate-float shadow-lg shadow-accent/20">
              ◈
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight gradient-text">
                AI Data Analyst
              </h1>
              <p className="text-text-muted text-sm mt-0.5">
                Upload CSV · Ask in plain English · Get instant insights
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {sessionId && (
              <div className="flex items-center gap-2 glass-panel-sm text-xs text-text-muted">
                <span className="pulse-dot" />
                Session active
              </div>
            )}
            <a
              href="/sample_sales.csv"
              download
              id="download-sample"
              className="text-sm px-4 py-2 rounded-xl border border-border text-accent-light hover:bg-accent-dim hover:border-accent transition-all duration-300"
            >
              ↓ Sample CSV
            </a>
          </div>
        </header>

        {/* ── Upload Section ──────────────────────────────────────────────── */}
        {!sessionId ? (
          <section className="animate-fade-in-up" id="upload-section">
            <div className="glass-panel glow-accent p-8 sm:p-12 text-center">
              <div className="mb-6">
                <div className="text-5xl mb-4">📊</div>
                <h2 className="text-xl font-semibold text-text-primary mb-2">
                  Upload your dataset
                </h2>
                <p className="text-text-muted text-sm max-w-md mx-auto">
                  Drop a CSV file to start analyzing. Our AI will parse your data and let you ask
                  questions in natural language.
                </p>
              </div>

              <label
                id="dropzone"
                className={`
                  group relative flex flex-col items-center justify-center
                  min-h-[180px] rounded-2xl border-2 border-dashed cursor-pointer
                  transition-all duration-300
                  ${isDragOver
                    ? 'border-accent bg-accent-dim scale-[1.01]'
                    : 'border-border hover:border-accent/60 hover:bg-accent-dim/50'
                  }
                `}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  id="csv-upload-input"
                />
                {uploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-3 border-accent/30 border-t-accent rounded-full animate-spin-slow" />
                    <span className="text-text-muted text-sm">Processing…</span>
                  </div>
                ) : (
                  <>
                    <div className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-300">
                      {isDragOver ? '📥' : '☁️'}
                    </div>
                    <span className="text-text-muted text-sm">
                      {isDragOver ? 'Release to upload' : 'Drop CSV here or click to browse'}
                    </span>
                    <span className="text-text-muted/50 text-xs mt-1">
                      Max 50 MB · .csv files only
                    </span>
                  </>
                )}
              </label>
            </div>
          </section>
        ) : (
          /* ── Data loaded — main workspace ─────────────────────────────── */
          <div className="animate-fade-in-up space-y-6">
            {/* File info bar */}
            <div className="glass-panel-sm flex flex-wrap items-center justify-between gap-3" id="file-info">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📄</span>
                <div>
                  <p className="font-medium text-text-primary text-sm">{filename}</p>
                  <p className="text-text-muted text-xs">
                    {rows.toLocaleString()} rows · {columns.length} columns
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {columns.slice(0, 6).map((c) => (
                    <span
                      key={c}
                      className="text-[0.65rem] px-2 py-0.5 rounded-full bg-surface-600 text-text-muted border border-border"
                    >
                      {c}
                    </span>
                  ))}
                  {columns.length > 6 && (
                    <span className="text-[0.65rem] px-2 py-0.5 rounded-full bg-surface-600 text-text-muted border border-border">
                      +{columns.length - 6} more
                    </span>
                  )}
                </div>
                <button
                  id="new-upload-btn"
                  onClick={() => {
                    setSessionId(null)
                    setFilename(null)
                    setRows(0)
                    setColumns([])
                    setPreview([])
                    setHistory([])
                  }}
                  className="ml-2 text-xs px-3 py-1.5 rounded-lg border border-border text-text-muted hover:text-rose hover:border-rose/40 transition-colors"
                >
                  New file
                </button>
              </div>
            </div>

            {/* Preview table */}
            {preview.length > 0 && (
              <details className="glass-panel group" id="preview-section">
                <summary className="cursor-pointer text-sm font-medium text-text-muted select-none flex items-center gap-2 hover:text-text-primary transition-colors">
                  <span className="transition-transform duration-200 group-open:rotate-90">▶</span>
                  Data Preview (first 10 rows)
                </summary>
                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th
                            key={c}
                            className="px-3 py-2.5 text-left font-medium text-text-muted bg-surface-800/80 border-b border-border whitespace-nowrap"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-border/50 hover:bg-surface-700/40 transition-colors"
                        >
                          {columns.map((c) => (
                            <td key={c} className="px-3 py-2 whitespace-nowrap text-text-primary/80">
                              {String(row[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* ── Chat / Conversation history ────────────────────────────── */}
            <div className="space-y-4" id="chat-area">
              {history.map((entry, idx) => (
                <div key={idx} className="space-y-3 animate-fade-in-up">
                  {/* User question bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-gradient-to-r from-accent to-accent/80 text-white text-sm font-medium shadow-lg shadow-accent/10">
                      {entry.question}
                    </div>
                  </div>

                  {/* AI response */}
                  <div className="glass-panel space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🤖</span>
                      <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                        AI Insight
                      </span>
                      {entry.usedLlm !== null && (
                        <span
                          className={`text-[0.6rem] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${
                            entry.usedLlm
                              ? 'bg-emerald-dim text-emerald'
                              : 'bg-accent-dim text-accent-light'
                          }`}
                        >
                          {entry.usedLlm ? '✦ AI Model' : '⚡ Heuristic'}
                        </span>
                      )}
                    </div>

                    {entry.insight && (
                      <p className="text-text-primary text-[0.95rem] leading-relaxed">
                        {renderInsight(entry.insight)}
                      </p>
                    )}

                    {entry.chart && <ChartBlock chart={entry.chart} />}

                    {entry.table && entry.table.length > 0 && (
                      <details className="group/table">
                        <summary className="cursor-pointer text-xs text-text-muted hover:text-text-primary transition-colors select-none flex items-center gap-1.5 mt-2">
                          <span className="transition-transform duration-200 group-open/table:rotate-90">
                            ▶
                          </span>
                          View data table ({entry.table.length} rows)
                        </summary>
                        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr>
                                {Object.keys(entry.table[0]).map((k) => (
                                  <th
                                    key={k}
                                    className="px-3 py-2 text-left font-medium text-text-muted bg-surface-800/80 border-b border-border whitespace-nowrap"
                                  >
                                    {k}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {entry.table.map((row, i) => (
                                <tr
                                  key={i}
                                  className="border-b border-border/50 hover:bg-surface-700/40 transition-colors"
                                >
                                  {Object.keys(entry.table![0]).map((k) => (
                                    <td key={k} className="px-3 py-2 whitespace-nowrap text-text-primary/80">
                                      {String(row[k] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}

              {/* Loading skeleton */}
              {loading && (
                <div className="glass-panel space-y-3 animate-fade-in-up">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🤖</span>
                    <span className="text-xs text-text-muted">Analyzing your data…</span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 w-3/4 rounded-lg shimmer" />
                    <div className="h-4 w-1/2 rounded-lg shimmer" />
                    <div className="h-32 w-full rounded-lg shimmer mt-3" />
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* ── Suggestion chips (show when no history yet) ─────────────── */}
            {history.length === 0 && !loading && (
              <div className="text-center space-y-4 py-6" id="suggestions-section">
                <p className="text-text-muted text-sm">Try asking a question:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.text}
                      onClick={() => ask(s.text)}
                      className="
                        flex items-center gap-2 px-4 py-2.5 rounded-xl
                        text-sm text-text-muted
                        bg-surface-700/50 border border-border
                        hover:bg-accent-dim hover:border-accent/40 hover:text-accent-light
                        transition-all duration-300 hover:scale-[1.02]
                      "
                    >
                      <span>{s.icon}</span>
                      {s.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Error toast ──────────────────────────────────────────────────── */}
        {error && (
          <div className="fixed top-6 right-6 z-50 animate-fade-in-up" id="error-toast">
            <div className="glass-panel-sm border-rose/40 bg-rose-dim/80 flex items-center gap-3 max-w-sm shadow-lg">
              <span className="text-rose text-lg">⚠</span>
              <p className="text-rose text-sm flex-1">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-rose/60 hover:text-rose transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer className="mt-12 pt-6 border-t border-border text-center" id="footer">
          <p className="text-text-muted text-xs">
            Set{' '}
            <code className="px-1.5 py-0.5 rounded bg-surface-700 text-accent-light text-[0.7rem]">
              GEMINI_API_KEY
            </code>{' '}
            for AI-powered NL understanding · Falls back to built-in heuristic rules
          </p>
          <p className="text-text-muted/40 text-[0.65rem] mt-2">
            Express.js + FastAPI + React · Recharts · Gemini AI
          </p>
        </footer>
      </div>

      {/* ── Sticky input bar ───────────────────────────────────────────────── */}
      {sessionId && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-gradient-to-t from-surface-900 via-surface-900/95 to-transparent pt-6 pb-5 px-4" id="query-bar">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 items-end glass-panel-sm glow-accent p-2 pl-4">
              <input
                id="query-input"
                type="text"
                placeholder={sessionId ? 'Ask anything about your data…' : 'Upload a CSV first'}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && ask()}
                disabled={!sessionId || loading}
                className="
                  flex-1 bg-transparent border-none outline-none
                  text-text-primary placeholder-text-muted/60 text-sm py-2
                  disabled:opacity-40
                "
              />
              <button
                id="analyze-btn"
                type="button"
                onClick={() => ask()}
                disabled={!sessionId || loading || !question.trim()}
                className="
                  px-5 py-2.5 rounded-xl font-semibold text-sm text-white
                  bg-gradient-to-r from-accent to-purple-500
                  hover:from-accent/90 hover:to-purple-500/90
                  disabled:opacity-30 disabled:cursor-not-allowed
                  transition-all duration-300 hover:shadow-lg hover:shadow-accent/20
                  active:scale-[0.97]
                  flex items-center gap-2
                "
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing
                  </>
                ) : (
                  <>
                    <span>✦</span>
                    Analyze
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
