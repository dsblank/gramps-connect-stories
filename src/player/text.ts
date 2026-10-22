// Slide text markup (spec/1.0/README.md section 4): **bold**, *italic*,
// line breaks, and blank lines between paragraphs -- nothing else. Parsed
// into plain data rather than HTML, so a viewer can never be tricked into
// rendering markup a story file smuggles in.

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** Paragraphs of lines of spans. */
export type ParsedText = TextSpan[][][];

// Bold before italic, so a bold span's own ** pair isn't read as two empty
// italic spans. Neither crosses a line break.
const MARKERS = /\*\*([^\n]+?)\*\*|\*([^\n]+?)\*/g;

function parseLine(line: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let last = 0;
  for (const match of line.matchAll(MARKERS)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ text: line.slice(last, index) });
    if (match[1] !== undefined) spans.push({ text: match[1], bold: true });
    else spans.push({ text: match[2], italic: true });
    last = index + match[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last) });
  return spans;
}

export function parseStoryText(text: string): ParsedText {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => paragraph.split("\n").map(parseLine));
}
