import type { TaskSummary, TeamSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import type { TuiTeamDetail } from "../data.ts";
import { truncateEnd } from "../format.ts";
import type { TeamFocus } from "../tui-state.ts";
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

export function TeamDetail(props: {
	team?: TeamSummary;
	detail?: TuiTeamDetail;
	selectedMemberIndex: number;
	focus: TeamFocus;
	loadingDetail?: boolean;
	loadingFrame?: string;
}): ReactNode {
	const { team, detail, selectedMemberIndex, focus, loadingDetail, loadingFrame } = props;
	if (!team) {
		return (
			<box title="Detail" borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} flexGrow={1} padding={1}>
				<text fg={theme.muted}>No team selected.</text>
			</box>
		);
	}
	const status = detail?.status?.status ?? team.status;
	const attention = detail?.attentionItems ?? [];
	const hints = detail?.manualSteerHints ?? [];
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
			<text fg={theme.cyan}>LANES</text>
			{LANE_ORDER.map((lane) => (
				<LaneRow key={lane} lane={lane} tasks={detail?.lanes[lane] ?? []} />
			))}
			<text fg={theme.cyan}>{`ATTENTION ${attention.length}`}</text>
			{attention.length === 0 ? (
				<text fg={theme.muted}>No attention items.</text>
			) : (
				attention.slice(0, 3).map((item) => (
					<text key={`${item.sequence}:${item.task_id}`} fg={theme.yellow}>
						{truncateEnd(`${item.position ?? "?"} ${item.task_id}: ${item.message_preview ?? item.message ?? item.type}`, 90)}
					</text>
				))
			)}
			{hints.length > 0 ? <text fg={theme.muted}>{`Manual steer hints: ${hints.length}`}</text> : null}
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
		</box>
	);
}
