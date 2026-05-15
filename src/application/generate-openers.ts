import type { FumenCodec, FumenUrls } from "../domain/fumen";
import { createFumenCodec } from "../infrastructure/fumen/tetris-fumen-codec";
import type { NativeComboTable, NativeKickTable, NativeSpinMode } from "../infrastructure/native/binding-types";
import { createOpenerFumenPages } from "./create-opener-fumen";
import {
  mineOpenerBagTemplates,
  searchOpenerBeamWithPlacements,
  type OpenerBagTemplateMining,
  type SearchOpenerBeamNode,
  type SearchPiece
} from "./search-opener";

export interface GenerateOpenersRules {
  readonly spinMode: NativeSpinMode;
  readonly comboTable: NativeComboTable;
  readonly kickTable: NativeKickTable;
  readonly allow180: boolean;
}

export interface GenerateOpenersInput {
  readonly bag?: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
  readonly maxQueues?: number;
  readonly top?: number;
  readonly includePath?: boolean;
  readonly previewMode?: GeneratedOpenerPreviewMode;
  readonly rules?: Partial<GenerateOpenersRules>;
  readonly fumenCodec?: FumenCodec;
}

export type GeneratedOpenerPreviewMode = "placements" | "final-board";

export interface GeneratedOpenerTemplate {
  readonly rank: number;
  readonly key: string;
  readonly supportQueues: number;
  readonly supportRate: number;
  readonly bestQueue: string;
  readonly bestScore: number;
  readonly weightedScore: number;
  readonly rows: readonly number[];
  readonly hold: string | null;
  readonly queueIndex: number;
  readonly depth: number;
  readonly path: readonly string[];
  readonly attack: number;
  readonly difficultAttack: number;
  readonly points: number;
  readonly allClears: number;
  readonly difficultClears: number;
  readonly spinClears: number;
  readonly spinAttack: number;
  readonly tSpinClears: number;
  readonly tSpinAttack: number;
  readonly combo: number;
  readonly backToBackChain: number;
  readonly tSpinPotential: number;
  readonly holes: number;
  readonly bumpiness: number;
  readonly previewUrl: string;
  readonly previewMode: GeneratedOpenerPreviewMode;
  readonly previewPageCount: number;
  readonly urls: FumenUrls;
}

export interface GeneratedOpenersReport {
  readonly generatedAt: string;
  readonly bag: string;
  readonly hold: boolean;
  readonly beamWidth: number;
  readonly maxDepth: number;
  readonly maxQueues: number;
  readonly top: number;
  readonly previewMode: GeneratedOpenerPreviewMode;
  readonly rules: GenerateOpenersRules;
  readonly mining: Omit<OpenerBagTemplateMining, "topTemplates">;
  readonly templates: readonly GeneratedOpenerTemplate[];
}

export const DEFAULT_GENERATE_OPENERS_RULES = {
  spinMode: "ALL-MINI+",
  comboTable: "MULTIPLIER",
  kickTable: "SRS+",
  allow180: true
} as const satisfies GenerateOpenersRules;

