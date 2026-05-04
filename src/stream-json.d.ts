// types/stream-json.d.ts

declare module "stream-json" {
  export const parser: any;
}

declare module "stream-json/streamers/StreamValues.js" {
  export const streamValues: any;
}

declare module "stream-json/streamers/StreamArray.js" {
  export const streamArray: any;
}

declare module "stream-chain" {
  export function chain(streams: any[]): any;
}