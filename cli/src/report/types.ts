export interface BenchmarkSuccess {
  status: "success";
  runsPerSecond: number;
  goodnessOfFit: number;
}

export interface BenchmarkFailure {
  status: "failure";
  error: string;
}

export interface BenchmarkRunning {
  status: "running";
  progress: number;
}

export type BenchmarkStatus =
  | BenchmarkSuccess
  | BenchmarkFailure
  | BenchmarkRunning;

export interface SingleResult {
  kind: "single";
  name: string;
  status: BenchmarkStatus;
}

export interface SeriesEntry {
  name: string;
  status: BenchmarkStatus;
}

export interface SeriesResult {
  kind: "series";
  name: string;
  entries: SeriesEntry[];
}

export interface GroupResult {
  kind: "group";
  name: string;
  children: BenchmarkResult[];
}

export type BenchmarkResult = SingleResult | SeriesResult | GroupResult;

export interface ProgressMessage {
  type: "progress";
  data: unknown;
}

export interface ResultMessage {
  type: "result";
  data: BenchmarkResult;
}

export type PortMessage = ProgressMessage | ResultMessage;