export function generateOpeners(input: GenerateOpenersInput = {}): GeneratedOpenersReport {
  const bag = input.bag === undefined ? "TIJLOSZ" : typeof input.bag === "string" ? input.bag : input.bag.join("");
  const hold = input.hold ?? true;
  const beamWidth = input.beamWidth ?? 128;
  const maxDepth = input.maxDepth ?? Math.min(7, bag.length);
  const maxQueues = input.maxQueues ?? 0;
  const top = input.top ?? 8;
  const previewMode = input.previewMode ?? "placements";
  const rules = { ...DEFAULT_GENERATE_OPENERS_RULES, ...input.rules };
  const fumenCodec = input.fumenCodec ?? createFumenCodec();
  const mining = mineOpenerBagTemplates({
    bag,
    hold,
    beamWidth,
    maxDepth,
    maxQueues,
    topTemplateCount: top,
    includePath: input.includePath ?? true,
    comboTable: rules.comboTable,
    kickTable: rules.kickTable,
    spinMode: rules.spinMode,
    allow180: rules.allow180
  });
  const detailedNodesByPreviewKey = new Map<string, readonly SearchOpenerBeamNode[]>();

  return {
    generatedAt: new Date().toISOString(),
    bag: mining.bag,
    hold,
    beamWidth,
    maxDepth,
    maxQueues,
    top,
    previewMode,
    rules,
    mining: {
      bag: mining.bag,
      totalQueues: mining.totalQueues,
      searchedQueues: mining.searchedQueues,
      exact: mining.exact,
      buildableQueues: mining.buildableQueues,
      templateCount: mining.templateCount
    },
    templates: mining.topTemplates.map((template, index) => {
      const preview = createTemplatePreview(template, index + 1, {
        beamWidth,
        hold,
        maxDepth,
        previewMode,
        rules,
        detailedNodesByPreviewKey
      });
      const data = fumenCodec.encodePages(preview.pages);
      const urls = fumenCodec.createUrls(data);
      return {
        rank: index + 1,
        key: template.key,
        supportQueues: template.supportQueues,
        supportRate: template.supportRate,
        bestQueue: template.bestQueue,
        bestScore: template.bestScore,
        weightedScore: template.weightedScore,
        rows: template.rows,
        hold: template.hold ?? null,
        queueIndex: template.queueIndex,
        depth: template.depth,
        path: template.path,
        attack: template.attack,
        difficultAttack: template.difficultAttack,
        points: template.points,
        allClears: template.allClears,
        difficultClears: template.difficultClears,
        spinClears: template.spinClears ?? 0,
        spinAttack: template.spinAttack ?? 0,
        tSpinClears: template.tSpinClears,
        tSpinAttack: template.tSpinAttack,
        combo: template.combo,
        backToBackChain: template.backToBackChain,
        tSpinPotential: template.tSpinPotential,
        holes: template.holes,
        bumpiness: template.bumpiness,
        previewUrl: urls.view,
        previewMode: preview.mode,
        previewPageCount: preview.pages.length,
        urls
      };
    })
  };
}

export function renderGeneratedOpenersConsole(report: GeneratedOpenersReport, top = report.templates.length): string {
  const lines = [
    `generated openers: bag=${report.bag} depth=${report.maxDepth} beam=${report.beamWidth} queues=${report.mining.searchedQueues}/${report.mining.totalQueues}`,
    `rules: spins=${report.rules.spinMode} combo=${report.rules.comboTable} kicks=${report.rules.kickTable} 180=${formatBooleanRule(report.rules.allow180)}`
  ];
  for (const template of report.templates.slice(0, top)) {
    lines.push(
      [
        `#${template.rank}`,
        `support=${template.supportQueues}/${report.mining.searchedQueues} (${formatPercent(template.supportRate)})`,
        `queue=${template.bestQueue}`,
        `attack=${template.attack}`,
        `diff=${template.difficultAttack}`,
        `tspin=${template.tSpinClears}/${template.tSpinAttack}`,
        `b2b=${template.backToBackChain}`,
        `holes=${template.holes}`,
        `view=${template.previewUrl}`
      ].join(" ")
    );
    if (template.path.length > 0) {
      lines.push(`path: ${template.path.join(" ")}`);
    }
  }
  return lines.join("\n");
}

export function renderGeneratedOpenersMarkdown(report: GeneratedOpenersReport): string {
  const lines = [
    "# Generated openers",
    "",
    `Generated: ${report.generatedAt}`,
    `Bag: ${report.bag}`,
    `Hold: ${report.hold}`,
    `Beam: ${report.beamWidth}`,
    `Depth: ${report.maxDepth}`,
    `Queues: ${report.mining.searchedQueues}/${report.mining.totalQueues}`,
    `Preview: ${report.previewMode}`,
    `Rules: spins=${report.rules.spinMode}, combo=${report.rules.comboTable}, kicks=${report.rules.kickTable}, 180=${formatBooleanRule(report.rules.allow180)}`,
    "",
    "| rank | support | queue | hold | attack | difficult attack | spin | spin attack | tspin | tspin attack | b2b | combo | all clears | tspin potential | holes | bumpiness | pages | path | preview |",
    "| ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |"
  ];
  for (const template of report.templates) {
    lines.push(
      [
        String(template.rank),
        `${template.supportQueues} (${formatPercent(template.supportRate)})`,
        template.bestQueue,
        template.hold ?? "-",
        String(template.attack),
        String(template.difficultAttack),
        String(template.spinClears),
        String(template.spinAttack),
        String(template.tSpinClears),
        String(template.tSpinAttack),
        String(template.backToBackChain),
        String(template.combo),
        String(template.allClears),
        String(template.tSpinPotential),
        String(template.holes),
        String(template.bumpiness),
        String(template.previewPageCount),
        template.path.join(" "),
        `[view](${template.previewUrl})`
      ].join(" | ")
    );
  }
  lines.push("");
  return lines.join("\n");
}

