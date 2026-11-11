import type { JSX } from 'preact';
import type { FinalSceneProps, PlayingSceneProps, ResultsSceneProps, StandingsPanelProps } from './types';

// Placeholder scenes: replaced by the real show.
export function PlayingScene(props: PlayingSceneProps): JSX.Element {
  return <div>{props.game.title}</div>;
}

export function ResultsScene(props: ResultsSceneProps): JSX.Element {
  return <div>{props.results.rows.length}</div>;
}

export function FinalScene(props: FinalSceneProps): JSX.Element {
  return <div>{props.players.length}</div>;
}

export function StandingsPanel(props: StandingsPanelProps): JSX.Element {
  return <div>{props.players.length}</div>;
}
