import { Component, type ReactNode } from 'react'

// Keeps a crash in one panel from blanking the whole page; resets when `resetKey` changes (e.g. the active tab).
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(prev: { resetKey?: string }) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card p-6 text-center text-sm">
        <div className="font-bold mb-1">Bagian ini gagal ditampilkan</div>
        <div className="text-muted mb-3 text-xs">{this.state.error.message}</div>
        <button className="btn-primary" onClick={() => this.setState({ error: null })}>Coba lagi</button>
      </div>
    )
  }
}
