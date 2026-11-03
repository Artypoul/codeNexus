import type MarkdownIt from "markdown-it";

const CJK_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;

function isCjkCodePoint(codePoint: number) {
  return codePoint > 0 && CJK_SCRIPT_PATTERN.test(String.fromCodePoint(codePoint));
}

function readPreviousCodePoint(source: string, position: number) {
  if (position <= 0) return 0x20;
  const lowSurrogate = source.charCodeAt(position - 1);
  if (lowSurrogate >= 0xdc00 && lowSurrogate <= 0xdfff && position >= 2) {
    const highSurrogate = source.charCodeAt(position - 2);
    if (highSurrogate >= 0xd800 && highSurrogate <= 0xdbff) {
      return source.codePointAt(position - 2) ?? lowSurrogate;
    }
  }
  return lowSurrogate;
}

/**
 * CommonMark rejects emphasis when the delimiter's inner edge is punctuation and
 * its outer edge is a letter. That pattern is normal in CJK prose, for example
 * `**结论。**下一句`, so include CJK letters in the emphasis context.
 */
export function installCjkFriendlyEmphasis(md: MarkdownIt): void {
  const BaseState = md.inline.State;

  class CjkFriendlyState extends BaseState {
    scanDelims(start: number, canSplitWord: boolean) {
      const marker = this.src.charCodeAt(start);
      const lastChar = readPreviousCodePoint(this.src, start);

      let position = start;
      while (position < this.posMax && this.src.charCodeAt(position) === marker) position += 1;
      const length = position - start;
      const nextChar = position < this.posMax ? (this.src.codePointAt(position) ?? 0x20) : 0x20;

      const isLastWhiteSpace = this.md.utils.isWhiteSpace(lastChar);
      const isNextWhiteSpace = this.md.utils.isWhiteSpace(nextChar);
      if (isLastWhiteSpace || isNextWhiteSpace) {
        return { can_open: !isNextWhiteSpace, can_close: !isLastWhiteSpace, length };
      }

      const isLastPunctChar =
        this.md.utils.isMdAsciiPunct(lastChar) || this.md.utils.isPunctChar(String.fromCodePoint(lastChar));
      const isNextPunctChar =
        this.md.utils.isMdAsciiPunct(nextChar) || this.md.utils.isPunctChar(String.fromCodePoint(nextChar));

      let canOpen = isLastPunctChar;
      let canClose = isNextPunctChar;
      if (canSplitWord) {
        const cjkContext = isCjkCodePoint(lastChar) || isCjkCodePoint(nextChar);
        canOpen ||= cjkContext || !isNextPunctChar;
        canClose ||= cjkContext || !isLastPunctChar;
      }

      return { can_open: canOpen, can_close: canClose, length };
    }
  }

  md.inline.State = CjkFriendlyState;
}
