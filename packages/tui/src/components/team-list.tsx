import type { TeamSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import { truncateEnd } from "../format.ts";
import { statusAccent, statusGlyph, theme } from "../theme.ts";

const TEAM_LIST_WIDTH = 42;
const TEAM_ROW_WIDTH = 38;

export function teamRow(team: TeamSummary, selected: boolean): string {
	const marker = selected ? "›" : " ";
	const glyph = statusGlyph(team.status);
	const id = team.team_id.padEnd(10).slice(0, 10);
	const status = team.status.padEnd(7).slice(0, 7);
	const count = `${team.task_counts.total}t`.padEnd(4).slice(0, 4);
	const title = team.title || team.objective || "-";
	return truncateEnd(`${marker} ${glyph} ${id} ${status} ${count} ${title}`, TEAM_ROW_WIDTH);
}

function rowBackground(index: number, selected: boolean): string {
	if (selected) return theme.rowSelected;
	return index % 2 === 0 ? theme.rowAlt : theme.row;
}

export function TeamList(props: { teams: TeamSummary[]; selectedIndex: number }): ReactNode {
	const { teams, selectedIndex } = props;
	return (
		<box
			title="Teams"
			borderStyle="single"
			borderColor={theme.border}
			backgroundColor={theme.panel}
			width={TEAM_LIST_WIDTH}
			flexShrink={0}
			padding={1}
		>
			<box backgroundColor={theme.panelAlt} height={1}>
				<text fg={theme.muted}>{"    TEAM_ID    STATUS  N    TITLE"}</text>
			</box>
			{teams.length === 0 ? (
				<text fg={theme.muted}>No teams found.</text>
			) : (
				teams.map((team, index) => {
					const selected = index === selectedIndex;
					return (
						<box key={team.team_id} backgroundColor={rowBackground(index, selected)} height={1}>
							<text fg={selected ? theme.strong : statusAccent(team.status)}>{teamRow(team, selected)}</text>
						</box>
					);
				})
			)}
		</box>
	);
}
