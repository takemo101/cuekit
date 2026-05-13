import type { TaskSummary, TeamSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import type { TuiTeamDetail } from "../data.ts";
import { truncateEnd } from "../format.ts";
import type { TeamDetailTab, TeamFocus } from "../tui-state.ts";
import { statusAccent, statusGlyph, theme } from "../theme.ts";

const LANE_ORDER = ["coordinator", "worker", "reviewer", "finisher", "observer", "unpositioned"];

function memberLine(task: TaskSummary, selected: boolean): string {
	const marker = selected ? "›" : " ";
	const role = task.role ?? task.position ?? task.agent_kind;
	return truncateEnd(
		`${marker} ${statusGlyph(task.status)} ${task.task_id} ${(task.position ?? "-").padEnd(11)} ${role}`,
		84,
	);
}

function LaneRow(props: { lane: string; tasks: TaskSummary[] }): ReactNode {
	return (
		<box height={1}>
			<text fg={theme.muted}>{props.lane.padEnd(12).slice(0, 12)}</text>
			<text fg={theme.text}>
				{truncateEnd(
					props.tasks.map((task) => `${statusGlyph(task.status)} ${task.task_id}`).join("  ") || "-",
					76,
				)}
			</text>
		</box>
	);
}

function teamCounts(team: TeamSummary, detail?: TuiTeamDetail): TeamSummary["task_counts"] {
	return detail?.status?.task_counts ?? team.task_counts;
}

function firstNextAction(detail?: TuiTeamDetail): string | undefined {
	const blocker = detail?.blockers?.[0];
	if (blocker) return `Next: inspect blocker ${blocker.task_id}`;
	const attention = detail?.attentionItems?.[0];
	if (attention?.task_id) return `Next: inspect attention item ${attention.task_id}`;
	const hint = detail?.manualSteerHints?.[0];
	if (hint?.task_id) return `Next: consider steering ${hint.task_id}`;
	return undefined;
}

function renderOverview(team: TeamSummary, detail?: TuiTeamDetail): ReactNode {
	const counts = teamCounts(team, detail);
	const attention = detail?.attentionItems?.length ?? 0;
	const blockers = detail?.blockers?.length ?? 0;
	const handoffs = detail?.latestHandoffs?.length ?? 0;
	const blackboard = detail?.blackboardEvents?.length ?? 0;
	return (
		<>
			<text fg={theme.text}>{`Tasks: ${counts.running} running / ${counts.blocked} blocked / ${counts.completed} completed`}</text>
			<text fg={theme.text}>{`Attention: ${attention}   Blockers: ${blockers}   Handoffs: ${handoffs}   Blackboard: ${blackboard}`}</text>
			{firstNextAction(detail) ? <text fg={theme.yellow}>{firstNextAction(detail)}</text> : <text fg={theme.muted}>No immediate action suggested.</text>}
		</>
	);
}

function renderMembers(detail: TuiTeamDetail | undefined, selectedMemberIndex: number, focus: TeamFocus): ReactNode {
	return (
		<>
			<text fg={theme.cyan}>LANES</text>
			{LANE_ORDER.map((lane) => (
				<LaneRow key={lane} lane={lane} tasks={detail?.lanes[lane] ?? []} />
			))}
			<text fg={theme.cyan}>MEMBERS</text>
			{detail?.members.length ? (
				detail.members.map((member, index) => {
					const selected = index === selectedMemberIndex;
					return (
						<text key={member.task_id} fg={selected && focus === "members" ? theme.strong : statusAccent(member.status)}>
							{memberLine(member, selected && focus === "members")}
						</text>
					);
				})
			) : (
				<text fg={theme.muted}>No member tasks.</text>
			)}
		</>
	);
}

function renderAttention(detail?: TuiTeamDetail): ReactNode {
	const attention = detail?.attentionItems ?? [];
	const hints = detail?.manualSteerHints ?? [];
	const blockers = detail?.blockers ?? [];
	return (
		<>
			<text fg={theme.cyan}>{`BLOCKERS ${blockers.length}`}</text>
			{blockers.length === 0 ? (
				<text fg={theme.muted}>No blockers.</text>
			) : (
				blockers.slice(0, 5).map((item) => (
					<text key={`${item.task_id}:blocker`} fg={theme.red}>
						{truncateEnd(`${item.position ?? "?"} ${item.task_id}: ${item.message}`, 90)}
					</text>
				))
			)}
			<text fg={theme.cyan}>{`ATTENTION ${attention.length}`}</text>
			{attention.length === 0 ? (
				<text fg={theme.muted}>No attention items.</text>
			) : (
				attention.slice(0, 5).map((item) => (
					<text key={`${item.sequence}:${item.task_id}`} fg={theme.yellow}>
						{truncateEnd(`${item.position ?? "?"} ${item.task_id}: ${item.message_preview ?? item.message ?? item.type}`, 90)}
					</text>
				))
			)}
			<text fg={theme.cyan}>{`STEER HINTS ${hints.length}`}</text>
			{hints.length === 0 ? (
				<text fg={theme.muted}>No manual steer hints.</text>
			) : (
				hints.slice(0, 5).map((hint) => (
					<text key={`${hint.attention_sequence}:${hint.task_id}`} fg={theme.muted}>
						{truncateEnd(`${hint.position ?? "?"} ${hint.task_id}: ${hint.suggested_message}`, 90)}
					</text>
				))
			)}
		</>
	);
}

function renderKnowledge(detail?: TuiTeamDetail): ReactNode {
	const handoffs = detail?.latestHandoffs ?? [];
	const blackboard = detail?.blackboardEvents ?? [];
	return (
		<>
			<text fg={theme.cyan}>{`HANDOFFS ${handoffs.length}`}</text>
			{handoffs.length === 0 ? (
				<text fg={theme.muted}>No handoffs.</text>
			) : (
				handoffs.slice(-5).map((item) => (
					<text key={item.event_id} fg={theme.purple}>
						{truncateEnd(`${item.position ?? "?"} ${item.task_id}: ${item.message_preview ?? item.event_id}`, 90)}
					</text>
				))
			)}
			<text fg={theme.cyan}>{`BLACKBOARD ${blackboard.length}`}</text>
			{blackboard.length === 0 ? (
				<text fg={theme.muted}>No blackboard events.</text>
			) : (
				blackboard.slice(-5).map((event) => (
					<text key={event.event_id} fg={theme.purple}>
						{truncateEnd(`${event.event_type} ${event.position ?? "?"}: ${event.message}`, 90)}
					</text>
				))
			)}
		</>
	);
}

export function TeamDetail(props: {
	team?: TeamSummary;
	detail?: TuiTeamDetail;
	selectedMemberIndex: number;
	focus: TeamFocus;
	activeTab?: TeamDetailTab;
	loadingDetail?: boolean;
	loadingFrame?: string;
}): ReactNode {
	const { team, detail, selectedMemberIndex, focus, activeTab = "overview", loadingDetail, loadingFrame } = props;
	if (!team) {
		return (
			<box title="Detail" borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} flexGrow={1} padding={1}>
				<text fg={theme.muted}>No team selected.</text>
			</box>
		);
	}
	const status = detail?.status?.status ?? team.status;
	return (
		<box
			title="Detail"
			borderStyle="single"
			borderColor={focus === "members" ? theme.cyan : theme.border}
			backgroundColor={theme.panel}
			flexGrow={1}
			padding={1}
		>
			{loadingDetail ? <text fg={theme.yellow}>{`${loadingFrame ?? "⠋"} Loading detail…`}</text> : null}
			<box height={1}>
				<text fg={statusAccent(status)}>{`${statusGlyph(status)} ${status}`}</text>
				<text fg={theme.strong}>{`  ${team.team_id}  ${truncateEnd(team.title, 56)}`}</text>
			</box>
			{team.objective ? <text fg={theme.muted}>{truncateEnd(team.objective, 90)}</text> : null}
			{detail?.error ? <text fg={theme.red}>{`Team status error: ${detail.error}`}</text> : null}
			{activeTab === "overview" ? renderOverview(team, detail) : null}
			{activeTab === "members" ? renderMembers(detail, selectedMemberIndex, focus) : null}
			{activeTab === "attention" ? renderAttention(detail) : null}
			{activeTab === "knowledge" ? renderKnowledge(detail) : null}
		</box>
	);
}
