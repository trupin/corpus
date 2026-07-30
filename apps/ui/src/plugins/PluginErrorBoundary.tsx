import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The per-slot error boundary every plugin-supplied component renders inside
 * (SPEC.md §10: "a crashing column shows an error card in place, never takes
 * down the board").
 *
 * One boundary instance per `<plugin>/<role>/<type>` slot — never one around
 * the board, which would let a single crash blank everything. The error card
 * is terminal until remount: "Try again" re-renders once, and a component that
 * throws again lands right back here rather than looping. Navigating away and
 * back remounts the slot, which resets the boundary.
 */

export interface PluginErrorBoundaryProps {
  /** The owning plugin's directory name, shown on the card. */
  readonly plugin: string;
  /** Which slot crashed: `view`, `list-item`, `doc-panel` or `column`. */
  readonly role: string;
  readonly children?: ReactNode;
}

interface PluginErrorBoundaryState {
  readonly error: Error | null;
}

export class PluginErrorBoundary extends Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  override state: PluginErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[corpus] plugin ${this.props.plugin} ${this.props.role} crashed`,
      error,
      info.componentStack,
    );
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="col-card col-card-error plugin-error-card" role="alert">
        <p className="col-card-title">
          Plugin error — <code>{this.props.plugin}</code>
        </p>
        <p className="col-card-body">
          Its {this.props.role} crashed: {error.message === "" ? "render failed" : error.message}.
          The rest of the board is unaffected.
        </p>
        <button type="button" className="plugin-error-retry" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
