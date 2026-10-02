/** Text helpers shared between the message renderer and voice output. */

/** Remove <think> reasoning blocks so they are neither shown nor spoken. */
export function stripThinkTags(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
  cleaned = cleaned.replace(/^[\s\S]*?<\/think>\s*/i, '');
  return cleaned.trim();
}

/**
 * Convert markdown-rich assistant output into natural speech.
 *
 * The UI should keep markdown for visual structure, but a TTS engine must not
 * receive formatting tokens such as **, #, `, pipes, or raw URLs. Otherwise
 * voices literally pronounce "asterisco", "hashtag", etc.
 */
export function toSpeechText(text: string): string {
  let cleaned = stripThinkTags(text);

  // Fenced code is useful on screen but unpleasant when read verbatim.
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' Trecho de código omitido. ');

  // Images/links: keep the human-readable label and drop the target URL.
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');

  // Headings, blockquotes and list markers.
  cleaned = cleaned.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  cleaned = cleaned.replace(/^\s*>+\s?/gm, '');
  cleaned = cleaned.replace(/^\s*[-+*]\s+/gm, '');
  cleaned = cleaned.replace(/^\s*(\d+)[.)]\s+/gm, '$1. ');

  // Markdown emphasis / strike-through / inline code.
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');
  cleaned = cleaned.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
  cleaned = cleaned.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');
  cleaned = cleaned.replace(/`([^\n`]+)`/g, '$1');

  // Remove leftover formatting glyphs and HTML tags.
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = cleaned.replace(/[|]+/g, ', ');
  cleaned = cleaned.replace(/[*_#~]/g, '');

  // Preserve natural pauses while avoiding long gaps from formatted blocks.
  cleaned = cleaned
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned;
}
