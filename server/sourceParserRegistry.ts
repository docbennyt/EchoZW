import {
  HIT_MASTER_PARSER_VERSION,
  HitParserError,
  parseHitSistMasterSnapshot,
  type HitParserResult,
  type HitSnapshotParserInput,
} from "../src/domain/hitMasterSnapshotParser.js";
import { HIT_TIMETABLE_PARSER_PROFILE } from "./sourceSnapshotConfig.js";

export type SourceParserResult = HitParserResult;
export type SourceParserInput = HitSnapshotParserInput;

export type SourceParser = {
  parse: (input: SourceParserInput) => SourceParserResult;
  parserVersion: string;
  profile: string;
};

export class SourceParserRegistryError extends Error {
  constructor(
    public readonly code: "SOURCE_PARSER_PROFILE_UNKNOWN",
    message: string,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const hitSistMasterParser: SourceParser = {
  parse: parseHitSistMasterSnapshot,
  parserVersion: HIT_MASTER_PARSER_VERSION,
  profile: HIT_TIMETABLE_PARSER_PROFILE,
};

const sourceParsers = new Map<string, SourceParser>([
  [hitSistMasterParser.profile, hitSistMasterParser],
]);

export function resolveSourceParser(profile: string | null | undefined) {
  const normalizedProfile = profile?.trim();
  if (!normalizedProfile) {
    throw new SourceParserRegistryError(
      "SOURCE_PARSER_PROFILE_UNKNOWN",
      "No parser profile is configured for this source.",
    );
  }

  const parser = sourceParsers.get(normalizedProfile);
  if (!parser) {
    throw new SourceParserRegistryError(
      "SOURCE_PARSER_PROFILE_UNKNOWN",
      "The configured source parser profile is not registered.",
      { profile: normalizedProfile },
    );
  }
  return parser;
}

export { HitParserError };
