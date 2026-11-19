export type {
  LonLat,
  MediaItem,
  Overlay,
  Place,
  Presentation,
  Slide,
  SlideMedia,
  StoryDate,
  StoryDoc,
} from "./types.js";
export {
  CURRENT_MAJOR,
  FORMAT_ID,
  FORMAT_VERSION,
  parseVersion,
  StoryFormatError,
  SUPPORTED_FORMAT_MAJORS,
  upgradeStory,
  type ParsedVersion,
  type StoryErrorCode,
} from "./version.js";
export { validate, type StoryIssue, type ValidationResult } from "./validate.js";
export {
  mediaBlob,
  readStoryZip,
  StoryValidationError,
  writeStoryZip,
  type ReadLimits,
  type StoryPackage,
} from "./zip.js";
export {
  DEFAULT_MAX_EDGE,
  encodingCandidates,
  fitWithin,
  optimizeImage,
  type ImagePurpose,
  type OptimizedImage,
  type OptimizeOptions,
} from "./image.js";