interface TemplatePreviewOptions {
  readonly beamWidth: number;
  readonly hold: boolean;
  readonly maxDepth: number;
  readonly previewMode: GeneratedOpenerPreviewMode;
  readonly rules: GenerateOpenersRules;
  readonly detailedNodesByPreviewKey: Map<string, readonly SearchOpenerBeamNode[]>;
}

interface TemplatePreview {
  readonly mode: GeneratedOpenerPreviewMode;
  readonly pages: ReturnType<typeof createOpenerFumenPages>;
}

function createTemplatePreview(
  template: OpenerBagTemplateMining["topTemplates"][number],
  rank: number,
  options: TemplatePreviewOptions
): TemplatePreview {
  if (options.previewMode === "placements") {
    const node = findDetailedTemplateNode(template, options);
    if (node !== undefined) {
      return {
        mode: "placements",
        pages: createOpenerFumenPages(node, { title: formatTemplateComment(rank, template) })
      };
    }
  }

  return {
    mode: "final-board",
    pages: [
      {
        rows: Uint16Array.from(template.rows),
        comment: formatTemplateComment(rank, template)
      }
    ]
  };
}

function findDetailedTemplateNode(
  template: OpenerBagTemplateMining["topTemplates"][number],
  options: TemplatePreviewOptions
): SearchOpenerBeamNode | undefined {
  const cacheKey = [
    template.bestQueue,
    options.beamWidth,
    options.hold,
    options.maxDepth,
    options.rules.comboTable,
    options.rules.kickTable,
    options.rules.spinMode,
    options.rules.allow180
  ].join("|");
  let nodes = options.detailedNodesByPreviewKey.get(cacheKey);
  if (nodes === undefined) {
    nodes = searchOpenerBeamWithPlacements({
      queue: template.bestQueue,
      beamWidth: options.beamWidth,
      hold: options.hold,
      maxDepth: options.maxDepth,
      comboTable: options.rules.comboTable,
      kickTable: options.rules.kickTable,
      spinMode: options.rules.spinMode,
      allow180: options.rules.allow180
    });
    options.detailedNodesByPreviewKey.set(cacheKey, nodes);
  }
  return nodes.find((node) => matchesTemplateNode(template, node));
}

function formatBooleanRule(value: boolean): "on" | "off" {
  return value ? "on" : "off";
}

function matchesTemplateNode(template: OpenerBagTemplateMining["topTemplates"][number], node: SearchOpenerBeamNode): boolean {
  return (
    node.depth === template.depth &&
    node.queueIndex === template.queueIndex &&
    rowsEqual(node.rows, template.rows) &&
    (node.hold ?? null) === (template.hold ?? null) &&
    node.attack === template.attack &&
    node.difficultAttack === template.difficultAttack &&
    node.points === template.points &&
    node.allClears === template.allClears &&
    node.difficultClears === template.difficultClears &&
    (node.spinClears ?? 0) === (template.spinClears ?? 0) &&
    (node.spinAttack ?? 0) === (template.spinAttack ?? 0) &&
    node.tSpinClears === template.tSpinClears &&
    node.tSpinAttack === template.tSpinAttack &&
    node.combo === template.combo &&
    node.backToBackChain === template.backToBackChain
  );
}

function rowsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((row, index) => row === right[index]);
}

function formatTemplateComment(rank: number, template: OpenerBagTemplateMining["topTemplates"][number]): string {
  const path = template.path.length === 0 ? "" : ` path=${template.path.join(" ")}`;
  return `#${rank} support=${template.supportQueues} attack=${template.attack} tspin=${template.tSpinClears}/${template.tSpinAttack} b2b=${template.backToBackChain}${path}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
