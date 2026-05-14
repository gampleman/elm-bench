declare module "asciichart" {
  interface PlotOptions {
    height?: number;
    offset?: number;
    padding?: string;
    colors?: string[];
    format?: (x: number) => string;
    min?: number;
    max?: number;
  }

  export function plot(series: number[][] | number[], options?: PlotOptions): string;

  export const black: string;
  export const red: string;
  export const green: string;
  export const yellow: string;
  export const blue: string;
  export const magenta: string;
  export const cyan: string;
  export const white: string;
  export const darkgray: string;
  export const lightred: string;
  export const lightgreen: string;
  export const lightyellow: string;
  export const lightblue: string;
  export const lightmagenta: string;
  export const lightcyan: string;
  export const reset: string;
}
