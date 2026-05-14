export const FUMEN_VIEWER_BASE_URL = "https://fumen.zui.jp/";

export type FumenData = string;
export type FumenUrlMode = "edit" | "view" | "list" | "list-min";
export type FumenMino = "I" | "L" | "O" | "Z" | "T" | "J" | "S";
export type FumenPiece = FumenMino | "X" | "_";
export type FumenCell = FumenPiece | "GRAY" | "EMPTY";
export type FumenCellRow = string | readonly FumenCell[];
export type FumenRotation = "spawn" | "right" | "reverse" | "left";

export interface FumenOperation {
  readonly type: FumenMino;
  readonly rotation: FumenRotation;
  readonly x: number;
  readonly y: number;
}

export interface FumenQuizInput {
  readonly hold?: FumenMino;
  readonly current?: FumenMino;
  readonly next?: readonly FumenMino[] | string;
}

export interface FumenPageInput {
  readonly rows?: Uint16Array;
  readonly field?: string;
  readonly fieldRows?: readonly FumenCellRow[];
  readonly garbage?: string;
  readonly garbageRow?: FumenCellRow;
  readonly comment?: string;
  readonly quiz?: FumenQuizInput | string;
  readonly operation?: FumenOperation;
  readonly flags?: {
    readonly lock?: boolean;
    readonly mirror?: boolean;
    readonly colorize?: boolean;
    readonly rise?: boolean;
  };
}

export interface DecodedFumenPage {
  readonly index: number;
  readonly comment: string;
  readonly operation?: FumenOperation;
  readonly flags: {
    readonly lock: boolean;
    readonly mirror: boolean;
    readonly colorize: boolean;
    readonly rise: boolean;
    readonly quiz: boolean;
  };
  readonly field: string;
  readonly fieldRows: readonly string[];
  readonly garbage: string;
  readonly quiz?: string;
}

export interface FumenUrls {
  readonly edit: string;
  readonly view: string;
  readonly list: string;
  readonly listMin: string;
}

export interface FumenCodec {
  encodePages(pages: readonly FumenPageInput[]): FumenData;
  decode(input: string): readonly DecodedFumenPage[];
  createUrl(data: string, mode?: FumenUrlMode): string;
  createUrls(data: string): FumenUrls;
}
