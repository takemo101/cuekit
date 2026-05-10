/**
 * Multiplexer-agnostic backend contract for spawning, addressing, and tearing
 * down task panes. Replaces the tmux-coupled `PaneBackend` shape so cuekit can
 * sit on top of tmux today and zellij (or another multiplexer) tomorrow
 * without leaking tmux-isms above this layer.
 *
 * See `docs/designs/cuekit-multiplexer-backend-design.md` for the phased
 * migration plan. This interface is the Phase 1 deliverable; the concrete
 * `TmuxBackend implementation` and zellij counterpart are filed as separate
 * issues.
 */

export interface SpawnPaneParams {
	task_id: string;
	cwd: string;
	/** Shell command line to run inside the pane. */
	command: string;
	env?: Record<string, string>;
	/**
	 * Optional file path the backend should mirror pane bytes into. tmux uses
	 * `pipe-pane` for this; backends without a continuous-stream equivalent
	 * (e.g. zellij) may populate the file via periodic snapshots.
	 */
	transcriptPath?: string;
}

export interface PaneHandle {
	task_id: string;
	/** Stable identifier for the backend that spawned this pane. */
	backend_kind: string;
	/** Backend-specific session identifier (tmux session name, zellij session name, etc.). */
	backend_session?: string;
	/** Backend-specific pane handle (tmux `%N`, zellij `terminal_N`, etc.). */
	backend_pane_id?: string;
}

export interface CaptureOptions {
	/** How far back into pane history to include in the capture. */
	scrollbackLines?: number;
}

export interface MultiplexerBackend {
	/** Stable identifier for this backend (`"tmux"`, `"zellij"`, ...). */
	readonly kind: string;

	/**
	 * The session name the given task currently resides in. For tmux today
	 * this is always `cuekit-task-<task_id>`; for zellij with team-dashboard
	 * support (Phase 4) this can be `cuekit-team-<team_id>` for tasks that
	 * belong to a team.
	 *
	 * Used by adapters for metadata fields and by the TUI for fallback
	 * lookups. Backends that need internal state (e.g. zellij team-session
	 * lookup) may resolve it from an internal map populated at spawn time.
	 */
	sessionNameFor(task_id: string): string;

	/**
	 * Spawn a new pane running the given command. Returns a handle the backend
	 * can use later to address the pane.
	 */
	spawnPane(params: SpawnPaneParams): Promise<PaneHandle>;

	/**
	 * Whether the backend can still see the pane (process / session alive).
	 * `false` → callers should treat the pane as gone.
	 */
	isAlive(task_id: string): Promise<boolean>;

	/**
	 * Send a literal string to the pane followed by a synthetic Enter. Caller
	 * passes the message exactly as it should appear on the input line; the
	 * backend simulates the trailing newline so steering call sites do not
	 * have to think about per-multiplexer newline conventions.
	 */
	sendKeys(task_id: string, message: string): Promise<void>;

	/**
	 * Capture the **current rendered screen** of the pane. Returns null when
	 * capture is not possible (pane gone, capture unsupported on this
	 * backend).
	 */
	capturePane(task_id: string, opts?: CaptureOptions): Promise<string | null>;

	/** Kill the pane and free any backend-side state for it. */
	killPane(task_id: string): Promise<void>;

	/**
	 * A backend-specific command line the operator can run from another shell
	 * to interactively attach to the pane. Returns null when the backend has
	 * no attach concept (e.g. a hypothetical headless backend).
	 */
	attachCommand(task_id: string): { argv: string[] } | null;
}
