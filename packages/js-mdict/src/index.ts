export type {
  MDictOptions,
  MDictHeader,
  KeyHeader,
  KeyInfoItem,
  RecordHeader,
  RecordInfo,
  KeyWordItem,
} from './mdict-base';

export { Mdict } from './mdict';
export { MDX } from './mdx';
export type { FuzzyWord } from './mdx';
export { MDD } from './mdd';

// Browser-friendly scanner. The Node-only `FileScanner` lives at
// './file-scanner.js' to keep the main entry free of `node:fs`.
export { BlobScanner } from './scanner';
export type { Scanner } from './scanner';
