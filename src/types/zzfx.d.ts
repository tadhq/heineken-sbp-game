// Minimal typings for the parts of zzfx (MIT) this project uses.
declare module "zzfx" {
  export const ZZFX: {
    audioContext: AudioContext;
    sampleRate: number;
    volume: number;
    buildSamples(...params: number[]): number[];
  };
}
