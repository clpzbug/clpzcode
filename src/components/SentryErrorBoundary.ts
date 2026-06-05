import * as React from 'react'
import { recordWeakPoint } from '../diagnostics/weakPoints.js'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

export class SentryErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error): void {
    recordWeakPoint(error, 'react')
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null
    }

    return this.props.children
  }
}
